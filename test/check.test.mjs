import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const CLI = join(here, '..', 'review.mjs')
const work = mkdtempSync(join(tmpdir(), 'review-check-test-'))
after(() => rmSync(work, { recursive: true, force: true }))
// The store is read once, as the library loads: a throwaway one, so the person's own is never looked at.
process.env.REVIEW_HOME = mkdtempSync(join(work, 'home-'))
const { checkNode, checkOwnPage, freePort, runChecks, sayResult, sayVerdict, startPage, up } = await import('../lib/check.mjs')
// A port nothing answers on stands in for the person's own page, so a page really running here is left alone.
const quiet = await freePort()

/** What the check left in its temporary folder: nothing, when it cleared up. */
const left = tmp => readdirSync(tmp).filter(name => name.startsWith('review-'))
const named = (results, name) => results.find(r => r.name === name)

test('the whole command passes here, prints a line for each check, and leaves no folder behind', () => {
  const home = mkdtempSync(join(work, 'home-'))
  const tmp = mkdtempSync(join(work, 'tmp-'))
  const env = { ...process.env, REVIEW_HOME: home, REVIEW_PORT: String(quiet), TMPDIR: tmp, TEMP: tmp, TMP: tmp }
  const ran = spawnSync('node', [CLI, 'check'], { env, encoding: 'utf8' })
  assert.equal(ran.status, 0, ran.stdout + ran.stderr)
  const lines = ran.stdout.trim().split('\n')
  assert.equal(lines.length, 9, 'eight checks and the last line')
  for (const line of lines.slice(0, 4)) assert.match(line, /^ok {7}\S/, 'the four checks that must pass')
  assert.match(lines[3], /A whole round works/)
  assert.match(lines[6], /^note {5}Your review page is not running\. Start it with: review start$/)
  assert.match(lines[7], /^note {5}Speaking cannot be checked from a command\./)
  assert.match(lines[8], /^(Everything works|Markback works, except .+): \d of 6 checks are ok\.$/)
  assert.deepEqual(left(tmp), [], 'its own store and pictures are gone')
  assert.deepEqual(readdirSync(home), [], "nothing is written to the person's own store")
})

test('--json gives the results as a list, and nothing else', () => {
  const tmp = mkdtempSync(join(work, 'tmp-'))
  const env = { ...process.env, REVIEW_HOME: mkdtempSync(join(work, 'home-')), REVIEW_PORT: String(quiet), TMPDIR: tmp, TEMP: tmp, TMP: tmp }
  const ran = spawnSync('node', [CLI, 'check', '--json'], { env, encoding: 'utf8' })
  assert.equal(ran.status, 0, ran.stdout + ran.stderr)
  const results = JSON.parse(ran.stdout)
  assert.deepEqual(results.map(r => r.name), ['node', 'store', 'page', 'round', 'pictures', 'pdf', 'your-page', 'speaking'])
  for (const r of results) assert.deepEqual(Object.keys(r), ['name', 'ok', 'required', 'words'])
  assert.deepEqual(results.map(r => r.required), [true, true, true, true, false, false, false, false])
  assert.ok(results.slice(0, 4).every(r => r.ok === true))
  assert.ok(results.slice(6).every(r => r.ok === null), 'a line that only informs is neither ok nor not')
  assert.deepEqual(left(tmp), [])
})

test('it leaves no server behind', async () => {
  const tmp = mkdtempSync(join(work, 'tmp-'))
  let port = 0
  const start = async (...words) => {
    const page = await startPage(...words)
    port = page.port
    assert.equal(await up(port), true, 'its own page answers while the check runs')
    return page
  }
  const { code } = await runChecks({ tmp, start, find: () => null, ownPort: quiet })
  assert.equal(code, 0)
  assert.ok(port > 0 && port !== quiet, 'on a free port of its own')
  assert.equal(await up(port), false, 'and is gone after')
  assert.deepEqual(left(tmp), [])
})

test('with no Chrome or Edge it warns, says what still works, and still passes', async () => {
  const tmp = mkdtempSync(join(work, 'tmp-'))
  const { results, code } = await runChecks({ tmp, find: () => null, ownPort: quiet })
  assert.equal(code, 0)
  const pictures = named(results, 'pictures')
  assert.equal(pictures.ok, false)
  assert.equal(pictures.required, false)
  assert.match(pictures.words, /No Chrome or Edge.*review project and review see cannot take pictures\. review push with your own screenshots still works\./)
  assert.match(sayResult(pictures), /^missing  No Chrome/)
  assert.match(sayVerdict(results), /^Markback works, except pictures(?: and PDFs)?: \d of 6 checks are ok\.$/)
  assert.deepEqual(left(tmp), [])
})

test('with no way to draw a PDF it warns, and names pdftoppm', async () => {
  const tmp = mkdtempSync(join(work, 'tmp-'))
  const draw = async () => {
    throw new Error('Showing a PDF needs pdftoppm on this computer (it comes with Poppler).')
  }
  const { results, code } = await runChecks({ tmp, draw, find: () => null, ownPort: quiet })
  assert.equal(code, 0)
  assert.match(named(results, 'pdf').words, /^review pdf needs pdftoppm on this computer\. It comes with Poppler\./)
  assert.match(sayVerdict(results), /^Markback works, except pictures and PDFs: 4 of 6 checks are ok\.$/)
})

test('when the round cannot complete it fails, says what to do, and still clears up', async () => {
  const tmp = mkdtempSync(join(work, 'tmp-'))
  let port = 0
  const send = async at => {
    port = at
    throw new Error('the page is deaf')
  }
  const { results, code } = await runChecks({ tmp, send, find: () => null, ownPort: quiet })
  assert.equal(code, 1)
  const round = named(results, 'round')
  assert.equal(round.ok, false)
  assert.match(round.words, /the review page did not take the answer \(the page is deaf\)\. Get a new copy of Markback and run review check again\. If it still fails, report it at https:/)
  assert.match(sayResult(round), /^failed   A whole round did not work/)
  assert.match(sayVerdict(results), /^Markback does not work here: \d of 6 checks are ok\.$/)
  assert.equal(results.length, 8, 'the checks after it still run')
  assert.equal(await up(port), false, 'the server is stopped')
  assert.deepEqual(left(tmp), [])
})

test('when the review page cannot start, the round is not tried and says why', async () => {
  const tmp = mkdtempSync(join(work, 'tmp-'))
  const start = async () => {
    throw new Error('Port 1 is taken.')
  }
  const { results, code } = await runChecks({ tmp, start, find: () => null, ownPort: quiet })
  assert.equal(code, 1)
  assert.match(named(results, 'page').words, /^The review page did not start: Port 1 is taken\. Run it by hand to see why: node .*server\.mjs$/)
  assert.match(named(results, 'round').words, /was not tried, because the review page did not start/)
  assert.deepEqual(left(tmp), [])
})

test('a check that throws is a check that failed, and the folder still goes', async () => {
  const tmp = mkdtempSync(join(work, 'tmp-'))
  const look = async () => {
    throw new Error('no network')
  }
  const { results, code } = await runChecks({ tmp, look, find: () => null, ownPort: quiet })
  assert.equal(code, 0, 'only a required check fails the command')
  assert.match(named(results, 'your-page').words, /could not be checked: no network\./)
  assert.deepEqual(left(tmp), [])
})

test('an old Node is said plainly, with what to do', async () => {
  assert.equal(checkNode('22.6.0').ok, true)
  assert.equal(checkNode('24.1.0').ok, true)
  for (const old of ['22.5.1', '20.11.0', '18.0.0']) {
    const result = checkNode(old)
    assert.equal(result.ok, false)
    assert.equal(result.required, true)
    assert.match(result.words, new RegExp(`This is Node ${old.replace(/\./g, '\\.')}\\. Markback needs Node 22\\.6 or later\\. Get it from`))
  }
  // It fails the command by itself, with all else well.
  const { results, code } = await runChecks({ tmp: mkdtempSync(join(work, 'tmp-')), node: '20.11.0', find: () => null, ownPort: quiet })
  assert.equal(code, 1)
  assert.deepEqual(results.filter(r => r.required && !r.ok).map(r => r.name), ['node'])
})

test("the person's own page is only looked at: it says where it runs, or how to start it", async () => {
  const seen = []
  const running = await checkOwnPage({ port: 5999, look: async port => seen.push(port) > 0 })
  assert.deepEqual(seen, [5999])
  assert.equal(running.ok, null)
  assert.equal(running.words, 'Your review page is running at http://localhost:5999')
  assert.match((await checkOwnPage({ port: quiet })).words, /is not running\. Start it with: review start/)
})
