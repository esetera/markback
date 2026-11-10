/**
 * Words read off a bare picture: tesseract's output, the order the words tool needs, the stand-in reader through the store,
 * and the Mac's own reader on a picture made here (on a Mac only).
 */
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { writePicture, writeReader } from './helpers.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const CLI = join(here, '..', 'review.mjs')
const work = mkdtempSync(join(tmpdir(), 'review-read-'))
after(() => rmSync(work, { recursive: true, force: true }))
// The store is chosen when it is first loaded: this test's own, never the person's.
process.env.REVIEW_HOME = join(work, 'home')
const { readingOrder, readPicture, wordsForPicture, wordsFromTsv } = await import('../lib/read-words.mjs')
const { push, receive } = await import('../lib/store.mjs')

const say = words => words.map(w => w.t).join(' ')
/** Words on one line, each 40 wide with a gap of 10, starting at x. */
const line = (x, y, text, h = 14) => text.split(' ').map((t, n) => ({ t, x: x + n * 50, y, w: 40, h }))

test('tesseract\'s TSV: the picture\'s size, and its words, without the poor guesses', () => {
  const reader = writeReader(join(work, 'tsv-reader.mjs'), { w: 300, h: 200 }, [{ t: 'Save', x: 10, y: 20, w: 40, h: 14 }, { t: '|', x: 60, y: 20, w: 4, h: 14, sure: 12 }, { t: 'changes', x: 70, y: 20, w: 60, h: 14 }])
  const said = wordsFromTsv(execFileSync(reader, { encoding: 'utf8' }))
  assert.deepEqual(said.size, { w: 300, h: 200 })
  assert.deepEqual(said.words, [{ t: 'Save', x: 10, y: 20, w: 40, h: 14 }, { t: 'changes', x: 70, y: 20, w: 60, h: 14 }])
})

test('reading order: lines left to right, a bar first, a side panel after the page beside it, and a form a row at a time', () => {
  // A paragraph in the wrong order reads as it is written.
  assert.equal(say(readingOrder([...line(10, 40, 'three four'), ...line(10, 20, 'one two')])), 'one two three four')
  // A bar across the top, then a page and a panel beside it whose lines do not meet: the page, then the panel.
  const bar = [...line(10, 0, 'Home Plots'), ...line(600, 0, 'Sign out')]
  const page = [...line(10, 60, 'Book a plot'), ...line(10, 82, 'Runs one season'), ...line(10, 110, 'Your name')]
  const panel = [...line(600, 70, 'This season'), ...line(600, 100, 'Plots free')]
  assert.equal(say(readingOrder([...panel, ...page, ...bar])), 'Home Plots Sign out Book a plot Runs one season Your name This season Plots free')
  // A form whose labels in two columns are level: a row at a time, as it is filled in.
  const form = [...line(10, 20, 'Your name'), ...line(300, 20, 'Email'), ...line(10, 60, 'First last'), ...line(300, 60, 'you@example.org')]
  assert.equal(say(readingOrder([...form].reverse())), 'Your name Email First last you@example.org')
})

test('a bare picture gets a list read off it once, kept beside it and marked as read; a given list is never read over', async () => {
  const picture = join(work, 'shot.png')
  writePicture(picture, 400, 300)
  process.env.REVIEW_TESSERACT = writeReader(join(work, 'reader.mjs'), { w: 400, h: 300 }, [...line(20, 40, 'Save the plot'), { t: 'Far\u0007away', x: 900, y: 40, w: 40, h: 14 }, { t: 'Bell\u0007s', x: 20, y: 80, w: 40, h: 14 }])
  try {
    const bare = push({ app: 'Read', screen: 'Bare', after: picture })
    assert.equal(bare.words, undefined)
    const answer = await wordsForPicture(bare.after)
    assert.match(answer.words, /^read\/bare-words-\d+\.json$/)
    const list = JSON.parse(readFileSync(join(process.env.REVIEW_HOME, 'images', answer.words), 'utf8'))
    // Checked as any list is: nothing outside the picture, no control characters.
    assert.deepEqual([list.read, list.size, say(list.words)], [true, { w: 400, h: 300 }, 'Save the plot Bells'])
    // Asked again, it is the same list, not read again.
    assert.deepEqual(await wordsForPicture(bare.after), { words: answer.words })
    // Not a picture the store keeps, or one a reader cannot take: nothing is read.
    assert.equal((await wordsForPicture('../../etc/passwd')).why, 'not-readable')
    assert.equal((await wordsForPicture('read/sheet-after-1.svg')).why, 'not-readable')
    // A mark on the picture carries the words read, and says they were read.
    const record = receive({ appSlug: 'read', id: 'bare', png: null, shapes: [{ type: 'box', colour: 'red', box: { x: 15, y: 35, w: 200, h: 30 } }], notes: '', verdict: 'changes', imageSize: null })
    assert.deepEqual([record.shapes[0].words, record.wordsRead], ['Save the plot', true])
    const read = spawnSync('node', [CLI, 'read', '--app', 'Read', '--latest'], { env: process.env, encoding: 'utf8' })
    assert.match(read.stdout, /on the words "Save the plot"/)
    assert.match(read.stdout, /read off the picture, so a few may be wrong/)
    // A list given with the push is exact: it is the one used, and the picture is not read.
    const given = join(work, 'given.json')
    execFileSync('node', ['-e', `require('fs').writeFileSync(${JSON.stringify(given)}, JSON.stringify({ size: { w: 400, h: 300 }, words: [{ t: 'Given', x: 20, y: 40, w: 60, h: 14 }] }))`])
    const exact = push({ app: 'Read', screen: 'Given', after: picture, words: given })
    assert.deepEqual(await wordsForPicture(exact.after), { words: exact.words })
    assert.equal(JSON.parse(readFileSync(join(process.env.REVIEW_HOME, 'images', exact.words), 'utf8')).read, undefined)
  } finally {
    delete process.env.REVIEW_TESSERACT
  }
})

test('with no tool to read with, there is no list, and the computer says it has no reader', async () => {
  const picture = join(work, 'none.png')
  writePicture(picture, 100, 100)
  const missing = join(work, 'no-such-reader')
  process.env.REVIEW_TESSERACT = missing
  try {
    assert.equal(await readPicture(picture), null)
  } finally {
    delete process.env.REVIEW_TESSERACT
  }
  // Looked for once in a run, so asked in a run of its own.
  const ask = env => execFileSync('node', ['--input-type=module', '-e', `import { hasReader } from ${JSON.stringify(join(here, '..', 'lib', 'read-words.mjs'))}; console.log(hasReader())`], { env: { ...process.env, ...env }, encoding: 'utf8' }).trim()
  assert.equal(ask({ REVIEW_TESSERACT: missing }), 'false')
  assert.equal(ask({ REVIEW_TESSERACT: process.execPath }), 'true')
  // No Mac reader and no tesseract on the PATH.
  if (process.platform !== 'darwin') assert.equal(ask({ REVIEW_TESSERACT: '', PATH: work }), 'false')
})

test('the Mac\'s own reader reads a picture made here', { skip: process.platform === 'darwin' ? false : 'only on a Mac' }, async () => {
  const picture = join(work, 'typed.png')
  // Words set in a plain font on white, drawn by the Mac itself: no picture file in the repo, nothing installed.
  execFileSync('osascript', ['-l', 'JavaScript', '-e', `ObjC.import('AppKit')
function run(argv) {
  const rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(null, 600, 160, 8, 4, true, false, $.NSCalibratedRGBColorSpace, 0, 0)
  $.NSGraphicsContext.saveGraphicsState
  $.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep))
  $.NSColor.whiteColor.set
  $.NSRectFill($.NSMakeRect(0, 0, 600, 160))
  const style = $.NSDictionary.dictionaryWithObjectForKey($.NSFont.systemFontOfSize(40), $.NSFontAttributeName)
  $('Book a growing plot').drawAtPointWithAttributes($.NSMakePoint(30, 90), style)
  $('Request this plot').drawAtPointWithAttributes($.NSMakePoint(30, 20), style)
  $.NSGraphicsContext.restoreGraphicsState
  rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $.NSDictionary.dictionary).writeToFileAtomically(argv[0], true)
}`, picture])
  const list = await readPicture(picture)
  assert.equal(list.read, true)
  assert.deepEqual(list.size, { w: 600, h: 160 })
  assert.equal(say(list.words), 'Book a growing plot Request this plot')
  // Each word's box is on it: from the top left, inside the picture, the first line above the second.
  const [book, , , , request] = list.words
  assert.ok(book.x >= 20 && book.x <= 45 && book.y >= 10 && book.y < 70, JSON.stringify(book))
  assert.ok(request.y > book.y + 40 && request.y + request.h <= 160, JSON.stringify(request))
})
