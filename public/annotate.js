/**
 * The one drawing code: marks on a picture (freehand, boxes, arrows and words), kept as numbers in the picture's own
 * pixels, so they can be redrawn at any zoom and burned into a copy of the picture to send back. Also the undo and redo
 * of those marks, the zoom rules, and what to look at: the line that says it and the places a picture changed.
 *
 */

export const COLOURS                    = [
  { id: 'red', label: 'Red', value: '#d42a20' },
  { id: 'amber', label: 'Amber', value: '#e89a00' },
  { id: 'blue', label: 'Blue', value: '#1f5fd1' },
  { id: 'black', label: 'Black', value: '#1b1d21' },
]

/** Line and type sizes that stay readable whatever the picture's size. */
export const strokeFor = (width        )         => Math.max(3, Math.round(width / 380))
export const textFor = (width        )         => Math.max(18, Math.round(width / 58))

const FONT = (size        )         => `600 ${size}px -apple-system, system-ui, sans-serif`

/** Draws marks onto a canvas context the size of the picture. */
export function paintMarks(ctx                          , marks                 )       {
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const m of marks) {
    ctx.strokeStyle = m.color
    ctx.fillStyle = m.color
    if (m.tool === 'pen') {
      if (m.points.length < 2) continue
      ctx.lineWidth = m.w
      ctx.beginPath()
      ctx.moveTo(m.points[0][0], m.points[0][1])
      for (const p of m.points.slice(1)) ctx.lineTo(p[0], p[1])
      ctx.stroke()
    } else if (m.tool === 'box') {
      ctx.lineWidth = m.w
      ctx.strokeRect(Math.min(m.a[0], m.b[0]), Math.min(m.a[1], m.b[1]), Math.abs(m.b[0] - m.a[0]), Math.abs(m.b[1] - m.a[1]))
    } else if (m.tool === 'arrow') {
      ctx.lineWidth = m.w
      ctx.beginPath()
      ctx.moveTo(m.a[0], m.a[1])
      ctx.lineTo(m.b[0], m.b[1])
      ctx.stroke()
      const angle = Math.atan2(m.b[1] - m.a[1], m.b[0] - m.a[0])
      const head = m.w * 5 + 8
      for (const side of [-1, 1]) {
        ctx.beginPath()
        ctx.moveTo(m.b[0], m.b[1])
        ctx.lineTo(m.b[0] - head * Math.cos(angle + side * 0.5), m.b[1] - head * Math.sin(angle + side * 0.5))
        ctx.stroke()
      }
    } else {
      ctx.font = FONT(m.size)
      ctx.textBaseline = 'top'
      ctx.lineWidth = Math.max(3, m.size / 5)
      ctx.strokeStyle = '#ffffff'
      ctx.strokeText(m.text, m.at[0], m.at[1])
      ctx.fillStyle = m.color
      ctx.fillText(m.text, m.at[0], m.at[1])
    }
  }
}

/** A mark worth keeping: a stroke that went somewhere, a box or arrow that has size, words that say something. */
export function isReal(m      )          {
  if (m.tool === 'pen') return m.points.length > 1
  if (m.tool === 'text') return m.text.trim().length > 0
  return Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1]) > 6
}

/** What a box needs to measure words. Without one (no canvas here) the width is a close estimate. */

const round = (n        )         => Math.round(n)

/** The box a mark covers, in the picture's pixels: what a change request points at. */
export function boxOf(m      , ctx                     )          {
  if (m.tool === 'pen') {
    const xs = m.points.map(p => p[0])
    const ys = m.points.map(p => p[1])
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    return { x: round(x), y: round(y), w: round(Math.max(...xs) - x), h: round(Math.max(...ys) - y) }
  }
  if (m.tool === 'text') {
    let width = m.text.length * m.size * 0.55
    if (ctx) {
      ctx.font = FONT(m.size)
      width = ctx.measureText(m.text).width
    }
    return { x: round(m.at[0]), y: round(m.at[1]), w: round(width), h: round(m.size * 1.2) }
  }
  const x = Math.min(m.a[0], m.b[0])
  const y = Math.min(m.a[1], m.b[1])
  return { x: round(x), y: round(y), w: round(Math.abs(m.b[0] - m.a[0])), h: round(Math.abs(m.b[1] - m.a[1])) }
}

/** A mark as it goes into the feedback file: its kind, its box, and what it is made of, all in image pixels. */
export function shapeOf(m      , ctx                     )            {
  const colour = COLOURS.find(c => c.value === m.color)
  const shape            = { type: m.tool === 'pen' ? 'freehand' : m.tool, colour: colour ? colour.id : m.color, box: boxOf(m, ctx) }
  if (m.tool === 'arrow') {
    shape.from = { x: round(m.a[0]), y: round(m.a[1]) }
    shape.to = { x: round(m.b[0]), y: round(m.b[1]) }
  } else if (m.tool === 'text') {
    shape.text = m.text
  } else if (m.tool === 'pen') {
    shape.points = m.points.map((p)     => [round(p[0]), round(p[1])])
  }
  return shape
}

/* ---------- burning marks into a copy of the picture ---------- */

/** A picture loaded for drawing. */
export function loadPicture(url        )                            {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('The picture could not be read.'))
    img.src = url
  })
}

/** The picture on a new canvas with its real marks drawn on it. */
export function burnCanvas(img                  , marks                 )                    {
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No canvas to draw on.')
  ctx.drawImage(img, 0, 0)
  paintMarks(ctx, marks.filter(isReal))
  return canvas
}

/** The picture with its marks burned in, as a PNG. */
export async function burnMarks(url        , marks                 )                {
  const canvas = burnCanvas(await loadPicture(url), marks)
  return new Promise((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('The marked picture could not be made.'))), 'image/png'))
}

/* ---------- undo and redo ---------- */

/** One picture's marks and what can be taken back. Every change makes a new one. */

export const startHistory = (marks         = [])              => ({ marks, undo: [], redo: [] })
/** The marks replaced by these, in one step that can be undone: one mark added, or all cleared. */
export const withMarks = (h             , marks        )              => ({ marks, undo: [...h.undo, h.marks], redo: [] })
export const withMark = (h             , mark      )              => withMarks(h, [...h.marks, mark])
export const canUndo = (h             )          => h.undo.length > 0
export const canRedo = (h             )          => h.redo.length > 0
export function undone(h             )              {
  if (!h.undo.length) return h
  return { marks: h.undo[h.undo.length - 1], undo: h.undo.slice(0, -1), redo: [...h.redo, h.marks] }
}
export function redone(h             )              {
  if (!h.redo.length) return h
  return { marks: h.redo[h.redo.length - 1], undo: [...h.undo, h.marks], redo: h.redo.slice(0, -1) }
}

/* ---------- zoom ---------- */

export const ZOOM_MIN = 0.05
export const ZOOM_MAX = 6
/** Fitting never blows a small picture up past this. */
export const ZOOM_FIT_MAX = 1.5
export const ZOOM_STEP = 1.25
export const ZOOM_WHEEL_STEP = 1.12

export const zoomedBy = (zoom        , factor        )         => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom * factor))

/** The zoom that shows the whole picture in the room there is. `across` pictures side by side share the width. */
export function fitZoom(room                                   , picture                                   , across = 1, gap = 16)         {
  const each = (room.width - (across - 1) * gap) / across
  return Math.max(ZOOM_MIN, Math.min(ZOOM_FIT_MAX, each / picture.width, room.height / picture.height))
}

/* ---------- what to look at ---------- */

/** How many words of what was said about a picture show at once. The rest waits behind a press. */
export const GLANCE_WORDS = 12

/** What to read at a glance: the first line or sentence, at most a few words, and whether there is more behind it. */
export function glanceOf(text        , most         = GLANCE_WORDS)                                  {
  const trimmed = text.trim()
  const whole = trimmed.replace(/\s+/g, ' ')
  const firstLine = trimmed.split('\n')[0].replace(/\s+/g, ' ')
  const first = /^.+?[.!?](?=\s|$)/.exec(firstLine)?.[0] ?? firstLine
  const words = first.split(' ')
  const line = words.length > most ? `${words.slice(0, most).join(' ')}…` : first
  return { line, more: line !== whole }
}

/** Pictures are compared at this size at most: enough to see words change, and quick. */
const CHANGE_SIDE = 800
const CHANGE_CELL = 8
/** How far a colour must move, out of 255, and in how many pixels of a cell, to count. Scaling blurs edges a little. */
const CHANGE_LEVEL = 16
const CHANGE_PIXELS = 2
/** More of the picture changed than this, or in more places, and there is nothing to point at: all of it is new. */
const CHANGE_MOST_AREA = 0.4
const CHANGE_MOST_PLACES = 12

/**
 * Where two same-sized pictures differ, as boxes. An empty list: no difference big enough to see. Null: they cannot be
 * compared, or so much changed that outlining it would say nothing.
 */
export function changedBoxes(a        , b        , cell         = CHANGE_CELL)                      {
  if (a.width !== b.width || a.height !== b.height || !a.width || !a.height) return null
  const cols = Math.ceil(a.width / cell)
  const rows = Math.ceil(a.height / cell)
  const hits = new Uint16Array(cols * rows)
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4
      if (Math.abs(a.data[i] - b.data[i]) > CHANGE_LEVEL || Math.abs(a.data[i + 1] - b.data[i + 1]) > CHANGE_LEVEL || Math.abs(a.data[i + 2] - b.data[i + 2]) > CHANGE_LEVEL) {
        hits[Math.floor(y / cell) * cols + Math.floor(x / cell)]++
      }
    }
  }
  const on = hits.map(n => (n >= CHANGE_PIXELS ? 1 : 0))
  if (on.reduce((sum        , n        ) => sum + n, 0) > CHANGE_MOST_AREA * cols * rows) return null
  // Cells with at most one quiet cell between them are one place: a line of words is one box, not one per letter.
  const seen = new Uint8Array(cols * rows)
  const boxes               = []
  for (let start = 0; start < on.length; start++) {
    if (!on[start] || seen[start]) continue
    seen[start] = 1
    const stack = [start]
    let left = cols, top = rows, right = 0, bottom = 0
    while (stack.length) {
      const at = stack.pop()          
      const col = at % cols
      const row = Math.floor(at / cols)
      left = Math.min(left, col)
      right = Math.max(right, col)
      top = Math.min(top, row)
      bottom = Math.max(bottom, row)
      for (let r = Math.max(0, row - 2); r <= Math.min(rows - 1, row + 2); r++) {
        for (let c = Math.max(0, col - 2); c <= Math.min(cols - 1, col + 2); c++) {
          const next = r * cols + c
          if (on[next] && !seen[next]) {
            seen[next] = 1
            stack.push(next)
          }
        }
      }
    }
    boxes.push({ x: left * cell, y: top * cell, w: Math.min(a.width, (right + 1) * cell) - left * cell, h: Math.min(a.height, (bottom + 1) * cell) - top * cell })
  }
  return boxes.length > CHANGE_MOST_PLACES ? null : boxes
}

/** Where a picture differs from the one before it, in its own pixels. Null when that cannot be said. */
export function changesBetween(before                  , after                  )                      {
  const width = after.naturalWidth
  const height = after.naturalHeight
  if (!width || !height || before.naturalWidth !== width || before.naturalHeight !== height) return null
  const scale = Math.min(1, CHANGE_SIDE / Math.max(width, height))
  const small = { width: Math.round(width * scale), height: Math.round(height * scale) }
  const read = (img                  )                => {
    const canvas = document.createElement('canvas')
    canvas.width = small.width
    canvas.height = small.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, small.width, small.height)
    return ctx.getImageData(0, 0, small.width, small.height)
  }
  try {
    const a = read(before)
    const b = read(after)
    const boxes = a && b ? changedBoxes(a, b) : null
    return boxes && boxes.map(box => ({ x: box.x / scale, y: box.y / scale, w: box.w / scale, h: box.h / scale }))
  } catch {
    // A picture the page may not read: nothing is outlined, and everything else works.
    return null
  }
}

/**
 * Each place a picture changed: a faint wash, corner ticks just outside it, and a flag that says Changed, so it cannot be taken
 * for part of the design. Only on screen, never in what is sent, and in a colour no mark can have.
 */
export function paintChanged(ctx                          , boxes                       , pictureWidth        )       {
  const w = Math.max(2, strokeFor(pictureWidth) - 1)
  const gap = w * 2
  const size = Math.max(12, Math.round(pictureWidth / 100))
  const flagHeight = Math.round(size * 1.6)
  const colour = '#0a8a8a'
  ctx.save()
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'miter'
  ctx.font = `600 ${size}px -apple-system, system-ui, sans-serif`
  ctx.textBaseline = 'middle'
  for (const box of boxes) {
    const left = box.x - gap
    const top = box.y - gap
    const right = box.x + box.w + gap
    const bottom = box.y + box.h + gap
    ctx.fillStyle = 'rgba(10, 138, 138, 0.1)'
    ctx.fillRect(left, top, right - left, bottom - top)
    const arm = Math.min(w * 7, (right - left) / 2.5, (bottom - top) / 2.5)
    for (const [stroke, width] of [['#ffffff', w + 2], [colour, w]]         ) {
      ctx.strokeStyle = stroke
      ctx.lineWidth = width
      ctx.beginPath()
      for (const [cx, cy, dx, dy] of [[left, top, 1, 1], [right, top, -1, 1], [right, bottom, -1, -1], [left, bottom, 1, -1]]) {
        ctx.moveTo(cx + dx * arm, cy)
        ctx.lineTo(cx, cy)
        ctx.lineTo(cx, cy + dy * arm)
      }
      ctx.stroke()
    }
    // Above the place, or inside it when there is no room above.
    const flagWidth = ctx.measureText('Changed').width + size
    const flagTop = top - flagHeight >= 0 ? top - flagHeight : top
    ctx.fillStyle = colour
    ctx.fillRect(left - w / 2, flagTop, flagWidth, flagHeight)
    ctx.fillStyle = '#ffffff'
    ctx.fillText('Changed', left - w / 2 + size / 2, flagTop + flagHeight / 2 + 1)
  }
  ctx.restore()
}
