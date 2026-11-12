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

test('a page whose own server process is alive is running, even when this command cannot reach it; stop then touches nothing and says how', async () => {
  // A stand-in for the server: a process whose command line names this Markback's server.mjs, as the real one does.
  const server = spawn('node', ['-e', 'setTimeout(() => {}, 60000)', join(dirname(CLI), 'server.mjs')], { stdio: 'ignore' })
  await new Promise(r => server.once('spawn', r))
  try {
    writeFileSync(pidFile, String(server.pid))
    const env = { ...process.env, REVIEW_HOME: home, REVIEW_PORT: '4692' }
    assert.match(execFileSync('node', [CLI, 'start'], { env, encoding: 'utf8' }), /Already running/)
    // Nothing answers on the port, so nothing shows this process is the page: it is left, with the line to stop it by hand.
    assert.match(execFileSync('node', [CLI, 'stop'], { env, encoding: 'utf8' }), new RegExp(`Not stopped: no review page answers on port 4692 from here\\. If process ${server.pid} is the review page you started, stop it with: kill ${server.pid}`))
    assert.ok(process.kill(server.pid, 0), 'still running')
  } finally {
    server.kill()
  }
})

test('a number in server.pid that now belongs to something else is never trusted, and never stopped', () => {
  writeFileSync(pidFile, String(process.pid))
  const env = { ...process.env, REVIEW_HOME: home, REVIEW_PORT: '4693' }
  assert.match(execFileSync('node', [CLI, 'stop'], { env, encoding: 'utf8' }), /Not stopped: /)
  assert.ok(process.kill(process.pid, 0), 'still here')
})

const run = (args, env) => promisify(execFile)('node', [CLI, ...args], { env, encoding: 'utf8' }).then(r => ({ code: 0, ...r }), e => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }))
const freePort = async () => {
  const probe = createServer().listen(0, '127.0.0.1')
  await new Promise(r => probe.once('listening', r))
  const { port } = probe.address()
  await new Promise(r => probe.close(r))
  return port
}
const answers = async port => {
  for (let i = 0; i < 100 && !(await fetch(`http://127.0.0.1:${port}/api/queue`).then(r => r.ok, () => false)); i++) await new Promise(r => setTimeout(r, 50))
}
/** What an older page answers: the queue with no store, pid or version, and the old 404 "Not found" for anything else. */
const OLD_PAGE = `import { createServer } from 'node:http'
createServer((req, res) => {
  res.writeHead(req.url === '/api/queue' ? 200 : 404, { 'content-type': 'application/json' })
  res.end(JSON.stringify(req.url === '/api/queue' ? { apps: [] } : { error: 'Not found' }))
}).listen(Number(process.env.REVIEW_PORT), '127.0.0.1')
await new Promise(() => {})
`
/** A clone that only looks like Markback (review.mjs, lib/store.mjs), running its own server.mjs as an old page would. */
async function lookalike(port) {
  const folder = mkdtempSync(join(tmpdir(), 'review-lookalike '))
  mkdirSync(join(folder, 'lib'))
  writeFileSync(join(folder, 'review.mjs'), '')
  writeFileSync(join(folder, 'lib', 'store.mjs'), '')
  writeFileSync(join(folder, 'server.mjs'), OLD_PAGE)
  const child = spawn('node', [join(folder, 'server.mjs')], { env: { ...process.env, REVIEW_PORT: String(port) }, stdio: 'ignore' })
  await answers(port)
  return { child, done: () => { child.kill(); rmSync(folder, { recursive: true, force: true }) } }
}

test('a stale server.pid naming a lookalike clone\'s server.mjs, its page on the port, is never stopped', async () => {
  const port = await freePort()
  const clone = await lookalike(port)
  try {
    writeFileSync(pidFile, String(clone.child.pid))
    const env = { ...process.env, REVIEW_HOME: home, REVIEW_PORT: String(port) }
    const out = await run(['stop'], env)
    assert.match(out.stdout, new RegExp(`Not stopped: process ${clone.child.pid} is not this copy of Markback's server\\. If process ${clone.child.pid} is the review page you started, stop it with: kill ${clone.child.pid}`))
    assert.doesNotMatch(out.stdout + out.stderr, /Not found/)
    const started = await run(['start'], env)
    assert.equal(started.code, 1)
    assert.match(started.stderr, /An older Markback runs on port \d+\. Not stopped: .* Then run review start again\./)
    assert.ok(process.kill(clone.child.pid, 0), 'still running')
  } finally {
    clone.done()
  }
})

test('a page serving another store, named by this store\'s server.pid, is never stopped', async () => {
  const port = await freePort()
  const other = mkdtempSync(join(tmpdir(), 'review-other-store-'))
  const server = spawn('node', [join(dirname(CLI), 'server.mjs')], { env: { ...process.env, REVIEW_HOME: other, REVIEW_PORT: String(port) }, stdio: 'ignore' })
  try {
    await answers(port)
    writeFileSync(pidFile, String(server.pid))
    const out = await run(['stop'], { ...process.env, REVIEW_HOME: home, REVIEW_PORT: String(port) })
    assert.match(out.stdout, /Not stopped: the page on port \d+ shows another store\./)
    assert.ok(process.kill(server.pid, 0), 'still running')
  } finally {
    server.kill()
    rmSync(other, { recursive: true, force: true })
  }
})

test('start --port with someone else\'s service on that port kills nothing, and never says Open there', async () => {
  const port = await freePort()
  const clone = await lookalike(port)
  // server.pid names this copy's server, of some other page: not the one on the port.
  const elsewhere = spawn('node', ['-e', 'setTimeout(() => {}, 60000)', join(dirname(CLI), 'server.mjs')], { stdio: 'ignore' })
  await new Promise(r => elsewhere.once('spawn', r))
  try {
    writeFileSync(pidFile, String(elsewhere.pid))
    const out = await run(['start', '--port', String(port)], { ...process.env, REVIEW_HOME: home })
    assert.equal(out.code, 1)
    assert.match(out.stderr, /Not stopped: the process listening on port \d+ is not the one server\.pid names/)
    assert.doesNotMatch(out.stdout, /Open http/)
    assert.ok(process.kill(clone.child.pid, 0) && process.kill(elsewhere.pid, 0), 'both still running')
  } finally {
    clone.done()
    elsewhere.kill()
  }
})

test('the honest upgrade: an older page of this very copy, listening on the store\'s port, is stopped and replaced', { skip: process.platform === 'win32' }, async () => {
  const port = await freePort()
  // This copy's server.mjs on the command line, as an older version of it ran; the stand-in answers as an old page did.
  const folder = mkdtempSync(join(tmpdir(), 'review-old-page-'))
  writeFileSync(join(folder, 'old.mjs'), OLD_PAGE)
  const older = spawn('node', ['--import', join(folder, 'old.mjs'), join(dirname(CLI), 'server.mjs')], { env: { ...process.env, REVIEW_PORT: String(port) }, stdio: 'ignore' })
  const gone = new Promise(r => older.once('exit', r))
  const env = { ...process.env, REVIEW_HOME: home, REVIEW_PORT: String(port) }
  try {
    await answers(port)
    writeFileSync(pidFile, String(older.pid))
    const out = await run(['start'], env)
    assert.match(out.stdout, /An older Markback was running for this store\. It is stopped, and this one starts in its place\.\nOpen http:\/\/localhost:\d+/)
    await gone
    const queue = await (await fetch(`http://127.0.0.1:${port}/api/queue`)).json()
    const { codeVersion } = await import('../lib/version.mjs')
    assert.equal(queue.version, codeVersion())
    assert.match((await run(['start'], env)).stdout, /Already running: http/, 'the same code is left running')
    assert.match((await run(['stop'], env)).stdout, /^Stopped\.$/m)
  } finally {
    older.kill()
    rmSync(folder, { recursive: true, force: true })
  }
})
