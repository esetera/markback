/**
 * The words in a picture. A screenshot is only pixels, so a mark on it says where and not what. A list of the words, made when
 * the picture is taken, lets every mark carry the words under it.
 *
 *   { "size": { "w": 1224, "h": 1584 }, "words": [{ "t": "Saturday", "x": 795, "y": 1038, "w": 132, "h": 34, "el": "div.item > b" }] }
 *
 * Positions are in the picture's own pixels, from its top left. Words are in reading order. `el` is the element a word is in,
 * for web pages. Words are never read off a bare picture here: a list comes from the page or the PDF the picture was made from.
 *
 * A list is words from a page nobody here wrote, and they end up in a terminal and in an agent's reading. So every list is
 * cleaned as it comes in: no control characters, nothing outside the picture, and nothing too long.
 */

import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs'

/** More than any screen or page holds. A longer list is a mistake, and the review page would have to load it. */
const MOST_WORDS = 20000
/** A list of the most words, each with a long path, is well under this. A bigger file is not read at all. */
const MOST_BYTES = 5 * 1024 * 1024
/** The longest a word or an element path is kept. */
const MOST_LETTERS = 200
/** The most one mark carries: a box round a whole page says its first words, not a book. */
const MOST_UNDER = 200
const MOST_UNDER_LETTERS = 2000

/**
 * Runs in the page, not here: gives the word list of what the window shows now. It is kept as a function so it is checked as
 * code, and sent as text (PAGE_SCRIPT). It must use nothing from outside itself. It leaves out what it cannot place: frames
 * in the page, closed shadow roots, and text a style sheet adds (::before and ::after).
 */
function wordsInPage() {
  const scale = window.devicePixelRatio || 1
  const wide = window.innerWidth
  const high = window.innerHeight
  // Each found word, with its box in the window's own units until the end: { t, l, u, r, d, el }.
  const found = []
  const paths = new Map()
  const shown = new Map()
  const painted = new Map()
  const strengths = new Map()
  const nameOf = el => el.localName + (el.id ? '#' + el.id : typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '')
  // A short path, three steps at most, that stops at an id: enough to find the element in the code.
  const pathOf = el => {
    if (paths.has(el)) return paths.get(el)
    const parts = []
    for (let at = el; at && at.nodeType === 1 && at.localName !== 'body' && at.localName !== 'html' && parts.length < 3; at = at.parentElement) {
      parts.unshift(nameOf(at))
      if (at.id) break
    }
    paths.set(el, parts.join(' > ') || el.localName)
    return paths.get(el)
  }
  const isShown = el => {
    if (shown.has(el)) return shown.get(el)
    const style = getComputedStyle(el)
    // An element with display: contents has no box of its own. Its words show when its parent's do.
    const yes = style.visibility === 'visible' && (style.display === 'contents' ? !el.parentElement || isShown(el.parentElement) : !el.checkVisibility || el.checkVisibility({ checkOpacity: true }))
    shown.set(el, yes)
    return yes
  }

  // What is drawn on top at a point can only be asked of elements that take the pointer. For as long as this runs, all do.
  const forced = []
  const takePointer = root => {
    try {
      const sheet = new CSSStyleSheet()
      sheet.replaceSync('* { pointer-events: auto !important }')
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet]
      forced.push([root, sheet])
    } catch (error) {
      // An old browser: words in parts that take no pointer may be left out.
    }
  }
  // How much of an element shows, with all that holds it: a solid layer in a parent that is see-through hides nothing.
  const strength = el => {
    if (!el || el.nodeType !== 1) return 1
    if (!strengths.has(el)) strengths.set(el, Number(getComputedStyle(el).opacity) * strength(el.parentElement || (el.getRootNode() || {}).host))
    return strengths.get(el)
  }
  // An element that really hides what is under it: it shows at half strength or more, and has a background colour at half
  // strength or more, or is a picture or a film that has loaded. A canvas, a gradient or a background picture may be mostly
  // clear, and there is no way to ask: a word kept under a faint cover does less harm than a word in plain sight left out.
  const paints = el => {
    if (painted.has(el)) return painted.get(el)
    const colour = getComputedStyle(el).backgroundColor
    const alpha = colour === 'transparent' ? 0 : Number((/^rgba\(.*,\s*([\d.]+)\)$/.exec(colour) || /\/\s*([\d.]+)\)$/.exec(colour) || [0, 1])[1])
    const picture = (el.localName === 'img' && el.complete && el.naturalWidth > 0) || (el.localName === 'video' && (el.readyState >= 2 || !!el.poster))
    const yes = strength(el) >= 0.5 && (alpha >= 0.5 || picture)
    painted.set(el, yes)
    return yes
  }
  let modal = null
  try {
    modal = document.querySelector(':modal')
  } catch (error) {
    // An old browser has no such thing.
  }
  // The element is the first thing drawn at this point: nothing that hides it is on top, and it is not cut off.
  const onTop = (el, x, y) => {
    let target = el
    // Text in an element with no box is drawn by the nearest parent that has one.
    while (target.parentElement && getComputedStyle(target).display === 'contents') target = target.parentElement
    // Drawn text in an SVG is hit only on its ink: the whole drawing stands for it.
    while (target.ownerSVGElement) target = target.ownerSVGElement
    const root = target.getRootNode()
    for (const over of (root.elementsFromPoint ? root : document).elementsFromPoint(x, y)) {
      if (over === target) return true
      // What holds the element is drawn under it, whatever its background.
      if (over.contains(target)) continue
      if (paints(over)) return false
    }
    // Not there at all. A part of the page that is switched off for now (behind an open dialog, say) is never there and
    // still shows. Anything else is cut off by a box that scrolls or hides what does not fit.
    return !!(el.closest('[inert]') || (modal && !modal.contains(el)))
  }

  // Scripts that write without spaces have many words in one run of letters.
  const noSpaces = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u
  let cutter = null
  try {
    cutter = new Intl.Segmenter(document.documentElement.lang || undefined, { granularity: 'word' })
  } catch (error) {
    try {
      cutter = new Intl.Segmenter(undefined, { granularity: 'word' })
    } catch (again) {
      // No way to cut: such a run stays one word.
    }
  }
  // Where the words are in one run of letters, as [start, end]. A mark of punctuation stays with the word beside it.
  const partsOf = run => {
    if (!cutter || !noSpaces.test(run)) return [[0, run.length]]
    const parts = []
    for (const piece of cutter.segment(run)) {
      const last = parts[parts.length - 1]
      if (last && (!piece.isWordLike || !last[2])) {
        last[1] = piece.index + piece.segment.length
        last[2] = last[2] || piece.isWordLike
      } else parts.push([piece.index, piece.index + piece.segment.length, piece.isWordLike])
    }
    return parts
  }
  // The box of some text. A word broken over two lines has a box on each line: the wider part stands for it, so the box is
  // always on the word. Parts on one line (a first letter set apart, say) are one box.
  const range = document.createRange()
  const boxOf = (node, from, to) => {
    range.setStart(node, from)
    range.setEnd(node, to)
    const lines = []
    for (const r of range.getClientRects()) {
      if (!(r.width > 0 && r.height > 0)) continue
      const line = lines.find(l => Math.min(l.d, r.bottom) - Math.max(l.u, r.top) > Math.min(l.d - l.u, r.height) / 2)
      if (line) {
        line.l = Math.min(line.l, r.left)
        line.u = Math.min(line.u, r.top)
        line.r = Math.max(line.r, r.right)
        line.d = Math.max(line.d, r.bottom)
      } else lines.push({ l: r.left, u: r.top, r: r.right, d: r.bottom })
    }
    return lines.sort((a, b) => b.r - b.l - (a.r - a.l))[0]
  }
  // The part of a box that is in the window, or nothing.
  const inWindow = box => {
    if (!box || box.r <= 0 || box.d <= 0 || box.l >= wide || box.u >= high) return null
    return { l: Math.max(box.l, 0), u: Math.max(box.u, 0), r: Math.min(box.r, wide), d: Math.min(box.d, high) }
  }
  const sharedParent = (a, b) => {
    let at = a
    while (at && !at.contains(b)) at = at.parentElement
    return at || a
  }

  // The words a form control shows: what is typed in it, or else its hint. Never a password, or a field that shows dots.
  const saidBy = el => {
    if (el.localName === 'select') return [...el.selectedOptions].map(option => option.text).join(' ')
    if (el.localName === 'input' && /^(button|submit|reset)$/.test(el.type)) return el.value
    if (el.localName !== 'textarea' && !(el.localName === 'input' && /^(text|search|email|url|tel|number)$/.test(el.type))) return ''
    const dots = getComputedStyle(el).webkitTextSecurity
    return dots && dots !== 'none' ? '' : el.value || el.placeholder
  }
  const boxOfElement = el => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 ? { l: r.left, u: r.top, r: r.right, d: r.bottom } : null
  }

  // The last word found, when the text since has had no space and no other word: the next letters may be the rest of it.
  let open = null
  const walk = root => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === 1) {
        if (node.shadowRoot) {
          takePointer(node.shadowRoot)
          walk(node.shadowRoot)
        }
        // A field with a page of text in it says its first words: they share one box, and more would be slivers.
        const said = String(saidBy(node) || '').split(/\s+/).filter(Boolean).slice(0, 30)
        const box = said.length && isShown(node) ? inWindow(boxOfElement(node)) : null
        if (!box || !onTop(node, (box.l + box.r) / 2, (box.u + box.d) / 2)) continue
        // Where each word is inside a control cannot be asked: they share its width, each by its length.
        const letters = said.reduce((sum, word) => sum + word.length + 1, 0)
        let before = 0
        for (const word of said) {
          found.push({ t: word, l: box.l + ((box.r - box.l) * before) / letters, u: box.u, r: box.l + ((box.r - box.l) * (before + word.length + 1)) / letters, d: box.d, el: node })
          before += word.length + 1
        }
        open = null
        continue
      }
      const el = node.parentElement
      // The text inside these is not what they show: a control's words are found above.
      if (!el || /^(script|style|noscript|template|title|textarea|option|optgroup)$/.test(el.localName) || !isShown(el)) continue
      const text = node.data
      if (!text) continue
      let last = null
      const runs = /\S+/g
      for (let run = runs.exec(text); run; run = runs.exec(text)) {
        for (const [from, to] of partsOf(run[0])) {
          const start = run.index + from
          const end = run.index + to
          const box = inWindow(boxOf(node, start, end))
          if (!box || !onTop(el, (box.l + box.r) / 2, (box.u + box.d) / 2)) {
            open = null
            last = null
            continue
          }
          const piece = text.slice(start, end)
          // Letters that follow a word with no space, and touch it on its line, are the rest of that word: <b>Sat</b>urday.
          const joins = open && start === 0 && !noSpaces.test(piece) && !noSpaces.test(open.t) && Math.min(open.d, box.d) - Math.max(open.u, box.u) > Math.min(open.d - open.u, box.d - box.u) / 2 && (Math.abs(box.l - open.r) <= 1.5 || Math.abs(open.l - box.r) <= 1.5)
          if (joins) {
            open.t += piece
            open.l = Math.min(open.l, box.l)
            open.u = Math.min(open.u, box.u)
            open.r = Math.max(open.r, box.r)
            open.d = Math.max(open.d, box.d)
            open.el = sharedParent(open.el, el)
            last = end === text.length ? open : null
          } else {
            const word = { t: piece, l: box.l, u: box.u, r: box.r, d: box.d, el }
            found.push(word)
            last = end === text.length ? word : null
          }
          open = null
        }
      }
      // Only a word that ends its piece of text, with nothing after it, can go on in the next piece.
      open = last
    }
  }
  try {
    takePointer(document)
    if (document.body) walk(document.body)
  } finally {
    for (const [root, sheet] of forced) root.adoptedStyleSheets = root.adoptedStyleSheets.filter(other => other !== sheet)
  }
  const words = found.map(word => ({ t: word.t, x: Math.round(word.l * scale), y: Math.round(word.u * scale), w: Math.max(1, Math.round((word.r - word.l) * scale)), h: Math.max(1, Math.round((word.d - word.u) * scale)), el: pathOf(word.el) }))
  return { size: { w: Math.round(wide * scale), h: Math.round(high * scale) }, words }
}

/** One expression for a browser tool to run in the page. Its value is the word list of what the window shows. */
export const PAGE_SCRIPT = `(${wordsInPage})()`

const isNumber = n => typeof n === 'number' && Number.isFinite(n)

/**
 * Text as it is safe to keep and to print: no control characters (a new line would forge a line of a report, and an escape
 * code would run in a terminal), no marks that turn the reading direction round (they make text read as other than it is),
 * and one space wherever there was any white space.
 */
export const printable = text => String(text ?? '').replace(/[\t\n\v\f\r\u0085]/g, ' ').replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim()
const short = (text, most = MOST_LETTERS) => [...printable(text)].slice(0, most).join('').trim()

/** The words that are in a picture of this size, each cut to the picture. A word mostly outside it is not in it. */
function inPicture(words, size) {
  const out = []
  for (const word of words) {
    const x = Math.max(word.x, 0)
    const y = Math.max(word.y, 0)
    const w = Math.min(word.x + word.w, size.w) - x
    const h = Math.min(word.y + word.h, size.h) - y
    if (!(w > 0 && h > 0) || w * h < (word.w * word.h) / 2) continue
    out.push(w === word.w && h === word.h ? word : { ...word, x, y, w, h })
  }
  return out
}

/**
 * The list as it is kept: only what the shape names, cleaned. A list that is not the right shape is refused in one plain
 * line. A word that says nothing once cleaned, has a number that is no number, or is not in the picture, is left out.
 */
export function checkWords(list) {
  const bad = why => new Error(`The word list is not right: ${why}. It is { "size": { "w", "h" }, "words": [{ "t", "x", "y", "w", "h" }] }, in the picture's own pixels.`)
  if (!list || typeof list !== 'object' || Array.isArray(list)) throw bad('it is not an object')
  if (!isNumber(list.size?.w) || !isNumber(list.size?.h) || list.size.w <= 0 || list.size.h <= 0) throw bad('size needs w and h, the width and height of the picture')
  if (!Array.isArray(list.words)) throw bad('words is not a list')
  if (list.words.length > MOST_WORDS) throw bad(`it has more than ${MOST_WORDS} words`)
  const size = { w: list.size.w, h: list.size.h }
  const words = []
  for (const [n, word] of list.words.entries()) {
    if (typeof word?.t !== 'string') throw bad(`word ${n + 1} has no text in t`)
    const t = short(word.t)
    const numbers = [word.x, word.y, word.w, word.h]
    if (!numbers.every(value => typeof value === 'number') || word.w <= 0 || word.h <= 0) throw bad(`word ${n + 1} ("${t.slice(0, 40)}") needs x, y, w and h as numbers, with a width and a height`)
    if (word.el !== undefined && word.el !== null && typeof word.el !== 'string') throw bad(`word ${n + 1} has an el that is not text`)
    if (!t || !numbers.every(isNumber)) continue
    const el = word.el ? short(word.el) : ''
    words.push({ t, x: word.x, y: word.y, w: word.w, h: word.h, ...(el ? { el } : {}) })
  }
  return { size, words: inPicture(words, size) }
}

/** How big a PNG is, from its first bytes. Null for any other kind of picture: then the list is taken at its word. */
export function pictureSize(path) {
  try {
    const head = Buffer.alloc(24)
    const file = openSync(path, 'r')
    try {
      readSync(file, head, 0, 24, 0)
    } finally {
      closeSync(file)
    }
    if (head.toString('latin1', 1, 4) !== 'PNG' || head.toString('latin1', 12, 16) !== 'IHDR') return null
    return { w: head.readUInt32BE(16), h: head.readUInt32BE(20) }
  } catch {
    return null
  }
}

/**
 * The word list in a file, checked. With the picture it is for, it is also fitted to it: a browser tool may save its screenshot
 * at another scale than the page's own, and then every position is off by that scale. A list of another shape is refused.
 */
export function readWords(path, picture = '') {
  let bytes
  try {
    const file = statSync(path)
    if (!file.isFile()) throw new Error('not a file')
    bytes = file.size
  } catch {
    throw new Error(`No word list at ${path}`)
  }
  // Said before any of it is read: a file of any size costs nothing to refuse.
  if (bytes > MOST_BYTES) throw new Error(`The word list at ${path} is too big: ${Math.ceil(bytes / 1024 / 1024)} MB, and the most is ${MOST_BYTES / 1024 / 1024} MB.`)
  let list
  try {
    list = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new Error(`The word list at ${path} is not JSON.`)
  }
  list = checkWords(list)
  const real = picture ? pictureSize(picture) : null
  if (!real || (real.w === list.size.w && real.h === list.size.h)) return list
  const across = real.w / list.size.w
  const down = real.h / list.size.h
  if (Math.abs(across / down - 1) > 0.02) throw new Error(`The word list is for a picture ${list.size.w} by ${list.size.h}, and the picture is ${real.w} by ${real.h}. Make the list at the same window size and scroll as the screenshot.`)
  const fit = (n, by) => Math.round(n * by * 10) / 10
  return { size: real, words: inPicture(list.words.map(word => ({ ...word, x: fit(word.x, across), y: fit(word.y, down), w: fit(word.w, across), h: fit(word.h, down) })), real) }
}

/** A list this module kept earlier, read back. Nothing when it is gone or no longer right: then marks carry no words. */
export function keptWords(path) {
  try {
    return readWords(path)
  } catch {
    return null
  }
}

const isBox = box => !!box && [box.x, box.y, box.w, box.h].every(isNumber)
const isPoint = point => Array.isArray(point) && isNumber(point[0]) && isNumber(point[1])

/** At least half of the word is inside the box: a box drawn a little short of a word still means it. */
const mostlyIn = (word, box) => {
  const w = Math.min(word.x + word.w, box.x + box.w) - Math.max(word.x, box.x)
  const h = Math.min(word.y + word.h, box.y + box.h) - Math.max(word.y, box.y)
  return w > 0 && h > 0 && w * h >= (word.w * word.h) / 2
}
/** How far a point is from a word's box. Nothing when it is on the word. */
const awayFrom = (point, word) => Math.hypot(Math.max(word.x - point.x, 0, point.x - (word.x + word.w)), Math.max(word.y - point.y, 0, point.y - (word.y + word.h)))

/** A line drawn round something: it ends near where it began, and it holds a good part of the box it covers. */
function isLoop(points, box) {
  if (points.length < 4 || Math.min(box.w, box.h) < 6) return false
  const gap = Math.hypot(points[0][0] - points.at(-1)[0], points[0][1] - points.at(-1)[1])
  let twice = 0
  for (const [n, point] of points.entries()) {
    const next = points[(n + 1) % points.length]
    twice += point[0] * next[1] - next[0] * point[1]
  }
  return gap <= Math.max(box.w, box.h) * 0.35 && Math.abs(twice) / 2 >= box.w * box.h * 0.3
}

/** Points along a drawn line, close enough together that no word is stepped over: [[x, y], …]. */
function alongLine(points) {
  const length = points.slice(1).reduce((sum, point, n) => sum + Math.hypot(point[0] - points[n][0], point[1] - points[n][1]), 0)
  // Two pixels apart, or wider on a very long line, so the work stays small.
  const step = Math.max(2, length / 4000)
  const out = [points[0]]
  for (const [n, point] of points.slice(1).entries()) {
    const from = points[n]
    const steps = Math.ceil(Math.hypot(point[0] - from[0], point[1] - from[1]) / step)
    for (let i = 1; i <= steps; i++) out.push([from[0] + ((point[0] - from[0]) * i) / steps, from[1] + ((point[1] - from[1]) * i) / steps])
  }
  return out
}

/**
 * The words a freehand line means. A loop means what is in its box. Any other line means the words it runs through: a point
 * of it takes the word whose own box holds it. A point on no word may be under one, as an underline is: it takes the word
 * straight above it whose foot is within half that word's height. A line struck through a row of words is level with them
 * in the gaps between them too, so there it is not an underline of the row above.
 */
function underLine(mark, list) {
  const points = Array.isArray(mark.points) ? mark.points.filter(isPoint) : []
  const bounds = isBox(mark.box) ? mark.box : null
  const inBox = bounds && (!points.length || isLoop(points, bounds)) ? list.words.filter(word => mostlyIn(word, bounds)) : []
  // A loop too small or too flat to hold a word is a line after all.
  if (inBox.length || !points.length) return inBox
  const holds = (word, [x, y]) => x >= word.x && x <= word.x + word.w && y >= word.y && y <= word.y + word.h
  const taken = new Set()
  const off = []
  for (const point of alongLine(points)) {
    const on = list.words.filter(word => holds(word, point))
    for (const word of on) taken.add(word)
    if (!on.length) off.push(point)
  }
  const struck = [...taken]
  for (const [x, y] of off) {
    if (struck.some(word => y >= word.y && y <= word.y + word.h)) continue
    for (const word of list.words) if (x >= word.x && x <= word.x + word.w && y > word.y + word.h && y - (word.y + word.h) <= word.h / 2) taken.add(word)
  }
  return list.words.filter(word => taken.has(word))
}

/** What a mark carries, cut to the most it may: it ends with … when words were left off. */
function cut(said) {
  const all = said.split(' ')
  let kept = all.length > MOST_UNDER ? `${all.slice(0, MOST_UNDER).join(' ')}…` : said
  if ([...kept].length > MOST_UNDER_LETTERS) kept = `${[...kept].slice(0, MOST_UNDER_LETTERS - 1).join('').trimEnd()}…`
  return kept
}

/**
 * One mark with the words it covers, as `words`, and the element they are all in, as `element`. A box and chosen words cover
 * the words that are at least half inside the mark's box. A freehand line covers the words it runs through or under, and a
 * loop the words in its box. An arrow points at the one word nearest its head, when it is within one and a half times that
 * word's height, or 24 pixels if that is more. A pin, spoken at a spot, points the same way from where it stands, and its
 * `text` is what was said there. A text mark covers none. Chosen words already say their words, as `text`.
 */
export function markWords(shape, list) {
  if (!shape || typeof shape !== 'object') return shape
  // Only what is worked out here is believed, never a field that came with the mark.
  const { words: _words, element: _element, ...mark } = shape
  let under = []
  if (list && ['box', 'words'].includes(mark.type) && isBox(mark.box)) under = list.words.filter(word => mostlyIn(word, mark.box))
  else if (list && mark.type === 'freehand') under = underLine(mark, list)
  else if (list && ['arrow', 'pin'].includes(mark.type)) {
    const point = mark.type === 'arrow' ? mark.to : mark.at
    if (isNumber(point?.x) && isNumber(point?.y)) {
      const nearest = list.words.reduce((best, word) => (!best || awayFrom(point, word) < awayFrom(point, best) ? word : best), null)
      if (nearest && awayFrom(point, nearest) <= Math.max(nearest.h * 1.5, 24)) under = [nearest]
    }
  }
  const said = cut(mark.type === 'words' ? printable(mark.text) : under.map(word => word.t).join(' '))
  if (!said) return mark
  const element = under.length && under.every(word => word.el && word.el === under[0].el) ? short(under[0].el) : ''
  return { ...mark, words: said, ...(element ? { element } : {}) }
}

/** Every mark of an answer, each with its words. With no list, only chosen words have any. */
export const marksWithWords = (shapes, list) => shapes.map(shape => markWords(shape, list))

/** The end of a mark's line in `review read`: the words it is on. A long run shows its start and its end. */
export function sayWords(shape) {
  const element = printable(shape.element)
  const inElement = element ? `, in ${element}` : ''
  const said = printable(shape.words)
  if (!said || shape.type === 'words') return inElement
  const all = said.split(' ')
  const shown = all.length > 40 ? `${all.slice(0, 15).join(' ')} … ${all.slice(-15).join(' ')}` : said
  return `, on the word${all.length === 1 ? '' : 's'} "${shown}"${all.length > 40 ? ` (${all.length} words; --json has them all)` : ''}${inElement}`
}
