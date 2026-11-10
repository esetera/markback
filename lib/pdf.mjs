/**
 * A PDF in the review page: each page becomes a screen to mark. The pictures are made on this computer, by a tool it already
 * has: the Mac's own PDF engine, or pdftoppm (Poppler) anywhere. Nothing is sent anywhere. The same tool says where each word of
 * a page is, so a mark on the page can carry the words under it.
 */

import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { HOME, IMAGES, listScreens, push, removeScreen, screenId, slug } from './store.mjs'
import { pictureSize } from './words.mjs'

const run = promisify(execFile)
/** A book has hundreds of pages, and nobody marks hundreds: more are asked for by name. */
export const MOST_PAGES = 30
/** Dots per inch: twice the PDF's own size, so small type can be read and marked. */
const SHARP = 144

/**
 * The Mac's PDF engine, driven through the script runner every Mac has. Prints how many pages the PDF has. Beside each picture
 * it writes the page's words, each with its box in the picture's pixels. The engine gives a box in points from the bottom left
 * of the page as it is stored, so it is moved to the crop box, turned as the page is turned, and measured from the top.
 */
const MAC_SCRIPT = `ObjC.import('PDFKit'); ObjC.import('AppKit')
function run(argv) {
  const file = argv[0], dir = argv[1], from = Number(argv[2]), to = Number(argv[3]), scale = Number(argv[4])
  const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(file))
  if (doc.isNil()) return 'unreadable'
  const count = Number(doc.pageCount)
  for (let n = from; n <= Math.min(to, count); n++) {
    const page = doc.pageAtIndex(n - 1)
    const box = page.boundsForBox($.kPDFDisplayBoxCropBox)
    const turned = page.rotation % 180 !== 0
    const w = Math.round((turned ? box.size.height : box.size.width) * scale)
    const h = Math.round((turned ? box.size.width : box.size.height) * scale)
    const rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(null, w, h, 8, 4, true, false, $.NSCalibratedRGBColorSpace, 0, 0)
    const ctx = $.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep)
    $.NSGraphicsContext.saveGraphicsState
    $.NSGraphicsContext.setCurrentContext(ctx)
    $.NSColor.whiteColor.set
    $.NSRectFill($.NSMakeRect(0, 0, w, h))
    const t = $.NSAffineTransform.transform
    t.scaleBy(scale)
    t.concat
    page.drawWithBoxToContext($.kPDFDisplayBoxCropBox, ctx.CGContext)
    $.NSGraphicsContext.restoreGraphicsState
    rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $.NSDictionary.dictionary).writeToFileAtomically(dir + '/page-' + n + '.png', true)
    try {
      const text = ObjC.unwrap(page.string) || ''
      const bw = box.size.width, bh = box.size.height
      const turn = ((page.rotation % 360) + 360) % 360
      const place = (u, v) => (turn === 90 ? [v, u] : turn === 180 ? [bw - u, v] : turn === 270 ? [bh - v, bw - u] : [u, bh - v])
      const words = []
      const find = /\\S+/g
      for (let found = find.exec(text); found; found = find.exec(text)) {
        const b = page.selectionForRange($.NSMakeRange(found.index, found[0].length)).boundsForPage(page)
        if (!(b.size.width > 0 && b.size.height > 0)) continue
        const p = place(b.origin.x - box.origin.x, b.origin.y - box.origin.y)
        const q = place(b.origin.x - box.origin.x + b.size.width, b.origin.y - box.origin.y + b.size.height)
        words.push({ t: found[0], x: Math.round(Math.min(p[0], q[0]) * scale), y: Math.round(Math.min(p[1], q[1]) * scale), w: Math.max(1, Math.round(Math.abs(q[0] - p[0]) * scale)), h: Math.max(1, Math.round(Math.abs(q[1] - p[1]) * scale)) })
      }
      if (words.length) $(JSON.stringify({ size: { w: w, h: h }, words: words })).writeToFileAtomicallyEncodingError(dir + '/page-' + n + '.words.json', true, $.NSUTF8StringEncoding, null)
    } catch (error) {
      // A page with no words to give still has its picture.
    }
  }
  return String(count)
}`

/** Which pages someone asked for: "3", or "2-5". With nothing said, the first ones. */
export function pagesOf(text) {
  if (text === undefined || text === null || text === '' || text === true) return { from: 1, to: MOST_PAGES, chosen: false }
  const said = /^(\d+)(?:-(\d+))?$/.exec(String(text).trim())
  const from = said && Number(said[1])
  const to = said && Number(said[2] ?? said[1])
  if (!said || from < 1 || to < from || to > 99999) throw new Error('--pages takes one page, like 3, or a run of them, like 2-5.')
  return { from, to, chosen: true }
}

const missing = error => error.code === 'ENOENT'

/**
 * The Mac's engine splits some words. A pair of letters set tight comes as two words whose boxes touch ("W ater"), and a heading
 * with its letters spaced out comes as single letters. Both are put back together, so a mark carries the words as they read.
 */
export function joinSplitWords(words) {
  const sameLine = (a, b) => Math.abs(a.y - b.y) <= 2 && Math.abs(a.h - b.h) <= 2
  const gap = (a, b) => b.x - (a.x + a.w)
  const join = group => {
    const y = Math.min(...group.map(word => word.y))
    return { t: group.map(word => word.t).join(''), x: group[0].x, y, w: group.at(-1).x + group.at(-1).w - group[0].x, h: Math.max(...group.map(word => word.y + word.h)) - y }
  }
  const whole = []
  for (const word of words) {
    const last = whole.at(-1)
    if (last && sameLine(last, word) && word.x > last.x && gap(last, word) <= 0) whole[whole.length - 1] = join([last, word])
    else whole.push(word)
  }
  const out = []
  for (let at = 0; at < whole.length;) {
    // A run of one and two letter pieces on one line, close together.
    let end = at + 1
    const short = word => word.t.length <= 2
    while (end < whole.length && short(whole[end - 1]) && short(whole[end]) && sameLine(whole[end - 1], whole[end]) && gap(whole[end - 1], whole[end]) > 0 && gap(whole[end - 1], whole[end]) < whole[end].h * 0.6) end++
    const run = whole.slice(at, end)
    // Spaced letters are mostly single letters, four or more of them. A few short words in a row ("is it so") are left alone.
    if (run.length < 4 || run.filter(word => word.t.length === 1).length < run.length * 0.7) {
      out.push(whole[at++])
      continue
    }
    // The gap between words is much wider than the gap between letters.
    const gaps = run.slice(1).map((word, n) => gap(run[n], word))
    const usual = [...gaps].sort((a, b) => a - b)[gaps.length >> 1]
    let group = [run[0]]
    for (const [n, word] of run.slice(1).entries()) {
      if (gaps[n] > usual * 2 + 1) {
        out.push(join(group))
        group = []
      }
      group.push(word)
    }
    out.push(join(group))
    at = end
  }
  return out
}

const plain = text => text.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

/**
 * What `pdftotext -bbox` prints, as the words of each page in order: [{ size, words }]. It gives each word's box in points from
 * the top left of the page, and the picture has `scale` pixels to a point.
 */
export function wordsFromBbox(xhtml, scale) {
  return String(xhtml).split(/<page\b/).slice(1).map(page => {
    const size = { w: Math.ceil(Number(/\bwidth="([\d.]+)"/.exec(page)?.[1]) * scale), h: Math.ceil(Number(/\bheight="([\d.]+)"/.exec(page)?.[1]) * scale) }
    const words = [...page.matchAll(/<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)">([\s\S]*?)<\/word>/g)]
      .map(([, x1, y1, x2, y2, text]) => ({ t: plain(text).trim(), x: Math.round(x1 * scale), y: Math.round(y1 * scale), w: Math.round((x2 - x1) * scale), h: Math.round((y2 - y1) * scale) }))
      .filter(word => word.t && word.w > 0 && word.h > 0)
    return { size, words }
  })
}

/**
 * Pictures of these pages, in a folder: [{ page, path, words }], and how many pages the PDF has when the tool says. `words` is
 * the path of the page's word list, or '' when the page has no words that can be had (a scan, say).
 */
export async function pagePictures(file, dir, { from, to }) {
  let total = null
  const pdftoppm = process.env.REVIEW_PDFTOPPM || 'pdftoppm'
  const withPoppler = async () => {
    await run(pdftoppm, ['-png', '-r', String(SHARP), '-f', String(from), '-l', String(to), file, join(dir, 'page')], { timeout: 180000 })
    // pdfinfo comes with pdftoppm and says how many pages there are. Without it, the count stays unknown.
    total = await run(process.env.REVIEW_PDFINFO || 'pdfinfo', [file], { timeout: 30000 }).then(({ stdout }) => Number([...stdout.matchAll(/^Pages:\s+(\d+)\s*$/gm)].at(-1)?.[1]) || null, () => null)
    // pdftotext comes with pdftoppm too, and says where each word is. Without it the pages have their pictures and no words.
    const said = await run(process.env.REVIEW_PDFTOTEXT || 'pdftotext', ['-bbox', '-f', String(from), '-l', String(to), file, '-'], { timeout: 120000, maxBuffer: 200 * 1024 * 1024 }).then(({ stdout }) => stdout, () => '')
    for (const [n, list] of wordsFromBbox(said, SHARP / 72).entries()) if (list.words.length) writeFileSync(join(dir, `page-${from + n}.words.json`), JSON.stringify(list))
    return true
  }
  const withMac = async () => {
    const { stdout } = await run('osascript', ['-l', 'JavaScript', '-e', MAC_SCRIPT, file, dir, String(from), String(to), String(SHARP / 72)], { timeout: 180000 })
    if (stdout.trim() === 'unreadable') throw new Error(`${basename(file)} could not be read as a PDF.`)
    total = Number(stdout.trim()) || null
    for (let n = from; n <= to; n++) {
      const list = join(dir, `page-${n}.words.json`)
      if (!existsSync(list)) continue
      const said = JSON.parse(readFileSync(list, 'utf8'))
      writeFileSync(list, JSON.stringify({ ...said, words: joinSplitWords(said.words) }))
    }
    return true
  }
  // The Mac's own engine first where there is one: it is always there. Anywhere else, Poppler.
  const ways = process.env.REVIEW_PDFTOPPM ? [withPoppler] : process.platform === 'darwin' ? [withMac, withPoppler] : [withPoppler]
  let made = false
  for (const way of ways) {
    try {
      made = await way()
      break
    } catch (error) {
      if (missing(error)) continue
      if (error.message.startsWith(basename(file))) throw error
      // The tool's own last words when it has any. Never the command line, which is all a tool stopped part-way leaves.
      const said = String(error.stderr ?? '').trim().split('\n').pop()
      throw new Error(error.killed ? 'Drawing the pages took too long. Ask for fewer with --pages.' : `The pages could not be drawn${said ? `: ${said}` : '.'}`)
    }
  }
  if (!made) throw new Error('Showing a PDF needs pdftoppm on this computer (it comes with Poppler). Or make pictures of the pages yourself and push them with review push.')
  // pdftoppm pads the page number to the width of the last one; the number is all that matters.
  const pictures = readdirSync(dir)
    .map(name => ({ page: Number(/^page-0*(\d+)\.png$/.exec(name)?.[1]), path: join(dir, name) }))
    .filter(p => p.page >= from && p.page <= to)
    .sort((a, b) => a.page - b.page)
    .map(p => ({ ...p, words: wordsOf(dir, p) }))
  if (!pictures.length) throw new Error(total && from > total ? `${basename(file)} has ${total} page${total === 1 ? '' : 's'}.` : `No page ${from} in ${basename(file)}.`)
  return { pictures, total }
}

/** The word list written beside a page's picture, made to say the picture's real size. '' when there is none. */
function wordsOf(dir, { page, path }) {
  const list = join(dir, `page-${page}.words.json`)
  if (!existsSync(list)) return ''
  try {
    // The tool that drew the picture chose how to round its size. The words keep their places: only the size is set right.
    const real = pictureSize(path)
    if (real) writeFileSync(list, JSON.stringify({ ...JSON.parse(readFileSync(list, 'utf8')), size: real }))
    return list
  } catch {
    return ''
  }
}

/** Puts a PDF in the review page, a screen for each page. */
export async function showPdf(path, { app = '', pages, note = '', check = [], kind = 'qa', item = '', from = 'Claude' } = {}) {
  const file = resolve(String(path ?? ''))
  if (!path || !existsSync(file)) throw new Error(path ? `No PDF at ${path}` : 'Say which PDF: review pdf <file.pdf>')
  const range = pagesOf(pages)
  mkdirSync(join(HOME, 'shots'), { recursive: true })
  const dir = mkdtempSync(join(HOME, 'shots', 'pdf-'))
  try {
    // Unasked, one page more than it shows is drawn: the only sure way to know there are more, whichever tool drew them.
    const drawn = await pagePictures(file, dir, range.chosen ? range : { from: 1, to: MOST_PAGES + 1 })
    const more = !range.chosen && drawn.pictures.length > MOST_PAGES
    const pictures = drawn.pictures.slice(0, range.chosen ? undefined : MOST_PAGES)
    const total = drawn.total ?? (range.chosen || more ? null : pictures.length)
    const name = app || basename(file).replace(/\.pdf$/i, '') || 'A PDF'
    const appSlug = slug(name)
    // A page shown before is the before picture now, so the review page marks where it changed.
    const shown = new Map(listScreens(appSlug).filter(s => !s.mode && /^Page \d+$/.test(s.screen)).map(s => [Number(s.screen.slice(5)), s]))
    const earlier = page => (shown.has(page) && existsSync(join(IMAGES, shown.get(page).after)) ? join(IMAGES, shown.get(page).after) : '')
    // What to look at is said once, on the first page. Pages keep their order however they were asked for.
    const entries = pictures.map((p, n) => push({ app: name, screen: `Page ${p.page}`, after: p.path, words: p.words, before: earlier(p.page), note: n ? '' : note, check: n ? [] : check, kind, item, from, place: p.page, madeFrom: { after: `${file}, page ${p.page}`, before: '' } }))
    // The PDF has lost pages since it was last shown: they leave the review page too. Only pages this PDF put there.
    if (total) for (const [page, screen] of shown) if (page > total && String(screen.source?.after ?? '').startsWith(`${file}, page `)) removeScreen(appSlug, screenId(`Page ${page}`))
    return { entries, name, first: pictures[0].page, last: pictures.at(-1).page, total, more }
  } finally {
    // push copied the pictures.
    rmSync(dir, { recursive: true, force: true })
  }
}
