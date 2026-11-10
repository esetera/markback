import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { writePicture } from './helpers.mjs'

const home = mkdtempSync(join(tmpdir(), 'review-film-'))
process.env.REVIEW_HOME = home
const { QUEUE, clearApp, push, receive } = await import('../lib/store.mjs')
const { MOST_STEPS, STEP_SECONDS, filmOf, filmScreen, saveFilm, savedPart } = await import('../lib/film.mjs')
const { pictureSize } = await import('../lib/words.mjs')
after(() => rmSync(home, { recursive: true, force: true }))
const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'review.mjs')
const picture = join(home, 'p.png')
writePicture(picture, 80, 50)
const png = readFileSync(picture)

/** A push names its picture by the time, to the millisecond: rounds in a test must not share one. */
const pause = () => new Promise(resolve => setTimeout(resolve, 5))
const round = async (app, screen = 'Home', mode = '', after = picture) => {
  await pause()
  return push({ app, screen, mode, after })
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

/**
 * A stand-in for ffmpeg. It writes what it was asked for where the picture or the film should go, with the list of steps when
 * it is given one, and adds each call to a log. FILM_WAIT makes it slow, as a long film is.
 */
function standIn() {
  const tool = join(home, 'ffmpeg-stand-in.cjs')
  writeFileSync(tool, `#!/usr/bin/env node
const fs = require('node:fs')
const words = process.argv.slice(2)
if (process.env.FILM_WAIT) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.FILM_WAIT))
const list = words.includes('concat') ? fs.readFileSync(words[words.indexOf('-i') + 1], 'utf8') : ''
fs.appendFileSync(${JSON.stringify(join(home, 'ffmpeg-calls.log'))}, JSON.stringify(words) + '\\n')
fs.writeFileSync(words.at(-1), JSON.stringify({ words, list }))
`)
  chmodSync(tool, 0o755)
  return tool
}
const calls = () => (existsSync(join(home, 'ffmpeg-calls.log')) ? readFileSync(join(home, 'ffmpeg-calls.log'), 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [])
const forgetCalls = () => rmSync(join(home, 'ffmpeg-calls.log'), { force: true })
const review = (words, env = {}) => spawnSync('node', [CLI, ...words], { env: { ...process.env, REVIEW_HOME: home, ...env }, encoding: 'utf8' })

test('review film writes the film with ffmpeg: every step fitted to the last picture alone, then all in order for their times', () => {
  forgetCalls()
  const out = join(home, 'story.mp4')
  const done = review(['film', '--app', 'Story', '--screen', 'Home', '--out', out], { REVIEW_FFMPEG: standIn() })
  assert.equal(done.status, 0, done.stderr)
  assert.equal(done.stdout.trim(), `Wrote ${out}: 4 rounds, 7 seconds.`)
  const film = filmOf('Story', 'home')
  const made = calls()
  // One picture at a time: ffmpeg never holds every big picture at once.
  const fits = made.slice(0, -1)
  assert.deepEqual(fits.map(words => words[words.indexOf('-i') + 1]), film.steps.map(s => s.file))
  for (const words of fits) assert.match(words[words.indexOf('-vf') + 1], /^scale=80:50:force_original_aspect_ratio=decrease,pad=80:50:/)
  const { words, list } = JSON.parse(readFileSync(out, 'utf8'))
  assert.equal(words[words.indexOf('-t') + 1], String(film.seconds))
  assert.deepEqual([...list.matchAll(/duration (\S+)/g)].map(m => Number(m[1])), film.steps.map(s => s.seconds))
  // The last picture is named twice, or its time is lost.
  assert.deepEqual([...list.matchAll(/file '(\d+)\.png'/g)].map(m => Number(m[1])), [0, 1, 2, 3, 4, 4])
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

test('each picture is labelled with its own round, from what was stored: an older picture gone does not move the others', async () => {
  const one = await round('Labels')
  const two = await round('Labels')
  const three = await round('Labels')
  // The round in between is gone: the first picture is still Round 1, not Round 2.
  rmSync(join(home, 'images', two.after))
  const film = filmOf('Labels', 'home')
  assert.deepEqual(film.rounds.map(r => [r.round, basename(r.picture)]), [[1, basename(one.after)], [3, basename(three.after)]])
  assert.equal(film.missing, 1)
})

test('only pictures of the review as it is now: a picture from before a clear never fills a gap', async () => {
  const old = await round('Gap')
  answer(old, { shapes: [box] })
  await round('Gap')
  clearApp('Gap')
  const fresh = [await round('Gap'), await round('Gap'), await round('Gap')]
  rmSync(join(home, 'images', fresh[1].after))
  const film = filmOf('Gap', 'home')
  assert.deepEqual(film.rounds.map(r => [r.round, basename(r.picture)]), [[1, basename(fresh[0].after)], [3, basename(fresh[2].after)]])
  assert.ok(film.steps.every(step => !step.marked), 'the old review\'s marks are not in it')
})

test('a screen queued before the push kept its pictures\' rounds: its kept pictures are found, and only a missing file is gone', async () => {
  const old = await round('Before')
  answer(old, { shapes: [box] })
  clearApp('Before')
  const one = await round('Before')
  answer(one, { shapes: [box] })
  // Pushed over with no answer: its picture is still kept.
  const two = await round('Before')
  const three = await round('Before')
  answer(three, { shapes: [box] })
  // As an older Markback wrote it: no list of pictures in the queue.
  const path = join(QUEUE, 'before', 'home.json')
  const entry = JSON.parse(readFileSync(path, 'utf8'))
  delete entry.pictures
  writeFileSync(path, JSON.stringify(entry))
  let film = filmOf('Before', 'home')
  assert.deepEqual(film.rounds.map(r => [r.round, basename(r.picture), r.marked.length]), [[1, basename(one.after), 1], [2, basename(two.after), 0], [3, basename(three.after), 1]])
  assert.equal(film.missing, 0, 'the picture of the review before the clear is not counted in')
  // Pushed again by this Markback: the list starts at round 4, and the older rounds are still found.
  const four = await round('Before')
  film = filmOf('Before', 'home')
  assert.deepEqual(film.rounds.map(r => r.round), [1, 2, 3, 4])
  assert.equal(basename(film.rounds.at(-1).picture), basename(four.after))
  // A file really gone is gone. Round 1 keeps its label: the answer on it says its round.
  rmSync(join(home, 'images', two.after))
  film = filmOf('Before', 'home')
  assert.deepEqual(film.rounds.map(r => [r.round, basename(r.picture)]), [[1, basename(one.after)], [3, basename(three.after)], [4, basename(four.after)]])
  assert.equal(film.missing, 1)
})

test('a screen queued before the list, with a file gone after a clear: the old review\'s picture is never borrowed, and the round is said to be gone', async () => {
  await round('Borrow')
  await round('Borrow')
  clearApp('Borrow')
  const fresh = [await round('Borrow'), await round('Borrow'), await round('Borrow')]
  const path = join(QUEUE, 'borrow', 'home.json')
  const entry = JSON.parse(readFileSync(path, 'utf8'))
  delete entry.pictures
  writeFileSync(path, JSON.stringify(entry))
  let film = filmOf('Borrow', 'home')
  assert.deepEqual(film.rounds.map(r => [r.round, basename(r.picture)]), fresh.map((e, i) => [i + 1, basename(e.after)]), 'nothing gone: every round of this review, and only those')
  rmSync(join(home, 'images', fresh[1].after))
  film = filmOf('Borrow', 'home')
  // One file left for rounds 1 and 2 cannot say which it is: it is not guessed at, and no older file stands in.
  assert.deepEqual(film.rounds.map(r => [r.round, basename(r.picture)]), [[3, basename(fresh[2].after)]])
  assert.equal(film.missing, 2)
})

/** The first bytes of a picture of each kind, which are all that is read for its size. */
const heads = {
  jpeg: (w, h) => {
    // A long part first, as a camera's notes are: the size comes after it.
    const notes = Buffer.alloc(3004)
    notes.writeUInt16BE(0xffe1, 0)
    notes.writeUInt16BE(3002, 2)
    const frame = Buffer.from([0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3])
    return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), Buffer.alloc(14), notes, frame, Buffer.alloc(16), Buffer.from([0xff, 0xd9])])
  },
  webpX: (w, h) => {
    const b = Buffer.alloc(40)
    b.write('RIFF', 0, 'latin1')
    b.write('WEBPVP8X', 8, 'latin1')
    b.writeUIntLE(w - 1, 24, 3)
    b.writeUIntLE(h - 1, 27, 3)
    return b
  },
  webpL: (w, h) => {
    const b = Buffer.alloc(40)
    b.write('RIFF', 0, 'latin1')
    b.write('WEBPVP8L', 8, 'latin1')
    b[20] = 0x2f
    b.writeUInt32LE(((w - 1) | ((h - 1) << 14)) >>> 0, 21)
    return b
  },
  webp: (w, h) => {
    const b = Buffer.alloc(40)
    b.write('RIFF', 0, 'latin1')
    b.write('WEBPVP8 ', 8, 'latin1')
    b.writeUInt16LE(w, 26)
    b.writeUInt16LE(h, 28)
    return b
  },
  gif: (w, h) => {
    const b = Buffer.alloc(32)
    b.write('GIF89a', 0, 'latin1')
    b.writeUInt16LE(w, 6)
    b.writeUInt16LE(h, 8)
    return b
  },
}

test('the size of a JPEG, WebP or GIF picture is read as a PNG\'s is, and a saved film is the size of its last picture whatever its kind', async () => {
  for (const [kind, make] of Object.entries(heads)) {
    const file = join(home, `size-${kind}`)
    writeFileSync(file, make(300, 400))
    assert.deepEqual(pictureSize(file), { w: 300, h: 400 }, kind)
  }
  assert.deepEqual(pictureSize(picture), { w: 80, h: 50 })
  writeFileSync(join(home, 'not.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')
  assert.equal(pictureSize(join(home, 'not.svg')), null)
  const jpeg = join(home, 'last.jpg')
  writeFileSync(jpeg, heads.jpeg(300, 400))
  await round('Jpeg')
  await round('Jpeg', 'Home', '', jpeg)
  process.env.REVIEW_FFMPEG = standIn()
  try {
    const made = await saveFilm(filmOf('Jpeg', 'home'), join(home, 'jpeg.mp4'))
    // Not a box of white round it: the film is the JPEG's own size.
    assert.deepEqual(made.size, { w: 300, h: 400 })
  } finally {
    delete process.env.REVIEW_FFMPEG
  }
})

test('a long story is saved as its newest rounds, says plainly that the older ones are left out, and a big picture is made smaller', async () => {
  const big = join(home, 'big.png')
  writePicture(big, 4000, 3000)
  let entry
  for (let i = 0; i < 30; i++) {
    entry = await round('Long', 'Home', '', big)
    answer(entry, { shapes: [box] })
  }
  // The newest round is the big picture with no marks yet: the film is its size.
  await round('Long', 'Home', '', big)
  const film = filmOf('Long', 'home')
  assert.equal(film.steps.length, 61)
  const part = savedPart(film)
  // The newest round's one step, then as many older rounds of two steps as fit.
  const older = Math.floor((MOST_STEPS - 1) / 2)
  assert.equal(part.steps.length, 1 + older * 2)
  assert.equal(part.rounds, 1 + older)
  assert.equal(part.leftOut, 31 - part.rounds)
  // The newest rounds, to the last: the page plays every round, and the file the end of the story.
  assert.equal(part.steps.at(-1), film.steps.at(-1))
  forgetCalls()
  const out = join(home, 'long.mp4')
  const done = review(['film', '--app', 'Long', '--screen', 'Home', '--out', out], { REVIEW_FFMPEG: standIn() })
  assert.equal(done.status, 0, done.stderr)
  assert.match(done.stdout, new RegExp(`The oldest ${part.leftOut} rounds are left out of the file: it holds the newest ${part.rounds}\\. The review page plays them all\\.`))
  assert.equal(calls().length, part.steps.length + 1)
  assert.match(calls()[0][calls()[0].indexOf('-vf') + 1], /^scale=1920:1440:/)
  // A round with more marked copies than a film holds still goes in whole: a saved film is never empty.
  const crowded = { ...film, rounds: [{ ...film.rounds[0], marked: Array(MOST_STEPS + 5).fill(film.rounds[0].picture) }], steps: Array.from({ length: MOST_STEPS + 6 }, () => ({ ...film.steps[0], at: 0 })) }
  assert.equal(savedPart(crowded).steps.length, MOST_STEPS + 6)
})

test('a film of a sketch plays in the page and is never offered as a file: saving it says so plainly', async () => {
  const sketch = join(home, 'sheet.svg')
  writeFileSync(sketch, '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#eee"/></svg>')
  await round('Sketch', 'Flow', '', sketch)
  await round('Sketch', 'Flow', '', sketch)
  const film = filmOf('Sketch', 'flow')
  assert.equal(film.steps.length, 2, 'it plays')
  assert.equal(savedPart(film).why, 'A film of a sketch cannot be saved as a file. It still plays in the review page.')
  forgetCalls()
  const done = review(['film', '--app', 'Sketch', '--screen', 'Flow', '--out', join(home, 'sketch.mp4')], { REVIEW_FFMPEG: standIn() })
  assert.equal(done.status, 1)
  assert.equal(done.stderr.trim(), 'A film of a sketch cannot be saved as a file. It still plays in the review page.')
  assert.equal(calls().length, 0, 'ffmpeg was not asked')
})

/** A port nothing else is on. */
const freePort = () => new Promise((resolve, reject) => {
  const probe = createServer()
  probe.once('error', reject)
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address()
    probe.close(() => resolve(port))
  })
})

test('the server makes one film at a time: a second ask while one is made gets a plain answer, and the page is told what a file leaves out', async () => {
  const port = await freePort()
  const server = spawn('node', [join(dirname(CLI), 'server.mjs')], { env: { ...process.env, REVIEW_HOME: home, REVIEW_PORT: String(port), REVIEW_FFMPEG: standIn(), FILM_WAIT: '700' }, stdio: 'ignore' })
  try {
    for (let i = 0; i < 100; i++) {
      if (await fetch(`http://127.0.0.1:${port}/api/queue`).then(r => r.ok, () => false)) break
      await new Promise(r => setTimeout(r, 100))
    }
    const address = `http://127.0.0.1:${port}/api/film/file?app=story&id=home`
    const first = fetch(address)
    await new Promise(r => setTimeout(r, 300))
    const second = await fetch(address)
    assert.equal(second.status, 409)
    assert.deepEqual(await second.json(), { error: 'A film is being made already. Try again when it is done.' })
    const made = await first
    assert.equal(made.status, 200)
    assert.equal(made.headers.get('content-type'), 'video/mp4')
    // Done, the next ask is made.
    assert.equal((await fetch(address)).status, 200)
    const long = (await (await fetch(`http://127.0.0.1:${port}/api/film?app=long&id=home`)).json()).film
    assert.equal(long.rounds.length, 31, 'the page plays every round')
    assert.match(long.save.leftOut, /^The oldest \d+ rounds are left out of the file/)
    assert.equal(long.save.why, '')
    const sketch = (await (await fetch(`http://127.0.0.1:${port}/api/film?app=sketch&id=flow`)).json()).film
    assert.match(sketch.save.why, /cannot be saved as a file/)
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/film/file?app=sketch&id=flow`)).status, 400)
  } finally {
    server.kill()
    await new Promise(resolve => (server.exitCode === null ? server.once('exit', resolve) : resolve()))
  }
})

test('a picture ffmpeg cannot read stops the film cleanly and says which round, in plain words', { skip: hasFfmpeg ? false : 'ffmpeg is not on this computer' }, async () => {
  await round('Broken')
  const cut = join(home, 'cut.png')
  writeFileSync(cut, readFileSync(picture).subarray(0, 40))
  await round('Broken', 'Home', '', cut)
  const out = join(home, 'broken.mp4')
  await assert.rejects(saveFilm(filmOf('Broken', 'home'), out), { message: 'The picture of round 2 could not be read, so the film was not saved. It still plays in the review page.' })
  assert.equal(existsSync(out), false)
})

test('when ffmpeg fails or takes too long, the line says so in plain words, with no command line or folder, and an ffmpeg deaf to a stop is killed', async () => {
  const tool = (name, body) => {
    const file = join(home, name)
    writeFileSync(file, `#!/bin/bash\n${body}\n`)
    chmodSync(file, 0o755)
    return file
  }
  const deaf = tool('ffmpeg-deaf', "trap '' TERM; while true; do sleep 1; done")
  // A store in a folder with spaces, a quote and letters beyond ASCII: none of it may show.
  const store = join(home, "Ann O'Brien Ünïcode folder", '.review-wizard')
  const env = { REVIEW_HOME: store }
  assert.equal(review(['push', '--app', 'Odd', '--screen', 'Home', '--after', picture], env).status, 0)
  const said = line => tool(`ffmpeg-says-${Math.random().toString(36).slice(2)}`, `for a in "$@"; do last="$a"; done; case "$last" in *.mp4) echo "${line.replaceAll('"', '\\"')}" >&2; exit 1;; esac; : > "$last"`)
  const film = (ffmpeg, out = join(home, 'odd.mp4')) => review(['film', '--app', 'Odd', '--screen', 'Home', '--out', out], { ...env, REVIEW_FFMPEG: ffmpeg })
  for (const line of [`[concat @ 0x1] Impossible to open '${store}/images/odd/x y.png'`, `Error opening ${store}/images/home.png: No space left`, 'C:\\Users\\ann\\x.png: bad']) {
    const done = film(said(line))
    assert.equal(done.status, 1)
    assert.equal(done.stderr.trim(), 'ffmpeg could not make the film.', 'a line with a path in it is not shown')
  }
  // A folder Markback knows is put in plain words, and the rest of ffmpeg's line is kept.
  assert.equal(film(said(`[out#0/mp4 @ 0x1] Conversion failed in ${store}`)).stderr.trim(), 'ffmpeg could not make the film: Conversion failed in the store')
  // Trouble that is not the picture's, a full disk say, is not blamed on the picture.
  const full = tool('ffmpeg-full', 'echo "[out#0/image2 @ 0x1] Error writing trailer: No space left on device" >&2; exit 1')
  assert.equal(film(full).stderr.trim(), 'ffmpeg could not make the film: Error writing trailer: No space left on device')
  // An ffmpeg that cannot be run says so.
  const stuck = join(home, 'ffmpeg-not-runnable')
  writeFileSync(stuck, 'not a program')
  chmodSync(stuck, 0o644)
  assert.equal(film(stuck).stderr.trim(), 'ffmpeg is on this computer but cannot be run. The film still plays in the review page.')
  const port = await freePort()
  const server = spawn('node', [join(dirname(CLI), 'server.mjs')], { env: { ...process.env, REVIEW_HOME: home, REVIEW_PORT: String(port), REVIEW_FFMPEG: deaf, REVIEW_FILM_TIMEOUT: '600' }, stdio: 'ignore' })
  try {
    for (let i = 0; i < 100; i++) {
      if (await fetch(`http://127.0.0.1:${port}/api/queue`).then(r => r.ok, () => false)) break
      await new Promise(r => setTimeout(r, 100))
    }
    const address = `http://127.0.0.1:${port}/api/film/file?app=story&id=home`
    const started = Date.now()
    const slow = await fetch(address)
    assert.equal(slow.status, 400)
    const { error } = await slow.json()
    assert.equal(error, 'Making the film took too long. Try a film of fewer rounds.')
    assert.ok(Date.now() - started < 15000, 'it did not wait on the deaf ffmpeg')
    // The one-at-a-time hold is free again: the next ask is made, not told to wait.
    assert.notEqual((await fetch(address)).status, 409)
  } finally {
    server.kill()
    await new Promise(resolve => (server.exitCode === null ? server.once('exit', resolve) : resolve()))
  }
})
