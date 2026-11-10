import './own-home.mjs'
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { inflateSync } from 'node:zlib'
import { writePicture } from './helpers.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const CLI = join(here, '..', 'review.mjs')
// A Chrome named for driving the browser tests is not the one that takes pictures: a person's own Chrome does that.
delete process.env.REVIEW_CHROME

const home = mkdtempSync(join(tmpdir(), 'review-words-'))
process.env.REVIEW_HOME = home
const { IMAGES, listScreens, push, readInbox, receive } = await import('../lib/store.mjs')
const { PAGE_SCRIPT, checkWords, markWords, printable, readWords, sayWords } = await import('../lib/words.mjs')
const { joinSplitWords, wordsFromBbox } = await import('../lib/pdf.mjs')
const { captureWithWords, chromeFlags, findChrome } = await import('../lib/first.mjs')
after(() => rmSync(home, { recursive: true, force: true }))
const env = { ...process.env, REVIEW_HOME: home }
const review = (words, more = {}) => spawnSync('node', [CLI, ...words], { env: { ...env, ...more }, encoding: 'utf8' })

const picture = join(home, 'p.png')
writePicture(picture, 200, 100)
/** A small screen: a card with a label and a date, and a line under it. */
const LIST = {
  size: { w: 200, h: 100 },
  words: [
    { t: 'First', x: 10, y: 10, w: 30, h: 10, el: 'div.item > small' },
    { t: 'work', x: 45, y: 10, w: 30, h: 10, el: 'div.item > small' },
    { t: 'day', x: 80, y: 10, w: 25, h: 10, el: 'div.item > small' },
    { t: 'Saturday', x: 10, y: 30, w: 60, h: 20, el: 'div.item > b' },
    { t: '14', x: 75, y: 30, w: 20, h: 20, el: 'div.item > b' },
    { t: 'March', x: 100, y: 30, w: 50, h: 20, el: 'div.item > b' },
    { t: 'Tea', x: 10, y: 70, w: 20, h: 10 },
  ],
}
const listFile = (name, list) => {
  const path = join(home, name)
  writeFileSync(path, typeof list === 'string' ? list : JSON.stringify(list))
  return path
}
const good = listFile('list.json', LIST)
const stored = entry => JSON.parse(readFileSync(join(IMAGES, entry.words), 'utf8'))

test('a push with a word list keeps it beside the picture, and the queue entry names it', () => {
  const entry = push({ app: 'Words', screen: 'Home', after: picture, words: good })
  assert.match(entry.words, /^words\/home-words-\d+\.json$/)
  assert.equal(entry.words.replace('-words-', '-after-').replace('.json', '.png'), entry.after, 'named as its picture is, with the same time')
  assert.deepEqual(stored(entry), LIST)
  assert.equal(listScreens('words').find(s => s.id === 'home').words, entry.words)
  // From the command, and the list file can go away after: it was copied.
  const scratch = listFile('scratch.json', LIST)
  const ran = review(['push', '--app', 'Words', '--screen', 'Told', '--after', picture, '--words', scratch])
  assert.equal(ran.status, 0, ran.stderr)
  rmSync(scratch)
  assert.deepEqual(stored(listScreens('words').find(s => s.id === 'told')), LIST)
})

test('a push with no word list is as it always was: no field, and marks carry no words', () => {
  const entry = push({ app: 'Words', screen: 'Bare', after: picture })
  assert.ok(!('words' in entry))
  assert.ok(!readdirSync(join(IMAGES, 'words')).some(name => name.startsWith('bare-words-')))
  const record = receive({ appSlug: 'words', id: 'bare', png: null, shapes: [{ type: 'box', colour: 'red', box: { x: 5, y: 5, w: 150, h: 50 } }], notes: '', verdict: 'changes', imageSize: null })
  assert.deepEqual(record.shapes, [{ type: 'box', colour: 'red', box: { x: 5, y: 5, w: 150, h: 50 } }])
})

test('a word list that is not right is refused in one plain line, and nothing is queued', () => {
  const wrong = {
    'not JSON at all': /The word list at .* is not JSON\./,
    '[1, 2]': /The word list is not right: it is not an object\./,
    '{"words": []}': /size needs w and h/,
    '{"size": {"w": 200, "h": 100}}': /words is not a list/,
    '{"size": {"w": 200, "h": 100}, "words": [{"x": 1, "y": 1, "w": 5, "h": 5}]}': /word 1 has no text in t/,
    '{"size": {"w": 200, "h": 100}, "words": [{"t": "Tea", "x": 1, "y": 1, "w": 5, "h": 5}, {"t": "pot", "x": "4", "y": 1, "w": 5, "h": 5}]}': /word 2 \("pot"\) needs x, y, w and h as numbers/,
    '{"size": {"w": 200, "h": 100}, "words": [{"t": "Tea", "x": 1, "y": 1, "w": 0, "h": 5}]}': /with a width and a height/,
    '{"size": {"w": 200, "h": 100}, "words": [{"t": "Tea", "x": 1, "y": 1, "w": 5, "h": 5, "el": 7}]}': /an el that is not text/,
    // A list made for a window of another shape than the picture.
    '{"size": {"w": 200, "h": 300}, "words": []}': /The word list is for a picture 200 by 300, and the picture is 200 by 100\./,
  }
  for (const [text, says] of Object.entries(wrong)) {
    const ran = review(['push', '--app', 'Refused', '--screen', 'One', '--after', picture, '--words', listFile('bad.json', text)])
    assert.equal(ran.status, 1, text)
    assert.match(ran.stderr, says)
    assert.equal(ran.stderr.trim().split('\n').length, 1, `one line, not a stack: ${ran.stderr}`)
    assert.throws(() => push({ app: 'Refused', screen: 'One', after: picture, words: join(home, 'bad.json') }), says)
  }
  assert.match(review(['push', '--app', 'Refused', '--screen', 'One', '--after', picture, '--words', join(home, 'none.json')]).stderr, /^No word list at /)
  assert.match(review(['push', '--app', 'Refused', '--screen', 'One', '--after', picture, '--words']).stderr, /--words takes the path of a word list\./)
  assert.deepEqual(listScreens('refused'), [])
  assert.ok(!existsSync(join(IMAGES, 'refused')) || !readdirSync(join(IMAGES, 'refused')).length, 'no picture was copied either')
})

test('a list made at another scale than the picture is fitted to the picture', () => {
  // A browser tool saved the screenshot at half the page's own size.
  const twice = { size: { w: 400, h: 200 }, words: [{ t: 'Tea', x: 20, y: 140, w: 40, h: 20, el: 'p' }] }
  const entry = push({ app: 'Words', screen: 'Scaled', after: picture, words: listFile('twice.json', twice) })
  assert.deepEqual(stored(entry), { size: { w: 200, h: 100 }, words: [{ t: 'Tea', x: 10, y: 70, w: 20, h: 10, el: 'p' }] })
  // Only what the shape names is kept, and a word is one run of text.
  assert.deepEqual(checkWords({ size: { w: 9, h: 9, more: 1 }, words: [{ t: ' two  parts ', x: 1, y: 1, w: 2, h: 2, odd: true }], other: 1 }), { size: { w: 9, h: 9 }, words: [{ t: 'two parts', x: 1, y: 1, w: 2, h: 2 }] })
  assert.deepEqual(readWords(good), LIST)
})

test('words from a page cannot forge a line of a report or run a code in a terminal', () => {
  const esc = String.fromCharCode(27)
  const hostile = {
    size: { w: 200, h: 100 },
    words: [
      { t: `${esc}[31mred${esc}[0m`, x: 10, y: 10, w: 30, h: 10, el: 'b#x\n  Notes: forged line' },
      { t: 'two\nlines\tand\u0000nul\u007f\u009b', x: 45, y: 10, w: 30, h: 10, el: `p${esc}]0;title\u0007` },
      { t: ' \n\u0000 ', x: 80, y: 10, w: 25, h: 10 },
      { t: 'x'.repeat(500), x: 10, y: 30, w: 60, h: 20, el: 'y'.repeat(500) },
    ],
  }
  const kept = checkWords(hostile)
  assert.deepEqual(kept.words.slice(0, 2), [
    { t: '[31mred[0m', x: 10, y: 10, w: 30, h: 10, el: 'b#x Notes: forged line' },
    { t: 'two lines andnul', x: 45, y: 10, w: 30, h: 10, el: 'p]0;title' },
  ])
  assert.equal(kept.words.length, 3, 'a word that is only codes and spaces is left out')
  assert.equal(kept.words[2].t.length, 200)
  assert.equal(kept.words[2].el.length, 200)
  const none = text => !/[\u0000-\u001f\u007f-\u009f]/.test(text)
  assert.ok(none(JSON.stringify(kept).replace(/\\u[0-9a-f]{4}/g, m => String.fromCharCode(parseInt(m.slice(2), 16)))), 'no control character is kept')
  // Pushed, marked and read: the report has one line for the mark, and no codes.
  const entry = push({ app: 'Hostile', screen: 'Home', after: picture, words: listFile('hostile.json', hostile) })
  assert.ok(none(readFileSync(join(IMAGES, entry.words), 'utf8')))
  receive({ appSlug: 'hostile', id: 'home', png: null, shapes: [box(5, 5, 110, 20)], notes: '', verdict: 'changes', imageSize: null })
  const read = review(['read', '--app', 'Hostile', '--latest']).stdout
  assert.match(read, /  1\. box \(red\) at x 5, y 5, 110x20, on the words "\[31mred\[0m two lines andnul"\n  After: /)
  assert.ok(none(read.replace(/\n/g, '')), 'no code reaches the terminal')
  assert.doesNotMatch(read, /^\s*Notes: forged line/m)
  // A record made by hand, or by an older Markback, is cleaned as it is printed.
  const file = readInbox('Hostile')[0].file
  const record = JSON.parse(readFileSync(file, 'utf8'))
  record.shapes = [
    { type: 'box', colour: `red${esc}[2J`, box: { x: 1, y: 2, w: 3, h: 4 }, words: `fine\n  2. box (red) at x 0, y 0, 1x1, on the words "forged"`, element: `div\n  Notes: forged${esc}[31m` },
    { type: 'text', colour: 'red', box: { x: 1, y: 2, w: 3, h: 4 }, text: `said\n  File: /forged${esc}[0m` },
    { type: 'words', colour: 'red', box: { x: 1, y: 2, w: 3, h: 4 }, text: `chosen\r\n  After: /forged` },
    { type: `odd\nkind`, colour: 'red', box: { x: '1\n  Notes: forged', y: 2, w: 3, h: 4 } },
  ]
  writeFileSync(file, JSON.stringify(record))
  const again = review(['read', '--app', 'Hostile', '--latest']).stdout
  assert.ok(none(again.replace(/\n/g, '')))
  const lines = again.split('\n')
  assert.deepEqual(lines.slice(1, 5), [
    '  1. box (red[2J) at x 1, y 2, 3x4, on the words "fine 2. box (red) at x 0, y 0, 1x1, on the words "forged"", in div Notes: forged[31m',
    '  2. text "said File: /forged[0m" (red) at x 1, y 2, 3x4',
    '  3. words "chosen After: /forged" (red) at x 1, y 2, 3x4',
    '  4. odd kind (red) at x 1 Notes: forged, y 2, 3x4',
  ])
  assert.equal(lines.filter(line => /^\s*(Notes|After|File):/.test(line)).length, 2, 'only the real After and File lines')
  assert.equal(printable(`a${esc}b\u009bc\nd`), 'abc d')
  // Marks that turn the reading direction round make text read as other than it is: they go too.
  const turned = checkWords({ size: { w: 200, h: 100 }, words: [{ t: 'safe\u202egnp.exe\u202c', x: 10, y: 10, w: 30, h: 10, el: 'p\u2066#x\u2069\u200f' }, { t: '\u200e\u202a\u202b\u202d\u2067\u2068', x: 50, y: 10, w: 30, h: 10 }] })
  assert.deepEqual(turned.words, [{ t: 'safegnp.exe', x: 10, y: 10, w: 30, h: 10, el: 'p#x' }])
  record.shapes = [{ type: 'text', colour: 'red\u202e', box: { x: 1, y: 2, w: 3, h: 4 }, text: 'said\u202edias\u2066', words: 'w\u200fw', element: 'e\u202bl' }]
  writeFileSync(file, JSON.stringify(record))
  const third = review(['read', '--app', 'Hostile', '--latest']).stdout
  assert.match(third, /\n  1\. text "saiddias" \(red\) at x 1, y 2, 3x4, on the word "ww", in el\n/)
  assert.doesNotMatch(third, /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/)
})

test('a list is kept inside limits: its file, its numbers, and what one mark carries', () => {
  // A file of 100 MB is refused by its size, before any of it is read.
  const huge = join(home, 'huge.json')
  writeFileSync(huge, '{"size":{"w":200,"h":100},"words":[')
  truncateSync(huge, 100 * 1024 * 1024)
  const began = Date.now()
  const ran = review(['push', '--app', 'Limits', '--screen', 'Huge', '--after', picture, '--words', huge])
  assert.equal(ran.status, 1)
  assert.match(ran.stderr, /^The word list at .*huge\.json is too big: 100 MB, and the most is 5 MB\.\n$/)
  assert.ok(Date.now() - began < 3000, 'quickly')
  assert.throws(() => push({ app: 'Limits', screen: 'Huge', after: picture, words: huge }), /is too big/)
  assert.deepEqual(listScreens('limits'), [])
  rmSync(huge)
  // A folder is not a list.
  assert.match(review(['push', '--app', 'Limits', '--screen', 'Folder', '--after', picture, '--words', home]).stderr, /^No word list at /)
  // Numbers that are no numbers, and words that are not in the picture, are left out. A word partly in it is cut to it.
  const odd = '{"size":{"w":200,"h":100},"words":[{"t":"fine","x":10,"y":10,"w":30,"h":10},{"t":"endless","x":1e999,"y":10,"w":30,"h":10},{"t":"wide","x":10,"y":10,"w":1e999,"h":10},{"t":"outside","x":500,"y":10,"w":30,"h":10},{"t":"above","x":10,"y":-50,"w":30,"h":10},{"t":"mostly-out","x":190,"y":10,"w":30,"h":10},{"t":"edge","x":180,"y":92,"w":25,"h":10}]}'
  assert.deepEqual(readWords(listFile('odd.json', odd), picture).words, [{ t: 'fine', x: 10, y: 10, w: 30, h: 10 }, { t: 'edge', x: 180, y: 92, w: 20, h: 8 }])
  // Fitted to a picture of half the size, a word is still inside it.
  const twice = { size: { w: 400, h: 200 }, words: [{ t: 'corner', x: 370, y: 186, w: 40, h: 16 }, { t: 'gone', x: 420, y: 10, w: 30, h: 20 }] }
  assert.deepEqual(readWords(listFile('twice-out.json', twice), picture).words, [{ t: 'corner', x: 185, y: 93, w: 15, h: 7 }])
  // One mark carries 200 words at most, or 2,000 letters, and says when it was cut.
  const many = { size: { w: 1000, h: 1000 }, words: Array.from({ length: 900 }, (_, n) => ({ t: `w${n + 1}`, x: (n % 30) * 30, y: Math.floor(n / 30) * 30, w: 20, h: 20 })) }
  const whole = markWords(box(0, 0, 1000, 1000), many).words
  assert.equal(whole.split(' ').length, 200)
  assert.match(whole, /^w1 w2 .* w199 w200…$/)
  const long = { size: { w: 1000, h: 1000 }, words: Array.from({ length: 100 }, (_, n) => ({ t: 'x'.repeat(199), x: (n % 10) * 100, y: Math.floor(n / 10) * 100, w: 90, h: 90 })) }
  const letters = markWords(box(0, 0, 1000, 1000), long).words
  assert.equal(letters.length, 2000)
  assert.ok(letters.endsWith('…'))
  const chosen = markWords({ type: 'words', colour: 'red', box: { x: 0, y: 0, w: 5, h: 5 }, text: `chosen\n${'word '.repeat(600)}` }, null).words
  assert.equal(chosen.split(' ').length, 200)
  assert.ok(chosen.startsWith('chosen word word') && chosen.endsWith('…'))
  // A list changed on disk after it was kept is cleaned again when an answer is saved.
  const entry = push({ app: 'Limits', screen: 'Kept', after: picture, words: good })
  writeFileSync(join(IMAGES, entry.words), JSON.stringify({ size: LIST.size, words: [{ t: 'Sat\nurday', x: 10, y: 30, w: 60, h: 20, el: 'b\n  Notes: forged' }] }))
  const record = receive({ appSlug: 'limits', id: 'kept', png: null, shapes: [box(5, 25, 150, 30)], notes: '', verdict: 'changes', imageSize: null })
  assert.deepEqual([record.shapes[0].words, record.shapes[0].element], ['Sat urday', 'b Notes: forged'])
  writeFileSync(join(IMAGES, entry.words), 'not a list any more')
  assert.equal(receive({ appSlug: 'limits', id: 'kept', png: null, shapes: [box(5, 25, 150, 30)], notes: '', verdict: 'changes', imageSize: null }).shapes[0].words, undefined)
})

const box = (x, y, w, h, more = {}) => ({ type: 'box', colour: 'red', box: { x, y, w, h }, ...more })
const arrow = (to, more = {}) => ({ type: 'arrow', colour: 'blue', box: { x: 150, y: 60, w: 10, h: 10 }, from: { x: 190, y: 95 }, to, ...more })

const pen = (points, more = {}) => {
  const xs = points.map(p => p[0])
  const ys = points.map(p => p[1])
  return { type: 'freehand', colour: 'amber', box: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }, points, ...more }
}
/** A line drawn round a middle, as a hand draws it: it ends near where it began. */
const loop = (x, y, across, down) => pen(Array.from({ length: 25 }, (_, n) => [Math.round(x + across * Math.cos((n / 24) * 6.1)), Math.round(y + down * Math.sin((n / 24) * 6.1))]))

test('each kind of mark carries the words under it, by its own rule', () => {
  // A box: the words that are at least half inside it, in reading order. They are in two elements, so it names none.
  assert.deepEqual(markWords(box(5, 5, 150, 50), LIST), box(5, 5, 150, 50, { words: 'First work day Saturday 14 March' }))
  // All in one element: it is named.
  assert.deepEqual(markWords(box(5, 25, 150, 30), LIST), box(5, 25, 150, 30, { words: 'Saturday 14 March', element: 'div.item > b' }))
  // A box that cuts a word takes it when it holds half of it or more. Saturday is 60 wide, from 10.
  assert.equal(markWords(box(5, 25, 35, 30), LIST).words, 'Saturday', 'half of it')
  assert.equal(markWords(box(5, 25, 34, 30), LIST).words, undefined, 'less than half')
  // Its centre is not what counts: a box over the top half of a word and the half beside its centre holds a quarter of it.
  assert.equal(markWords(box(5, 25, 36, 15), LIST).words, undefined)
  // A box drawn a little low still means the line: it holds more than half of each word.
  assert.equal(markWords(box(5, 38, 150, 30), LIST).words, 'Saturday 14 March')

  // A freehand line through words means those words.
  assert.deepEqual(markWords(pen([[72, 40], [94, 40]]), LIST), { ...pen([[72, 40], [94, 40]]), words: '14', element: 'div.item > b' })
  // Two points far apart: the line between them counts, not only its ends.
  assert.equal(markWords(pen([[2, 40], [160, 40]]), LIST).words, 'Saturday 14 March')
  // A line under words means them: the word's box reaches down by half its height. The words are 20 high, from 30 to 50.
  assert.equal(markWords(pen([[12, 58], [50, 59], [93, 58]]), LIST).words, 'Saturday 14')
  assert.equal(markWords(pen([[12, 62], [93, 62]]), LIST).words, undefined, 'too far under')
  assert.equal(markWords(pen([[12, 27], [93, 27]]), LIST).words, undefined, 'a line over the words is not on them')
  // Two rows set close: the first ends at 30 and the next starts at 32. A line through the top of the second row is on the
  // second row, in the gaps between its words too: it is not an underline of the first.
  const close = { size: { w: 200, h: 100 }, words: [{ t: 'a1', x: 10, y: 10, w: 50, h: 20 }, { t: 'a2', x: 70, y: 10, w: 50, h: 20 }, { t: 'b1', x: 10, y: 32, w: 40, h: 20 }, { t: 'b2', x: 60, y: 32, w: 60, h: 20 }] }
  assert.equal(markWords(pen([[5, 36], [125, 36]]), close).words, 'b1 b2')
  assert.equal(markWords(pen([[5, 35], [60, 37], [125, 36]]), close).words, 'b1 b2')
  // Between the rows it is on no word: it is under the first row.
  assert.equal(markWords(pen([[5, 31], [125, 31]]), close).words, 'a1 a2')
  // Under the second row it takes the second row only, and a point beside a word takes nothing.
  assert.equal(markWords(pen([[5, 56], [125, 56]]), close).words, 'b1 b2')
  assert.equal(markWords(pen([[130, 5], [130, 60]]), close).words, undefined)
  // A line down through both rows takes the word of each row it goes through, and no other.
  assert.equal(markWords(pen([[30, 5], [30, 60]]), close).words, 'a1 b1')
  // A loop round a word touches nothing: it means what is in its box.
  const round = loop(85, 40, 16, 16)
  assert.equal(round.points.length, 25)
  assert.deepEqual(markWords(round, LIST), { ...round, words: '14', element: 'div.item > b' })
  assert.equal(markWords(loop(80, 30, 78, 26), LIST).words, 'First work day Saturday 14 March', 'a loop that cuts through words takes those mostly inside')
  // A line that ends where it began but holds no room is not a loop: there and back under a word.
  assert.equal(markWords(pen([[12, 56], [50, 57], [68, 56], [50, 55], [12, 56]]), LIST).words, 'Saturday')
  // A freehand mark with no points is taken by its box.
  assert.equal(markWords({ type: 'freehand', colour: 'amber', box: { x: 70, y: 28, w: 30, h: 24 } }, LIST).words, '14')

  // An arrow: the one word nearest its head, when it is within one and a half times the word's height, and never less than 24.
  assert.deepEqual(markWords(arrow({ x: 12, y: 90 }), LIST), arrow({ x: 12, y: 90 }, { words: 'Tea' }))
  // Tea is 10 high, so its reach is 24. It ends at 80.
  assert.equal(markWords(arrow({ x: 12, y: 104 }), LIST).words, 'Tea', 'at the limit')
  assert.equal(markWords(arrow({ x: 12, y: 105 }), LIST).words, undefined, 'just past it')
  // March is 20 high, so its reach is 30. It ends at 150.
  assert.equal(markWords(arrow({ x: 180, y: 40 }), LIST).words, 'March', 'at the limit of a taller word')
  assert.equal(markWords(arrow({ x: 181, y: 40 }), LIST).words, undefined)
  assert.equal(markWords(arrow({ x: 110, y: 40 }), LIST).words, 'March', 'on a word')
  assert.deepEqual(markWords(arrow({ x: 190, y: 95 }), LIST), arrow({ x: 190, y: 95 }), 'far from every word: none')
  // A text mark is the person's own words: it carries none of the picture's.
  const note = { type: 'text', colour: 'red', box: { x: 5, y: 25, w: 150, h: 30 }, text: 'Wrong day' }
  assert.deepEqual(markWords(note, LIST), note)
  // Chosen words say their words already, and name the element as a box does.
  const chosen = { type: 'words', color: 'red', box: { x: 8, y: 28, w: 144, h: 24 }, text: 'Saturday 14 March' }
  assert.deepEqual(markWords(chosen, LIST), { ...chosen, words: 'Saturday 14 March', element: 'div.item > b' })
  assert.deepEqual(markWords(chosen, null), { ...chosen, words: 'Saturday 14 March' }, 'with no list they still say them')
  // A mark on no words has no words field, and a field that came with a mark is not believed.
  assert.deepEqual(markWords(box(160, 60, 30, 30), LIST), box(160, 60, 30, 30))
  assert.deepEqual(markWords({ ...note, words: 'made up', element: 'body' }, LIST), note)
  // A mark without the numbers it should have is kept as it came, with no words.
  assert.deepEqual(markWords({ type: 'box', colour: 'red' }, LIST), { type: 'box', colour: 'red' })
  assert.deepEqual(markWords({ type: 'freehand', colour: 'red', points: [[1, 'x'], 'no'] }, LIST), { type: 'freehand', colour: 'red', points: [[1, 'x'], 'no'] })
})

test('an answer saved for a screen with a word list has the words on each mark, and read says them', () => {
  push({ app: 'Answered', screen: 'Home', after: picture, words: good })
  const shapes = [
    box(5, 5, 150, 50),
    { type: 'words', color: 'red', box: { x: 8, y: 28, w: 144, h: 24 }, text: 'Saturday 14 March' },
    arrow({ x: 12, y: 90 }),
    arrow({ x: 190, y: 95 }),
    { type: 'text', colour: 'red', box: { x: 5, y: 25, w: 150, h: 30 }, text: 'Wrong day' },
    { type: 'freehand', colour: 'amber', box: { x: 72, y: 40, w: 22, h: 0 }, points: [[72, 40], [94, 40]] },
  ]
  const record = receive({ appSlug: 'answered', id: 'home', png: null, shapes, notes: 'Check the date.', verdict: 'changes', imageSize: { w: 200, h: 100 } })
  assert.deepEqual(record.shapes.map(s => s.words), ['First work day Saturday 14 March', 'Saturday 14 March', 'Tea', undefined, undefined, '14'])
  assert.deepEqual(record.shapes.map(s => s.element), [undefined, 'div.item > b', undefined, undefined, undefined, 'div.item > b'])
  assert.deepEqual(readInbox('Answered')[0].shapes, record.shapes, 'as saved')
  const read = review(['read', '--app', 'Answered', '--latest']).stdout
  assert.match(read, /  1\. box \(red\) at x 5, y 5, 150x50, on the words "First work day Saturday 14 March"\n/)
  assert.match(read, /  2\. words "Saturday 14 March" \(red\) at x 8, y 28, 144x24, in div\.item > b\n/)
  assert.match(read, /  3\. arrow from 190,95 to 12,90 \(blue\) at x 150, y 60, 10x10, on the word "Tea"\n/)
  assert.match(read, /  4\. arrow from 190,95 to 190,95 \(blue\) at x 150, y 60, 10x10\n/)
  assert.match(read, /  5\. text "Wrong day" \(red\) at x 5, y 25, 150x30\n/)
  assert.match(read, /  6\. freehand \(amber\) at x 72, y 40, 22x0, on the word "14", in div\.item > b\n/)
  const [json] = JSON.parse(review(['read', '--app', 'Answered', '--latest', '--json']).stdout)
  assert.equal(json.shapes[0].words, 'First work day Saturday 14 March')
  // A box over a whole page says where its words start and end, and how many there are.
  const many = Array.from({ length: 50 }, (_, n) => `w${n + 1}`).join(' ')
  assert.equal(sayWords({ type: 'box', words: many }), ', on the words "w1 w2 w3 w4 w5 w6 w7 w8 w9 w10 w11 w12 w13 w14 w15 … w36 w37 w38 w39 w40 w41 w42 w43 w44 w45 w46 w47 w48 w49 w50" (50 words; --json has them all)')
})

test('marks on a picture since replaced carry the words of the picture they were drawn on', async () => {
  const first = push({ app: 'Replaced', screen: 'Home', after: picture, words: good })
  await new Promise(r => setTimeout(r, 5))
  const later = { size: LIST.size, words: [{ t: 'Sunday', x: 10, y: 30, w: 60, h: 20 }] }
  const again = push({ app: 'Replaced', screen: 'Home', after: picture, words: listFile('later.json', later) })
  assert.notEqual(again.words, first.words, 'each picture has its own list')
  const old = receive({ appSlug: 'replaced', id: 'home', png: null, shapes: [box(5, 25, 150, 30)], notes: '', verdict: 'changes', imageSize: null, after: first.after, round: 1 })
  assert.equal(old.olderPicture, true)
  assert.equal(old.shapes[0].words, 'Saturday 14 March')
  const now = receive({ appSlug: 'replaced', id: 'home', png: null, shapes: [box(5, 25, 150, 30)], notes: '', verdict: 'changes', imageSize: null, after: again.after, round: 2 })
  assert.equal(now.shapes[0].words, 'Sunday')
  // A picture name that leads out of the app's own pictures finds no list.
  const odd = receive({ appSlug: 'replaced', id: 'home', png: null, shapes: [box(5, 25, 150, 30)], notes: '', verdict: 'changes', imageSize: null, after: '../../secret/home-after-1.png', round: 1 })
  assert.equal(odd.shapes[0].words, undefined)
})

/** A port nothing listens on, for a server of this test's own. */
const freePort = () => new Promise(resolve => {
  const probe = createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address()
    probe.close(() => resolve(port))
  })
})

test('the server gives the word list as JSON, and marks sent as the page sends them come back with their words', async () => {
  const entry = push({ app: 'Served', screen: 'Home', after: picture, words: good })
  const port = await freePort()
  const server = spawn('node', [join(here, '..', 'server.mjs')], { env: { ...env, REVIEW_PORT: String(port) }, stdio: 'ignore' })
  try {
    const at = `http://127.0.0.1:${port}`
    for (let i = 0; i < 50 && !(await fetch(`${at}/api/queue`).then(r => r.ok, () => false)); i++) await new Promise(r => setTimeout(r, 100))
    const queue = await (await fetch(`${at}/api/queue`)).json()
    assert.equal(queue.apps.find(a => a.slug === 'served').screens[0].words, entry.words, 'the page is told where the list is')
    const list = await fetch(`${at}/images/${entry.words}`)
    assert.equal(list.status, 200)
    assert.match(list.headers.get('content-type'), /^application\/json/)
    assert.deepEqual(await list.json(), LIST)
    const sent = await fetch(`${at}/api/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ appSlug: 'served', id: 'home', after: entry.after, round: 1, verdict: 'changes', notes: '', imageSize: LIST.size, png: null, shapes: [box(5, 25, 150, 30)] }) })
    const { record } = await sent.json()
    assert.equal(record.shapes[0].words, 'Saturday 14 March')
    assert.equal(record.shapes[0].element, 'div.item > b')
  } finally {
    server.kill()
  }
})

test('the script for a browser tool is one expression, and the command prints it', () => {
  const ran = review(['words-script'])
  assert.equal(ran.status, 0, ran.stderr)
  assert.equal(ran.stdout.trim(), PAGE_SCRIPT)
  // It reads as code, as one value, without being run: it needs a page.
  assert.doesNotThrow(() => new Function(`return ${PAGE_SCRIPT}`))
  assert.match(PAGE_SCRIPT, /^\(function wordsInPage\(\) \{[\s\S]*\}\)\(\)$/)
  assert.doesNotMatch(PAGE_SCRIPT, /\bimport\b|\brequire\(/, 'it uses nothing from outside itself')
})

/* ---------- a PDF ---------- */

const work = mkdtempSync(join(home, 'pdf-'))
// A script without .mjs in its name runs as a module only when a package.json beside it says so.
writeFileSync(join(work, 'package.json'), '{"type":"module"}')
const tool = (name, body) => {
  const path = join(work, name)
  writeFileSync(path, `#!/usr/bin/env node\n${body}`)
  chmodSync(path, 0o755)
  return path
}
/** A stand-in for pdftoppm, as in the PDF tests: a picture 60 by 40 for each page asked for. */
const pdftoppm = tool('pdftoppm', `import { writePicture } from ${JSON.stringify(pathToFileURL(join(here, 'helpers.mjs')).href)}
const words = process.argv.slice(2)
const from = Number(words[words.indexOf('-f') + 1]), to = Math.min(Number(words[words.indexOf('-l') + 1]), 3)
for (let n = from; n <= to; n++) writePicture(words.at(-1) + '-' + n + '.png', 60, 40)
`)
/** A stand-in for pdftotext -bbox: what the real one prints, for pages of 30 by 20 points. Page 2 has no words. */
const pdftotext = tool('pdftotext', `const words = process.argv.slice(2)
if (words[0] !== '-bbox' || words.at(-1) !== '-') process.exit(2)
const from = Number(words[words.indexOf('-f') + 1]), to = Math.min(Number(words[words.indexOf('-l') + 1]), 3)
let out = '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">\\n<html xmlns="http://www.w3.org/1999/xhtml">\\n<head>\\n<title></title>\\n</head>\\n<body>\\n<doc>\\n'
for (let n = from; n <= to; n++) {
  out += '  <page width="30.000000" height="20.000000">\\n'
  if (n !== 2) out += '    <word xMin="2.000000" yMin="3.000000" xMax="12.500000" yMax="8.000000">Page</word>\\n    <word xMin="14.000000" yMin="3.000000" xMax="17.000000" yMax="8.000000">' + n + '</word>\\n    <word xMin="2.000000" yMin="10.000000" xMax="20.000000" yMax="15.000000">Beans&amp;peas</word>\\n'
  out += '  </page>\\n'
}
console.log(out + '</doc>\\n</body>\\n</html>')
`)

/** A real PDF with real words, written by hand: each line is [x, y, size, text], in points from the bottom left. */
function writeTextPdf(path, lines, page = '/MediaBox [0 0 300 200]') {
  const stream = lines.map(([x, y, size, text]) => `BT /F1 ${size} Tf ${x} ${y} Td (${text}) Tj ET`).join('\n')
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', `<< /Type /Page /Parent 2 0 R ${page} /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`]
  let text = '%PDF-1.4\n'
  const at = objects.map((body, n) => {
    const offset = text.length
    text += `${n + 1} 0 obj\n${body}\nendobj\n`
    return offset
  })
  const xref = text.length
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${at.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  writeFileSync(path, text)
}

test('what pdftotext prints becomes each page\'s words, in the picture\'s pixels', () => {
  const said = '<doc>\n  <page width="612.000000" height="792.000000">\n    <word xMin="397.500000" yMin="517.250000" xMax="465.800000" yMax="538.400000">Saturday</word>\n    <word xMin="470.000000" yMin="517.250000" xMax="490.000000" yMax="538.400000">14</word>\n    <word xMin="10.000000" yMin="20.000000" xMax="30.000000" yMax="32.000000">R&amp;D</word>\n    <word xMin="40.000000" yMin="20.000000" xMax="60.000000" yMax="32.000000">&lt;b&gt;&#233;t&#xe9;&quot;</word>\n  </page>\n  <page width="595.276000" height="841.890000">\n  </page>\n</doc>'
  assert.deepEqual(wordsFromBbox(said, 2), [
    {
      size: { w: 1224, h: 1584 },
      words: [
        { t: 'Saturday', x: 795, y: 1035, w: 137, h: 42 },
        { t: '14', x: 940, y: 1035, w: 40, h: 42 },
        { t: 'R&D', x: 20, y: 40, w: 40, h: 24 },
        { t: '<b>été"', x: 80, y: 40, w: 40, h: 24 },
      ],
    },
    { size: { w: 1191, h: 1684 }, words: [] },
  ])
  assert.deepEqual(wordsFromBbox('', 2), [])
})

test('with Poppler, each page of a PDF is pushed with its words, and a page with none has no list', () => {
  const pdf = join(work, 'Leaflet.pdf')
  writeTextPdf(pdf, [[20, 100, 14, 'Not read by the stand-in']])
  const ran = review(['pdf', pdf], { REVIEW_PDFTOPPM: pdftoppm, REVIEW_PDFTOTEXT: pdftotext, REVIEW_PDFINFO: join(work, 'no-pdfinfo') })
  assert.equal(ran.status, 0, ran.stderr)
  const pages = listScreens('leaflet')
  assert.deepEqual(pages.map(s => s.screen), ['Page 1', 'Page 2', 'Page 3'])
  assert.deepEqual(stored(pages[0]), { size: { w: 60, h: 40 }, words: [{ t: 'Page', x: 4, y: 6, w: 21, h: 10 }, { t: '1', x: 28, y: 6, w: 6, h: 10 }, { t: 'Beans&peas', x: 4, y: 20, w: 36, h: 10 }] })
  assert.ok(!('words' in pages[1]), 'a page with no words')
  assert.equal(stored(pages[2]).words[1].t, '3', 'each page has its own words')
  assert.deepEqual(readdirSync(join(home, 'shots')).filter(name => name.startsWith('pdf-')), [], 'the working lists are cleared away with the pictures')
  const record = receive({ appSlug: 'leaflet', id: 'page-3', png: null, shapes: [box(0, 0, 60, 18)], notes: '', verdict: 'changes', imageSize: null })
  assert.equal(record.shapes[0].words, 'Page 3')
  // Without pdftotext the pages are still shown, with no words.
  const bare = review(['pdf', pdf, '--app', 'No words tool'], { REVIEW_PDFTOPPM: pdftoppm, REVIEW_PDFTOTEXT: join(work, 'not-installed'), REVIEW_PDFINFO: join(work, 'no-pdfinfo') })
  assert.equal(bare.status, 0, bare.stderr)
  assert.ok(listScreens('no-words-tool').every(s => !('words' in s)))
})

test('letters the Mac gives apart are put back into words', () => {
  const letter = (t, x, w = 10) => ({ t, x, y: 90, w, h: 21 })
  // A spaced heading: single letters 3 apart, and words 9 apart. One pair of letters came together.
  const spaced = [letter('S', 100), letter('E', 113), letter('E', 126), letter('D', 139), letter('S', 158), letter('W', 171), letter('AP', 184, 22)]
  assert.deepEqual(joinSplitWords(spaced).map(w => [w.t, w.x, w.w]), [['SEED', 100, 49], ['SWAP', 158, 48]])
  // Two pieces whose boxes touch are one word.
  assert.deepEqual(joinSplitWords([{ t: 'W', x: 100, y: 10, w: 20, h: 22 }, { t: 'ater', x: 118, y: 10, w: 36, h: 22 }, { t: 'is', x: 160, y: 10, w: 12, h: 22 }]), [{ t: 'Water', x: 100, y: 10, w: 54, h: 22 }, { t: 'is', x: 160, y: 10, w: 12, h: 22 }])
  // Short words in a row are words, and so are words on other lines.
  const short = [{ t: 'is', x: 10, y: 10, w: 12, h: 22 }, { t: 'it', x: 28, y: 10, w: 10, h: 22 }, { t: 'so', x: 44, y: 10, w: 14, h: 22 }, { t: 'a', x: 10, y: 40, w: 8, h: 22 }]
  assert.deepEqual(joinSplitWords(short), short)
})

test('on a Mac, a PDF\'s real words come with their places in the picture', { skip: process.platform !== 'darwin' }, () => {
  const pdf = join(work, 'Dates.pdf')
  // The page is 300 by 200 points, so its picture is 600 by 400. The crop box and the turn are tried on a second PDF.
  writeTextPdf(pdf, [[20, 160, 24, 'Hello garden'], [20, 100, 14, 'Saturday 14 March']])
  const ran = review(['pdf', pdf], { REVIEW_PDFTOPPM: '' })
  assert.equal(ran.status, 0, ran.stderr)
  const list = stored(listScreens('dates')[0])
  assert.deepEqual(list.size, { w: 600, h: 400 })
  assert.deepEqual(list.words.map(w => w.t), ['Hello', 'garden', 'Saturday', '14', 'March'])
  const near = (n, to, by = 4) => Math.abs(n - to) <= by
  const [hello, , saturday, fourteen] = list.words
  // Text set at x 20 points starts 40 pixels in. Its baseline, 160 points up, is 80 pixels down: the box is round it.
  assert.ok(near(hello.x, 40) && hello.y < 80 - 24 && hello.y + hello.h >= 80, JSON.stringify(hello))
  assert.ok(near(saturday.x, 40) && saturday.y < 200 - 14 && saturday.y + saturday.h >= 200 && saturday.y > 150, JSON.stringify(saturday))
  assert.ok(fourteen.x > saturday.x + saturday.w && near(fourteen.y, saturday.y, 1), 'words follow each other along the line')
  const record = receive({ appSlug: 'dates', id: 'page-1', png: null, shapes: [box(30, 170, 300, 40)], notes: '', verdict: 'changes', imageSize: null })
  assert.equal(record.shapes[0].words, 'Saturday 14 March')

  // Cropped and turned a quarter: the picture is 340 by 540, and the first line runs down its right side.
  const turned = join(work, 'Turned.pdf')
  writeTextPdf(turned, [[20, 160, 24, 'Hello garden'], [20, 100, 14, 'Saturday 14 March']], '/MediaBox [0 0 300 200] /CropBox [10 20 280 190] /Rotate 90')
  assert.equal(review(['pdf', turned], { REVIEW_PDFTOPPM: '' }).status, 0)
  const side = stored(listScreens('turned')[0])
  assert.deepEqual(side.size, { w: 340, h: 540 })
  const [down, next] = side.words
  assert.equal(down.t, 'Hello')
  assert.ok(down.h > down.w * 1.5, 'the word stands on its end')
  assert.ok(near(down.y, 20) && down.x > 240 && down.x + down.w <= 340, JSON.stringify(down))
  assert.ok(next.y > down.y + down.h && near(next.x, down.x, 1), 'and the next word is under it')
})

/* ---------- a web page ---------- */

const PAGE = `<!doctype html><meta charset="utf-8"><title>Not a word of the page</title>
<style>body { margin: 0; font: 20px/30px sans-serif } h1 { position: absolute; left: 100px; top: 50px; margin: 0; font: 40px/40px sans-serif; white-space: nowrap }
  .item { position: absolute; left: 100px; top: 200px } .bar { position: fixed; left: 0; top: 380px; width: 300px; height: 60px; background: #fff }
  .box { position: absolute; left: 400px; top: 300px; width: 200px; height: 30px; overflow: hidden }</style>
<h1 id="top">Garden club</h1>
<div class="item"><small>First work day</small> <b>Saturday 14 March</b></div>
<p style="display: none">Never shown</p><p style="visibility: hidden">Ghost words</p><p style="opacity: 0">Clear words</p>
<p style="position: absolute; left: 100px; top: 400px">Covered words</p><div class="bar"></div>
<div class="box">Kept line<br>Cut line</div>
<p style="position: absolute; left: 100px; top: 2000px">Below the window</p>
<script>document.querySelector('.item').append(' at nine')</script>`

test('a picture of a web page comes with the words it shows, each in its place', { skip: !findChrome() }, async () => {
  const page = join(home, 'page.html')
  writeFileSync(page, PAGE)
  const out = join(home, 'page.png')
  const list = await captureWithWords(pathToFileURL(page), out, { width: 800, height: 600 })
  assert.equal(list, `${out}.words.json`)
  const { size, words } = readWords(list, out)
  assert.deepEqual(size, { w: 800, h: 600 }, 'the list is the size of the picture')
  // In reading order. Words that are hidden, see-through, covered, cut off or below the window are not in the picture.
  assert.equal(words.map(w => w.t).join(' '), 'Garden club First work day Saturday 14 March at nine Kept line')
  const [garden, club] = words
  // The heading is set at 100, 50, in type 40 high. A word's box is as tall as its type, which is near that.
  assert.deepEqual({ x: garden.x, el: garden.el }, { x: 100, el: 'h1#top' })
  assert.ok(Math.abs(garden.y - 50) <= 6 && garden.h >= 36 && garden.h <= 52, JSON.stringify(garden))
  assert.ok(garden.w > 80 && garden.w < 200 && club.x > garden.x + garden.w && club.y === garden.y, JSON.stringify([garden, club]))
  assert.deepEqual([...new Set(words.slice(2).map(w => w.el))], ['div.item > small', 'div.item > b', 'div.item', 'div.box'])
  // The picture and the list go to push as they are, and a mark on the picture names its words and their element.
  const entry = push({ app: 'Web', screen: 'Home', after: out, words: list })
  const saturday = words.find(w => w.t === 'Saturday')
  const march = words.find(w => w.t === 'March')
  const round = { x: saturday.x - 4, y: saturday.y - 4, w: march.x + march.w - saturday.x + 8, h: saturday.h + 8 }
  const record = receive({ appSlug: 'web', id: 'home', png: null, shapes: [{ type: 'box', colour: 'red', box: round }], notes: '', verdict: 'changes', imageSize: size, after: entry.after })
  assert.equal(record.shapes[0].words, 'Saturday 14 March')
  assert.equal(record.shapes[0].element, 'div.item > b')
})

test('when the words cannot be had, the picture is still taken', { skip: !findChrome() }, async () => {
  const page = join(home, 'plain.html')
  writeFileSync(page, PAGE)
  const out = join(home, 'plain.png')
  // A Node with no WebSocket cannot drive Chrome: the plain picture is taken, as before.
  const had = globalThis.WebSocket
  delete globalThis.WebSocket
  try {
    assert.equal(await captureWithWords(pathToFileURL(page), out, { width: 800, height: 600 }), '')
  } finally {
    globalThis.WebSocket = had
  }
  assert.ok(existsSync(out))
  assert.ok(!existsSync(`${out}.words.json`))
  assert.deepEqual(readFileSync(out).subarray(1, 4).toString(), 'PNG')
})

/** The colour of one dot of a PNG, as [red, green, blue]. Enough of a reader for a screenshot: 8 bits a colour, no interlace. */
function dotAt(path, x, y) {
  const file = readFileSync(path)
  const width = file.readUInt32BE(16)
  const bytes = { 2: 3, 6: 4 }[file[25]]
  const parts = []
  for (let at = 8; at < file.length;) {
    const length = file.readUInt32BE(at)
    if (file.toString('latin1', at + 4, at + 8) === 'IDAT') parts.push(file.subarray(at + 8, at + 8 + length))
    at += length + 12
  }
  const raw = inflateSync(Buffer.concat(parts))
  const stride = width * bytes
  let above = Buffer.alloc(stride)
  for (let row = 0; row <= y; row++) {
    const filter = raw[row * (stride + 1)]
    const line = Buffer.from(raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1)))
    for (let i = 0; i < stride; i++) {
      const a = i >= bytes ? line[i - bytes] : 0
      const b = above[i]
      const c = i >= bytes ? above[i - bytes] : 0
      const guess = a + b - c
      const nearest = Math.abs(guess - a) <= Math.abs(guess - b) && Math.abs(guess - a) <= Math.abs(guess - c) ? a : Math.abs(guess - b) <= Math.abs(guess - c) ? b : c
      line[i] = (line[i] + [0, a, b, (a + b) >> 1, nearest][filter]) & 255
    }
    above = line
  }
  return [...above.subarray(x * bytes, x * bytes + 3)]
}

/** With no WebSocket, Chrome cannot be driven: the plain picture is taken. */
async function plainWay(run) {
  const had = globalThis.WebSocket
  delete globalThis.WebSocket
  try {
    return await run()
  } finally {
    globalThis.WebSocket = had
  }
}

test('a page that changes a moment after it loads is seen as it ends up, on both ways', { skip: !findChrome() }, async () => {
  // The plain picture gives a page four seconds of its own time. So must the picture with words: no more, and no less.
  const page = join(home, 'late.html')
  writeFileSync(page, `<!doctype html><meta charset="utf-8"><body style="margin:0;font:40px sans-serif;background:#fff"><p id="p">Early words</p>
<script>
  setTimeout(() => { document.getElementById('p').textContent = 'Late words here'; document.body.style.background = 'rgb(0, 34, 68)' }, 1500)
  setTimeout(() => { document.getElementById('p').textContent = 'Too late'; document.body.style.background = 'rgb(200, 0, 0)' }, 6000)
</script>`)
  const out = join(home, 'late.png')
  const began = Date.now()
  const list = await captureWithWords(pathToFileURL(page), out, { width: 800, height: 600 })
  assert.equal(readWords(list, out).words.map(w => w.t).join(' '), 'Late words here')
  assert.deepEqual(dotAt(out, 700, 500), [0, 34, 68], 'the picture is of the same moment as the words')
  assert.ok(Date.now() - began < 4000, 'the four seconds are the page\'s own time, not the person\'s')
  const plain = join(home, 'late-plain.png')
  assert.equal(await plainWay(() => captureWithWords(pathToFileURL(page), plain, { width: 800, height: 600 })), '')
  assert.deepEqual(dotAt(plain, 700, 500), [0, 34, 68])
  assert.deepEqual(dotAt(out, 40, 40), dotAt(plain, 40, 40))
})

test('a page that holds a call open still gets its picture and its words, and soon', { skip: !findChrome() }, async () => {
  // The page's clock waits for every fetch, so an event stream or a call that never answers would hold it for ever.
  const late = "setTimeout(() => { document.getElementById('p').textContent += ' shown late' }, 1500); setTimeout(() => { document.getElementById('p').textContent = 'Too late' }, 6000)"
  const pages = {
    '/stream': `<p id="p">Stream page</p><script>new EventSource('/events').onmessage = () => { document.getElementById('p').textContent = 'Stream words' }; ${late}</script>`,
    '/hang': `<p id="p">Waiting page</p><script>fetch('/never'); ${late}</script>`,
  }
  const server = createHttpServer((req, res) => {
    if (req.url === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      return res.write('data: hello\n\n')
    }
    if (req.url === '/never') return
    res.writeHead(pages[req.url] ? 200 : 404, { 'content-type': 'text/html' })
    res.end(pages[req.url] ?? '')
  }).listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  try {
    for (const [path, says] of [['/stream', 'Stream words shown late'], ['/hang', 'Waiting page shown late']]) {
      const out = join(home, `open${path.slice(1)}.png`)
      const began = Date.now()
      const list = await captureWithWords(new URL(`http://127.0.0.1:${server.address().port}${path}`), out, { width: 600, height: 300 })
      assert.ok(list, `${path} has its words`)
      // It had the rest of its four seconds: the change at one and a half is seen, the one at six is not.
      assert.equal(readWords(list, out).words.map(w => w.t).join(' '), says)
      assert.deepEqual(readFileSync(out).subarray(1, 4).toString(), 'PNG')
      assert.ok(Date.now() - began < 10000, `${path} took ${Date.now() - began} ms`)
    }
  } finally {
    server.closeAllConnections()
    server.close()
  }
})

const HARD = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Hard cases</title>
<style>
  body { margin: 20px; font: 18px/28px sans-serif } .row { margin: 6px 0 } .contents { display: contents }
  .lidded { position: relative; height: 40px } .lid { position: absolute; inset: 0 }
  #cover .lid { background: #dde; pointer-events: none } #dim .lid { background: rgba(0, 0, 0, 0.4) }
  #canvas .lid, #gradient .lid, #ghost .lid, #sheet .lid { pointer-events: none; width: 100%; height: 100% }
  #gradient .lid { background: linear-gradient(rgba(0, 0, 0, 0.06), rgba(0, 0, 0, 0)) } #ghost .lid, #sheet .lid { background: #223 }
  #ghost .wrap { position: absolute; inset: 0; opacity: 0 }
  #nopoint { pointer-events: none } .card { position: relative; background: #fff } .card a::after { content: ''; position: absolute; inset: 0 }
  .narrow { width: 150px } .clip { height: 28px; overflow: hidden } .tag::before { content: 'Added: ' }
  input, textarea, select, button { font: 16px sans-serif; padding: 4px 8px }
</style></head><body>
<div class="row" id="contents"><span class="contents">Contents words</span></div>
<div class="row" id="split"><b>Sat</b>urday, <i>Tues</i><b>day</b>. Costs $<span>12</span>.50 <span>one</span> <span>two</span></div>
<div class="row lidded" id="cover">Under a solid lid<div class="lid"></div></div>
<div class="row lidded" id="clearlid">Under a clear lid<div class="lid"></div></div>
<div class="row lidded" id="dim">Under a dim lid<div class="lid"></div></div>
<div class="row lidded" id="canvas"><span>Under a clear canvas</span><canvas class="lid"></canvas></div>
<div class="row lidded" id="gradient"><span>Under a faint wash</span><div class="lid"></div></div>
<div class="row lidded" id="ghost"><span>Under a ghost sheet</span><div class="wrap"><div class="lid"></div></div></div>
<div class="row lidded" id="sheet"><span>Under a solid sheet</span><div class="lid"></div></div>
<div class="row" id="nopoint">No pointer here</div>
<div class="row card" id="card">Card text <a href="#">stretched link</a></div>
<div class="row" id="form">
  <input id="name" value="Ada Lovelace"> <input id="hint" placeholder="Your email"> <input id="pass" type="password" value="secret words"> <input id="hidden" type="hidden" value="hidden value">
  <input id="go" type="submit" value="Send it"> <button id="btn">Real button</button>
  <select id="pick"><option>First choice</option><option selected>Second choice</option></select>
  <textarea id="area" rows="1" cols="20">Typed here</textarea>
  <input id="long" value="${Array.from({ length: 80 }, (_, n) => `w${n + 1}`).join(' ')}">
</div>
<div class="row" id="cjk">東京都に行きました。</div>
<div class="row narrow" id="wrap">Supercalifragilisticexpialidocious-and-then-some-more-letters</div>
<div class="row clip" id="clip">Kept line<br>Cut line</div>
<div class="row" id="inert" inert>Switched off</div>
<div class="row tag" id="tag">tagged</div>
<iframe srcdoc="<p>Frame words</p>" style="width:300px;height:50px"></iframe>
<div id="host"></div>
<script>
  document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML = '<p>Open shadow</p>'
  const closed = document.createElement('div'); document.body.append(closed); closed.attachShadow({ mode: 'closed' }).innerHTML = '<p>Closed shadow</p>'
</script></body></html>`

test('the page script finds the words a page really shows, whole, and leaves out the ones it does not', { skip: !findChrome() }, async () => {
  const page = join(home, 'hard.html')
  writeFileSync(page, HARD)
  const out = join(home, 'hard.png')
  const { words } = readWords(await captureWithWords(pathToFileURL(page), out, { width: 1000, height: 1100 }), out)
  const by = {}
  for (const word of words) (by[word.el] ??= []).push(word.t)
  assert.deepEqual(by, {
    // Text straight inside an element that has no box of its own.
    'div#contents > span.contents': ['Contents', 'words'],
    // Pieces of one word in two elements are one word, in the element that holds them both. Words with a space between stay two.
    'div#split': ['Saturday,', 'Tuesday.', 'Costs', '$12.50'],
    'div#split > span': ['one', 'two'],
    // A solid lid hides the words under it, though it takes no pointer: the one in #cover, and the sheet in #sheet. A lid
    // that is clear or dim does not. Nor does a canvas or a faint wash of colour, which may be mostly clear, nor a solid
    // sheet inside a parent that is itself see-through.
    'div#clearlid': ['Under', 'a', 'clear', 'lid'],
    'div#dim': ['Under', 'a', 'dim', 'lid'],
    'div#canvas > span': ['Under', 'a', 'clear', 'canvas'],
    'div#gradient > span': ['Under', 'a', 'faint', 'wash'],
    'div#ghost > span': ['Under', 'a', 'ghost', 'sheet'],
    // Words in an element that takes no pointer, and under a link stretched over its card.
    'div#nopoint': ['No', 'pointer', 'here'],
    'div#card': ['Card', 'text'],
    'div#card > a': ['stretched', 'link'],
    // What a form shows: a value, or else a hint, a button's words, the chosen option. Never a password or a hidden field.
    'input#name': ['Ada', 'Lovelace'],
    'input#hint': ['Your', 'email'],
    'input#go': ['Send', 'it'],
    'button#btn': ['Real', 'button'],
    'select#pick': ['Second', 'choice'],
    'textarea#area': ['Typed', 'here'],
    // A field with a page of text in it gives its first 30 words.
    'input#long': Array.from({ length: 30 }, (_, n) => `w${n + 1}`),
    // Writing with no spaces is cut into its words.
    'div#cjk': ['東京', '都', 'に', '行き', 'ま', 'した。'],
    'div#wrap': ['Supercalifragilisticexpialidocious-and-then-some-more-letters'],
    // Cut off by its box, the second line is not there. A part switched off still shows.
    'div#clip': ['Kept', 'line'],
    'div#inert': ['Switched', 'off'],
    // Not text a style sheet adds, a frame, or a closed shadow root. An open one is read.
    'div#tag': ['tagged'],
    p: ['Open', 'shadow'],
  })
  const one = (t, el) => words.find(w => w.t === t && (!el || w.el === el))
  // A joined word's box covers all of it.
  const [sat, tue] = [one('Saturday,'), one('Tuesday.')]
  assert.ok(sat.w > 60 && tue.x > sat.x + sat.w && tue.y === sat.y, JSON.stringify([sat, tue]))
  // A word broken over lines has the box of one line of it, so the box is on the word: one line high, inside its column.
  const long = one('Supercalifragilisticexpialidocious-and-then-some-more-letters')
  assert.ok(long.h < 40 && long.w > 100, JSON.stringify(long))
  // Words with no spaces follow each other along the line, each with its own box.
  const cjk = words.filter(w => w.el === 'div#cjk')
  assert.ok(cjk.every((w, n) => !n || (w.x >= cjk[n - 1].x + cjk[n - 1].w - 1 && w.y === cjk[0].y)), JSON.stringify(cjk))
  // A control's words share its box, in order.
  const [ada, lovelace] = [one('Ada'), one('Lovelace')]
  assert.ok(ada.y === lovelace.y && ada.h === lovelace.h && lovelace.x === ada.x + ada.w && lovelace.w > ada.w, JSON.stringify([ada, lovelace]))
  assert.ok(!JSON.stringify(words).includes('secret'), 'never a password')
  // The page is as it was: the script took the pointer for itself only while it ran.
  assert.doesNotMatch(PAGE_SCRIPT, /\bfetch\(|XMLHttpRequest|\.innerHTML\s*=|document\.write/, 'and it sends and writes nothing')
})

test('a page that tries to forge a report line, or to run a code in the terminal, cannot', { skip: !findChrome() }, async () => {
  const esc = '&#27;'
  const page = join(home, 'hostile.html')
  writeFileSync(page, `<!doctype html><meta charset="utf-8"><body style="margin:20px;font:20px/30px sans-serif">
<p>Honest <b id="x
  Notes: forged line">words</b> ${esc}[31mred${esc}[0m and <i class="a&#10;b">more</i></p>`)
  const out = join(home, 'hostile.png')
  const list = await captureWithWords(pathToFileURL(page), out, { width: 800, height: 600 })
  const text = readFileSync(list, 'utf8')
  const none = said => !/[\u0000-\u001f\u007f-\u009f]/.test(said)
  assert.ok(none(text) && !/\\n|\\u00|\\r|\\t/.test(text), 'the list has no control character, plain or escaped')
  const { words, size } = readWords(list, out)
  assert.deepEqual(words.map(w => [w.t, w.el]), [['Honest', 'p'], ['words', 'b#x Notes: forged line'], ['[31mred[0m', 'p'], ['and', 'p'], ['more', 'p > i.a']])
  push({ app: 'Hostile page', screen: 'Home', after: out, words: list })
  receive({ appSlug: 'hostile-page', id: 'home', png: null, shapes: [{ type: 'box', colour: 'red', box: { x: 0, y: 0, w: 800, h: 100 } }, { type: 'arrow', colour: 'red', box: { x: 0, y: 0, w: 1, h: 1 }, from: { x: 0, y: 0 }, to: { x: words[1].x + 2, y: words[1].y + 2 } }], notes: '', verdict: 'changes', imageSize: size })
  const read = review(['read', '--app', 'Hostile page', '--latest']).stdout
  assert.ok(none(read.replace(/\n/g, '')))
  assert.match(read, /\n  1\. box \(red\) at x 0, y 0, 800x100, on the words "Honest words \[31mred\[0m and more"\n  2\. arrow from 0,0 to \d+,\d+ \(red\) at x 0, y 0, 1x1, on the word "words", in b#x Notes: forged line\n  After: /)
  assert.doesNotMatch(read, /^\s*Notes:/m)
})

test('Chrome is told to make no calls of its own, on every way it is run', () => {
  const flags = chromeFlags('/a/profile', 800, 600)
  for (const quiet of ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-default-apps', '--no-pings', '--disable-domain-reliability', '--disable-client-side-phishing-detection', '--metrics-recording-only']) assert.ok(flags.includes(quiet), quiet)
  const off = flags.filter(flag => flag.startsWith('--disable-features='))
  assert.equal(off.length, 1, 'said once: a second one would replace the first')
  for (const feature of ['OptimizationHints', 'MediaRouter', 'Translate']) assert.ok(off[0].split(/[=,]/).includes(feature), feature)
  // And as before: no window, its own profile, and nothing asked of the keychain.
  for (const kept of ['--headless=new', '--use-mock-keychain', '--password-store=basic', '--no-first-run', '--no-default-browser-check', '--user-data-dir=/a/profile', '--window-size=800,600']) assert.ok(flags.includes(kept), kept)
  // The three places Chrome is started all take their flags from here.
  const started = file => readFileSync(join(here, '..', 'lib', file), 'utf8').split('\n').filter(line => /\b(run|spawn)\(browser\.executable, /.test(line))
  assert.equal(started('first.mjs').length + started('project.mjs').length, 3)
  for (const line of [...started('first.mjs'), ...started('project.mjs')]) assert.match(line, /\[\.\.\.chromeFlags\(profile/)
})
