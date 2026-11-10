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

import { spawn } from 'node:child_process'
import { closeSync, existsSync, openSync, readSync } from 'node:fs'
import { delimiter, extname, join } from 'node:path'
import { IMAGES, wordsNameFor, writeAtomic } from './store.mjs'
import { checkWords, pictureSize } from './words.mjs'

/** The first read on a Mac loads the reader, which takes about ten seconds. A picture that takes longer than this is let go. */
const MOST_TIME = 60000
/** How tall a band of a tall picture the Mac reads at a time, and how much each band overlaps the next, in pixels. */
const BAND = 1600
const OVERLAP = 200
/** The most a reader may print: a list of the most words is well under this. */
const MOST_OUTPUT = 50 * 1024 * 1024

/**
 * Runs a reader and gives what it printed. When its time is up it is killed outright, and the answer comes at once whatever
 * the tool does then: a tool that ignores being asked to stop must not hold up every read after it. A tool that is not
 * there fails with the code ENOENT.
 */
/** Readers running now, so a server that stops can stop them too. */
const running = new Set()

/**
 * Stops every reader that is running: asked first, then killed if it has not gone in half a second. For a server that stops,
 * so no reader goes on working, or holding the computer, after it.
 */
export async function stopReading() {
  const left = [...running]
  for (const child of left) child.kill('SIGTERM')
  const gone = child => child.exitCode !== null || child.signalCode !== null
  for (let waited = 0; waited < 500 && !left.every(gone); waited += 25) await new Promise(resolve => setTimeout(resolve, 25))
  for (const child of left) if (!gone(child)) child.kill('SIGKILL')
}

function runTool(command, args, timeout) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      running.add(child)
      child.on('exit', () => running.delete(child))
    } catch (error) {
      return reject(error)
    }
    const out = []
    let size = 0
    let done = false
    const end = (error, value) => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (error) {
        child.kill('SIGKILL')
        reject(error)
      } else resolve(value)
    }
    const timer = setTimeout(() => end(Object.assign(new Error('The reader took too long.'), { killed: true })), timeout)
    child.stdout.on('data', chunk => {
      size += chunk.length
      if (size > MOST_OUTPUT) end(new Error('The reader printed too much.'))
      else out.push(chunk)
    })
    child.stderr.resume()
    child.on('error', error => end(error))
    child.on('close', code => (code === 0 ? end(null, { stdout: Buffer.concat(out).toString('utf8') }) : end(new Error(`The reader stopped with ${code}.`))))
  })
}

/**
 * The orientation a JPEG says it is to be shown in (EXIF tag 0x0112), 1 when it says none or is not a JPEG. A viewer turns
 * such a picture; tesseract reads its pixels as they are stored, so its boxes would be in the wrong places.
 */
export function jpegOrientation(path) {
  let head
  try {
    head = Buffer.alloc(65536)
    const file = openSync(path, 'r')
    try {
      head = head.subarray(0, readSync(file, head, 0, head.length, 0))
    } finally {
      closeSync(file)
    }
  } catch {
    return 1
  }
  if (head[0] !== 0xff || head[1] !== 0xd8) return 1
  for (let at = 2; at + 4 <= head.length && head[at] === 0xff;) {
    const marker = head[at + 1]
    const length = head.readUInt16BE(at + 2)
    if (marker === 0xe1 && head.toString('latin1', at + 4, at + 10) === 'Exif\0\0') {
      const tiff = at + 10
      const big = head.toString('latin1', tiff, tiff + 2) === 'MM'
      const u16 = n => (big ? head.readUInt16BE(n) : head.readUInt16LE(n))
      const u32 = n => (big ? head.readUInt32BE(n) : head.readUInt32LE(n))
      try {
        const ifd = tiff + u32(tiff + 4)
        for (let n = 0; n < u16(ifd); n++) if (u16(ifd + 2 + n * 12) === 0x0112) return u16(ifd + 2 + n * 12 + 8) || 1
      } catch {
        return 1
      }
      return 1
    }
    if (marker === 0xda) break
    at += 2 + length
  }
  return 1
}
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
  const tile = Number(argv[1]), overlap = Number(argv[2])
  const handler = $.VNImageRequestHandler.alloc.initWithURLOptions(url, $.NSDictionary.dictionary)
  const words = []
  // The reader shrinks what it is given to a size of its own, so the small type of a tall page would be lost. A tall picture
  // is read a band at a time. Bands overlap, so a line cut by the edge of one is whole in the next: a word near a cut edge is
  // left to the other band. Words in the overlap come from both bands, and the doubles are taken out afterwards.
  for (let top = 0; top < H; top += tile - overlap) {
    const bottom = H - top <= tile + overlap ? H : top + tile
    const request = $.VNRecognizeTextRequest.alloc.init
    // 0 is the careful reader, not the quick one: the quick one misreads small type in a screenshot. Language correction would
    // "correct" names, codes and addresses, which a screen is full of.
    request.recognitionLevel = 0
    request.usesLanguageCorrection = false
    // The band, from the bottom left as parts of the picture. Boxes come back as parts of the band.
    request.regionOfInterest = $.CGRectMake(0, (H - bottom) / H, 1, (bottom - top) / H)
    if (!handler.performRequestsError($.NSArray.arrayWithObject(request), null)) return 'failed'
    // Near a cut edge the reader sees only part of a line, and reads it as something else: what is there is left to the other
    // band, which holds it whole, since the bands overlap by four times this.
    const from = top ? top + overlap / 4 : 0
    const to = bottom < H ? bottom - overlap / 4 : H
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
        const high = bottom - top
        const word = { t: found[0], x: Math.round(b.origin.x * W), y: top + Math.round((1 - b.origin.y - b.size.height) * high), w: Math.max(1, Math.round(b.size.width * W)), h: Math.max(1, Math.round(b.size.height * high)) }
        if (word.y >= from && word.y + word.h <= to) words.push(word)
      }
    }
    if (bottom === H) break
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

/**
 * The words with each read twice taken out: the bands of a tall picture overlap, so a word there is read by both. Two words are
 * one when they say the same and most of the smaller box lies in the other.
 */
export function withoutDoubles(words) {
  const kept = new Map()
  const out = []
  for (const word of words) {
    const same = kept.get(word.t) ?? []
    const double = same.some(other => {
      const w = Math.min(word.x + word.w, other.x + other.w) - Math.max(word.x, other.x)
      const h = Math.min(word.y + word.h, other.y + other.h) - Math.max(word.y, other.y)
      return w > 0 && h > 0 && w * h >= Math.min(word.w * word.h, other.w * other.h) / 2
    })
    if (double) continue
    kept.set(word.t, [...same, word])
    out.push(word)
  }
  return out
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

/** The words in lines, top to bottom: a word is on the line its middle is in. Each line: { words, top, high }. */
function linesOf(words) {
  const lines = []
  for (const word of [...words].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2))) {
    const line = lines.at(-1)
    if (line && word.y + word.h / 2 <= line.bottom) {
      line.words.push(word)
      line.bottom = Math.max(line.bottom, word.y + word.h * 0.75)
    } else lines.push({ words: [word], bottom: word.y + word.h })
  }
  return lines.map(line => ({ words: line.words, top: Math.min(...line.words.map(w => w.y)), high: Math.max(1, middle(line.words.map(w => w.h))) }))
}

/**
 * How far apart the lines of these words mostly are, as so many line heights (the lower middle of the gaps from each line's
 * top to the next): about one in a paragraph or a card, two or more between the rows of a table. Infinity for one line.
 */
function spacing(words) {
  const lines = linesOf(words)
  const steps = lines.slice(1).map((line, n) => (line.top - lines[n].top) / Math.max(line.high, lines[n].high)).sort((a, b) => a - b)
  return steps.length ? steps[(steps.length - 1) >> 1] : Infinity
}
/** A block: several lines set close, one under the next. */
const isBlock = words => spacing(words) < 1.5

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
 *   a table, whose lines go straight across its columns and whose rows stand apart, reads a row at a time. Blocks side by
 *   side whose lines sit close together (cards in a row) are read one after the other.
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
    // A line on its own just under a row of blocks, running on under two of them across the gap between (notes under a row
    // of cards), comes after all of that row, not between two of its blocks.
    const under = bands.findIndex((band, n) => {
      if (!n || !oneLine(band)) return false
      const blocks = apartBy(runsAlong(bands[n - 1], 'x', 'w'), tall * 1.5)
      const from = Math.min(...band.map(w => w.x))
      const to = Math.max(...band.map(w => w.x + w.w))
      // Blocks are a few lines set close: two columns of a form are not, and a line under a form stays where it is.
      return blocks.slice(1).some((block, k) => isBlock(blocks[k]) && isBlock(block) && from < Math.max(...blocks[k].map(w => w.x + w.w)) && to > Math.min(...block.map(w => w.x)))
    })
    if (under >= 0) return [bands.slice(0, under).flat(), bands[under], bands.slice(under + 1).flat()].filter(part => part.length).forEach(order)
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
      // Every column level with the next. Lines set close, one under the next as in a paragraph, are blocks side by side
      // (cards in a row): each is read through before the next. Lines set further apart than that, row after row on the
      // same lines across the columns, are a table or a form, read a row at a time however close its rows are.
      // How close each column sets two of its lines at the closest, as so many line heights: a block has lines one under the
      // next (well under one and a half), while a table's rows stand apart, even a dense one's.
      const closest = parts.map(part => {
        const lines = linesOf(part)
        return Math.min(Infinity, ...lines.slice(1).map((line, n) => (line.top - lines[n].top) / Math.max(line.high, lines[n].high)))
      }).filter(Number.isFinite)
      // Only within one band: where rows stand apart across the whole width, the bands come first.
      if (bands.length === 1 && closest.length && middle(closest) < 1.5) return parts.forEach(order)
      if (bands.length === 1 && rows.runs.length > 1) return rows.runs.forEach(order)
    }
    if (bands.length > 1) return bands.forEach(order)
    if (rows.runs.length > 1) return rows.runs.forEach(order)
    // Lines that touch: along each line.
    for (const line of linesOf(group)) out.push(...line.words.sort((a, b) => a.x - b.x))
  }
  order(words)
  return out
}

const missing = error => error.code === 'ENOENT'

/** A command this computer has: a path to it, or a name found on the PATH. On Windows a command has an ending (.exe). */
function isCommand(name) {
  const endings = process.platform === 'win32' ? ['', ...String(process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)] : ['']
  const there = path => endings.some(ending => existsSync(path + ending) || existsSync(path + ending.toLowerCase()))
  return /[\\/]/.test(name) ? there(name) : String(process.env.PATH ?? '').split(delimiter).some(dir => dir && there(join(dir, name)))
}
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
export async function readPicture(path, { timeout = MOST_TIME } = {}) {
  const withTesseract = async () => {
    // A turned JPEG would get boxes for its pixels as stored, not as shown. The Mac's reader turns it first; tesseract does not.
    if (jpegOrientation(path) !== 1) throw new Error('tesseract cannot read a turned JPEG.')
    // Sparse text: a screen is labels and buttons here and there, not a page of prose.
    const { stdout } = await runTool(process.env.REVIEW_TESSERACT || 'tesseract', [path, 'stdout', '--psm', '11', 'tsv'], timeout)
    return wordsFromTsv(stdout)
  }
  const withMac = async () => {
    const { stdout } = await runTool('osascript', ['-l', 'JavaScript', '-e', MAC_SCRIPT, path, String(BAND), String(OVERLAP)], timeout)
    if (['unreadable', 'failed'].includes(stdout.trim())) throw new Error('The picture could not be read.')
    return JSON.parse(stdout)
  }
  // The Mac's own reader first where there is one: it is always there. Anywhere else, tesseract. A stand-in named for tests
  // is the only way.
  const ways = process.env.REVIEW_TESSERACT ? [withTesseract] : process.platform === 'darwin' ? [withMac, withTesseract] : [withTesseract]
  // A tool that is there and fails leaves the next to try. Its fault is said only when no other tool reads the picture.
  let failure = null
  for (const way of ways) {
    let said
    try {
      said = await way()
    } catch (error) {
      if (!missing(error)) failure ??= error
      continue
    }
    // The picture's own size where it says it: the tool's is only as good as how it rounds.
    const size = pictureSize(path) ?? said.size
    if (!size) throw new Error('The reader did not say how big the picture is.')
    const list = checkWords({ size, words: said.words ?? [] })
    return { size: list.size, words: readingOrder(withoutDoubles(list.words)), read: true }
  }
  if (failure) throw failure
  return null
}

/** A picture the store keeps, by the name the page knows it by. Only these are read: never a path from anywhere else. */
const KEPT_PICTURE = /^[a-z0-9-]+\/[a-z0-9-]+-after-\d+\.[A-Za-z0-9]+$/
/** Kinds of picture a reader can take. A drawing (SVG) is not pixels, and its words are better read from its text. */
const READABLE = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.heic'])

/**
 * Pictures someone wants read: after → { after, name, askedAt }. The page asks again every second or so while a picture is on
 * show, so a picture asked about a while ago has been left, and is let go unread.
 */
const wanted = new Map()
/** How long after the last ask a picture is still wanted. */
const STILL_WANTED = 10000
/** The most pictures waiting at once: moving fast through many screens must not queue them all. */
const MOST_WAITING = 8
/** Pictures that could not be read in this run of the server: after → why. Not asked of the reader again until it restarts. */
const ended = new Map()
let reading = null
/** This computer has nothing to read with: known after the first try, so the page is told at once. */
let noReader = false

/**
 * The word list for a picture the store keeps, as `after` names it ('app/home-after-123.png'). It answers at once and never
 * waits on the reader, so asking can never hold up the page: { words } with the list's name beside the picture when it is
 * there, { words: '', reading: true } while it is being read (ask again), or { words: '', why } when there will be none:
 * 'none' (no tool here), 'failed', or 'not-readable'. A list given with the push, or read earlier, is found first. Pictures
 * are read one at a time, the one asked about last first, since that is the one on show.
 */
export function wordsForPicture(after) {
  const name = KEPT_PICTURE.test(String(after)) ? wordsNameFor(after) : ''
  if (!name || !READABLE.has(extname(after).toLowerCase())) return { words: '', why: 'not-readable' }
  if (existsSync(join(IMAGES, name))) return { words: name }
  if (ended.has(after)) return { words: '', why: ended.get(after) }
  if (noReader || !hasReader()) return { words: '', why: 'none' }
  // Asked again or for the first time: it is the newest.
  wanted.delete(after)
  wanted.set(after, { after, name, askedAt: Date.now() })
  for (const old of [...wanted.keys()].slice(0, -MOST_WAITING)) wanted.delete(old)
  readNext()
  return { words: '', reading: true }
}

/** Settles when nothing is being read and nothing waits. For tests, and for a server that stops. */
export async function readingDone() {
  while (reading) await reading
}

function readNext() {
  if (reading) return
  const now = Date.now()
  for (const [after, job] of wanted) if (now - job.askedAt > STILL_WANTED) wanted.delete(after)
  const job = [...wanted.values()].at(-1)
  if (!job) return
  reading = readOne(job).finally(() => {
    wanted.delete(job.after)
    reading = null
    readNext()
  })
}

async function readOne({ after, name }) {
  const picture = join(IMAGES, after)
  if (!existsSync(picture)) return ended.set(after, 'not-readable')
  try {
    const list = await readPicture(picture)
    if (!list) {
      noReader = true
      return
    }
    // Kept even with no words in it, so a picture with nothing to read is not read again.
    writeAtomic(join(IMAGES, name), JSON.stringify(list))
  } catch {
    // Not kept on disk: a later run of the server tries again.
    ended.set(after, 'failed')
  }
}
