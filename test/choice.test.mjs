import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { writePicture } from './helpers.mjs'

const home = mkdtempSync(join(tmpdir(), 'review-choice-'))
process.env.REVIEW_HOME = home
const { listScreens, readInbox, receive } = await import('../lib/store.mjs')
const { optionAt, readOptions } = await import('../lib/choice.mjs')
after(() => rmSync(home, { recursive: true, force: true }))
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

test('a choice that is not one of the options is no choice; a Looks good with one says it plainly', () => {
  const [entry] = listScreens('brochure')
  receive({ appSlug: 'brochure', id: entry.id, png: null, shapes: [], notes: '', verdict: 'approved', imageSize: null, choice: 'Z' })
  assert.equal(readInbox('brochure').at(-1).choice.chosen, null)
  receive({ appSlug: 'brochure', id: entry.id, png: null, shapes: [], notes: '', verdict: 'approved', imageSize: null, choice: 'A' })
  const text = execFileSync('node', [CLI, 'read', '--app', 'Brochure', '--latest'], { env, encoding: 'utf8' })
  assert.match(text, /round 1: LOOKS GOOD\n {2}Chose A: /)
  const none = execFileSync('node', [CLI, 'read', '--app', 'Brochure'], { env, encoding: 'utf8' })
  assert.match(none, /Chose none: the reviewer did not choose/)
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
