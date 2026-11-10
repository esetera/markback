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
import { fileURLToPath, pathToFileURL } from 'node:url'
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
  // Found from a folder below, up to the top of the project's repository.
  mkdirSync(join(dir, '.git'))
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
    // Beside the project, not in it: a project inside the home folder's own folder would be above home.
    const home = `${dir}-home`
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
  assert.match(first.stdout, new RegExp(`Wrote .*\\.markback\\. Markback commands in this folder now keep screens and marks in .*\\.markback-store, and the review page is on port ${port}\\.`))
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
  const written = JSON.parse(readFileSync(join(installed, '.markback', 'config.json'), 'utf8'))
  assert.equal(written.home, '.markback/store')
  assert.ok(written.port >= 5760 && written.port < 5800 && written.port !== 5793, 'a port of its own, not the usual one')
  assert.equal((await run(['push', '--app', 'Npm', '--screen', 'One', '--after', join(installed, 'shot.png')], { cwd: installed })).code, 0)
  assert.deepEqual(queued(join(installed, '.markback', 'store'), 'npm'), ['one.json'])
})

test('plugins in a store a .markback named are never run: a project cannot bring its own', async () => {
  const dir = project({ home: '.markback-store' })
  const plugin = join(dir, '.markback-store', 'plugins', 'hello')
  mkdirSync(plugin, { recursive: true })
  writeFileSync(join(plugin, 'plugin.json'), JSON.stringify({ name: 'hello', version: '1.0.0', description: 'Says hello', commands: { hello: 'hello.js' } }))
  writeFileSync(join(plugin, 'hello.js'), `import { writeFileSync } from 'node:fs'\nexport default () => writeFileSync(${JSON.stringify(join(dir, 'ran'))}, 'yes')\n`)
  const home = `${dir}-home`
  mkdirSync(home)
  const out = await run(['hello'], { cwd: dir, env: dropped({ HOME: home }) })
  assert.equal(out.code, 1)
  assert.equal(existsSync(join(dir, 'ran')), false)
  // Named by the person, with --home, the same folder's plugins are theirs.
  assert.equal((await run(['hello', '--home', join(dir, '.markback-store')], { cwd: dir, env: dropped({ HOME: home }) })).code, 0)
  assert.equal(readFileSync(join(dir, 'ran'), 'utf8'), 'yes')
})

test('a store a .markback named that holds a link is never written through: push and start refuse in one line', async () => {
  const outside = join(base, 'outside-links')
  mkdirSync(outside)
  writeFileSync(join(outside, 'victim.txt'), 'mine')
  const dir = project({ home: 'store', port: await freePort() })
  mkdirSync(join(dir, 'store'))
  symlinkSync(join(outside), join(dir, 'store', 'images'))
  symlinkSync(join(outside, 'victim.txt'), join(dir, 'store', 'port'))
  for (const args of [['push', '--app', 'Evil', '--screen', 'One', '--after', join(dir, 'shot.png')], ['start', '--port', String(await freePort())], ['demo']]) {
    const out = await run(args, { cwd: dir })
    assert.equal(out.code, 1, args[0])
    const said = out.stderr.split('\n').filter(line => line && !line.startsWith('Store:'))
    assert.equal(said.length, 1, out.stderr)
    assert.match(said[0], /the store holds a link that leads outside it/)
  }
  assert.deepEqual(readdirSync(outside), ['victim.txt'])
  assert.equal(readFileSync(join(outside, 'victim.txt'), 'utf8'), 'mine')
  // The page refuses too, and checks again before each write: a link added while it runs sends nothing anywhere.
  const server = await import('node:child_process').then(({ spawn }) => spawn(process.execPath, [join(ROOT, 'server.mjs')], { cwd: dir, env: dropped(), stdio: ['ignore', 'ignore', 'pipe'] }))
  let said = ''
  server.stderr.on('data', part => (said += part))
  await new Promise(resolve => server.once('exit', resolve))
  assert.match(said, /Not starting: the store holds a link/)
})

test('a store port file that holds no number is passed over, never localhost:NaN', async () => {
  const dir = project({ home: 'store', port: await freePort() })
  mkdirSync(join(dir, 'store'))
  writeFileSync(join(dir, 'store', 'port'), 'not a port')
  const out = await run(['push', '--app', 'Nan', '--screen', 'One', '--after', join(dir, 'shot.png')], { cwd: dir })
  assert.doesNotMatch(out.stdout, /NaN/)
  assert.match(out.stdout, /localhost:\d+\//)
})

test('two stores, one port: a push says the page there is another store\'s, and start moves this store to a port of its own', async () => {
  const port = await freePort()
  const other = join(base, 'other-store')
  // The person's usual page, for another store, already on the port the project names.
  const { spawn } = await import('node:child_process')
  const theirs = spawn(process.execPath, [join(ROOT, 'server.mjs')], { env: { ...process.env, REVIEW_HOME: other, REVIEW_PORT: String(port) }, stdio: 'ignore' })
  try {
    for (let i = 0; i < 100 && !(await queueAt(port)); i++) await new Promise(r => setTimeout(r, 100))
    const dir = project({ home: '.markback-store', port })
    const env = { ...process.env, HOME: base }
    delete env.REVIEW_HOME
    delete env.REVIEW_PORT
    const pushed = await run(['push', '--app', 'Mine', '--screen', 'Home', '--after', join(dir, 'shot.png')], { cwd: dir, env })
    assert.match(pushed.stdout, new RegExp(`The review page on port ${port} shows another store, so it does not show this\\.`))
    const start = await run(['start'], { cwd: dir, env })
    assert.equal(start.code, 0, start.stderr)
    const moved = Number(/goes on port (\d+)/.exec(start.stdout)?.[1])
    assert.ok(moved && moved !== port, start.stdout)
    try {
      assert.match(start.stdout, new RegExp(`Open http://localhost:${moved}`))
      assert.deepEqual((await queueAt(moved)).apps.map(a => a.name), ['Mine'])
      assert.deepEqual((await queueAt(port)).apps, [], 'the other store is untouched')
      assert.equal(readFileSync(join(dir, '.markback-store', 'port'), 'utf8'), String(moved), 'kept for later commands')
      const again = await run(['push', '--app', 'Mine', '--screen', 'Two', '--after', join(dir, 'shot.png')], { cwd: dir, env })
      assert.match(again.stdout, new RegExp(`Open http://localhost:${moved}/#mine`))
      assert.doesNotMatch(again.stdout, /another store|not running/)
    } finally {
      await run(['stop'], { cwd: dir, env })
    }
  } finally {
    theirs.kill()
  }
})

test('the port in .markback is only for the store it names: --home and REVIEW_HOME stores keep their own', async () => {
  const filePort = await freePort()
  const ownPort = await freePort()
  const dir = project({ home: 'store', port: filePort })
  const flagStore = join(base, 'flag-port-store')
  mkdirSync(flagStore)
  writeFileSync(join(flagStore, 'port'), String(ownPort))
  for (const opts of [{ args: ['--home', flagStore] }, { env: dropped({ REVIEW_HOME: flagStore }) }]) {
    const out = await run(['push', '--app', 'Ports', '--screen', 'One', '--after', join(dir, 'shot.png'), ...(opts.args ?? [])], { cwd: dir, ...(opts.env ? { env: opts.env } : {}) })
    assert.match(out.stdout, new RegExp(`localhost:${ownPort}/`), out.stdout)
  }
})

test('a .markback is looked for only where the person keeps their own work', async () => {
  const { findProjectFile } = await import('../lib/home.mjs')
  const home = join(base, 'look-home')
  const repo = join(home, 'code', 'repo')
  mkdirSync(join(repo, '.git'), { recursive: true })
  mkdirSync(join(repo, 'src'))
  writeFileSync(join(home, '.markback'), '{"home": "store"}')
  writeFileSync(join(home, 'code', '.markback'), '{"home": "store"}')
  assert.equal(findProjectFile(join(repo, 'src'), { home }), null, 'not above the top of the repository')
  writeFileSync(join(repo, '.markback'), '{"home": "store"}')
  assert.equal(findProjectFile(join(repo, 'src'), { home }).root, repo)
  const loose = join(home, 'notes', 'deep')
  mkdirSync(loose, { recursive: true })
  assert.equal(findProjectFile(loose, { home }), null, 'not in the home folder itself')
  writeFileSync(join(home, 'notes', '.markback'), '{"home": "store"}')
  assert.equal(findProjectFile(loose, { home }).root, join(home, 'notes'), 'up to the home folder, without git')
  // Outside the home folder, only the folder itself.
  const away = join(base, 'away', 'inner')
  mkdirSync(away, { recursive: true })
  writeFileSync(join(base, 'away', '.markback'), '{"home": "store"}')
  assert.equal(findProjectFile(away, { home }), null)
  // A folder anyone can write to, and a file someone else owns, are skipped and said so.
  const open = join(base, 'open')
  mkdirSync(open)
  writeFileSync(join(open, '.markback'), '{"home": "store"}')
  chmodSync(open, 0o777)
  assert.match(findProjectFile(open, { home }).skipped[0], /anyone can write in/)
  chmodSync(open, 0o755)
  assert.match(findProjectFile(open, { home, uid: 424242 }).skipped[0], /belongs to someone else/)
  const out = await run(['list'], { cwd: open, env: dropped({ HOME: `${open}-home` }) })
  assert.doesNotMatch(out.stderr, /Skipping/, 'its own file, in its own folder, is used')
  assert.match(out.stderr, /^Store: /m)
  chmodSync(open, 0o777)
  try {
    const skipped = await run(['list'], { cwd: open, env: dropped({ HOME: join(base, 'open-home') }) })
    assert.match(skipped.stderr, /^Skipping .*\.markback: anyone can write in /m)
  } finally {
    chmodSync(open, 0o755)
  }
})

test('the .gitignore hint: only for a .markback store, on writing the file and on its first push, and git is never run', async () => {
  const dir = project()
  mkdirSync(join(dir, '.git'))
  // A git that leaves a mark if anything runs it.
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'git'), `#!/bin/sh\ntouch ${JSON.stringify(join(dir, 'git-ran'))}\nexit 1\n`)
  chmodSync(join(bin, 'git'), 0o755)
  const env = dropped({ PATH: `${bin}:${process.env.PATH}` })
  const hint = /^The store is inside a git repository\. Add \.markback-store\/ to \.gitignore, so screens and marks are not committed\.$/m
  assert.match((await run(['project', '--store', '.markback-store'], { cwd: dir, env })).stdout, hint)
  const push = () => run(['push', '--app', 'Git', '--screen', 'One', '--after', join(dir, 'shot.png')], { cwd: dir, env })
  assert.match((await push()).stderr, hint)
  assert.doesNotMatch((await push()).stderr, /gitignore/, 'once')
  assert.doesNotMatch((await run(['list'], { cwd: dir, env })).stderr, /gitignore/)
  assert.equal(existsSync(join(dir, '.gitignore')), false, '.gitignore is not touched')
  const ignored = project()
  mkdirSync(join(ignored, '.git'))
  writeFileSync(join(ignored, '.gitignore'), '/.markback-store/\n')
  assert.doesNotMatch((await run(['project', '--store', '.markback-store'], { cwd: ignored, env })).stdout, /gitignore/)
  // A home folder that is a repository, with no .markback: nothing said.
  const repoHome = join(base, 'repo-home')
  mkdirSync(join(repoHome, '.git'), { recursive: true })
  const plain = project()
  assert.doesNotMatch((await run(['push', '--app', 'Plain', '--screen', 'One', '--after', join(plain, 'shot.png')], { cwd: plain, env: dropped({ HOME: repoHome, PATH: env.PATH }) })).stderr, /gitignore/)
  assert.equal(existsSync(join(dir, 'git-ran')), false)
})

test('inside Codex\'s sandbox, the small browser goes in the .markback store, and the place is checked before the person is asked', { skip: process.platform !== 'darwin' }, async () => {
  const dir = project({ home: '.markback-store' })
  writeFileSync(join(dir, 'index.html'), '<h1>Hi</h1>')
  const env = dropped({ CODEX_SANDBOX: 'seatbelt' })
  const asked = await run(['see', pathToFileURL(join(dir, 'index.html')).href], { cwd: dir, env })
  assert.equal(asked.code, 1)
  assert.match(asked.stderr, /needs a small Chrome from Google.*Ask the person first/)
  assert.ok(existsSync(join(dir, '.markback-store', 'browser')), 'kept in the store, where the sandbox can write')
  const locked = join(base, 'locked-store')
  mkdirSync(join(locked, 'browser'), { recursive: true })
  chmodSync(join(locked, 'browser'), 0o500)
  try {
    const cannot = await run(['see', pathToFileURL(join(dir, 'index.html')).href, '--home', locked], { cwd: dir, env })
    assert.match(cannot.stderr, /this sandbox cannot write there/)
    assert.doesNotMatch(cannot.stderr, /Ask the person/, 'nothing to say yes to')
  } finally {
    chmodSync(join(locked, 'browser'), 0o700)
  }
})

test('review project without Chrome stops at once: nothing started, nothing written, the Chrome line', async () => {
  const dir = project({ home: '.markback-store', port: await freePort() })
  writeFileSync(join(dir, 'index.html'), '<h1>Hi</h1>')
  const started = Date.now()
  const out = await run(['project'], { cwd: dir, env: dropped({ REVIEW_CHROME: join(dir, 'no-chrome') }) })
  assert.equal(out.code, 1)
  assert.ok(Date.now() - started < 5000)
  assert.match(out.stderr, /^No Chrome or Edge here/m)
  assert.equal(existsSync(join(dir, '.agents')), false)
  assert.equal(existsSync(join(dir, '.markback-store')), false)
})

test('the small things: a dangling store link, paths with spaces, --home=, a kept port, unreadable and huge files', async () => {
  const dangling = project({ home: 'store' })
  symlinkSync(join(base, 'nowhere'), join(dangling, 'store'))
  const home = `${dangling}-home`
  mkdirSync(home)
  const out = await run(['list'], { cwd: dangling, env: dropped({ HOME: home }) })
  assert.equal(out.code, 0)
  assert.match(out.stderr, /^Ignoring .*: "home" .* is a link that leads nowhere\./m)
  assert.doesNotMatch(out.stderr, /ENOENT|\n\s+at /)

  const spaced = join(base, 'with space')
  mkdirSync(spaced)
  writePicture(join(spaced, 'shot.png'), 40, 30)
  writeFileSync(join(spaced, '.markback'), JSON.stringify({ home: 'store', port: await freePort() }))
  const pushed = await run(['push', '--app', 'Space', '--screen', 'One', '--after', join(spaced, 'shot.png')], { cwd: spaced })
  assert.match(pushed.stdout, new RegExp(`"review start" in '${spaced}'`))
  const flagged = join(base, 'equals store')
  assert.equal((await run(['push', `--home=${flagged}`, '--app', 'Eq', '--screen', 'One', '--after', join(spaced, 'shot.png')], { cwd: spaced })).code, 0)
  assert.deepEqual(queued(flagged, 'eq'), ['one.json'])
  const env = await run(['push', '--app', 'Eq', '--screen', 'One', '--after', join(spaced, 'shot.png')], { cwd: spaced, env: dropped({ REVIEW_HOME: flagged, REVIEW_PORT: String(await freePort()) }) })
  assert.match(env.stdout, new RegExp(`"review start --home '${flagged}' --port \\d+"`))

  const kept = project({ home: 'store', port: 5777, extra: 1 })
  assert.equal((await run(['project', '--store', 'store2'], { cwd: kept })).code, 0)
  assert.deepEqual(JSON.parse(readFileSync(join(kept, '.markback'), 'utf8')), { home: 'store2', port: 5777 })

  const unreadable = project({ home: 'store' })
  chmodSync(join(unreadable, '.markback'), 0o000)
  try {
    assert.match((await run(['list'], { cwd: unreadable, env: dropped({ HOME: home }) })).stderr, /it cannot be read/)
  } finally {
    chmodSync(join(unreadable, '.markback'), 0o600)
  }
  const huge = project(`{"home": "store", "port": 5760${' '.repeat(10000)}}`)
  assert.match((await run(['list'], { cwd: huge, env: dropped({ HOME: home }) })).stderr, /it is larger than 4 KB/)
})

test('a link added to a .markback store while the page runs: the page saves nothing until it is gone', async () => {
  const port = await freePort()
  const dir = project({ home: 'store', port })
  mkdirSync(join(dir, 'store'))
  const { spawn } = await import('node:child_process')
  const server = spawn(process.execPath, [join(ROOT, 'server.mjs')], { cwd: dir, env: dropped(), stdio: 'ignore' })
  try {
    for (let i = 0; i < 100 && !(await queueAt(port)); i++) await new Promise(r => setTimeout(r, 100))
    const sample = () => fetch(`http://127.0.0.1:${port}/api/sample`, { method: 'POST' })
    assert.equal((await sample()).status, 200)
    const outside = join(base, 'outside-later')
    mkdirSync(outside)
    symlinkSync(outside, join(dir, 'store', 'inbox'))
    const refused = await sample()
    assert.equal(refused.status, 409)
    assert.match((await refused.json()).error, /the store holds a link that leads outside it/)
    assert.deepEqual(readdirSync(outside), [])
  } finally {
    server.kill()
  }
})

/** A store with a program planted where the small browser goes: it leaves a mark if anything runs it. */
function plantedBrowser(dir) {
  const folder = join(dir, '.markback-store', 'browser', `chrome-headless-shell-${process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64'}`)
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'chrome-headless-shell'), `#!/bin/sh\necho ran >> ${JSON.stringify(join(dir, 'planted-ran'))}\nexit 1\n`)
  chmodSync(join(folder, 'chrome-headless-shell'), 0o755)
  writeFileSync(join(dir, 'index.html'), '<h1>Hi</h1>')
  return folder
}

test('a browser planted in a .markback store is never run by see, check or project, in a sandbox or out of one', async () => {
  const port = await freePort()
  const dir = project({ home: '.markback-store', port })
  plantedBrowser(dir)
  const page = pathToFileURL(join(dir, 'index.html')).href
  const inside = dropped({ CODEX_SANDBOX: 'seatbelt' })
  const outside = dropped({ REVIEW_CHROME: join(dir, 'no-chrome') })
  try {
    for (const env of [inside, outside]) {
      const seen = await run(['see', page], { cwd: dir, env })
      assert.equal(seen.code, 1)
      if (env === inside && process.platform === 'darwin') assert.match(seen.stderr, /inside the project, and Markback cannot tell that it put it there.*--use-store-browser/)
      await run(['check'], { cwd: dir, env })
      const made = await run(['project', '--no-open'], { cwd: dir, env })
      assert.equal(made.code, 1)
    }
  } finally {
    await run(['stop'], { cwd: dir })
  }
  assert.equal(existsSync(join(dir, 'planted-ran')), false)
})

test('a store browser runs only on the person\'s yes, and never from a store git tracks', { skip: process.platform !== 'darwin' }, async () => {
  const dir = project({ home: '.markback-store' })
  plantedBrowser(dir)
  const page = pathToFileURL(join(dir, 'index.html')).href
  const env = dropped({ CODEX_SANDBOX: 'seatbelt' })
  // Committed: the store's path is in the repository's index, as it is after a clone.
  mkdirSync(join(dir, '.git'))
  const entry = Buffer.from('.markback-store/browser/chrome-headless-shell\0')
  const header = Buffer.alloc(12)
  header.write('DIRC', 0, 'latin1')
  header.writeUInt32BE(2, 4)
  header.writeUInt32BE(1, 8)
  writeFileSync(join(dir, '.git', 'index'), Buffer.concat([header, Buffer.alloc(62), entry]))
  const tracked = await run(['see', page, '--use-store-browser'], { cwd: dir, env })
  assert.match(tracked.stderr, /git tracks files in .*so they came with the project/)
  assert.equal(existsSync(join(dir, 'planted-ran')), false)
  // An index git compresses cannot be read here: not run either.
  header.writeUInt32BE(4, 4)
  writeFileSync(join(dir, '.git', 'index'), Buffer.concat([header, Buffer.alloc(62), entry]))
  assert.match((await run(['see', page, '--use-store-browser'], { cwd: dir, env })).stderr, /cannot tell whether git tracks/)
  assert.equal(existsSync(join(dir, 'planted-ran')), false)
  // Not committed, and the person said yes for this command: it runs, and says it is a program inside the project.
  rmSync(join(dir, '.git', 'index'))
  const yes = await run(['see', page, '--use-store-browser'], { cwd: dir, env })
  assert.match(yes.stderr, /Running the browser in .*a program inside the project/)
  assert.ok(existsSync(join(dir, 'planted-ran')))
  const { trackedByGit } = await import('../lib/capture-browser.mjs')
  assert.equal(trackedByGit(join(dir, '.markback-store')), 'no')
})

test('wake commands in a .markback store are never run: a project\'s store keeps its commands in the person\'s own folder', async () => {
  const dir = project({ home: '.markback-store' })
  mkdirSync(join(dir, '.git'))
  const store = join(dir, '.markback-store')
  // A command as it would be committed in the store: made the old way, with the store as REVIEW_HOME.
  const wakeLib = JSON.stringify(join(ROOT, 'lib', 'wake.mjs'))
  execFileSync(process.execPath, ['--input-type=module', '-e', `const w = await import(${wakeLib}); w.setWake({ run: 'touch planted {prompt}', folder: ${JSON.stringify(dir)} })`], { env: { ...process.env, REVIEW_HOME: store }, cwd: dir })
  assert.ok(readdirSync(join(store, 'work', 'wake')).some(f => f.endsWith('.json')))
  const own = join(base, 'wake-home')
  mkdirSync(own)
  const list = () => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `const w = await import(${wakeLib}); console.log(JSON.stringify(w.listWakes()))`], { env: dropped({ HOME: own }), cwd: dir, encoding: 'utf8' }))
  assert.deepEqual(list(), [], 'the server lists none of them')
  // Set on this computer, it is kept outside the project, and listed.
  const set = await run(['wake', 'set', '--run', 'echo {prompt}'], { cwd: dir, env: dropped({ HOME: own }) })
  assert.equal(set.code, 0, set.stderr)
  assert.ok(existsSync(join(own, '.review-wizard', 'store-wakes')))
  assert.deepEqual(list().map(w => w.run), ['echo {prompt}'])
  // In a sandbox that cannot write there, it says so in one line, and sets nothing in the store.
  const refused = await run(['wake', 'set', '--run', 'echo {prompt}'], { cwd: dir })
  assert.equal(refused.code, 1)
  assert.match(refused.stderr, /kept in .*outside the project, and this sandbox cannot write there/)
  // The page says the store's own commands are not run.
  const port = await freePort()
  writeFileSync(join(dir, '.markback'), JSON.stringify({ home: '.markback-store', port }))
  const { spawn } = await import('node:child_process')
  const server = spawn(process.execPath, [join(ROOT, 'server.mjs')], { cwd: dir, env: dropped({ HOME: own }), stdio: ['ignore', 'ignore', 'pipe'] })
  let said = ''
  server.stderr.on('data', part => (said += part))
  try {
    for (let i = 0; i < 100 && !(await queueAt(port)); i++) await new Promise(r => setTimeout(r, 100))
    assert.match(said, /Not running the wake commands in .*they came with the project's store/)
  } finally {
    server.kill()
  }
})

test('review stop never signals a server named by a .markback store\'s server.pid unless that server serves this store', async () => {
  const theirPort = await freePort()
  const { spawn } = await import('node:child_process')
  const theirs = spawn(process.execPath, [join(ROOT, 'server.mjs')], { env: { ...process.env, REVIEW_HOME: join(base, 'their-store'), REVIEW_PORT: String(theirPort) }, stdio: 'ignore' })
  try {
    for (let i = 0; i < 100 && !(await queueAt(theirPort)); i++) await new Promise(r => setTimeout(r, 100))
    const dir = project({ home: '.markback-store', port: await freePort() })
    mkdirSync(join(dir, '.markback-store'))
    writeFileSync(join(dir, '.markback-store', 'server.pid'), String(theirs.pid))
    assert.match((await run(['stop'], { cwd: dir })).stdout, /It was not running/)
    assert.ok((await queueAt(theirPort))?.apps, 'their page still runs')
  } finally {
    theirs.kill()
  }
})
