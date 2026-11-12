import './own-home.mjs'
import assert from 'node:assert/strict'
import { execFile, execFileSync, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'review.mjs')
// The person's own store, in this test file's own home folder (see own-home.mjs): what it holds is theirs.
const home = join(process.env.HOME, '.review-wizard')
mkdirSync(home, { recursive: true })
after(() => rmSync(home, { recursive: true, force: true }))
const pidFile = join(home, 'server.pid')

test('a start that cannot reach a page already running leaves that page stoppable', async () => {
  // Something holds the port and does not answer as a review page: what a sandbox makes a running page look like.
  const blocker = createServer((req, res) => res.writeHead(404).end()).listen(4691, '127.0.0.1')
  await new Promise(r => blocker.once('listening', r))
  try {
    writeFileSync(pidFile, '424242')
    // Not a blocking run: the stand-in above must stay able to answer.
    const run = await promisify(execFile)('node', [CLI, 'start', '--port', '4691'], { env: { ...process.env, REVIEW_HOME: home }, encoding: 'utf8' }).then(() => null, error => error)
    assert.ok(run, 'it says it did not start')
    assert.match(run.stderr + run.stdout, /Pushing works without the page/)
    assert.equal(readFileSync(pidFile, 'utf8'), '424242', 'the running page is still the one stop stops')
  } finally {
    blocker.close()
  }
})

test('a page whose own server process is alive is running, even when this command cannot reach it; stop stops it', async () => {
  // A stand-in for the server: a process whose command line names this Markback's server.mjs, as the real one does.
  const server = spawn('node', ['-e', 'setTimeout(() => {}, 60000)', join(dirname(CLI), 'server.mjs')], { stdio: 'ignore' })
  await new Promise(r => server.once('spawn', r))
  try {
    writeFileSync(pidFile, String(server.pid))
    const env = { ...process.env, REVIEW_HOME: home, REVIEW_PORT: '4692' }
    assert.match(execFileSync('node', [CLI, 'start'], { env, encoding: 'utf8' }), /Already running/)
    assert.match(execFileSync('node', [CLI, 'stop'], { env, encoding: 'utf8' }), /Stopped/)
    await new Promise(r => server.once('exit', r))
  } finally {
    server.kill()
  }
})

test('a number in server.pid that now belongs to something else is never trusted, and never stopped', () => {
  writeFileSync(pidFile, String(process.pid))
  const env = { ...process.env, REVIEW_HOME: home, REVIEW_PORT: '4693' }
  assert.match(execFileSync('node', [CLI, 'stop'], { env, encoding: 'utf8' }), /It was not running/)
  assert.ok(process.kill(process.pid, 0), 'still here')
})

/**
 * A review page from an older Markback, in a copy of Markback of its own: it answers the queue as old pages did (no store, no
 * pid, no version) and has no phone question, so asking one gets the old 404 "Not found".
 */
async function olderPage() {
  const folder = mkdtempSync(join(tmpdir(), 'review-older '))
  mkdirSync(join(folder, 'lib'))
  writeFileSync(join(folder, 'review.mjs'), '')
  writeFileSync(join(folder, 'lib', 'store.mjs'), '')
  writeFileSync(join(folder, 'server.mjs'), `import { createServer } from 'node:http'
createServer((req, res) => {
  res.writeHead(req.url === '/api/queue' ? 200 : 404, { 'content-type': 'application/json' })
  res.end(JSON.stringify(req.url === '/api/queue' ? { apps: [] } : { error: 'Not found' }))
}).listen(Number(process.env.REVIEW_PORT), '127.0.0.1')
`)
  const probe = createServer().listen(0, '127.0.0.1')
  await new Promise(r => probe.once('listening', r))
  const port = probe.address().port
  await new Promise(r => probe.close(r))
  const child = spawn('node', [join(folder, 'server.mjs')], { env: { ...process.env, REVIEW_PORT: String(port) }, stdio: 'ignore' })
  for (let i = 0; i < 100 && !(await fetch(`http://127.0.0.1:${port}/api/queue`).then(r => r.ok, () => false)); i++) await new Promise(r => setTimeout(r, 50))
  const gone = new Promise(r => child.once('exit', r))
  return { port, child, gone, done: () => { child.kill(); rmSync(folder, { recursive: true, force: true }) } }
}

test('review stop stops an older Markback this store started, though it has no phone question and says nothing of itself', async () => {
  const older = await olderPage()
  try {
    writeFileSync(pidFile, String(older.child.pid))
    const out = await promisify(execFile)('node', [CLI, 'stop'], { env: { ...process.env, REVIEW_HOME: home, REVIEW_PORT: String(older.port) }, encoding: 'utf8' })
    assert.match(out.stdout, /^Stopped\.$/m)
    assert.doesNotMatch(out.stdout + out.stderr, /Not found/)
    await older.gone
  } finally {
    older.done()
  }
})

test('review start puts this code in place of an older Markback this store started, and the new page says its version', async () => {
  const older = await olderPage()
  const env = { ...process.env, REVIEW_HOME: home, REVIEW_PORT: String(older.port) }
  try {
    writeFileSync(pidFile, String(older.child.pid))
    const out = await promisify(execFile)('node', [CLI, 'start'], { env, encoding: 'utf8' })
    assert.match(out.stdout, /An older Markback was running for this store\. It is stopped, and this one starts in its place\.\nOpen http:\/\/localhost:\d+/)
    await older.gone
    const queue = await (await fetch(`http://127.0.0.1:${older.port}/api/queue`)).json()
    const { codeVersion } = await import('../lib/version.mjs')
    assert.equal(queue.version, codeVersion())
    assert.match(execFileSync('node', [CLI, 'start'], { env, encoding: 'utf8' }), /Already running/, 'the same code is left running')
  } finally {
    await promisify(execFile)('node', [CLI, 'stop'], { env, encoding: 'utf8' }).catch(() => null)
    older.done()
  }
})

test('an older page this store did not start is never stopped: start says how to stop it', async () => {
  const older = await olderPage()
  try {
    writeFileSync(pidFile, '424242')
    const run = await promisify(execFile)('node', [CLI, 'start'], { env: { ...process.env, REVIEW_HOME: home, REVIEW_PORT: String(older.port) }, encoding: 'utf8' }).then(() => null, error => error)
    assert.ok(run)
    assert.match(run.stderr, /An older Markback runs on port \d+, and this command cannot tell it is this store's\. Stop it, then run review start again/)
    assert.ok(process.kill(older.child.pid, 0), 'still running')
  } finally {
    older.done()
  }
})
