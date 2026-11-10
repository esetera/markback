import './own-home.mjs'
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
