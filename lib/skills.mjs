/**
 * The skills in skills/ are the one source of what an agent is taught. Claude Code reads them as a plugin. Every other agent
 * gets them from here: as skill folders for agents that read SKILL.md (Codex and Cursor read ~/.agents/skills),
 * and as one AGENTS.md for agents that read only that. Nothing here is written by hand twice, so the two cannot drift.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKILLS = join(ROOT, 'skills')
/** The order a newcomer meets them in. Any skill not named here follows, by name. */
const ORDER = ['markback', 'push-screens', 'read-marks', 'workflow-sketches', 'ideas-and-queue']

export const BLOCK_START = '<!-- markback:start -->'
export const BLOCK_END = '<!-- markback:end -->'

/** Each skill: its folder name, its frontmatter as text and as fields, and its body. */
export function readSkills(dir = SKILLS) {
  const names = readdirSync(dir).filter(name => existsSync(join(dir, name, 'SKILL.md')))
  names.sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b))
  return names.map(name => {
    const text = readFileSync(join(dir, name, 'SKILL.md'), 'utf8')
    const [, front = '', body = text] = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text) ?? []
    const fields = Object.fromEntries(front.split('\n').map(line => /^([a-z-]+):\s*(.*)$/.exec(line)).filter(Boolean).map(([, k, v]) => [k, v.replace(/^"(.*)"$/, '$1')]))
    return { name, front, fields, body: body.trim() }
  })
}

/**
 * What only Claude Code fills in, said for any agent: where Markback is, and what the person asked. `root` is the folder
 * that holds review.mjs, or null to say it in words.
 */
export function forAnyAgent(text, root) {
  const at = root ? `node "${join(root, 'review.mjs')}"` : '`node review.mjs` in the Markback folder'
  return text
    .replace(/If `review` is not found, use `node <markback folder>\/review\.mjs` in its place \(in Claude Code, `node "\$\{CLAUDE_PLUGIN_ROOT\}\/review\.mjs"`\)\./g, root ? `If \`review\` is not found, use \`${at}\` in its place.` : `If \`review\` is not found, use ${at} in its place.`)
    .replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, root ?? '<Markback folder>')
    .replace(/^They said: \$ARGUMENTS$/m, 'Start from what the person said.')
    .replace(/\$ARGUMENTS/g, 'what the person asked for')
}

/** A skill folder's SKILL.md for any agent. The frontmatter keeps only what every agent reads. */
export function skillForAnyAgent(skill, root) {
  return `---\nname: ${skill.name}\ndescription: ${JSON.stringify(skill.fields.description)}\n---\n\n<!-- Made by \`review install-skills\` from Markback's skills/${skill.name}. Run it again after updating Markback. -->\n\n${forAnyAgent(skill.body, root)}\n`
}

const demote = body => body.replace(/^(#{1,5}) /gm, '$1# ')

/** Everything an agent needs, in one file, from the skills. `root` as for forAnyAgent. */
export function agentsMd({ root = null, skills = readSkills() } = {}) {
  const parts = skills.map(skill => `## ${skill.name}\n\n_${skill.fields.description}_\n\n${demote(forAnyAgent(skill.body, root))}`)
  return `# Markback

The person reviews screens by drawing on them in a local page. You push screenshots with the \`review\` command; they mark them up and press Send; you read each mark back as a request. Everything is plain files under \`~/.review-wizard\`, so any agent that can run a shell command can use it. Each section below is a skill; where one says \"use the \`read-marks\` skill\", read that section.

\`review\` is \`bin/review\` in the Markback folder. If it is not on the PATH, use ${root ? `\`node "${join(root, 'review.mjs')}"\`` : '`node review.mjs` in the Markback folder'} in its place. It needs Node 22.6 or later, and nothing else.

${root ? '' : 'Working on Markback itself? This file is made from `skills/*/SKILL.md` by `node scripts/agents-md.mjs`: change the skills, not this file, and run `npm test`.\n\n'}${parts.join('\n\n')}
`
}

/** Puts Markback's part into a project's AGENTS.md between its markers, replacing an older one, and keeps the rest. */
export function withBlock(existing, block) {
  const marked = `${BLOCK_START}\n${block.trim()}\n${BLOCK_END}`
  const at = existing.indexOf(BLOCK_START)
  const end = existing.indexOf(BLOCK_END)
  if (at >= 0 && end > at) return `${existing.slice(0, at)}${marked}${existing.slice(end + BLOCK_END.length)}`
  return existing.trim() ? `${existing.trimEnd()}\n\n${marked}\n` : `${marked}\n`
}

/**
 * Skill folders for agents that read them, and optionally a project's AGENTS.md. Returns what was written. `to` defaults to
 * ~/.agents/skills, where Codex and Cursor look.
 */
export function installSkills({ to, agentsMdIn = null, root = ROOT, pathInAgentsMd = true } = {}) {
  const written = []
  for (const skill of readSkills()) {
    mkdirSync(join(to, skill.name), { recursive: true })
    writeFileSync(join(to, skill.name, 'SKILL.md'), skillForAnyAgent(skill, root))
    written.push(join(to, skill.name, 'SKILL.md'))
  }
  if (agentsMdIn) {
    const path = join(agentsMdIn, 'AGENTS.md')
    writeFileSync(path, withBlock(existsSync(path) ? readFileSync(path, 'utf8') : '', agentsMd({ root: pathInAgentsMd ? root : null })))
    written.push(path)
  }
  return written
}
