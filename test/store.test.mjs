import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { writePicture } from './helpers.mjs'

const home = mkdtempSync(join(tmpdir(), 'review-store-'))
process.env.REVIEW_HOME = home
const { clearApp, listApps, listScreens, push, readInbox, receive, setAside } = await import('../lib/store.mjs')
after(() => rmSync(home, { recursive: true, force: true }))
const picture = join(home, 'p.png')
writePicture(picture, 8, 5)
const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'review.mjs')

const answer = (appSlug, id, verdict, noComment = false) => receive({ appSlug, id, png: null, shapes: [], notes: noComment ? 'No comment.' : '', verdict, imageSize: { w: 8, h: 5 }, noComment })

test('an entry stays open while one screen waits, and closes when every screen has an answer', () => {
  for (const screen of ['One', 'Two', 'Three']) push({ app: 'Closes', screen, mode: 'light', after: picture, note: `About ${screen}` })
  const waiting = () => listApps().find(a => a.slug === 'closes').screens.filter(s => s.status === 'waiting').length
  assert.equal(waiting(), 3)
  answer('closes', 'one-light', 'changes')
  answer('closes', 'two-light', 'approved')
  assert.equal(waiting(), 1, 'what happened to the brochure: answered screens with one left behind')
  answer('closes', 'three-light', 'approved', true)
  assert.equal(waiting(), 0)
  assert.deepEqual(listScreens('closes').map(s => s.status), ['sent', 'approved', 'approved'])
})

test('no comment is recorded as looks good, with the flag, and the session reading it is told', () => {
  const record = readInbox('closes').find(r => r.screenId === 'three-light')
  assert.equal(record.verdict, 'approved')
  assert.equal(record.noComment, true)
  const read = execFileSync('node', [CLI, 'read', '--app', 'Closes', '--latest'], { env: { ...process.env, REVIEW_HOME: home }, encoding: 'utf8' })
  assert.match(read, /Three \(light\), round 1: LOOKS GOOD \(no comment\)/)
  assert.match(read, /Two \(light\), round 1: LOOKS GOOD\n/)
})

test('--latest shows marks sent twice on one picture, and a Looks good pressed over them stands alone', () => {
  const env = { ...process.env, REVIEW_HOME: home }
  push({ app: 'Twice', screen: 'One', after: picture })
  // A file is named by its millisecond: two in the same one would be one.
  const say = (notes, verdict = 'changes') => {
    const now = Date.now()
    while (Date.now() === now);
    return receive({ appSlug: 'twice', id: 'one', png: null, shapes: [], notes, verdict, imageSize: null })
  }
  say('First marks')
  say('Second marks')
  const [record] = JSON.parse(execFileSync('node', [CLI, 'read', '--app', 'Twice', '--latest', '--json'], { env, encoding: 'utf8' }))
  assert.equal(record.notes, 'Second marks')
  assert.deepEqual(record.earlier.map(r => r.notes), ['First marks'])
  const text = execFileSync('node', [CLI, 'read', '--app', 'Twice', '--latest'], { env, encoding: 'utf8' })
  assert.match(text, /Notes: Second marks/)
  assert.match(text, /Also said, and still stands:\n.*\n\s+Notes: First marks/)
  say('', 'approved')
  const [good] = JSON.parse(execFileSync('node', [CLI, 'read', '--app', 'Twice', '--latest', '--json'], { env, encoding: 'utf8' }))
  assert.equal(good.verdict, 'approved')
  assert.equal(good.earlier, undefined)
})

test('an answer on a picture since replaced is not an answer on the new one', async () => {
  const env = { ...process.env, REVIEW_HOME: home }
  const first = push({ app: 'Newer', screen: 'One', after: picture })
  const shape = { appSlug: 'newer', id: 'one', png: null, shapes: [], imageSize: null, after: first.after, round: 1 }
  await new Promise(r => setTimeout(r, 5))
  const again = push({ app: 'Newer', screen: 'One', after: picture })
  assert.notEqual(again.after, first.after, 'each push has its own picture')
  assert.equal(receive({ ...shape, notes: '', verdict: 'approved' }), null)
  assert.deepEqual(readInbox('newer'), [], 'dropped')
  assert.equal(listScreens('newer')[0].status, 'waiting')
  const marked = receive({ ...shape, notes: 'On the old one', verdict: 'changes' })
  assert.equal(marked.round, 1)
  assert.equal(marked.olderPicture, true)
  assert.ok(marked.afterImage.endsWith(first.after))
  assert.equal(listScreens('newer')[0].status, 'waiting', 'still waiting')
  assert.match(execFileSync('node', [CLI, 'read', '--app', 'Newer', '--latest'], { env, encoding: 'utf8' }), /about an older picture/)
  // The same picture is answered as ever, and what was said about the one before comes along.
  receive({ ...shape, after: again.after, round: 2, notes: 'On the new one', verdict: 'changes' })
  assert.equal(listScreens('newer')[0].status, 'sent')
  const [record] = JSON.parse(execFileSync('node', [CLI, 'read', '--app', 'Newer', '--latest', '--json'], { env, encoding: 'utf8' }))
  assert.equal(record.notes, 'On the new one')
  assert.deepEqual(record.earlier.map(r => r.notes), ['On the old one'])
  // A path out of the app's own pictures is not believed.
  push({ app: 'Newer', screen: 'Two', after: picture })
  const odd = receive({ appSlug: 'newer', id: 'two', png: null, shapes: [], imageSize: null, notes: 'x', verdict: 'changes', after: '../../secret/x.png', round: 1 })
  assert.ok(!odd.afterImage.includes('secret'))
})

test('review wait --all returns once Submit all has answered everything', () => {
  const out = execFileSync('node', [CLI, 'wait', '--app', 'Closes', '--all', '--timeout', '5'], { env: { ...process.env, REVIEW_HOME: home }, encoding: 'utf8' })
  assert.match(out, /CHANGES ASKED/)
})

test('set aside: kept with the queue, nothing answered, and a new round stays aside and says so', async () => {
  const { setAside: aside, listApps: list, push: pushed, readInbox: inbox, clearApp: clear } = await import('../lib/store.mjs')
  pushed({ app: 'Held', screen: 'One', mode: '', after: picture, note: '' })
  const one = () => list().find(a => a.slug === 'held')
  assert.equal(one().setAside, undefined)
  aside(['held'], true)
  assert.equal(one().setAside.isNew, false)
  assert.deepEqual(inbox('Held'), [], 'not an answer')
  assert.equal(one().screens[0].status, 'waiting')
  await new Promise(r => setTimeout(r, 5))
  pushed({ app: 'Held', screen: 'One', mode: '', after: picture, note: '' })
  assert.equal(one().setAside.isNew, true)
  aside(['held'], false)
  assert.equal(one().setAside, undefined)
  aside(['held'], true)
  clear('Held')
  pushed({ app: 'Held', screen: 'One', mode: '', after: picture, note: '' })
  assert.equal(one().setAside, undefined, 'taken off and pushed afresh, it is new')
})

test('push keeps what to check, and a push without leaves none', async () => {
  const { push: pushed } = await import('../lib/store.mjs')
  assert.deepEqual(pushed({ app: 'Checks', screen: 'One', mode: '', after: picture, check: ['A', 'B'] }).check, ['A', 'B'])
  assert.equal(pushed({ app: 'Checks', screen: 'One', mode: '', after: picture }).check, undefined)
  const out = execFileSync('node', [CLI, 'push', '--app', 'Checks', '--screen', 'Two', '--after', picture, '--check', 'One thing', '--note', 'Words', '--check', 'Another'], { env: { ...process.env, REVIEW_HOME: home }, encoding: 'utf8' })
  assert.match(out, /Queued Checks/)
  assert.deepEqual(listScreens('checks').find(s => s.id === 'two').check, ['One thing', 'Another'])
})

test('a push says whose words, Claude unless told', async () => {
  const { push: pushed } = await import('../lib/store.mjs')
  assert.equal(pushed({ app: 'From', screen: 'One', mode: '', after: picture }).from, 'Claude')
  assert.equal(pushed({ app: 'From', screen: 'Two', mode: '', after: picture, from: 'A session' }).from, 'A session')
  execFileSync('node', [CLI, 'push', '--app', 'From', '--screen', 'Three', '--after', picture, '--from', 'Layout'], { env: { ...process.env, REVIEW_HOME: home }, encoding: 'utf8' })
  assert.equal(listScreens('from').find(s => s.id === 'three').from, 'Layout')
})

test('two answers in one millisecond are two answers', () => {
  push({ app: 'Quick', screen: 'One', after: picture })
  for (let i = 0; i < 30; i++) receive({ appSlug: 'quick', id: 'one', png: null, shapes: [], notes: `Said ${i}`, verdict: 'changes', imageSize: null })
  assert.deepEqual(readInbox('Quick').map(r => r.notes), Array.from({ length: 30 }, (_, i) => `Said ${i}`))
})

test('set aside: a broken file means nothing is aside, and a press writes a good one; an app called Constructor is not aside', () => {
  push({ app: 'Filed', screen: 'One', after: picture })
  push({ app: 'Constructor', screen: 'One', after: picture })
  const file = join(home, 'queue', 'set-aside.json')
  const aside = slug => listApps().find(a => a.slug === slug).setAside
  assert.equal(aside('constructor'), undefined)
  for (const bad of ['{not json', '[1,2,3]', '"words"', '5', 'null']) {
    writeFileSync(file, bad)
    assert.equal(aside('filed'), undefined, bad)
    setAside(['filed'], true)
    assert.equal(aside('filed').isNew, false, `a press over ${bad}`)
  }
  setAside(['filed'], false)
  // A path is only ever a name: nothing outside the queue is read or written.
  setAside(['../../../../etc/passwd', '../inbox'], true)
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {})
})

test('review wait --all on something set aside: not done, says why, and ends at its timeout. A push on it says so too', () => {
  const env = { ...process.env, REVIEW_HOME: home }
  push({ app: 'Parked', screen: 'One', after: picture })
  setAside(['parked'], true)
  const run = spawnSync('node', [CLI, 'wait', '--app', 'Parked', '--all', '--timeout', '1'], { env, encoding: 'utf8' })
  assert.equal(run.status, 1)
  assert.equal(run.stdout, '')
  assert.match(run.stderr, /Parked is set aside by the reviewer/)
  assert.match(run.stderr, /before the timeout\. It is set aside, not answered\./)
  assert.match(execFileSync('node', [CLI, 'push', '--app', 'Parked', '--screen', 'One', '--after', picture], { env, encoding: 'utf8' }), /This review is set aside/)
  assert.deepEqual(readInbox('Parked'), [])
})

test('a blank --check is no bullet', () => {
  assert.deepEqual(push({ app: 'Blank', screen: 'One', after: picture, check: ['', '  ', 'Real'] }).check, ['Real'])
  assert.equal(push({ app: 'Blank', screen: 'Two', after: picture, check: [''] }).check, undefined)
})

test('review wait --all at its timeout says how many screens wait, and the next run gives every answer once', async () => {
  push({ app: 'Half done', screen: 'One', mode: '', after: picture, note: '' })
  push({ app: 'Half done', screen: 'Two', mode: '', after: picture, note: '' })
  const waiting = spawn('node', [CLI, 'wait', '--app', 'Half done', '--all', '--timeout', '2'], { env: { ...process.env, REVIEW_HOME: home } })
  let out = ''
  let err = ''
  waiting.stdout.on('data', chunk => (out += chunk))
  waiting.stderr.on('data', chunk => (err += chunk))
  await new Promise(r => setTimeout(r, 700))
  answer('half-done', 'one', 'changes')
  const code = await new Promise(r => waiting.on('close', r))
  assert.equal(code, 1, 'not everything was answered')
  assert.equal(out, '', 'nothing is given twice: the answers come together at the end')
  assert.match(err, /before the timeout: 1 of 2 screens of Half done still waits\. Run this again to keep waiting\./)
  answer('half-done', 'two', 'approved')
  const all = execFileSync('node', [CLI, 'wait', '--app', 'Half done', '--all', '--timeout', '5'], { env: { ...process.env, REVIEW_HOME: home }, encoding: 'utf8' })
  assert.equal(all.match(/Half done \/ One, round 1: CHANGES ASKED/g).length, 1)
  assert.match(all, /Half done \/ Two, round 1: LOOKS GOOD/)
})

/* Marks become checks: each mark asked for comes to the next round, to be ticked fixed or said to still stand. */
const later = () => {
  const now = Date.now()
  while (Date.now() === now);
}
const box = (x, more = {}) => ({ type: 'box', colour: 'red', box: { x, y: 1, w: 2, h: 2 }, ...more })

test('each mark and the notes of an answer come to the next round as earlier marks, at their places', () => {
  push({ app: 'Carry', screen: 'One', after: picture })
  receive({ appSlug: 'carry', id: 'one', png: null, shapes: [box(1, { text: 'Bigger' }), { type: 'arrow', colour: 'blue', box: { x: 0, y: 0, w: 6, h: 4 }, from: { x: 0, y: 0 }, to: { x: 6, y: 4 } }], notes: 'Bigger title', verdict: 'changes', imageSize: { w: 8, h: 5 } })
  const entry = push({ app: 'Carry', screen: 'One', after: picture })
  assert.deepEqual(entry.asked.map(a => [a.n, a.round, a.type, a.state]), [[1, 1, 'box', 'open'], [2, 1, 'arrow', 'open'], [3, 1, 'notes', 'open']])
  assert.equal(entry.asked[0].text, 'Bigger', 'with what was written there')
  assert.deepEqual(entry.asked[0].size, { w: 8, h: 5 }, 'the size it was drawn on, so the page can fit it to a new one')
  assert.deepEqual(entry.asked[1].box, { x: -18, y: -20, w: 48, h: 48 }, 'an arrow is about what its head points at')
  assert.equal(entry.asked[2].box, undefined, 'notes have no place')
  // Pushed again with no answer in between, nothing is lost and nothing doubles.
  assert.deepEqual(push({ app: 'Carry', screen: 'One', after: picture }).asked.map(a => a.n), [1, 2, 3])
})

test('what was said of each earlier mark: fixed ones are held, the rest stay open, and read says which', () => {
  const env = { ...process.env, REVIEW_HOME: home }
  push({ app: 'Ticked', screen: 'One', after: picture })
  receive({ appSlug: 'ticked', id: 'one', png: null, shapes: [box(1), box(2), box(3)], notes: '', verdict: 'changes', imageSize: { w: 8, h: 5 } })
  push({ app: 'Ticked', screen: 'One', after: picture })
  const record = receive({ appSlug: 'ticked', id: 'one', png: null, shapes: [box(4)], notes: '', verdict: 'changes', imageSize: { w: 8, h: 5 }, said: { 1: 'fixed', 2: 'stands', 3: 'maybe' } })
  assert.deepEqual(record.asked.map(a => [a.n, a.said]), [[1, 'fixed'], [2, 'stands'], [3, null]], 'a word that is not one of the two is not said')
  assert.equal(record.asked[0].state, undefined, 'the agent reads what was said, not how the page keeps it')
  const text = execFileSync('node', [CLI, 'read', '--app', 'Ticked', '--latest'], { env, encoding: 'utf8' })
  assert.match(text, /Earlier marks: 1 of 3 ticked fixed, 2 still to do/)
  assert.match(text, /1\. fixed, from round 1: box \(red\) at x 1, y 1, 2x2/)
  assert.match(text, /2\. still stands, from round 1: box/)
  assert.match(text, /3\. not ticked, so still to do, from round 1: box/)
  const [json] = JSON.parse(execFileSync('node', [CLI, 'read', '--app', 'Ticked', '--latest', '--json'], { env, encoding: 'utf8' }))
  assert.deepEqual(json.asked.map(a => a.said), ['fixed', 'stands', null])
  const third = push({ app: 'Ticked', screen: 'One', after: picture })
  assert.deepEqual(third.asked.map(a => [a.n, a.round, a.state]), [[1, 1, 'fixed'], [2, 1, 'open'], [3, 1, 'open'], [4, 2, 'open']])
  assert.equal(third.asked[0].fixedIn, 2)
  // A fixed one is told again only when it came back.
  const quiet = receive({ appSlug: 'ticked', id: 'one', png: null, shapes: [], notes: 'x', verdict: 'changes', imageSize: null })
  assert.deepEqual(quiet.asked.map(a => a.n), [2, 3, 4])
  later()
  const back = receive({ appSlug: 'ticked', id: 'one', png: null, shapes: [], notes: '', verdict: 'changes', imageSize: null, said: { 1: 'stands' } })
  assert.deepEqual(back.asked[0], { n: 1, round: 1, type: 'box', colour: 'red', box: { x: 1, y: 1, w: 2, h: 2 }, said: 'stands', cameBack: true, fixedIn: 2 })
  assert.match(execFileSync('node', [CLI, 'read', '--app', 'Ticked', '--latest'], { env, encoding: 'utf8' }), /1\. came back, from round 1/)
  const fourth = push({ app: 'Ticked', screen: 'One', after: picture })
  assert.deepEqual(fourth.asked.filter(a => a.n === 1).map(a => [a.state, a.cameBack]), [['open', true]], 'it is open again, and says it came back')
})

test('a Looks good ticks every earlier mark fixed, and one pressed over changes takes their marks back', () => {
  push({ app: 'Good', screen: 'One', after: picture })
  receive({ appSlug: 'good', id: 'one', png: null, shapes: [box(1), box(2)], notes: '', verdict: 'changes', imageSize: null })
  push({ app: 'Good', screen: 'One', after: picture })
  receive({ appSlug: 'good', id: 'one', png: null, shapes: [box(3)], notes: 'More', verdict: 'changes', imageSize: null, said: { 1: 'stands' } })
  later()
  const good = receive({ appSlug: 'good', id: 'one', png: null, shapes: [], notes: '', verdict: 'approved', imageSize: null, said: { 2: 'stands' } })
  assert.deepEqual(good.asked.map(a => a.said), ['fixed', 'fixed'])
  const next = push({ app: 'Good', screen: 'One', after: picture })
  assert.deepEqual(next.asked.map(a => [a.n, a.state]), [[1, 'fixed'], [2, 'fixed']], 'the marks sent before the Looks good do not come along')
})

test('marks sent twice on one picture all come along, and what was said in either counts', () => {
  push({ app: 'Two sends', screen: 'One', after: picture })
  receive({ appSlug: 'two-sends', id: 'one', png: null, shapes: [box(1)], notes: '', verdict: 'changes', imageSize: null })
  push({ app: 'Two sends', screen: 'One', after: picture })
  receive({ appSlug: 'two-sends', id: 'one', png: null, shapes: [box(2)], notes: '', verdict: 'changes', imageSize: null, said: { 1: 'fixed' } })
  later()
  // The page sends only what is new: the second time, what was said of mark 1 has gone already.
  receive({ appSlug: 'two-sends', id: 'one', png: null, shapes: [box(3)], notes: '', verdict: 'changes', imageSize: null })
  const next = push({ app: 'Two sends', screen: 'One', after: picture })
  assert.deepEqual(next.asked.map(a => [a.n, a.round, a.state]), [[1, 1, 'fixed'], [2, 2, 'open'], [3, 2, 'open']])
})

test('an answer about an older picture says nothing of the earlier marks on the new one', async () => {
  const first = push({ app: 'Old marks', screen: 'One', after: picture })
  receive({ appSlug: 'old-marks', id: 'one', png: null, shapes: [box(1)], notes: '', verdict: 'changes', imageSize: null })
  await new Promise(r => setTimeout(r, 5))
  push({ app: 'Old marks', screen: 'One', after: picture })
  const old = receive({ appSlug: 'old-marks', id: 'one', png: null, shapes: [box(2)], notes: '', verdict: 'changes', imageSize: null, after: first.after, round: 1, said: { 1: 'fixed' } })
  assert.equal(old.olderPicture, true)
  assert.equal(old.asked, undefined)
})

test('push says that earlier marks come along as checks', () => {
  const env = { ...process.env, REVIEW_HOME: home }
  push({ app: 'Told', screen: 'One', after: picture })
  receive({ appSlug: 'told', id: 'one', png: null, shapes: [box(1), box(2)], notes: '', verdict: 'changes', imageSize: null })
  assert.match(execFileSync('node', [CLI, 'push', '--app', 'Told', '--screen', 'One', '--after', picture], { env, encoding: 'utf8' }), /2 earlier marks on this screen come along as checks/)
})

/* What an independent read found. */

test('a review cleared and pushed afresh brings back none of the old marks: answers are the entry\'s own, never found by round alone', () => {
  push({ app: 'Fresh', screen: 'One', after: picture })
  receive({ appSlug: 'fresh', id: 'one', png: null, shapes: [box(1)], notes: 'Old words', verdict: 'changes', imageSize: null })
  clearApp('Fresh')
  push({ app: 'Fresh', screen: 'One', after: picture })
  assert.equal(push({ app: 'Fresh', screen: 'One', after: picture }).asked, undefined)
})

test('a second send on one picture keeps every word said before it, and the newest record says them all', () => {
  const env = { ...process.env, REVIEW_HOME: home }
  push({ app: 'Kept words', screen: 'One', after: picture })
  receive({ appSlug: 'kept-words', id: 'one', png: null, shapes: [box(1), box(2), box(3)], notes: '', verdict: 'changes', imageSize: null })
  push({ app: 'Kept words', screen: 'One', after: picture })
  receive({ appSlug: 'kept-words', id: 'one', png: null, shapes: [], notes: 'a', verdict: 'changes', imageSize: null, said: { 1: 'fixed', 2: 'stands' } })
  later()
  const second = receive({ appSlug: 'kept-words', id: 'one', png: null, shapes: [], notes: 'b', verdict: 'changes', imageSize: null, said: { 3: 'fixed' } })
  assert.deepEqual(second.asked.map(a => [a.n, a.said]), [[1, 'fixed'], [2, 'stands'], [3, 'fixed']])
  assert.match(execFileSync('node', [CLI, 'read', '--app', 'Kept words', '--latest'], { env, encoding: 'utf8' }).split('\n').slice(0, 2).join('\n'), /round 2: CHANGES ASKED\n\s+Earlier marks: 2 of 3 ticked fixed, 1 still to do/)
  later()
  // Taken back on the page: null, and it is open again.
  const third = receive({ appSlug: 'kept-words', id: 'one', png: null, shapes: [], notes: 'c', verdict: 'changes', imageSize: null, said: { 1: null } })
  assert.deepEqual(third.asked.map(a => a.said), [null, 'stands', 'fixed'])
})

test('changes sent after a Looks good on one picture take back its blanket fixed: what is not ticked is asked again', () => {
  push({ app: 'Over good', screen: 'One', after: picture })
  receive({ appSlug: 'over-good', id: 'one', png: null, shapes: [box(1), box(2)], notes: '', verdict: 'changes', imageSize: null })
  push({ app: 'Over good', screen: 'One', after: picture })
  receive({ appSlug: 'over-good', id: 'one', png: null, shapes: [], notes: 'x', verdict: 'changes', imageSize: null, said: { 2: 'fixed' } })
  later()
  receive({ appSlug: 'over-good', id: 'one', png: null, shapes: [], notes: '', verdict: 'approved', imageSize: null })
  later()
  const late = receive({ appSlug: 'over-good', id: 'one', png: null, shapes: [box(5)], notes: '', verdict: 'changes', imageSize: null })
  assert.deepEqual(late.asked.map(a => [a.n, a.said]), [[1, null], [2, 'fixed']], 'mark 2 was ticked for itself, and stands')
  const next = push({ app: 'Over good', screen: 'One', after: picture })
  assert.deepEqual(next.asked.map(a => [a.n, a.state]), [[1, 'open'], [2, 'fixed'], [3, 'open']])
})

test('Looks good for the rest ticks no earlier mark: sent unseen, they stay open, and read says they were not looked at', () => {
  const env = { ...process.env, REVIEW_HOME: home }
  push({ app: 'Unseen', screen: 'One', after: picture })
  receive({ appSlug: 'unseen', id: 'one', png: null, shapes: [box(1)], notes: '', verdict: 'changes', imageSize: null })
  push({ app: 'Unseen', screen: 'One', after: picture })
  const rest = receive({ appSlug: 'unseen', id: 'one', png: null, shapes: [], notes: 'No comment.', verdict: 'approved', imageSize: null, noComment: true })
  assert.deepEqual(rest.asked.map(a => a.said), [null])
  const text = execFileSync('node', [CLI, 'read', '--app', 'Unseen', '--latest'], { env, encoding: 'utf8' })
  assert.match(text, /Earlier marks: 0 of 1 ticked fixed, 1 still to do \(sent with the rest, not looked at\)/)
  assert.match(text, /1\. not looked at, so still to do/)
  assert.deepEqual(push({ app: 'Unseen', screen: 'One', after: picture }).asked.map(a => a.state), ['open'])
})

test('an arrow keeps its from and to, a pin its spot, and read gives no empty colour', () => {
  const env = { ...process.env, REVIEW_HOME: home }
  push({ app: 'Shapes', screen: 'One', after: picture })
  receive({ appSlug: 'shapes', id: 'one', png: null, shapes: [{ type: 'arrow', colour: 'red', box: { x: 0, y: 0, w: 6, h: 4 }, from: { x: 0, y: 0 }, to: { x: 6, y: 4 } }, { type: 'pin', box: { x: 0, y: 0, w: 4, h: 4 }, at: { x: 2, y: 2 }, text: 'Here' }], notes: '', verdict: 'changes', imageSize: null })
  const entry = push({ app: 'Shapes', screen: 'One', after: picture })
  assert.deepEqual([entry.asked[0].from, entry.asked[0].to, entry.asked[1].at], [{ x: 0, y: 0 }, { x: 6, y: 4 }, { x: 2, y: 2 }])
  assert.equal(entry.lastAfter, undefined, 'only when a fixed one is held')
  receive({ appSlug: 'shapes', id: 'one', png: null, shapes: [], notes: 'x', verdict: 'changes', imageSize: null, said: { 1: 'fixed' } })
  const text = execFileSync('node', [CLI, 'read', '--app', 'Shapes', '--latest'], { env, encoding: 'utf8' })
  assert.doesNotMatch(text, /\(\)/)
  assert.match(text, /said at pin "Here" at x -22, y -22, 48x48/)
  const third = push({ app: 'Shapes', screen: 'One', after: picture })
  assert.ok(third.lastAfter, 'the last round\'s picture, to compare a held one with when there is no before')
})
