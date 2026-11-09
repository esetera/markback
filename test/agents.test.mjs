import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { writePicture } from './helpers.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const home = mkdtempSync(join(tmpdir(), 'review-agents-'))
process.env.REVIEW_HOME = home
const { agentsMd, installSkills, readSkills, BLOCK_START, BLOCK_END } = await import('../lib/skills.mjs')
const { receive } = await import('../lib/store.mjs')
after(() => rmSync(home, { recursive: true, force: true }))
const CLI = join(ROOT, 'review.mjs')
const AGENTS = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8')

test('AGENTS.md is made from the skills, and is not out of date', () => {
  assert.equal(AGENTS, agentsMd(), 'run: node scripts/agents-md.mjs')
  for (const skill of readSkills()) assert.ok(AGENTS.includes(`## ${skill.name}\n`), `${skill.name} is in AGENTS.md`)
  assert.doesNotMatch(AGENTS, /CLAUDE_PLUGIN_ROOT|\$ARGUMENTS/, 'nothing only Claude Code fills in')
})

test('every skill has the name and description all agents need, and its name is its folder (Cursor insists)', () => {
  for (const skill of readSkills()) {
    assert.equal(skill.fields.name, skill.name)
    assert.match(skill.name, /^[a-z0-9-]+$/)
    assert.ok(skill.fields.description?.length > 20, `${skill.name} has a description`)
  }
})

test('install-skills writes skill folders any agent can follow, and a block in a project AGENTS.md that a rerun replaces', () => {
  const to = join(home, 'agents-skills')
  const project = join(home, 'project')
  mkdirSync(project)
  writeFileSync(join(project, 'AGENTS.md'), '# My project\n\nUse tabs.\n')
  const run = () => execFileSync('node', [CLI, 'install-skills', '--to', to, '--agents-md', project], { encoding: 'utf8' })
  run()
  run()
  for (const skill of readSkills()) {
    const text = readFileSync(join(to, skill.name, 'SKILL.md'), 'utf8')
    assert.match(text, new RegExp(`^---\\nname: ${skill.name}\\ndescription: `))
    assert.doesNotMatch(text, /CLAUDE_PLUGIN_ROOT|\$ARGUMENTS/)
  }
  assert.ok(readFileSync(join(to, 'push-screens', 'SKILL.md'), 'utf8').includes(`node "${CLI}"`), 'says where Markback is')
  const mine = readFileSync(join(project, 'AGENTS.md'), 'utf8')
  assert.match(mine, /^# My project\n\nUse tabs\.\n/, 'what was there stays')
  assert.doesNotMatch(mine, /Working on Markback itself/, 'the line for Markback\'s own contributors stays in its own repo')
  assert.equal(mine.split(BLOCK_START).length, 2, 'once, however often it runs')
  assert.ok(mine.includes(`node "${CLI}"`), 'says where Markback is')
  execFileSync('node', [CLI, 'install-skills', '--to', to, '--agents-md', project, '--no-path'], { encoding: 'utf8' })
  const pathless = readFileSync(join(project, 'AGENTS.md'), 'utf8')
  assert.ok(!pathless.includes(ROOT), '--no-path leaves no path of this computer in a file that may be committed')
  assert.equal(pathless.split(BLOCK_START).length, 2)
  assert.ok(mine.includes(BLOCK_END))
})

/** Splits one shell line the way a shell would, for the plain quoting AGENTS.md uses. */
const words = line => [...line.matchAll(/"([^"]*)"|(\S+)/g)].map(m => m[1] ?? m[2])
const commandsIn = text => [...text.matchAll(/```bash\n([\s\S]*?)```/g)].flatMap(m => m[1].split('\n')).map(l => l.trim()).filter(l => l.startsWith('review '))

test('every command AGENTS.md teaches is one the CLI knows, with flags it reads', () => {
  const source = readFileSync(CLI, 'utf8') + readFileSync(join(ROOT, 'lib', 'skills.mjs'), 'utf8')
  const lines = commandsIn(AGENTS)
  assert.ok(lines.length >= 15, `${lines.length} commands taught`)
  for (const line of lines) {
    const [, command, ...rest] = words(line)
    assert.ok(source.includes(`command === '${command}'`) || ['ideas'].includes(command), `${command} is a command`)
    for (const flag of rest.filter(w => w.startsWith('--')).map(w => w.slice(2))) {
      assert.ok(source.includes(`flags.${flag}`) || source.includes(`need('${flag}')`) || source.includes(`flags['${flag}']`) || source.includes(`flags.${flag.replace(/-./g, c => c[1].toUpperCase())}`), `--${flag} in "${line}" is read`)
    }
  }
})

test('another agent, with AGENTS.md alone: it pushes, the person answers, and it reads the mark back', () => {
  // The agent: it knows nothing but the lines in AGENTS.md, and runs them as written, with its own pictures.
  const after = join(home, 'after.png')
  const before = join(home, 'before.png')
  writePicture(after, 40, 30)
  writePicture(before, 40, 30)
  const run = line => execFileSync('node', [CLI, ...words(line).slice(1)], { cwd: home, env: { ...process.env, REVIEW_HOME: home }, encoding: 'utf8' })
  const pushLine = commandsIn(AGENTS).find(l => l.startsWith('review push --app "My app"'))
  assert.ok(pushLine, 'AGENTS.md shows a push')
  run(`${pushLine.replace('after.png', after).replace('before.png', before)} --from "Another agent"`)
  const queued = JSON.parse(readFileSync(join(home, 'queue', 'my-app', 'home-light.json'), 'utf8'))
  assert.equal(queued.from, 'Another agent')
  assert.deepEqual(queued.check, ['Does the heading line up?'])
  // The person draws a box and presses Send.
  receive({ appSlug: 'my-app', id: 'home-light', png: null, shapes: [{ type: 'box', colour: '#e53935', box: { x: 4, y: 4, w: 10, h: 8 } }], notes: 'Move this up', verdict: 'changes', imageSize: { w: 40, h: 30 } })
  const readLine = commandsIn(AGENTS).find(l => l.startsWith('review read --app "My app" --latest --json'))
  const [answer] = JSON.parse(run(readLine))
  assert.equal(answer.verdict, 'changes')
  assert.equal(answer.notes, 'Move this up')
  assert.deepEqual(answer.shapes[0].box, { x: 4, y: 4, w: 10, h: 8 })
  assert.ok(existsSync(answer.afterImage))
})
