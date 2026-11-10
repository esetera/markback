/**
 * Words read off a bare picture: tesseract's output, the order the words tool needs, the stand-in reader through the store,
 * and the Mac's own reader on a picture made here (on a Mac only).
 */
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
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
const { jpegOrientation, readingDone, readingOrder, readPicture, wordsForPicture, wordsFromTsv } = await import('../lib/read-words.mjs')
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
    // The answer comes at once: it is being read. Asked again once it has been, the list is there.
    assert.deepEqual(wordsForPicture(bare.after), { words: '', reading: true })
    await readingDone()
    const answer = wordsForPicture(bare.after)
    assert.match(answer.words, /^read\/bare-words-\d+\.json$/)
    const list = JSON.parse(readFileSync(join(process.env.REVIEW_HOME, 'images', answer.words), 'utf8'))
    // Checked as any list is: nothing outside the picture, no control characters.
    assert.deepEqual([list.read, list.size, say(list.words)], [true, { w: 400, h: 300 }, 'Save the plot Bells'])
    // Asked again, it is the same list, not read again.
    assert.deepEqual(wordsForPicture(bare.after), { words: answer.words })
    // Not a picture the store keeps, or one a reader cannot take: nothing is read.
    assert.equal(wordsForPicture('../../etc/passwd').why, 'not-readable')
    assert.equal(wordsForPicture('read/sheet-after-1.svg').why, 'not-readable')
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
    assert.deepEqual(wordsForPicture(exact.after), { words: exact.words })
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

test('reads go one at a time, the picture asked about last first, and pictures left behind are let go', async () => {
  // A slow reader that notes each picture it is given.
  const log = join(work, 'reads.log')
  const slow = join(work, 'slow-reader.mjs')
  writeFileSync(slow, `#!/usr/bin/env node\nimport { appendFileSync } from 'node:fs'\nappendFileSync(${JSON.stringify(log)}, process.argv[2].split('/').pop() + '\\n')\nsetTimeout(() => process.stdout.write('level\\tp\\tb\\tp\\tl\\tw\\tleft\\ttop\\twidth\\theight\\tconf\\ttext\\n1\\t1\\t0\\t0\\t0\\t0\\t0\\t0\\t60\\t40\\t-1\\t\\n'), 150)\n`, { mode: 0o755 })
  process.env.REVIEW_TESSERACT = slow
  try {
    const picture = join(work, 'small.png')
    writePicture(picture, 60, 40)
    const shots = Array.from({ length: 11 }, (_, n) => push({ app: 'Queue', screen: `S${n}`, after: picture }))
    // The first starts at once. Then ten more are asked about while it is read: only the newest eight wait.
    for (const shot of shots) assert.equal(wordsForPicture(shot.after).reading, true)
    await readingDone()
    const read = readFileSync(log, 'utf8').trim().split('\n').map(name => name.replace(/-after-\d+\.png$/, ''))
    assert.deepEqual(read, ['s0', 's10', 's9', 's8', 's7', 's6', 's5', 's4', 's3'])
    assert.equal(existsSync(join(process.env.REVIEW_HOME, 'images', shots[1].after.replace('-after-', '-words-').replace('.png', '.json'))), false, 'one left behind is not read')
    // Asked again, a picture let go is read then.
    assert.equal(wordsForPicture(shots[1].after).reading, true)
    await readingDone()
    assert.match(wordsForPicture(shots[1].after).words, /s1-words-/)
  } finally {
    delete process.env.REVIEW_TESSERACT
  }
})

test('a reader that will not stop is killed when its time is up, and the answer comes at once', async () => {
  const stuck = join(work, 'stuck-reader.mjs')
  // It ignores being asked to stop, and never ends by itself.
  writeFileSync(stuck, `#!/usr/bin/env node\nprocess.on('SIGTERM', () => {})\nsetInterval(() => {}, 1000)\n`, { mode: 0o755 })
  const picture = join(work, 'stuck.png')
  writePicture(picture, 60, 40)
  process.env.REVIEW_TESSERACT = stuck
  try {
    const started = Date.now()
    await assert.rejects(readPicture(picture, { timeout: 400 }), /took too long/)
    assert.ok(Date.now() - started < 2000, `settled in ${Date.now() - started} ms`)
  } finally {
    delete process.env.REVIEW_TESSERACT
  }
})

test('a turned JPEG is not given to tesseract, whose boxes would be for the pixels as stored', async () => {
  // A JPEG head with an EXIF orientation of 6 (shown turned a quarter right), and one that says nothing.
  const tiff = Buffer.from([0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0])
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff])
  const turned = join(work, 'turned.jpg')
  writeFileSync(turned, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, payload.length + 2]), payload, Buffer.from([0xff, 0xda, 0, 2])]))
  const plain = join(work, 'plain.jpg')
  writeFileSync(plain, Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 2]))
  assert.deepEqual([jpegOrientation(turned), jpegOrientation(plain), jpegOrientation(join(work, 'small.png'))], [6, 1, 1])
  process.env.REVIEW_TESSERACT = writeReader(join(work, 'jpeg-reader.mjs'), { w: 60, h: 40 }, [{ t: 'Wrong', x: 1, y: 1, w: 20, h: 10 }])
  try {
    await assert.rejects(readPicture(turned), /turned JPEG/)
  } finally {
    delete process.env.REVIEW_TESSERACT
  }
})

/**
 * The words real screenshots were read as by the Mac's reader, in no order: the order comes only from readingOrder. Two are in
 * docs/; two are pages made for the test: a people table beside a side list, and three plan cards with a line under them.
 */
const shapes = JSON.parse(readFileSync(join(here, 'read-words-shapes.json'), 'utf8'))
const shuffled = name => shapes[name].words.map(([t, x, y, w, h]) => ({ t, x, y, w, h }))

test('reading order on a real screen: bars, a form a row at a time, its tiles one by one, and the panel beside it after', () => {
  assert.equal(say(readingOrder(shuffled('screen'))), 'Markback Plot booking / Book a plot »0T# 1 left Stop here From Markback Draw on anything. More Riverbend Garden Plots Work days Seed swap Sign out Book a growing plot Plots run for one season, March to October. Your name Email First and last name you@example.org Where in the garden? North beds Full sun Orchard side Part shade Greenhouse row Covered Start of season March 2027 See the garden map Request this plot Make this the main button This season Plots free 14 Water Included Tools shed Shared Work days Two a season Ask for the plot size here Notes (N) Looks good Send')
})

test('reading order on boxes side by side: each box is read through before the next, so a drag inside one stays in it', () => {
  // Arrows between the boxes are read as marks of their own: they are left out here.
  const said = say(readingOrder(shuffled('picture')).filter(word => /\w/.test(word.t)))
  for (const box of ['AGENT PUSHES Any agent After a change', 'YOU MARK IT You Screen is waiting', 'YOU SEND You Press Send', 'AGENT READS Any agent Answer lands Each mark is a request']) assert.ok(said.includes(box), `${box} in: ${said}`)
  assert.ok(said.indexOf('AGENT PUSHES') < said.indexOf('YOU MARK IT') && said.indexOf('YOU MARK IT') < said.indexOf('YOU SEND') && said.indexOf('YOU SEND') < said.indexOf('AGENT READS'))
  // A table whose rows stand apart still reads a row at a time.
  const row = (y, cells) => cells.map((t, n) => ({ t, x: 10 + n * 200, y, w: 60, h: 14 }))
  assert.equal(say(readingOrder([...row(70, ['Water', 'Included']), ...row(10, ['Plots', '14']), ...row(40, ['Tools', 'Shared'])])), 'Plots 14 Tools Shared Water Included')
})

test('the Mac\'s reader reads a tall picture a band at a time, and finds every line', { skip: process.platform === 'darwin' ? false : 'only on a Mac' }, async () => {
  const picture = join(work, 'tall.png')
  // Thirty lines of small type down a page ten screens tall, drawn by the Mac itself.
  execFileSync('osascript', ['-l', 'JavaScript', '-e', `ObjC.import('AppKit')
function run(argv) {
  const W = 1440, H = 9000
  const rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(null, W, H, 8, 4, true, false, $.NSCalibratedRGBColorSpace, 0, 0)
  $.NSGraphicsContext.saveGraphicsState
  $.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep))
  $.NSColor.whiteColor.set
  $.NSRectFill($.NSMakeRect(0, 0, W, H))
  const style = $.NSDictionary.dictionaryWithObjectForKey($.NSFont.systemFontOfSize(15), $.NSFontAttributeName)
  for (let n = 1; n <= 30; n++) $('Line ' + n + ' of the tall page').drawAtPointWithAttributes($.NSMakePoint(40, H - n * 296), style)
  $.NSGraphicsContext.restoreGraphicsState
  rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $.NSDictionary.dictionary).writeToFileAtomically(argv[0], true)
}`, picture])
  const list = await readPicture(picture)
  const lines = list.words.filter(word => word.t === 'Line')
  assert.equal(lines.length, 30, say(list.words))
  // Each word once, in the whole picture's pixels: line n is near n × 296 from the top.
  const numbers = list.words.filter((word, n) => list.words[n - 1]?.t === 'Line')
  assert.deepEqual(numbers.map(word => word.t), Array.from({ length: 30 }, (_, n) => String(n + 1)))
  for (const [n, word] of numbers.entries()) assert.ok(Math.abs(word.y - ((n + 1) * 296 - 20)) < 30, `line ${n + 1} at ${word.y}`)
})

test('reading order in a table: a row at a time however close the rows, beside a side list, and a form row by row', () => {
  // The people table: the side list first, then the table a row at a time, so a drag along one row takes that row.
  assert.equal(say(readingOrder(shuffled('table'))), 'Acme Journal Dashboard Submissions People Settings People Name Role Status Joined Ana Lopez Editor Active 12 Mar 2026 Ben Okafor Author Invited 3 Apr 2026 Chen Wei Reviewer Active 19 May 2026 Dara Singh Author Paused 2 Jun 2026 Eli Moss Admin Active 27 Jul 2026 Fay Grant Reviewer Invited 8 Aug 2026')
  // A dense table: rows 24 pixels apart, 14 pixel type, so no gap between rows is as high as a line.
  const cell = (x, y, text) => text.split(' ').map((t, n) => ({ t, x: x + n * 45, y, w: 40, h: 14 }))
  const dense = [['Name', 'Role', 'Joined'], ['Ana Lopez', 'Editor', 'March'], ['Ben Okafor', 'Author', 'April'], ['Chen Wei', 'Admin', 'May']].flatMap((row, r) => row.flatMap((text, c) => cell(20 + c * 300, 40 + r * 24, text)))
  assert.equal(say(readingOrder([...dense].reverse())), 'Name Role Joined Ana Lopez Editor March Ben Okafor Author April Chen Wei Admin May')
  // A form with its labels on the left and its fields on the right: each label with its field.
  const form = [['Name', 'Ana Lopez'], ['Email', 'ana@example.org'], ['Role', 'Editor']].flatMap(([label, field], r) => [...cell(20, 30 + r * 40, label), ...cell(240, 30 + r * 40, field)])
  assert.equal(say(readingOrder([...form].reverse())), 'Name Ana Lopez Email ana@example.org Role Editor')
})

test('reading order in cards: each card through, and a line under them after them all', () => {
  assert.equal(say(readingOrder(shuffled('cards'))), 'Choose a plan Starter Free for one person Up to 3 projects Team $12 a person a month Unlimited projects Business $30 a person a month Single sign-on Prices do not include tax. You can change plan at any time.')
})

test('doubles from overlapping bands are taken out; the same word elsewhere is kept', async () => {
  const { withoutDoubles } = await import('../lib/read-words.mjs')
  const word = (t, x, y) => ({ t, x, y, w: 40, h: 14 })
  assert.deepEqual(withoutDoubles([word('Line', 10, 100), word('Line', 11, 101), word('Line', 10, 300), word('Lane', 10, 100)]), [word('Line', 10, 100), word('Line', 10, 300), word('Lane', 10, 100)])
})

test('the Mac\'s reader keeps a line that sits where two bands meet', { skip: process.platform === 'darwin' ? false : 'only on a Mac' }, async () => {
  // The first band is 0 to 1600 and the second starts at 1400. Lines centred on 1500, where the two meet half way, a pixel either
  // side of it, and on each band's cut edge: each picture holds one, and each must be found once.
  const centres = [1499, 1500, 1501, 1400, 1600]
  const pictures = centres.map(c => join(work, `edge-${c}.png`))
  execFileSync('osascript', ['-l', 'JavaScript', '-e', `ObjC.import('AppKit')
function run(argv) {
  const W = 1440, H = 4000
  for (let i = 0; i < argv.length; i += 2) {
    const centre = Number(argv[i + 1])
    const rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(null, W, H, 8, 4, true, false, $.NSCalibratedRGBColorSpace, 0, 0)
    $.NSGraphicsContext.saveGraphicsState
    $.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep))
    $.NSColor.whiteColor.set
    $.NSRectFill($.NSMakeRect(0, 0, W, H))
    const font = $.NSFont.systemFontOfSize(15)
    const style = $.NSDictionary.dictionaryWithObjectForKey(font, $.NSFontAttributeName)
    // The line's middle is half its height above where it is drawn from, counted from the foot of the picture.
    const text = $('Edge line at ' + centre)
    const high = text.sizeWithAttributes(style).height
    text.drawAtPointWithAttributes($.NSMakePoint(60, H - centre - high / 2), style)
    $('Top line').drawAtPointWithAttributes($.NSMakePoint(60, H - 300), style)
    $('Foot line').drawAtPointWithAttributes($.NSMakePoint(60, 300), style)
    $.NSGraphicsContext.restoreGraphicsState
    rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $.NSDictionary.dictionary).writeToFileAtomically(argv[i], true)
  }
}`, ...pictures.flatMap((p, n) => [p, String(centres[n])])])
  for (const [n, picture] of pictures.entries()) {
    const list = await readPicture(picture)
    assert.equal(say(list.words), `Top line Edge line at ${centres[n]} Foot line`, `centred on ${centres[n]}`)
  }
})

test('the Mac\'s reader loses no line of a real screen set down a tall page, wherever its lines fall on the bands', { skip: process.platform === 'darwin' ? false : 'only on a Mac' }, async () => {
  // docs/screen.png in the middle of a white page, so that its lines fall across where two bands meet, a pixel apart.
  const flat = await readPicture(join(here, '..', 'docs', 'screen.png'))
  const count = (list, text) => list.words.filter(word => word.t === text).length
  for (const top of [1149, 1150, 1151]) {
    const tall = join(work, `screen-down-${top}.png`)
    execFileSync('sips', ['--padToHeightWidth', String(top * 2 + 900), '1440', '--padColor', 'FFFFFF', join(here, '..', 'docs', 'screen.png'), '--out', tall], { stdio: 'ignore' })
    const list = await readPicture(tall)
    // The panel's last rows fall where the bands meet: every word there is read, and none twice.
    for (const text of ['Tools', 'shed', 'Shared', 'Work', 'days', 'Two', 'season']) assert.equal(count(list, text), count(flat, text), `${text} with the screen ${top} down`)
  }
})

test('a server that stops stops the reader it was running, even one that will not stop when asked', async () => {
  const home = mkdtempSync(join(work, 'serve-'))
  const pidFile = join(home, 'reader.pid')
  const stuck = join(home, 'stuck.mjs')
  writeFileSync(stuck, `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(pidFile)}, String(process.pid))\nprocess.on('SIGTERM', () => {})\nsetInterval(() => {}, 1000)\n`, { mode: 0o755 })
  const port = await new Promise(resolve => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
  const env = { ...process.env, REVIEW_HOME: home, REVIEW_PORT: String(port), REVIEW_TESSERACT: stuck }
  const picture = join(home, 'p.png')
  writePicture(picture, 60, 40)
  const pushed = JSON.parse(execFileSync('node', ['--input-type=module', '-e', `import { push } from ${JSON.stringify(join(here, '..', 'lib', 'store.mjs'))}; console.log(JSON.stringify(push({ app: 'Serve', screen: 'One', after: ${JSON.stringify(picture)} })))`], { env, encoding: 'utf8' }))
  const server = spawn('node', [join(here, '..', 'server.mjs')], { env, stdio: 'ignore' })
  const until = async (check, what) => {
    for (let i = 0; i < 100; i++) {
      if (await check()) return
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error(`${what} did not happen`)
  }
  try {
    await until(() => fetch(`http://127.0.0.1:${port}/api/queue`).then(r => r.ok, () => false), 'the server starting')
    const asked = await (await fetch(`http://127.0.0.1:${port}/api/read-words`, { method: 'POST', body: JSON.stringify({ after: pushed.after }) })).json()
    assert.equal(asked.reading, true)
    await until(() => existsSync(pidFile), 'the reader starting')
    const pid = Number(readFileSync(pidFile, 'utf8'))
    const exited = new Promise(resolve => server.once('exit', resolve))
    server.kill('SIGTERM')
    await exited
    const alive = () => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    }
    await until(() => !alive(), 'the reader stopping')
  } finally {
    server.kill('SIGKILL')
    try {
      process.kill(Number(readFileSync(pidFile, 'utf8')), 'SIGKILL')
    } catch {
      // Already gone, as it should be.
    }
  }
})

test('reading order in dense tables (rows 22, 24 and 28 pixels apart) is a row at a time, and a side list beside a form stays apart at 1x and 2x', () => {
  const rows = 'Ana Lopez Editor Active 12 Mar 2026 Ben Okafor Author Invited 3 Apr 2026 Chen Wei Reviewer Active 19 May 2026 Dara Singh Author Paused 2 Jun 2026 Eli Moss Admin Active 27 Jul 2026 Fay Grant Reviewer Invited 8 Aug 2026 Gus Hale Author Active 9 Sep 2026 Hana Ito Editor Paused 1 Oct 2026'
  for (const name of ['dense22', 'dense24', 'dense28']) assert.equal(say(readingOrder(shuffled(name))), `Acme Journal Dashboard People People ${rows}`, name)
  const form = 'Acme Journal Dashboard Submissions People Settings New submission Title Short title Soil carbon in old orchards Soil carbon First author Email Ana Lopez ana@example.org Section Keywords Research article soil, carbon, orchards Your submission is saved as a draft until you press Submit.'
  for (const name of ['form1x', 'form2x']) assert.equal(say(readingOrder(shuffled(name))), form, name)
})

test('a read that finds few words is read again in halves, then by tesseract if it is here, and the most words win', async () => {
  const picture = join(work, 'few.png')
  writePicture(picture, 800, 600)
  const log = join(work, 'mac.log')
  // A stand-in for the Mac's script runner: one word read whole, `halves` words read in halves.
  const mac = halves => {
    const path = join(work, `mac-${halves}.mjs`)
    const words = n => JSON.stringify(Array.from({ length: n }, (_, i) => ({ t: `w${i}`, x: 10 + (i % 10) * 70, y: 10 + Math.floor(i / 10) * 40, w: 60, h: 20 })))
    writeFileSync(path, `#!/usr/bin/env node\nimport { appendFileSync } from 'node:fs'\nconst mode = process.argv.at(-1)\nappendFileSync(${JSON.stringify(log)}, mode + '\\n')\nprocess.stdout.write('{"size":{"w":800,"h":600},"words":' + (mode === 'halves' ? ${JSON.stringify(words(halves))} : ${JSON.stringify(words(1))}) + '}')\n`, { mode: 0o755 })
    return path
  }
  const tesseract = writeReader(join(work, 'many-reader.mjs'), { w: 800, h: 600 }, Array.from({ length: 12 }, (_, i) => ({ t: `t${i}`, x: 10 + i * 60, y: 300, w: 50, h: 20 })))
  const runs = () => readFileSync(log, 'utf8').trim().split('\n')
  try {
    // Halves find plenty: they win, and tesseract is not asked.
    process.env.REVIEW_TESSERACT = tesseract
    writeFileSync(log, '')
    assert.equal((await readPicture(picture, { mac: mac(40) })).words.length, 40)
    assert.deepEqual(runs(), ['whole', 'halves'])
    // Halves find little too: tesseract reads it, and its twelve words win over three.
    writeFileSync(log, '')
    assert.equal(say((await readPicture(picture, { mac: mac(3) })).words), Array.from({ length: 12 }, (_, i) => `t${i}`).join(' '))
    assert.deepEqual(runs(), ['whole', 'halves'])
    // No tesseract: the most the Mac found.
    process.env.REVIEW_TESSERACT = join(work, 'no-tesseract')
    assert.equal((await readPicture(picture, { mac: mac(3) })).words.length, 3)
  } finally {
    delete process.env.REVIEW_TESSERACT
  }
})

test('the Mac\'s reader, reading in halves, keeps each word once and in the whole picture\'s pixels', { skip: process.platform === 'darwin' ? false : 'only on a Mac' }, async () => {
  // A short picture with a word in each quarter and one across the middle, read with the halves the retry uses.
  const picture = join(work, 'quarters.png')
  execFileSync('osascript', ['-l', 'JavaScript', '-e', `ObjC.import('AppKit')
function run(argv) {
  const W = 1280, H = 720
  const rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(null, W, H, 8, 4, true, false, $.NSCalibratedRGBColorSpace, 0, 0)
  $.NSGraphicsContext.saveGraphicsState
  $.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep))
  $.NSColor.whiteColor.set
  $.NSRectFill($.NSMakeRect(0, 0, W, H))
  const style = $.NSDictionary.dictionaryWithObjectForKey($.NSFont.systemFontOfSize(16), $.NSFontAttributeName)
  $('Upper left').drawAtPointWithAttributes($.NSMakePoint(80, H - 120), style)
  $('Upper right').drawAtPointWithAttributes($.NSMakePoint(900, H - 120), style)
  $('Across the middle of the page').drawAtPointWithAttributes($.NSMakePoint(520, H / 2 - 8), style)
  $('Lower left').drawAtPointWithAttributes($.NSMakePoint(80, 100), style)
  $('Lower right').drawAtPointWithAttributes($.NSMakePoint(900, 100), style)
  $.NSGraphicsContext.restoreGraphicsState
  rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $.NSDictionary.dictionary).writeToFileAtomically(argv[0], true)
}`, picture])
  // The script itself, asked for halves, as the retry asks it.
  const source = readFileSync(join(here, '..', 'lib', 'read-words.mjs'), 'utf8')
  const script = /const MAC_SCRIPT = `([\s\S]*?)`\n/.exec(source)[1].replace(/\\\\/g, '\\')
  const said = JSON.parse(execFileSync('osascript', ['-l', 'JavaScript', '-e', script, picture, '1600', '200', 'halves'], { encoding: 'utf8' }))
  const list = readingOrder((await import('../lib/read-words.mjs')).withoutDoubles(said.words))
  // The reader may run two short words together ("Lowerleft"): that is its reading, not the halves'. Each is there once.
  assert.equal(say(list).replace(/ /g, ''), 'UpperleftUpperrightAcrossthemiddleofthepageLowerleftLowerright')
  const across = list.find(word => word.t === 'Across')
  assert.ok(Math.abs(across.x - 520) < 12 && Math.abs(across.y - 352) < 14, JSON.stringify(across))
})
