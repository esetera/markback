/**
 * A workflow as an architect's sheet: tracing paper, pencil lines that cross at the corners, column bubbles over each step, a
 * title block. One idea a sheet, one row of boxes. Each box says who may do the step and what makes it happen, in a few words.
 * It writes an SVG, which the wizard takes as it is: nothing to install.
 *
 *   { "title": "...", "boxes": [{ "step": "...", "who": "...", "when": "...", "tell": "...", "mark": 1 }],
 *     "notes": ["Rejected: it ends here"], "name": "My workflow", "sheet": "1 of 3" }
 */

const W = 1600, H = 1000, M = 84, GAP = 52
const PAPER = '#F5F1E6', GRID = '#E7E1D1', GUIDE = '#C9C2AF', INK = '#2E3136', SOFT = '#5C5F63', RED = '#B9472B'
const FONT = "Noteworthy, 'Chalkboard SE', 'Comic Neue', 'Segoe Print', 'Marker Felt', cursive"
const MOST_BOXES = 8

const widthOf = (text, size, bold) => text.length * size * 0.52 * (bold ? 1.06 : 1)
function wrap(text, width, size, bold) {
  const out = []
  let row = ''
  for (const word of String(text).split(' ')) {
    const next = row ? `${row} ${word}` : word
    if (widthOf(next, size, bold) > width && row) {
      out.push(row)
      row = word
    } else row = next
  }
  if (row) out.push(row)
  return out
}
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const t = (x, y, size, words, { bold = false, colour = INK, anchor = 'start', caps = false } = {}) => `<text x="${x}" y="${y}" font-size="${size}"${bold ? ' font-weight="700"' : ''} fill="${colour}" text-anchor="${anchor}"${caps ? ' letter-spacing="1.2"' : ''}>${esc(caps ? String(words).toUpperCase() : words)}</text>`
const line = (x1, y1, x2, y2, { colour = INK, width = 1.8, dash = '' } = {}) => `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${colour}" stroke-width="${width}" stroke-linecap="round" fill="none"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`
const box = (x, y, w, h, over = 11) => line(x - over, y, x + w + over, y) + line(x - over, y + h, x + w + over, y + h) + line(x, y - over, x, y + h + over) + line(x + w, y - over, x + w, y + h + over)
const hexagon = (cx, cy, r) => `<path d="M${[0, 1, 2, 3, 4, 5].map(i => `${(cx + r * Math.cos((Math.PI / 3) * i)).toFixed(1)} ${(cy + r * Math.sin((Math.PI / 3) * i)).toFixed(1)}`).join(' L')} Z" fill="${PAPER}" stroke="${RED}" stroke-width="2"/>`

export function sketch({ title, boxes, notes = [], name = 'Workflow', sheet = '1 of 1' }) {
  if (!title || !Array.isArray(boxes) || !boxes.length) throw new Error('A sheet needs a title and at least one box.')
  if (boxes.length > MOST_BOXES) throw new Error(`At most ${MOST_BOXES} boxes a sheet: make another sheet.`)
  const n = boxes.length
  const w = (W - 2 * M - GAP * (n - 1)) / n
  const pad = 18
  const inner = w - pad * 2
  const NAME = n >= 6 ? 22 : 26
  const nameLine = NAME + 8
  const ruled = Math.min(W - 2 * M, String(title).length * 28.8)
  const laid = boxes.map(b => {
    const step = wrap(String(b.step).toUpperCase(), inner, NAME, true)
    const who = wrap(b.who ?? '', inner, 23)
    const when = wrap(b.when ?? '', inner, 23)
    const tell = wrap(b.tell ?? '', inner, 23)
    return { b, step, who, when, tell, h: step.length * nameLine + 20 + who.length * 30 + when.length * 30 + (tell.length ? 10 + tell.length * 30 : 0) + pad * 2 + 8 }
  })
  const h = Math.max(...laid.map(l => l.h))
  const top = 440 - h / 2
  let lines = box(30, 30, W - 60, H - 60, 0)
  lines += line(M - 40, top, W - M + 40, top, { colour: GUIDE, width: 1.1 }) + line(M - 40, top + h, W - M + 40, top + h, { colour: GUIDE, width: 1.1 })
  lines += line(M - 6, 166, M + ruled + 8, 166, { width: 2.2 }) + line(M - 6, 173, M + ruled * 0.62, 173, { width: 1.1 })
  let words = t(M, 148, 44, title, { bold: true, caps: true })
  let marks = ''
  laid.forEach((l, i) => {
    const x = M + i * (w + GAP)
    const cx = x + w / 2
    const by = top - 72
    lines += line(cx, by + 20, cx, top - 12, { colour: SOFT, width: 1.1, dash: '9 4 2 4' })
    lines += `<circle cx="${cx}" cy="${by}" r="20" fill="none" stroke="${INK}" stroke-width="1.6"/>`
    words += t(cx, by + 7, 20, String.fromCharCode(65 + i), { anchor: 'middle' })
    lines += box(x, top, w, h)
    let y = top + pad + NAME
    for (const row of l.step) {
      words += t(x + pad, y, NAME, row, { bold: true, caps: true })
      y += nameLine
    }
    y += 14
    for (const row of l.who) {
      words += t(x + pad, y, 23, row)
      y += 30
    }
    for (const row of l.when) {
      words += t(x + pad, y, 23, row, { colour: SOFT })
      y += 30
    }
    if (l.tell.length) y += 10
    for (const row of l.tell) {
      words += t(x + pad, y, 23, row, { colour: SOFT })
      y += 30
    }
    if (l.b.mark) marks += hexagon(x + w, top, 21) + t(x + w, top + 7, 20, String(l.b.mark), { anchor: 'middle', colour: RED, bold: true })
    if (i < n - 1) {
      const ay = top + h / 2
      const x1 = x + w + 14
      const x2 = x + w + GAP - 12
      lines += line(x1, ay, x2, ay, { width: 2.2 }) + line(x2 - 12, ay - 7, x2, ay, { width: 2.2 }) + line(x2 - 12, ay + 7, x2, ay, { width: 2.2 })
    }
  })
  let y = top + h + 74
  if (notes.length) {
    words += t(M, y, 22, 'Notes', { bold: true, caps: true })
    lines += line(M, y + 10, M + 96, y + 10, { width: 1.4 })
    y += 48
    notes.forEach((note, i) => {
      words += t(M, y, 25, `${i + 1}.  ${note}`)
      y += 40
    })
  }
  const tx = W - 30 - 340
  const ty = H - 30 - 104
  lines += line(tx, ty, W - 30, ty, { width: 1.6 }) + line(tx, ty, tx, H - 30, { width: 1.6 }) + line(tx, ty + 56, W - 30, ty + 56, { width: 1.1 }) + line(tx + 200, ty + 56, tx + 200, H - 30, { width: 1.1 })
  words += t(tx + 16, ty + 38, 25, name, { bold: true, caps: true })
  words += t(tx + 16, ty + 88, 20, `Sheet ${sheet}`, { caps: true })
  words += t(tx + 216, ty + 88, 20, 'Not to scale')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${esc(FONT)}">
<defs><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="${GRID}" stroke-width="1"/></pattern>
<filter id="pencil" x="-2%" y="-2%" width="104%" height="104%"><feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="3" seed="7"/><feDisplacementMap in="SourceGraphic" scale="3"/></filter></defs>
<rect width="${W}" height="${H}" fill="${PAPER}"/><rect x="30" y="30" width="${W - 60}" height="${H - 60}" fill="url(#grid)"/>
<g filter="url(#pencil)">${lines}</g>${words}${marks}</svg>
`
}

/** A small sheet for trying the wizard with nothing of your own. */
export const SAMPLE = {
  title: 'Try it: draw on this',
  name: 'Sample',
  boxes: [
    { step: 'Agent pushes', who: 'Any agent', when: 'After a change' },
    { step: 'You mark it', who: 'You', when: 'Screen is waiting' },
    { step: 'You send', who: 'You', when: 'Press Send' },
    { step: 'Agent reads', who: 'Any agent', when: 'Answer lands', tell: 'Each mark is a request' },
  ],
  notes: ['Looks good sends no marks: it is an approval.'],
}
