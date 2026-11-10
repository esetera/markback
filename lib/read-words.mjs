/**
 * Words read off a bare picture. Agents mostly push screenshots with no word list, and then a mark says where and not what. So
 * when the review page shows such a picture, the server reads its words here, with a tool this computer already has: the Mac's
 * own text reader (Vision), or tesseract anywhere. Nothing is sent anywhere and nothing is fetched. With neither, the picture
 * has no list, as before.
 *
 * A read list is a guess, so it says so ("read": true). A list given with the push, or made from the page or the PDF the
 * picture came from, is exact: it is kept under the same name, so it is always found first and a picture that has one is
 * never read.
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, extname, join } from 'node:path'
import { promisify } from 'node:util'
import { IMAGES, wordsNameFor, writeAtomic } from './store.mjs'
import { checkWords, pictureSize } from './words.mjs'

const run = promisify(execFile)
/** The first read on a Mac loads the reader, which takes about ten seconds. A picture that takes longer than this is let go. */
const MOST_TIME = 60000
/** tesseract gives each word how sure it is, 0 to 100. Below this it is mostly a guess at an icon or a line. */
const LEAST_SURE = 30

/**
 * The Mac's text reader, driven through the script runner every Mac has. Prints the word list: each word with its box in the
 * picture's pixels. The reader gives a line of text at a time, with boxes from the bottom left as parts of the picture, so each
 * word's box is asked for by its place in the line, and turned into pixels from the top left.
 */
const MAC_SCRIPT = `ObjC.import('Vision'); ObjC.import('AppKit')
function run(argv) {
  const url = $.NSURL.fileURLWithPath(argv[0])
  const rep = $.NSImageRep.imageRepWithContentsOfURL(url)
  if (rep.isNil()) return 'unreadable'
  const W = Number(rep.pixelsWide), H = Number(rep.pixelsHigh)
  if (!(W > 0 && H > 0)) return 'unreadable'
  const request = $.VNRecognizeTextRequest.alloc.init
  // 0 is the careful reader, not the quick one: the quick one misreads small type in a screenshot. Language correction would
  // "correct" names, codes and addresses, which a screen is full of.
  request.recognitionLevel = 0
  request.usesLanguageCorrection = false
  const handler = $.VNImageRequestHandler.alloc.initWithURLOptions(url, $.NSDictionary.dictionary)
  if (!handler.performRequestsError($.NSArray.arrayWithObject(request), null)) return 'failed'
  const words = []
  const lines = request.results
  const count = lines.isNil() ? 0 : Number(lines.count)
  for (let i = 0; i < count; i++) {
    const best = lines.objectAtIndex(i).topCandidates(1)
    if (!Number(best.count)) continue
    const line = best.objectAtIndex(0)
    const text = ObjC.unwrap(line.string) || ''
    const find = /\\S+/g
    for (let found = find.exec(text); found; found = find.exec(text)) {
      const where = line.boundingBoxForRangeError($.NSMakeRange(found.index, found[0].length), null)
      if (where.isNil()) continue
      const b = where.boundingBox
      words.push({ t: found[0], x: Math.round(b.origin.x * W), y: Math.round((1 - b.origin.y - b.size.height) * H), w: Math.max(1, Math.round(b.size.width * W)), h: Math.max(1, Math.round(b.size.height * H)) })
    }
  }
  return JSON.stringify({ size: { w: W, h: H }, words: words })
}`

/**
 * What `tesseract <picture> stdout tsv` prints, as a word list. Its first row of each page gives the picture's size, and each
 * row of level 5 is a word, with its box in pixels from the top left and how sure it is.
 */
export function wordsFromTsv(tsv) {
  let size = null
  const words = []
  for (const row of String(tsv).split('\n').slice(1)) {
    const cells = row.split('\t')
    if (cells.length < 12) continue
    const [level, , , , , , x, y, w, h, sure] = cells.map(Number)
    const t = cells.slice(11).join(' ').trim()
    if (level === 1 && !size) size = { w: x + w, h: y + h }
    if (level === 5 && t && sure >= LEAST_SURE && w > 0 && h > 0) words.push({ t, x, y, w, h })
  }
  return { size, words }
}

/** The middle one of some numbers. */
const middle = numbers => [...numbers].sort((a, b) => a - b)[numbers.length >> 1]

/**
 * The words along one direction, in runs that do not overlap, with the gap before each run after the first. `at` and `size`
 * are 'y' and 'h' for rows down the picture, 'x' and 'w' for columns across it.
 */
function runsAlong(words, at, size) {
  const sorted = [...words].sort((a, b) => a[at] - b[at])
  const runs = [[sorted[0]]]
  const gaps = []
  let end = sorted[0][at] + sorted[0][size]
  for (const word of sorted.slice(1)) {
    if (word[at] > end) {
      gaps.push(word[at] - end)
      runs.push([])
    }
    runs.at(-1).push(word)
    end = Math.max(end, word[at] + word[size])
  }
  return { runs, gaps }
}

/** The runs, with those closer than `least` put back together. */
const apartBy = ({ runs, gaps }, least) => runs.slice(1).reduce((out, run, n) => (gaps[n] >= least ? [...out, run] : [...out.slice(0, -1), [...out.at(-1), ...run]]), [runs[0]])

/** The words are one line: none is wholly above another, and together they are no taller than two of the tallest. */
const oneLine = words => runsAlong(words, 'y', 'h').runs.length === 1 && Math.max(...words.map(w => w.y + w.h)) - Math.min(...words.map(w => w.y)) <= 2 * Math.max(...words.map(w => w.h))

/**
 * The words in the order the words tool needs: it marks every word from the first pressed to the last, so words that read on
 * from each other must be next to each other in the list. A reader gives lines in its own order, so the picture is cut where
 * nothing is written, the way a page is laid out:
 *
 * - A single line across the top or the foot, set apart by at least a line's height and reaching across the columns under
 *   it, is a bar: it comes first or last.
 * - Then columns, where a gap down the picture is wider than a line and the columns keep lines of their own (a side panel
 *   beside a form). A drag down the form then marks the form, not the panel beside it.
 * - Then bands across it, at gaps at least a line high, and then lines. Inside a line the words go left to right. A form or
 *   a table, whose lines go straight across its columns, reads a row at a time.
 */
export function readingOrder(words) {
  if (words.length < 2) return words
  const tall = Math.max(1, middle(words.map(word => word.h)))
  const out = []
  const order = group => {
    if (group.length < 2) return out.push(...group)
    const rows = runsAlong(group, 'y', 'h')
    const columns = runsAlong(group, 'x', 'w')
    const across = Math.max(0, ...rows.gaps)
    const down = Math.max(0, ...columns.gaps)
    const bands = across >= tall ? apartBy(rows, tall) : [group]
    const parts = down >= tall * 1.5 ? apartBy(columns, tall * 1.5) : [group]
    // A bar is a line on its own that reaches across the columns under it. A line inside one column stays in it.
    const inPart = new Map(parts.flatMap((part, n) => part.map(word => [word, n])))
    const isBar = band => oneLine(band) && new Set(band.map(word => inPart.get(word))).size > 1
    // Lines on their own above a bar go with it: a title line over a page's top bar, say.
    let top = 0
    for (let n = 0; n < bands.length - 1 && oneLine(bands[n]); n++) if (isBar(bands[n])) top = n + 1
    if (top) return [...bands.slice(0, top), bands.slice(top).flat()].forEach(order)
    let foot = bands.length
    for (let n = bands.length - 1; n > 0 && oneLine(bands[n]); n--) if (isBar(bands[n])) foot = n
    if (foot < bands.length) return [bands.slice(0, foot).flat(), ...bands.slice(foot)].forEach(order)
    if (parts.length > 1) {
      // Columns whose lines go straight across from one to the next are a form or a table: they read a row at a time. Columns
      // that each keep their own lines, a side panel beside a form say, read one after the other.
      const tops = parts.map(part => runsAlong(part, 'y', 'h').runs.map(run => Math.min(...run.map(word => word.y))))
      const level = n => {
        const [fewer, more] = tops[n].length <= tops[n + 1].length ? [tops[n], tops[n + 1]] : [tops[n + 1], tops[n]]
        return fewer.filter(top => more.some(other => Math.abs(other - top) <= tall * 0.4)).length >= fewer.length * 0.6
      }
      const apart = parts.slice(1).reduce((out, part, n) => (level(n) ? [...out.slice(0, -1), [...out.at(-1), ...part]] : [...out, part]), [parts[0]])
      if (apart.length > 1) return apart.forEach(order)
    }
    if (bands.length > 1) return bands.forEach(order)
    if (rows.runs.length > 1) return rows.runs.forEach(order)
    // Lines that touch: a word is on the line its middle is in. Then along each line.
    const lines = []
    for (const word of [...group].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2))) {
      const line = lines.at(-1)
      if (line && word.y + word.h / 2 <= line.bottom) {
        line.words.push(word)
        line.bottom = Math.max(line.bottom, word.y + word.h * 0.75)
      } else lines.push({ words: [word], bottom: word.y + word.h })
    }
    for (const line of lines) out.push(...line.words.sort((a, b) => a.x - b.x))
  }
  order(words)
  return out
}

const missing = error => error.code === 'ENOENT'

/** A command this computer has: a path to it, or a name found on the PATH. */
const isCommand = name => (name.includes('/') ? existsSync(name) : String(process.env.PATH ?? '').split(delimiter).some(dir => dir && existsSync(join(dir, name))))
let reader = null
/**
 * Whether this computer has a tool to read words with, so the page can leave out a tool that could never work. Looked for once,
 * without running anything: every Mac has its reader, and anywhere else tesseract is on the PATH or not.
 */
export function hasReader() {
  reader ??= process.env.REVIEW_TESSERACT ? isCommand(process.env.REVIEW_TESSERACT) : (process.platform === 'darwin' && existsSync('/usr/bin/osascript')) || isCommand('tesseract')
  return reader
}

/**
 * The words in a picture, read off it on this computer: { size, words, read: true }, checked as any list is, in reading order.
 * Null when this computer has no tool to read with. Throws when the tool could not read this picture.
 */
export async function readPicture(path) {
  const withTesseract = async () => {
    // Sparse text: a screen is labels and buttons here and there, not a page of prose.
    const { stdout } = await run(process.env.REVIEW_TESSERACT || 'tesseract', [path, 'stdout', '--psm', '11', 'tsv'], { timeout: MOST_TIME, maxBuffer: 50 * 1024 * 1024 })
    return wordsFromTsv(stdout)
  }
  const withMac = async () => {
    const { stdout } = await run('osascript', ['-l', 'JavaScript', '-e', MAC_SCRIPT, path], { timeout: MOST_TIME, maxBuffer: 50 * 1024 * 1024 })
    if (['unreadable', 'failed'].includes(stdout.trim())) throw new Error('The picture could not be read.')
    return JSON.parse(stdout)
  }
  // The Mac's own reader first where there is one: it is always there. Anywhere else, tesseract. A stand-in named for tests
  // is the only way.
  const ways = process.env.REVIEW_TESSERACT ? [withTesseract] : process.platform === 'darwin' ? [withMac, withTesseract] : [withTesseract]
  for (const way of ways) {
    let said
    try {
      said = await way()
    } catch (error) {
      if (missing(error)) continue
      throw error
    }
    // The picture's own size where it says it: the tool's is only as good as how it rounds.
    const size = pictureSize(path) ?? said.size
    if (!size) throw new Error('The reader did not say how big the picture is.')
    const list = checkWords({ size, words: said.words ?? [] })
    return { size: list.size, words: readingOrder(list.words), read: true }
  }
  return null
}

/** A picture the store keeps, by the name the page knows it by. Only these are read: never a path from anywhere else. */
const KEPT_PICTURE = /^[a-z0-9-]+\/[a-z0-9-]+-after-\d+\.[A-Za-z0-9]+$/
/** Kinds of picture a reader can take. A drawing (SVG) is not pixels, and its words are better read from its text. */
const READABLE = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.heic'])

/** What each picture asked about in this run of the server came to, so it is read once: after → a promise of the answer. */
const answers = new Map()
/** Pictures waiting to be read, the newest last. */
const waiting = []
let reading = false
/** This computer has nothing to read with: known after the first try, so the page is told at once. */
let noReader = false

/**
 * The word list for a picture the store keeps, as `after` names it ('app/home-after-123.png'): { words } with the list's name
 * beside the picture, or { words: '', why } with why there is none: 'none' (no tool here), 'failed', or 'not-readable'. A
 * list already there, given with the push or read earlier, comes back at once. Otherwise the picture is read: one at a
 * time, and the picture asked for last first, since that is the one on show.
 */
export function wordsForPicture(after) {
  const name = KEPT_PICTURE.test(String(after)) ? wordsNameFor(after) : ''
  if (!name || !READABLE.has(extname(after).toLowerCase())) return Promise.resolve({ words: '', why: 'not-readable' })
  if (existsSync(join(IMAGES, name))) return Promise.resolve({ words: name })
  if (answers.has(after)) {
    // Asked again: it is on show again, so it goes to the front.
    const at = waiting.findIndex(job => job.after === after)
    if (at >= 0) waiting.push(...waiting.splice(at, 1))
    return answers.get(after)
  }
  if (noReader || !hasReader()) return Promise.resolve({ words: '', why: 'none' })
  const answer = new Promise(resolve => waiting.push({ after, name, resolve }))
  answers.set(after, answer)
  readNext()
  return answer
}

async function readNext() {
  if (reading || !waiting.length) return
  reading = true
  const job = waiting.pop()
  try {
    job.resolve(await readOne(job))
  } finally {
    reading = false
    readNext()
  }
}

async function readOne({ after, name }) {
  const picture = join(IMAGES, after)
  if (noReader) return { words: '', why: 'none' }
  if (!existsSync(picture)) return { words: '', why: 'not-readable' }
  try {
    const list = await readPicture(picture)
    if (!list) {
      noReader = true
      return { words: '', why: 'none' }
    }
    // Kept even with no words in it, so a picture with nothing to read is not read again.
    writeAtomic(join(IMAGES, name), JSON.stringify(list))
    return { words: name }
  } catch {
    // Not kept: a later run of the server tries again.
    return { words: '', why: 'failed' }
  }
}
