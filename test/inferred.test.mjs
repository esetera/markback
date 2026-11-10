import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { writePicture } from './helpers.mjs'

const home = mkdtempSync(join(tmpdir(), 'review-inferred-'))
process.env.REVIEW_HOME = home
const { listApps, postReading, push, readInbox, receive, replyToReading } = await import('../lib/store.mjs')
after(() => rmSync(home, { recursive: true, force: true }))
const picture = join(home, 'p.png')
writePicture(picture, 80, 50)
const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'review.mjs')
const env = { ...process.env, REVIEW_HOME: home }
const cli = (...args) => execFileSync('node', [CLI, ...args], { env, encoding: 'utf8' })
const fails = (...args) => promisify(execFile)('node', [CLI, ...args], { env, encoding: 'utf8' }).then(() => '', error => error.stderr)

const box = (x, y) => ({ type: 'box', colour: 'red', box: { x, y, w: 10, h: 10 } })
const marked = (app, screen, shapes = [box(1, 1), box(30, 20)], mode = 'light') => {
  push({ app, screen, mode, after: picture })
  // A file is named by its millisecond: two in the same one would be one.
  const now = Date.now()
  while (Date.now() === now);
  return receive({ appSlug: app.toLowerCase(), id: `${screen.toLowerCase()}-${mode}`, png: null, shapes, notes: '', verdict: 'changes', imageSize: { w: 80, h: 50 } })
}

test('a reading goes with the answer it read, beside its mark, and review read says it with what came back', () => {
  marked('Shop', 'Home')
  const said = cli('inferred', '--app', 'Shop', '--screen', 'Home', '--mark', '2', '--text', 'Make the Book link the main button')
  assert.match(said, /Shown beside mark 2 on Home \(light\): Make the Book link the main button/)
  const [record] = readInbox('shop')
  assert.deepEqual(record.inferred.map(r => [r.n, r.text, r.from]), [[2, 'Make the Book link the main button', 'Claude']])
  assert.match(cli('read', '--app', 'Shop', '--latest'), /2\. box \(red\) at x 30, y 20, 10x10\n\s+Read as: "Make the Book link the main button"\. Not answered yet\./)
  replyToReading({ appSlug: 'shop', id: 'home-light', answer: basename(record.file), n: 2, text: 'No, the Pay link' })
  assert.match(cli('read', '--app', 'Shop', '--latest'), /They corrected it: "No, the Pay link"/)
  replyToReading({ appSlug: 'shop', id: 'home-light', answer: basename(record.file), n: 2, yes: true })
  assert.match(cli('read', '--app', 'Shop', '--latest'), /They said: yes, that\./)
  // Said again, it replaces the first, and what came back to the first does not stand for the new one.
  cli('inferred', '--app', 'Shop', '--screen', 'Home', '--mark', '2', '--text', 'Make Book bigger')
  assert.deepEqual(readInbox('shop')[0].inferred.map(r => [r.text, r.reply ?? null]), [['Make Book bigger', null]])
})

test('the page is told when readings come or are answered, and only then', () => {
  const stamp = () => listApps().find(a => a.slug === 'shop').screens[0].inferred
  const first = stamp()
  assert.ok(first.posted && first.changed)
  assert.equal(first.from, 'Claude')
  assert.throws(() => replyToReading({ appSlug: 'shop', id: 'home-light', answer: 'none.json', n: 1, yes: true }), /No such reading/)
  assert.deepEqual(stamp(), first, 'nothing found, nothing written')
  marked('Plain', 'One')
  assert.equal(listApps().find(a => a.slug === 'plain').screens[0].inferred, undefined, 'a screen with no readings is as it was')
})

test('a reading is refused in one line where it could not be shown', async () => {
  marked('Refuse', 'Home', [box(1, 1)])
  assert.match(await fails('inferred', '--app', 'Refuse', '--screen', 'Home', '--mark', '2', '--text', 'x'), /--mark is a number from 1 to 1/)
  assert.match(await fails('inferred', '--app', 'Refuse', '--screen', 'Nowhere', '--mark', '1', '--text', 'x'), /No screen Nowhere in Refuse/)
  assert.match(await fails('inferred', '--app', 'Refuse', '--screen', 'Home', '--mark', '1'), /Missing --text/)
  marked('Refuse', 'Notes', [])
  assert.match(await fails('inferred', '--app', 'Refuse', '--screen', 'Notes', '--mark', '1', '--text', 'x'), /no marks, only notes/)
  // Pushed again: the page shows the new picture, so a reading of the old answer would be seen by nobody.
  push({ app: 'Refuse', screen: 'Home', mode: 'light', after: picture })
  assert.match(await fails('inferred', '--app', 'Refuse', '--screen', 'Home', '--mark', '1', '--text', 'x'), /new round since that answer/)
  marked('Both', 'Home', [box(1, 1)], 'dark')
  push({ app: 'Both', screen: 'Home', mode: 'light', after: picture })
  assert.match(await fails('inferred', '--app', 'Both', '--screen', 'Home', '--mark', '1', '--text', 'x'), /say which with --mode/)
  assert.equal(postReading({ app: 'Both', screen: 'Home', mode: 'dark', mark: 1, text: '  Say   it\nshort ' }).reading.text, 'Say it short')
})

test('review wait ends when a reading is answered, and gives the answer with what was said back', async () => {
  const record = marked('Waits', 'Home', [box(1, 1)])
  const answer = basename(readInbox('waits').find(r => r.sentAt === record.sentAt).file)
  cli('inferred', '--app', 'Waits', '--screen', 'Home', '--mark', '1', '--text', 'Bigger title')
  const waiting = promisify(execFile)('node', [CLI, 'wait', '--app', 'Waits', '--timeout', '20'], { env, encoding: 'utf8' })
  await new Promise(r => setTimeout(r, 700))
  replyToReading({ appSlug: 'waits', id: 'home-light', answer, n: 1, text: 'The subtitle, not the title' })
  const { stdout } = await waiting
  assert.match(stdout, /Read as: "Bigger title"\. They corrected it: "The subtitle, not the title"/)
})

test('a reading lands on the answer it read: with two on one picture, --answer says which, and without it it asks', async () => {
  marked('Two', 'Home', [box(1, 1), box(30, 20)])
  const now = Date.now()
  while (Date.now() === now);
  receive({ appSlug: 'two', id: 'home-light', png: null, shapes: [box(50, 5)], notes: '', verdict: 'changes', imageSize: { w: 80, h: 50 } })
  const [first, second] = readInbox('two')
  const refused = await fails('inferred', '--app', 'Two', '--screen', 'Home', '--mark', '1', '--text', 'x')
  assert.match(refused, /Home has 2 answers on this picture: say which with --answer\./)
  assert.ok(refused.includes(`${first.sentAt} (2 marks)`) && refused.includes(`${second.sentAt} (1 mark)`), refused)
  // review read prints each answer's name beside its marks, the earlier one too.
  const read = cli('read', '--app', 'Two', '--latest')
  assert.ok(read.includes(`Answer: ${second.sentAt}`) && read.includes(`Answer: ${first.sentAt}`), read)
  cli('inferred', '--app', 'Two', '--screen', 'Home', '--answer', first.sentAt, '--mark', '2', '--text', 'For the first answer')
  cli('inferred', '--app', 'Two', '--screen', 'Home', '--answer', second.sentAt, '--mark', '1', '--text', 'For the second answer')
  const [a, b] = readInbox('two')
  assert.deepEqual(a.inferred.map(r => [r.n, r.text]), [[2, 'For the first answer']])
  assert.deepEqual(b.inferred.map(r => [r.n, r.text]), [[1, 'For the second answer']])
  assert.match(await fails('inferred', '--app', 'Two', '--screen', 'Home', '--answer', 'nope', '--mark', '1', '--text', 'x'), /No answer nope stands on Home/)
  // A Looks good over them stands alone: their marks no longer stand.
  receive({ appSlug: 'two', id: 'home-light', png: null, shapes: [], notes: '', verdict: 'approved', imageSize: null })
  assert.match(await fails('inferred', '--app', 'Two', '--screen', 'Home', '--answer', first.sentAt, '--mark', '1', '--text', 'x'), /answered Looks good/)
})

test('who read it is a short name on one line, however much is given', () => {
  marked('Named', 'Home', [box(1, 1)])
  cli('inferred', '--app', 'Named', '--screen', 'Home', '--mark', '1', '--text', 'x', '--from', `Codex\n${'X'.repeat(3000)}`)
  const [reading] = readInbox('named')[0].inferred
  assert.equal(reading.from, `Codex ${'X'.repeat(34)}`)
  assert.equal(listApps().find(a => a.slug === 'named').screens[0].inferred.from, reading.from)
  assert.equal(postReading({ app: 'Named', screen: 'Home', mark: 1, text: 'y', from: '   ' }).reading.from, 'Claude')
})
