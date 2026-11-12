import './own-home.mjs'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { writePicture } from './helpers.mjs'

const home = mkdtempSync(join(tmpdir(), 'review-choice-'))
process.env.REVIEW_HOME = home
const { listScreens, readInbox, receive } = await import('../lib/store.mjs')
const { optionAt, readOptions } = await import('../lib/choice.mjs')
after(() => rmSync(home, { recursive: true, force: true }))
const require = createRequire(import.meta.url)
const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'review.mjs')
const env = { ...process.env, REVIEW_HOME: home }
const run = (...args) => spawnSync('node', [CLI, ...args], { env, encoding: 'utf8' })
const pic = (name, w = 400, h = 600) => {
  const path = join(home, name)
  writePicture(path, w, h)
  return path
}
const a = pic('a.png')
const b = pic('b.png')
const c = pic('c.png', 200, 300)

test('choose: 2 to 6 options, in order, each a picture; anything else is refused in one line and queues nothing', () => {
  const refused = (args, why) => {
    const r = run('choose', '--app', 'Refused', ...args)
    assert.equal(r.status, 1, args.join(' '))
    assert.match(r.stderr, why)
  }
  refused(['--question', 'Which?', '--option', a], /2 to 6 options/)
  refused(['--question', 'Which?', ...Array.from({ length: 7 }, () => ['--option', a]).flat()], /2 to 6 options/)
  refused(['--option', a, '--option', b], /Missing --question/)
  refused(['--question', 'Which?', '--option', `B=${a}`, '--option', b], /Option 1 is A, not B/)
  refused(['--question', 'Which?', '--option', a, '--option', join(home, 'gone.png')], /No picture at/)
  refused(['--question', 'Which?', '--option', a, '--option', `${'Long words '.repeat(5)}=${b}`], /too long/)
  refused(['--question', 'Which?', '--option', a, '--option', 'B='], /has no picture/)
  const svg = join(home, 'x.svg')
  writePicture(join(home, 'x.svg'), 4, 4)
  refused(['--question', 'Which?', '--option', a, '--option', svg], /PNG, JPEG, WebP or GIF/)
  assert.equal(listScreens('refused').length, 0, 'nothing was queued')
  assert.throws(() => readOptions(['x.png', 'y.png'], () => false), /No picture at x.png/)
})

test('choose: the options become one lineup screen, side by side at one height, each kept with its letter, label and place', () => {
  const out = run('choose', '--app', 'Brochure', '--question', 'Which cover for page 2?', '--option', `A=${a}`, '--option', b, '--option', `Two columns=${c}`, '--note', 'Page 2 only')
  assert.equal(out.status, 0, out.stderr)
  assert.match(out.stdout, /Queued Brochure \/ Which cover for page 2\?, round 1: a choice of A, B or C/)
  const [entry] = listScreens('brochure')
  assert.equal(entry.choice.question, 'Which cover for page 2?')
  assert.deepEqual(entry.choice.options.map(o => [o.key, o.label]), [['A', ''], ['B', ''], ['C', 'Two columns']])
  assert.match(entry.after, /\.svg$/, 'one picture, so marks, zoom and the film work as on any screen')
  const svg = readFileSync(join(home, 'images', entry.after), 'utf8')
  assert.equal((svg.match(/<image /g) ?? []).length, 3)
  const boxes = entry.choice.options.map(o => o.box)
  assert.ok(boxes.every(box => box.h === 600), 'every option at the same height')
  assert.equal(boxes[2].w, 400, 'a smaller picture is scaled up to it')
  assert.ok(boxes[1].x > boxes[0].x + boxes[0].w && boxes[2].x > boxes[1].x + boxes[1].w, 'side by side, a gap between')
  for (const o of entry.choice.options) assert.ok(readFileSync(join(home, 'images', o.picture)).length > 0, 'each option kept as its own picture')
  assert.equal(entry.note, 'Page 2 only')
  assert.equal(optionAt(entry.choice.options, boxes[1].x + 10).key, 'B')
  assert.equal(optionAt(entry.choice.options, boxes[0].w + 2).key, 'A', 'in the gap, the nearest')
})

test('read: the answer says which option was chosen, and each mark which option it is on and where in its own picture', () => {
  const [entry] = listScreens('brochure')
  const [, B, C] = entry.choice.options
  const shapes = [{ type: 'box', colour: '#d42a20', box: { x: C.box.x + 20, y: 40, w: 100, h: 60 } }, { type: 'text', text: 'bigger', colour: '#d42a20', box: { x: B.box.x + 10, y: 10, w: 50, h: 20 } }]
  receive({ appSlug: 'brochure', id: entry.id, png: null, shapes, notes: 'Use the C cover, with a bigger title.', verdict: 'changes', imageSize: { w: 1, h: 1 }, choice: 'C' })
  const [record] = readInbox('brochure')
  assert.equal(record.choice.chosen, 'C')
  assert.equal(record.choice.label, 'Two columns')
  assert.equal(record.choice.question, 'Which cover for page 2?')
  assert.deepEqual(record.choice.options.map(o => o.key), ['A', 'B', 'C'])
  assert.deepEqual(record.shapes.map(s => s.option), ['C', 'B'])
  // C is 200 by 300, shown at 400 by 600: half of the lineup's pixels.
  assert.deepEqual(record.shapes[0].optionBox, { x: 10, y: 20, w: 50, h: 30 })
  const text = execFileSync('node', [CLI, 'read', '--app', 'Brochure', '--latest'], { env, encoding: 'utf8' })
  assert.match(text, /Which cover for page 2\?, round 1: CHANGES ASKED/)
  assert.match(text, /\n {2}Chose C \(Two columns\): .*option-c-\d+\.png\. Asked: Which cover for page 2\? A, B, C \(Two columns\)\n/)
  assert.match(text, /Notes: Use the C cover, with a bigger title\./)
  assert.match(text, /1\. on C: box \(#d42a20\)/)
  assert.match(text, /2\. on B: text "bigger"/)
  const json = JSON.parse(execFileSync('node', [CLI, 'read', '--app', 'Brochure', '--latest', '--json'], { env, encoding: 'utf8' }))
  assert.equal(json[0].choice.chosen, 'C')
  assert.equal(json[0].shapes[0].option, 'C')
})

test('a choice is never made for the person: a Looks good with none, or one not among the options, is refused; marks with none are "none of these"', () => {
  const [entry] = listScreens('brochure')
  const count = () => readInbox('brochure').length
  const before = count()
  for (const choice of [null, 'Z']) {
    assert.throws(() => receive({ appSlug: 'brochure', id: entry.id, png: null, shapes: [], notes: '', verdict: 'approved', imageSize: null, choice }), /Choose one first/)
    assert.throws(() => receive({ appSlug: 'brochure', id: entry.id, png: null, shapes: [], notes: 'No comment.', verdict: 'approved', imageSize: null, noComment: true, choice }), /Choose one first/)
  }
  assert.equal(count(), before, 'nothing was written')
  receive({ appSlug: 'brochure', id: entry.id, png: null, shapes: [], notes: 'None of these: try a darker one', verdict: 'changes', imageSize: null, choice: null })
  assert.equal(readInbox('brochure').at(-1).choice.chosen, null)
  assert.match(execFileSync('node', [CLI, 'read', '--app', 'Brochure', '--latest'], { env, encoding: 'utf8' }), /CHANGES ASKED[^\n]*\n {2}Chose none: the reviewer did not choose/)
  receive({ appSlug: 'brochure', id: entry.id, png: null, shapes: [], notes: '', verdict: 'approved', imageSize: null, choice: 'A' })
  const text = execFileSync('node', [CLI, 'read', '--app', 'Brochure', '--latest'], { env, encoding: 'utf8' })
  assert.match(text, /round 1: LOOKS GOOD\n {2}Chose A: /)
})

test('a proposal shown as a lineup is never taken on to be built by an answer with nothing chosen', async () => {
  const { askForIdeas, postIdea, decide, take, listWork, setStage } = await import('../lib/work.mjs')
  const r = askForIdeas({ target: 'Lined', count: 1 })
  const idea = postIdea({ request: r.id, what: 'Three covers' })
  decide(idea.id, 'yes')
  take({ by: 'Claude', id: idea.id })
  assert.equal(run('choose', '--app', 'Lined', '--question', 'Which cover?', '--option', a, '--option', b, '--kind', 'proposal', '--item', idea.id).status, 0)
  setStage(idea.id, 'ready')
  const [entry] = listScreens('lined')
  assert.throws(() => receive({ appSlug: 'lined', id: entry.id, png: null, shapes: [], notes: 'No comment.', verdict: 'approved', imageSize: null, noComment: true }), /Choose one first/)
  const item = () => listWork().find(i => i.id === idea.id)
  assert.equal(item().phase, 'proposal')
  assert.equal(entry.status, 'waiting')
  const { answered } = await import('../lib/work.mjs')
  answered({ item: idea.id, app: 'Lined', verdict: 'approved', choice: { chosen: null } })
  assert.equal(item().phase, 'proposal', 'a planted answer with nothing chosen moves nothing')
})

test('options of any shape fit one sensible lineup; a strip is refused in one line', () => {
  const banner = pic('banner.png', 3000, 200)
  const phone = pic('phone.png', 390, 844)
  const out = run('choose', '--app', 'Shapes', '--question', 'Which?', '--option', banner, '--option', phone)
  assert.equal(out.status, 0, out.stderr)
  const [entry] = listScreens('shapes')
  const [wide, tall] = entry.choice.options.map(o => o.box)
  assert.ok(wide.w <= wide.h * 16 && wide.w <= 1.6 * tall.h + 1, 'the banner fits a box 1.6 times as wide as high')
  assert.ok(tall.x + tall.w < 4000, `the lineup is ${tall.x + tall.w} wide`)
  assert.ok(wide.y > 0, 'a short option stands centred in the height')
  const six = run('choose', '--app', 'Six', '--question', 'Which?', ...Array.from({ length: 6 }, () => ['--option', pic('w.png', 3000, 2400)]).flat())
  assert.equal(six.status, 0, six.stderr)
  const last = listScreens('six')[0].choice.options.at(-1).box
  assert.ok(last.x + last.w <= 9000, 'the whole lineup is capped')
  const strip = run('choose', '--app', 'Strip', '--question', 'Which?', '--option', pic('strip.png', 4000, 10), '--option', pic('thin.png', 20, 3000))
  assert.equal(strip.status, 1)
  assert.match(strip.stderr, /Option A is 4000 by 10: too thin to show beside the others/)
  assert.equal(listScreens('strip').length, 0)
})

test('a long question gets a short screen name, is warned about first, and a label may hold an =', () => {
  const question = `Which of these ${'very '.repeat(60)}long layouts should page two use?`
  const out = run('choose', '--app', 'Long', '--question', question, '--option', a, '--option', `Price = value=${b}`)
  assert.equal(out.status, 0, out.stderr)
  assert.match(out.stderr, /^Too long: ask the question in twelve words or fewer/)
  const [entry] = listScreens('long')
  assert.ok(entry.id.length <= 60, entry.id)
  assert.equal(entry.choice.question, question.replace(/\s+/g, ' ').trim())
  assert.equal(entry.choice.options[1].label, 'Price = value')
  const bad = run('choose', '--app', 'Longer', '--screen', 'x'.repeat(300), '--question', 'Which?', '--option', a, '--option', b)
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /--screen is too long/)
  const { existsSync } = require('node:fs')
  assert.equal(existsSync(join(home, 'queue', 'longer')), false, 'no folder left behind')
  assert.equal(existsSync(join(home, 'images', 'longer')), false)
})

test('the film of a lineup says it is a lineup when it cannot be saved', () => {
  const [entry] = listScreens('brochure')
  const film = run('film', '--app', 'Brochure', '--screen', entry.screen, '--out', join(home, 'f.mp4'))
  assert.match(film.stderr + film.stdout, /A film of a lineup cannot be saved as a file/)
})

test('a choice pushed again is round 2, with no marks carried over from the old options', () => {
  const out = run('choose', '--app', 'Brochure', '--question', 'Which cover for page 2?', '--option', a, '--option', b)
  assert.equal(out.status, 0, out.stderr)
  const [entry] = listScreens('brochure')
  assert.equal(entry.round, 2)
  assert.equal(entry.choice.options.length, 2)
  assert.equal(entry.asked, undefined)
  assert.equal(entry.status, 'waiting')
})

test('wait ends on a choice as on any answer', async () => {
  const [entry] = listScreens('brochure')
  const { spawn } = await import('node:child_process')
  const waiting = spawn('node', [CLI, 'wait', '--app', 'Brochure', '--timeout', '20'], { env })
  let said = ''
  waiting.stdout.on('data', d => (said += d))
  await new Promise(r => setTimeout(r, 600))
  receive({ appSlug: 'brochure', id: entry.id, png: null, shapes: [], notes: '', verdict: 'approved', imageSize: null, choice: 'B' })
  const code = await new Promise(r => waiting.once('exit', r))
  assert.equal(code, 0)
  assert.match(said, /round 2: LOOKS GOOD\n {2}Chose B: /)
})

test('in a project store the choice is inside the page\'s stamp: one changed in the file, or planted, is the project\'s claim, and no wait ends on it', async () => {
  const out = run('choose', '--app', 'Planted', '--question', 'Which one?', '--option', a, '--option', b, '--option', `Equal panels=${c}`)
  assert.equal(out.status, 0, out.stderr)
  const [entry] = listScreens('planted')
  const record = receive({ appSlug: 'planted', id: entry.id, png: null, shapes: [], notes: '', verdict: 'approved', imageSize: null, choice: 'B' })
  assert.match(run('read', '--app', 'Planted', '--latest').stdout, /LOOKS GOOD\n {2}Chose B: /, 'stamped by the page: the person\'s')
  // Changed in the file afterwards: the stamp no longer fits, so the choice is the project's words.
  const file = readInbox('planted').at(-1).file
  const { writeFileSync } = await import('node:fs')
  writeFileSync(file, JSON.stringify({ ...record, choice: { ...record.choice, chosen: 'C', label: 'Equal panels' } }, null, 2))
  const read = run('read', '--app', 'Planted', '--latest').stdout
  assert.match(read, /NOT CONFIRMED[^\n]*\n {2}Planted \/ Which one\?, round 1\. The project's store says: looks good, chose C \(Equal panels\)\./)
  assert.doesNotMatch(read, /Chose C|LOOKS GOOD/)
  assert.equal(JSON.parse(run('read', '--app', 'Planted', '--latest', '--json').stdout)[0].byPage, false)
  // A planted answer that comes while an agent waits does not end the wait.
  const { spawn } = await import('node:child_process')
  const waiting = spawn('node', [CLI, 'wait', '--app', 'Planted', '--timeout', '3'], { env })
  let said = ''
  waiting.stdout.on('data', d => (said += d))
  await new Promise(r => setTimeout(r, 600))
  const later = new Date(Date.now() + 1000).toISOString()
  writeFileSync(file.replace(/\.json$/, '-planted.json'), JSON.stringify({ ...record, sentAt: later, choice: { ...record.choice, chosen: 'A', label: '' } }, null, 2))
  assert.equal(await new Promise(r => waiting.once('exit', r)), 1, 'it waited on for the person')
  assert.doesNotMatch(said, /Chose A/)
})

test('a plain screen pushed in place of a lineup carries no marks from the options', () => {
  const [entry] = listScreens('planted')
  const box = entry.choice.options[1].box
  receive({ appSlug: 'planted', id: entry.id, png: null, shapes: [{ type: 'box', colour: 'red', box: { x: box.x + 5, y: 5, w: 20, h: 20 } }], notes: 'Tighter', verdict: 'changes', imageSize: null, choice: 'B' })
  const out = run('push', '--app', 'Planted', '--screen', 'Which one?', '--after', a)
  assert.equal(out.status, 0, out.stderr)
  const [next] = listScreens('planted')
  assert.equal(next.choice, undefined)
  assert.equal(next.asked, undefined, 'the marks were on the lineup, not on this picture')
})

test('an option with more than one = is read the one way that names a picture, and two such ways are refused', () => {
  const { mkdirSync, copyFileSync } = require('node:fs')
  mkdirSync(join(home, 'x'), { recursive: true })
  copyFileSync(c, join(home, 'x', 'c.png'))
  const only = readOptions([a, `Calm=dir=${join(home, 'x', 'c.png')}`], file => require('node:fs').existsSync(file))
  assert.deepEqual([only[1].label, only[1].file], ['Calm=dir', join(home, 'x', 'c.png')], 'the one reading whose path is a file')
  // A folder named dir=x beside it: now both readings name a picture.
  mkdirSync(join(home, 'dir=x'), { recursive: true })
  copyFileSync(c, join(home, 'dir=x', 'c.png'))
  const both = spawnSync('node', [CLI, 'choose', '--app', 'Eq', '--question', 'Which?', '--option', a, '--option', `Calm=dir=x/c.png`], { env, encoding: 'utf8', cwd: home })
  assert.equal(both.status, 1)
  assert.match(both.stderr, /Option B can be read more than one way: label "Calm" with dir=x\/c\.png, or label "Calm=dir" with x\/c\.png\. Give the picture a name without =\./)
  assert.equal(listScreens('eq').length, 0)
})
