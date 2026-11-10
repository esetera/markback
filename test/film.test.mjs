import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { writePicture } from './helpers.mjs'

const home = mkdtempSync(join(tmpdir(), 'review-film-'))
process.env.REVIEW_HOME = home
const { clearApp, push, receive } = await import('../lib/store.mjs')
const { STEP_SECONDS, filmOf, filmScreen, saveFilm } = await import('../lib/film.mjs')
after(() => rmSync(home, { recursive: true, force: true }))
const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'review.mjs')
const picture = join(home, 'p.png')
writePicture(picture, 80, 50)
const png = readFileSync(picture)

/** A push names its picture by the time, to the millisecond: rounds in a test must not share one. */
const pause = () => new Promise(resolve => setTimeout(resolve, 5))
const round = async (app, screen = 'Home', mode = '') => {
  await pause()
  return push({ app, screen, mode, after: picture })
}
const box = { type: 'box', colour: 'red', box: { x: 4, y: 4, w: 10, h: 8 } }
/** What the page sends: marks with their marked picture, notes alone with a copy that has nothing on it, or a Looks good. */
const answer = (entry, { shapes = [], notes = '', verdict = 'changes', after = entry.after } = {}) => receive({ appSlug: entry.appSlug, id: entry.id, png: verdict === 'approved' ? null : png, shapes, notes, verdict, imageSize: { w: 80, h: 50 }, after, round: entry.round })

test('the film of a screen: each round\'s picture, then its marks, in order, from the files the store keeps', async () => {
  const one = await round('Story')
  const marked = answer(one, { shapes: [box], notes: 'Move this up' })
  // Pushed again with no answer: the round still has its picture.
  const two = await round('Story')
  const three = await round('Story')
  // Notes alone: the marked copy has nothing drawn on it, so it is no step.
  answer(three, { notes: 'Nearly' })
  const four = await round('Story')
  answer(four, { verdict: 'approved' })
  const film = filmOf('Story', 'home')
  assert.deepEqual(film.rounds.map(r => r.round), [1, 2, 3, 4])
  assert.deepEqual(film.rounds.map(r => basename(r.picture)), [one, two, three, four].map(e => basename(e.after)))
  assert.deepEqual(film.rounds.map(r => r.marked), [[marked.annotatedImage], [], [], []])
  assert.deepEqual(film.rounds.map(r => r.answer?.verdict ?? null), ['changes', null, 'changes', 'approved'])
  assert.deepEqual(film.rounds[0].answer, { verdict: 'changes', notes: 'Move this up', marks: 1, noComment: false })
  assert.deepEqual(film.steps.map(s => [s.at, s.marked, basename(s.file)]), [
    [0, false, basename(one.after)],
    [0, true, basename(marked.annotatedImage)],
    [1, false, basename(two.after)],
    [2, false, basename(three.after)],
    [3, false, basename(four.after)],
  ])
  assert.deepEqual(film.steps.map(s => s.seconds), [STEP_SECONDS.picture, STEP_SECONDS.marked, STEP_SECONDS.picture, STEP_SECONDS.picture, STEP_SECONDS.last])
  assert.equal(film.seconds, 6.5)
  assert.equal(film.finished, true)
  assert.equal(film.missing, 0)
  assert.ok(film.steps.every(s => existsSync(s.file)))
  assert.equal(filmOf('Story', 'nothing'), null)
})

test('four rounds with marks and a finished one make the twelve seconds of the design', async () => {
  let entry
  for (let i = 0; i < 4; i++) {
    entry = await round('Twelve')
    answer(entry, { shapes: [box] })
  }
  answer(await round('Twelve'), { verdict: 'approved' })
  const film = filmOf('Twelve', 'home')
  assert.equal(film.rounds.length, 5)
  assert.equal(film.steps.length, 9)
  assert.equal(film.seconds, 12)
})

test('marks sent twice on one picture are two steps, and marks on an older picture go with that picture', async () => {
  const one = await round('Twice')
  const first = answer(one, { shapes: [box] })
  const second = answer(one, { shapes: [box, box] })
  const two = await round('Twice')
  // Sent after the new picture came: it is about the old one, and says so.
  const late = answer(two, { shapes: [box], after: one.after })
  assert.equal(late.olderPicture, true)
  const film = filmOf('Twice', 'home')
  assert.deepEqual(film.rounds.map(r => r.marked.map(file => basename(file))), [[first, second, late].map(r => basename(r.annotatedImage)), []])
  assert.equal(film.finished, false)
  assert.equal(film.steps.at(-1).seconds, STEP_SECONDS.last)
})

test('a cleared review starts again: the film has only the new rounds, and light and dark each have their own', async () => {
  const old = await round('Again', 'Home', 'light')
  answer(old, { shapes: [box] })
  await round('Again', 'Home', 'light')
  clearApp('Again')
  const fresh = await round('Again', 'Home', 'light')
  await round('Again', 'Home', 'dark')
  const film = filmOf('Again', 'home-light')
  assert.deepEqual(film.rounds.map(r => [r.round, basename(r.picture), r.marked.length]), [[1, basename(fresh.after), 0]])
  assert.equal(filmOf('Again', 'home-dark').rounds.length, 1)
  assert.equal(filmScreen('Again', 'Home', 'dark'), 'home-dark')
  assert.throws(() => filmScreen('Again', 'Home'), /Home has 2 modes\. Say which: --mode (light|dark) or --mode (light|dark)/)
  assert.throws(() => filmScreen('Again', 'Other'), /No screen called Other in Again\. It has: Home \(light\), Home \(dark\)|No screen called Other in Again\. It has: Home \(dark\), Home \(light\)/)
  assert.throws(() => filmScreen('Nobody', 'Home'), /No review called Nobody/)
})

test('a picture that has gone from the folder cannot be shown, and the film says how many', async () => {
  const one = await round('Gone')
  await round('Gone')
  const three = await round('Gone')
  rmSync(join(home, 'images', one.after))
  const film = filmOf('Gone', 'home')
  assert.deepEqual(film.rounds.map(r => r.round), [2, 3])
  assert.equal(basename(film.rounds.at(-1).picture), basename(three.after))
  assert.equal(film.missing, 1)
})

/** A stand-in for ffmpeg: it writes what it was asked for where the film should go. */
function standIn() {
  const tool = join(home, 'ffmpeg-stand-in.cjs')
  writeFileSync(tool, `#!/usr/bin/env node
const words = process.argv.slice(2)
require('node:fs').writeFileSync(words.at(-1), JSON.stringify(words))
`)
  chmodSync(tool, 0o755)
  return tool
}
const review = (words, env = {}) => spawnSync('node', [CLI, ...words], { env: { ...process.env, REVIEW_HOME: home, ...env }, encoding: 'utf8' })

test('review film writes the film with ffmpeg: every step for its time, fitted to the last picture', () => {
  const out = join(home, 'story.mp4')
  const done = review(['film', '--app', 'Story', '--screen', 'Home', '--out', out], { REVIEW_FFMPEG: standIn() })
  assert.equal(done.status, 0, done.stderr)
  assert.equal(done.stdout.trim(), `Wrote ${out}: 4 rounds, 7 seconds.`)
  const words = JSON.parse(readFileSync(out, 'utf8'))
  const film = filmOf('Story', 'home')
  const inputs = words.flatMap((word, i) => (word === '-i' ? [[words[i - 1], words[i + 1]]] : []))
  assert.deepEqual(inputs, film.steps.map(s => [String(s.seconds), s.file]))
  const graph = words[words.indexOf('-filter_complex') + 1]
  assert.match(graph, /\[0:v\]scale=80:50:force_original_aspect_ratio=decrease,pad=80:50:/)
  assert.match(graph, /concat=n=5:v=1:a=0/)
})

test('without ffmpeg, review film says so in one plain line and writes nothing', () => {
  const out = join(home, 'none.mp4')
  const done = review(['film', '--app', 'Story', '--screen', 'Home', '--out', out], { REVIEW_FFMPEG: join(home, 'no-such-ffmpeg') })
  assert.equal(done.status, 1)
  assert.equal(done.stderr.trim(), 'Saving a film needs ffmpeg on this computer. The film still plays in the review page.')
  assert.equal(existsSync(out), false)
  const unsaid = review(['film', '--app', 'Story', '--screen', 'Home'])
  assert.equal(unsaid.status, 1)
  assert.match(unsaid.stderr, /Say where to write it: --out film\.mp4/)
  const wrong = review(['film', '--app', 'Story', '--screen', 'Nowhere', '--out', out])
  assert.match(wrong.stderr, /No screen called Nowhere in Story\. It has: Home/)
})

const hasFfmpeg = spawnSync(process.env.REVIEW_FFMPEG || 'ffmpeg', ['-version']).status === 0
test('with the real ffmpeg, where this computer has it, the film is a video file', { skip: hasFfmpeg ? false : 'ffmpeg is not on this computer' }, async () => {
  const out = join(home, 'real.mp4')
  const made = await saveFilm(filmOf('Story', 'home'), out)
  assert.deepEqual(made.size, { w: 80, h: 50 })
  assert.equal(made.steps, 5)
  // Every MP4 names its kind near its start.
  assert.equal(readFileSync(out).subarray(4, 8).toString('latin1'), 'ftyp')
})
