/**
 * Agents whose sandbox drops environment variables, cannot write outside the project, and has no Chrome. A project's .markback
 * names the store and port; pushing works with no page running; a page started later on the same store shows what was pushed.
 */
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { writePicture } from './helpers.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = join(ROOT, 'review.mjs')
const base = realpathSync(mkdtempSync(join(tmpdir(), 'review-sandbox-')))
// The sandbox's home folder: nothing may be written there.
const lockedHome = join(base, 'home')
mkdirSync(lockedHome)
chmodSync(lockedHome, 0o500)
after(() => {
  chmodSync(lockedHome, 0o700)
  rmSync(base, { recursive: true, force: true })
})

/** What a sandbox that drops variables passes on: a path and a home folder, nothing of Markback's. */
const dropped = (extra = {}) => ({ PATH: process.env.PATH, HOME: lockedHome, ...extra })
const run = (args, { cwd, env = dropped() }) => promisify(execFile)(process.execPath, [CLI, ...args], { cwd, env, encoding: 'utf8', timeout: 20000 }).then(r => ({ code: 0, ...r }), e => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }))

const freePort = () => new Promise(resolve => {
  const probe = createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address()
    probe.close(() => resolve(port))
  })
})
const queueAt = port => fetch(`http://127.0.0.1:${port}/api/queue`, { signal: AbortSignal.timeout(1500) }).then(r => r.json(), () => null)

let made = 0
/** A project folder with a picture in it, and a .markback when given one. */
function project(markback) {
  const dir = join(base, `project-${++made}`)
  mkdirSync(dir)
  writePicture(join(dir, 'shot.png'), 40, 30)
  if (markback !== undefined) writeFileSync(join(dir, '.markback'), typeof markback === 'string' ? markback : JSON.stringify(markback))
  return dir
}
const queued = (store, app) => existsSync(join(store, 'queue', app)) ? readdirSync(join(store, 'queue', app)) : []

test('variables dropped and .markback present: a push lands in the project store, says so, and starts no page', async () => {
  const port = await freePort()
  const dir = project({ home: '.markback-store', port })
  const sub = join(dir, 'src', 'deep')
  mkdirSync(sub, { recursive: true })
  const started = Date.now()
  const out = await run(['push', '--app', 'My app', '--screen', 'Home', '--after', join(dir, 'shot.png')], { cwd: sub })
  assert.equal(out.code, 0, out.stderr)
  assert.ok(Date.now() - started < 10000, 'nothing was waited for')
  assert.deepEqual(queued(join(dir, '.markback-store'), 'my-app'), ['home.json'], 'found by walking up from a folder inside the project')
  assert.match(out.stderr, new RegExp(`Store: ${join(dir, '.markback-store')} \\(from ${join(dir, '.markback')}\\)`))
  assert.match(out.stdout, new RegExp(`Open http://localhost:${port}/#my-app`), 'the port came from the file')
  assert.match(out.stdout, new RegExp(`shows once the person runs "review start" in ${dir} outside any sandbox`))
  assert.deepEqual(readdirSync(lockedHome), [], 'nothing outside the project')
  assert.equal(existsSync(join(dir, '.markback-store', 'server.pid')), false, 'no page was started')
  assert.equal(await queueAt(port), null)
})

test('--home beats REVIEW_HOME, which beats .markback, which beats the default; --home may come before the command', async () => {
  const dir = project({ home: 'from-file' })
  const flag = join(base, 'from-flag')
  const env = join(base, 'from-env')
  const after = join(dir, 'shot.png')
  const push = (args, opts) => run([...args, '--app', 'Order', '--screen', 'One', '--after', after], { cwd: dir, ...opts })
  const byFlag = await push(['push', '--home', flag], { env: dropped({ REVIEW_HOME: env }) })
  assert.equal(byFlag.code, 0, byFlag.stderr)
  assert.match(byFlag.stderr, /from --home, not the one .*\.markback names/)
  assert.equal((await push(['--home', flag, 'push'], { env: dropped({ REVIEW_HOME: env }) })).code, 0)
  assert.equal(JSON.parse(readFileSync(join(flag, 'queue', 'order', 'one.json'), 'utf8')).round, 2, 'both pushes went to the --home store')
  assert.equal((await push(['push'], { env: dropped({ REVIEW_HOME: env }) })).code, 0)
  assert.deepEqual(queued(env, 'order'), ['one.json'])
  assert.equal((await push(['push'], {})).code, 0)
  assert.deepEqual(queued(join(dir, 'from-file'), 'order'), ['one.json'])
  const fallback = join(base, 'writable-home')
  mkdirSync(fallback)
  const plain = project()
  assert.equal((await run(['push', '--app', 'Order', '--screen', 'One', '--after', join(plain, 'shot.png')], { cwd: plain, env: dropped({ HOME: fallback }) })).code, 0)
  assert.deepEqual(queued(join(fallback, '.review-wizard'), 'order'), ['one.json'], 'no file, no setting: the usual store')
  assert.match((await run(['list', '--home'], { cwd: dir })).stderr, /--home takes a folder/)
})

test('a .markback that is not valid is ignored, in one plain line, and the usual store is used', async () => {
  const outside = join(base, 'outside')
  mkdirSync(outside)
  const linked = project({ home: 'linked' })
  symlinkSync(outside, join(linked, 'linked'))
  const cases = [
    [project('{not json'), /it is not JSON/],
    [project({ home: '../escape' }), /"home" must stay inside/],
    [project({ home: outside }), /"home" must be a folder inside the project/],
    [project({ home: '.' }), /"home" must stay inside/],
    [linked, /"home" must stay inside/],
    [project({ home: 'store', port: 'many' }), /"port" must be a whole number/],
    [project({ home: 'store', hooks: 'run.sh' }), /does not know "hooks"/],
    [project([]), /not a JSON object/],
  ]
  for (const [dir, why] of cases) {
    const home = join(dir, 'own-home')
    mkdirSync(home)
    const out = await run(['push', '--app', 'Bad', '--screen', 'One', '--after', join(dir, 'shot.png')], { cwd: dir, env: dropped({ HOME: home }) })
    assert.equal(out.code, 0, out.stderr)
    const lines = out.stderr.split('\n').filter(line => line.startsWith('Ignoring'))
    assert.equal(lines.length, 1, out.stderr)
    assert.match(lines[0], why)
    assert.match(lines[0], /It should look like \{"home": ".markback-store", "port": 5760\}\./)
    assert.deepEqual(queued(join(home, '.review-wizard'), 'bad'), ['one.json'])
  }
  assert.deepEqual(readdirSync(outside), [], 'nothing written through the link')
})

test('push, pdf, note, take and queue all work with no page and no way to start one, and say how the person will see them', async () => {
  const port = await freePort()
  const dir = project({ home: '.markback-store', port })
  const store = join(dir, '.markback-store')
  // An idea the person said yes to, made the way the page makes it.
  const script = `const w = await import(${JSON.stringify(join(ROOT, 'lib', 'work.mjs'))}); const r = w.askForIdeas({ target: 'My app', count: 1 }); const i = w.postIdea({ request: r.id, what: 'Sort the list' }); w.decide(i.id, 'yes'); console.log(i.id)`
  const id = execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, REVIEW_HOME: store }, encoding: 'utf8' }).trim()
  const { tinyPdf } = await import('../lib/check.mjs')
  writeFileSync(join(dir, 'doc.pdf'), tinyPdf())
  const started = Date.now()
  for (const args of [
    ['push', '--app', 'My app', '--screen', 'Home', '--after', join(dir, 'shot.png'), '--item', id],
    ['pdf', join(dir, 'doc.pdf'), '--app', 'My doc'],
    ['note', '--item', id, '--text', 'Pushed from a sandbox'],
  ]) {
    const out = await run(args, { cwd: dir })
    assert.equal(out.code, 0, `${args[0]}: ${out.stderr}`)
    assert.match(out.stdout, /The review page is not running, or cannot be seen from here\. It is saved in .*, and shows once the person runs "review start" in /, args[0])
  }
  const take = await run(['take', '--by', 'sandboxed agent'], { cwd: dir })
  assert.equal(take.code, 0, take.stderr)
  assert.match((await run(['queue'], { cwd: dir })).stdout, /Sort the list/)
  const json = await run(['note', '--item', id, '--text', 'Again', '--json'], { cwd: dir })
  assert.equal(JSON.parse(json.stdout).notes.length, 2, 'with --json, stdout stays JSON')
  assert.ok(Date.now() - started < 30000, 'nothing hung')
  assert.deepEqual(queued(store, 'my-doc'), ['page-1.json'])
  assert.equal(existsSync(join(store, 'server.pid')), false, 'no page was started')
  assert.deepEqual(readdirSync(lockedHome), [])
})

test('a page started later, outside the sandbox, on the same store shows what was pushed', async () => {
  const port = await freePort()
  const dir = project({ home: '.markback-store', port })
  assert.equal((await run(['push', '--app', 'Later', '--screen', 'Home', '--after', join(dir, 'shot.png')], { cwd: dir })).code, 0)
  // The person, outside the sandbox: their own variables, no REVIEW_HOME, in the project folder.
  const env = { ...process.env, HOME: base }
  delete env.REVIEW_HOME
  delete env.REVIEW_PORT
  const start = await run(['start'], { cwd: dir, env })
  try {
    assert.equal(start.code, 0, start.stderr)
    assert.match(start.stdout, new RegExp(`Open http://localhost:${port}`))
    const apps = (await queueAt(port))?.apps ?? []
    assert.deepEqual(apps.map(a => a.name), ['Later'])
    // Pushed while it runs: the page sees that too, and the push says nothing about starting it.
    const more = await run(['push', '--app', 'Later', '--screen', 'Two', '--after', join(dir, 'shot.png')], { cwd: dir })
    assert.doesNotMatch(more.stdout, /not running/)
    assert.equal((await queueAt(port)).apps[0].screens.length, 2)
  } finally {
    assert.match((await run(['stop'], { cwd: dir, env })).stdout, /Stopped/)
  }
})

test('review see fails fast, in one line, where there is no Chrome, and says to push a screenshot instead', async () => {
  const dir = project({ home: '.markback-store' })
  const port = await freePort()
  const started = Date.now()
  const out = await run(['see', `localhost:${port}`], { cwd: dir, env: dropped({ REVIEW_CHROME: join(dir, 'no-chrome') }) })
  assert.equal(out.code, 1)
  assert.ok(Date.now() - started < 5000, 'before waiting for the address')
  const said = out.stderr.split('\n').filter(line => line && !line.startsWith('Store:'))
  assert.equal(said.length, 1, out.stderr)
  assert.match(said[0], /^No Chrome or Edge here.*sandbox.*review push --app "My app" --screen "Home" --after shot\.png$/)
  const { checkPictures } = await import('../lib/check.mjs')
  assert.match((await checkPictures(dir, { find: () => null })).words, /sandbox often has none.*review push with your own screenshots still works/)
})

test('review project --store writes .markback in one step, keeps its port, and refuses a store outside the project', async () => {
  const dir = project()
  const port = await freePort()
  const first = await run(['project', '--store', '.markback-store', '--port', String(port)], { cwd: dir })
  assert.equal(first.code, 0, first.stderr)
  assert.match(first.stdout, /Wrote .*\.markback\. Markback commands in this folder now keep screens and marks in .*\.markback-store\./)
  assert.deepEqual(JSON.parse(readFileSync(join(dir, '.markback'), 'utf8')), { home: '.markback-store', port })
  assert.equal((await run(['project', '--store', 'reviews/store'], { cwd: dir })).code, 0)
  assert.deepEqual(JSON.parse(readFileSync(join(dir, '.markback'), 'utf8')), { home: 'reviews/store', port }, 'the port it named stays')
  const refused = await run(['project', '--store', '../elsewhere'], { cwd: dir })
  assert.equal(refused.code, 1)
  assert.match(refused.stderr, /must stay inside .*use --home or REVIEW_HOME/)
  // Markback installed into a .markback folder with npm: the file goes in that folder.
  const installed = project()
  mkdirSync(join(installed, '.markback'))
  assert.equal((await run(['project', '--store', '.markback/store'], { cwd: installed })).code, 0)
  assert.deepEqual(JSON.parse(readFileSync(join(installed, '.markback', 'config.json'), 'utf8')), { home: '.markback/store' })
  assert.equal((await run(['push', '--app', 'Npm', '--screen', 'One', '--after', join(installed, 'shot.png')], { cwd: installed })).code, 0)
  assert.deepEqual(queued(join(installed, '.markback', 'store'), 'npm'), ['one.json'])
})

test('a store inside a git repository that git does not ignore gets one line suggesting .gitignore, and .gitignore is not touched', async () => {
  const dir = project({ home: '.markback-store' })
  execFileSync('git', ['init', '-q'], { cwd: dir })
  const out = await run(['list'], { cwd: dir })
  assert.match(out.stderr, /^The store is inside a git repository\. Add \.markback-store\/ to \.gitignore, so screens and marks are not committed\.$/m)
  assert.equal(existsSync(join(dir, '.gitignore')), false)
  writeFileSync(join(dir, '.gitignore'), '.markback-store/\n')
  assert.doesNotMatch((await run(['list'], { cwd: dir })).stderr, /gitignore/)
})

test('plugins in a store a .markback named are never run: a project cannot bring its own', async () => {
  const dir = project({ home: '.markback-store' })
  const plugin = join(dir, '.markback-store', 'plugins', 'hello')
  mkdirSync(plugin, { recursive: true })
  writeFileSync(join(plugin, 'plugin.json'), JSON.stringify({ name: 'hello', version: '1.0.0', description: 'Says hello', commands: { hello: 'hello.js' } }))
  writeFileSync(join(plugin, 'hello.js'), `import { writeFileSync } from 'node:fs'\nexport default () => writeFileSync(${JSON.stringify(join(dir, 'ran'))}, 'yes')\n`)
  const home = join(dir, 'own-home')
  mkdirSync(home)
  const out = await run(['hello'], { cwd: dir, env: dropped({ HOME: home }) })
  assert.equal(out.code, 1)
  assert.equal(existsSync(join(dir, 'ran')), false)
  // Named by the person, with --home, the same folder's plugins are theirs.
  assert.equal((await run(['hello', '--home', join(dir, '.markback-store')], { cwd: dir, env: dropped({ HOME: home }) })).code, 0)
  assert.equal(readFileSync(join(dir, 'ran'), 'utf8'), 'yes')
})
