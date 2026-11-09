import assert from 'node:assert/strict'
import { execFile, execFileSync, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'review.mjs')
const home = mkdtempSync(join(tmpdir(), 'review-cli-'))
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
