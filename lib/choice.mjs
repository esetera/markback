/**
 * A choice: two to six options for the person to choose between, shown side by side as a lineup. The options become one
 * picture, an SVG with each option's own picture inside it, so everything the page does with a picture (marks, zoom, the
 * film, readings) works on a lineup too. Where each option sits in that picture is kept, so a mark can say which option it is on.
 */

import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { pictureSize } from './words.mjs'

export const KEYS = ['A', 'B', 'C', 'D', 'E', 'F']
export const FEWEST = 2
export const MOST = KEYS.length
/** A label is read on a button at a glance. */
const LABEL_LONGEST = 40
/** Tall enough to read a page; any taller and the one picture gets too big for a browser to hold. */
const MOST_HIGH = 2400
/** Each option fits a box this many times as wide as it is high: a wide banner beside a phone shot stays a sensible size. */
const WIDEST_BOX = 1.6
/** The whole lineup is never wider than this: a browser draws a picture far wider badly, or not at all. */
const MOST_WIDE = 9000
/** A picture longer than this against its width, either way, is a strip: beside others it would be a line. */
const THINNEST = 20
const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }

/**
 * `--option` as given: `a.png`, `A=a.png`, or `Two columns=a.png`. The letter always follows the order, so a name that is only
 * a letter must be that letter. Cut at the last =, so a label may have one; a path rarely does, and a whole path that is a file
 * is taken as it is. Checked before anything is written.
 */
export function readOptions(given, exists) {
  const list = Array.isArray(given) ? given : given ? [given] : []
  if (list.length < FEWEST || list.length > MOST) throw new Error(`A choice needs ${FEWEST} to ${MOST} options: give --option once for each, in order.`)
  return list.map((raw, n) => {
    const text = String(raw)
    const cut = text.lastIndexOf('=')
    // A path with = in it is still a path, when there is a file there.
    const whole = cut < 0 || exists(text)
    const name = whole ? '' : text.slice(0, cut).trim()
    const file = whole ? text : text.slice(cut + 1).trim()
    const key = KEYS[n]
    if (/^[a-z]$/i.test(name) && name.toUpperCase() !== key) throw new Error(`Option ${n + 1} is ${key}, not ${name.toUpperCase()}: give the options in order, A first.`)
    const label = /^[a-z]$/i.test(name) ? '' : name.replace(/\s+/g, ' ')
    if (label.length > LABEL_LONGEST) throw new Error(`The label of option ${key} is too long: a few words, ${LABEL_LONGEST} letters at most.`)
    if (!file) throw new Error(`Option ${key} has no picture: give it as ${key}=picture.png.`)
    if (!exists(file)) throw new Error(`No picture at ${file}`)
    return { key, label, file }
  })
}

/**
 * The lineup as one SVG: every option at the same height, side by side, a gap between them, each with a thin edge. The gaps
 * are left clear, so the page shows through them. Returns the SVG and each option's place in it.
 */
export function lineupPicture(options) {
  const sized = options.map(o => {
    const type = TYPES[extname(o.file).toLowerCase()]
    const size = type ? pictureSize(o.file) : null
    if (!size?.w || !size?.h) throw new Error(`Option ${o.key}: give a PNG, JPEG, WebP or GIF picture.`)
    if (size.w / size.h > THINNEST || size.h / size.w > THINNEST) throw new Error(`Option ${o.key} is ${size.w} by ${size.h}: too thin to show beside the others. Crop it nearer to the part to choose.`)
    return { ...o, type, size }
  })
  // One box for every option, as high as the tallest (up to MOST_HIGH) and WIDEST_BOX times as wide. Each fills as much of it
  // as it can, whole, and stands centred in its height.
  let high = Math.min(MOST_HIGH, Math.max(...sized.map(o => o.size.h)))
  const fit = o => Math.min(high / o.size.h, (high * WIDEST_BOX) / o.size.w)
  const across = () => sized.reduce((sum, o) => sum + o.size.w * fit(o), 0) + Math.max(24, high * 0.035) * (sized.length - 1)
  // Too wide in all: every option smaller, alike.
  if (across() > MOST_WIDE) high = Math.floor((high * MOST_WIDE) / across())
  const gap = Math.max(24, Math.round(high * 0.035))
  let x = 0
  const placed = sized.map(o => {
    const w = Math.max(1, Math.round(o.size.w * fit(o)))
    const h = Math.max(1, Math.round(o.size.h * fit(o)))
    const box = { x, y: Math.round((high - h) / 2), w, h }
    x += w + gap
    return { ...o, box }
  })
  const width = x - gap
  const edge = Math.max(2, Math.round(high / 600))
  const body = placed.map(o => {
    const data = readFileSync(o.file).toString('base64')
    const { x: left, y: top, w, h } = o.box
    return `<image x="${left}" y="${top}" width="${w}" height="${h}" preserveAspectRatio="none" href="data:${o.type};base64,${data}"/><rect x="${left + edge / 2}" y="${top + edge / 2}" width="${w - edge}" height="${h - edge}" fill="none" stroke="#c5cbd3" stroke-width="${edge}"/>`
  }).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${high}" viewBox="0 0 ${width} ${high}">${body}</svg>`
  return { svg, size: { w: width, h: high }, options: placed.map(({ key, label, box, size }) => ({ key, label, box, size })) }
}

/** The option a point is on. In a gap, the nearest one: a mark just past an edge still means that option. */
export function optionAt(options, x) {
  if (!Array.isArray(options) || !options.length || !Number.isFinite(x)) return null
  const inside = options.find(o => x >= o.box.x && x <= o.box.x + o.box.w)
  if (inside) return inside
  return options.reduce((near, o) => (Math.abs(o.box.x + o.box.w / 2 - x) < Math.abs(near.box.x + near.box.w / 2 - x) ? o : near))
}

/** Where a mark is, for finding its option: an arrow's head, a pin's spot, or the middle of its box. */
function spotOf(shape) {
  const spot = shape.type === 'arrow' ? shape.to : shape.type === 'pin' ? shape.at : null
  if (spot && Number.isFinite(spot.x)) return spot
  const box = shape.box
  return box && Number.isFinite(box.x) ? { x: box.x + box.w / 2, y: box.y + box.h / 2 } : null
}

/**
 * Each mark says which option it is on, and where it is in that option's own picture, so the agent can find the place there
 * without working it out from the lineup.
 */
export function marksOnOptions(shapes, options) {
  return shapes.map(shape => {
    const spot = spotOf(shape)
    const o = spot ? optionAt(options, spot.x) : null
    if (!o) return shape
    const scale = o.size.h / o.box.h
    const box = shape.box && Number.isFinite(shape.box.x) ? { x: Math.round((shape.box.x - o.box.x) * scale), y: Math.round((shape.box.y - o.box.y) * scale), w: Math.round(shape.box.w * scale), h: Math.round(shape.box.h * scale) } : null
    return { ...shape, option: o.key, ...(box ? { optionBox: box } : {}) }
  })
}
