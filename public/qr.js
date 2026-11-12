/**
 * A QR code for a short address, made here so nothing is installed and nothing is fetched. Only what an address needs: bytes,
 * the lowest level of error correction, and the five smallest sizes, which hold up to 106 bytes. A longer address gets no code,
 * and the caller shows the address in words.
 */

/** Size 1 to 5 at level L: all the codewords, and how many of them correct errors. Each is one block, so nothing is interleaved. */
const SIZES = [null, [26, 7], [44, 10], [70, 15], [100, 20], [134, 26]]

/** Multiplying in the field the codes use, by tables of powers and logs. */
const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = EXP[i + 255] = x
  LOG[x] = i
  x = (x << 1) ^ (x & 0x80 ? 0x11d : 0)
}
const times = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0)

/** The codewords that correct errors in `data`: what is left when it is divided by the generator. */
function correction(data, count) {
  // The generator: (x - 1)(x - 2)(x - 4)… one factor for each codeword, highest power first.
  let gen = [1]
  for (let i = 0; i < count; i++) {
    const next = new Array(gen.length + 1).fill(0)
    for (const [n, g] of gen.entries()) {
      next[n] ^= g
      next[n + 1] ^= times(g, EXP[i])
    }
    gen = next
  }
  const rest = new Array(count).fill(0)
  for (const byte of data) {
    const lead = byte ^ rest.shift()
    rest.push(0)
    for (let n = 0; n < count; n++) rest[n] ^= times(gen[n + 1], lead)
  }
  return rest
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  x => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
]

/** How hard a code is to read, as the standard counts it: long runs, blocks, shapes like a corner mark, and too much of one colour. */
function penalty(m) {
  const n = m.length
  let points = 0
  const lines = [...m, ...m.map((_, x) => m.map(row => row[x]))]
  for (const line of lines) {
    for (let i = 0, run = 1; i < n; i++, run++) {
      if (i + 1 < n && line[i + 1] === line[i]) continue
      if (run >= 5) points += run - 2
      run = 0
    }
    const text = line.map(Number).join('')
    for (let i = 0; i + 11 <= n; i++) if (text.startsWith('10111010000', i) || text.startsWith('00001011101', i)) points += 40
  }
  let dark = 0
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (m[y][x]) dark++
    if (x + 1 < n && y + 1 < n && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) points += 3
  }
  return points + Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10
}

/**
 * The code for a text, as rows of true (dark) and false, or null when the text is too long for it. `mask` chooses one of the
 * eight patterns by number, for tests; left out, the one that reads best is used.
 */
export function qr(text, mask = null) {
  const bytes = [...new TextEncoder().encode(String(text))]
  const version = SIZES.findIndex(s => s && bytes.length <= s[0] - s[1] - 2)
  if (version < 1) return null
  const [all, extra] = SIZES[version]
  const room = all - extra
  // Says "bytes", how many, then the bytes: four bits, eight bits, and the rest. Then the end mark and the padding.
  const bits = [0, 1, 0, 0]
  for (const value of [bytes.length, ...bytes]) for (let i = 7; i >= 0; i--) bits.push((value >> i) & 1)
  for (let i = 0; i < 4 && bits.length < room * 8; i++) bits.push(0)
  while (bits.length % 8) bits.push(0)
  const data = []
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((byte, bit) => (byte << 1) | bit, 0))
  for (let pad = 0xec; data.length < room; pad ^= 0xec ^ 0x11) data.push(pad)
  const words = [...data, ...correction(data, extra)]

  const n = 17 + version * 4
  const dark = Array.from({ length: n }, () => new Array(n).fill(false))
  // What is part of the code's own frame, and never holds data.
  const fixed = Array.from({ length: n }, () => new Array(n).fill(false))
  const set = (x, y, on) => {
    if (x < 0 || y < 0 || x >= n || y >= n) return
    dark[y][x] = on
    fixed[y][x] = true
  }
  // The three corner marks, each with a light edge round it.
  for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    const ring = Math.max(Math.abs(dx), Math.abs(dy))
    set(cx + dx, cy + dy, ring !== 2 && ring !== 4)
  }
  // The dotted lines between them.
  for (let i = 8; i < n - 8; i++) {
    set(i, 6, i % 2 === 0)
    set(6, i, i % 2 === 0)
  }
  // The small mark near the fourth corner, from size 2 up.
  if (version > 1) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(n - 7 + dx, n - 7 + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
  // Where the format goes: fifteen bits, written twice. Kept free for now, and filled once the mask is chosen.
  const format = (m, bit) => {
    const put = (x, y, i) => {
      m[y][x] = bit(i)
      fixed[y][x] = true
    }
    for (let i = 0; i <= 5; i++) put(8, i, i)
    put(8, 7, 6)
    put(8, 8, 7)
    put(7, 8, 8)
    for (let i = 9; i < 15; i++) put(14 - i, 8, i)
    for (let i = 0; i < 8; i++) put(n - 1 - i, 8, i)
    for (let i = 8; i < 15; i++) put(8, n - 15 + i, i)
    // One module beside them is always dark.
    m[n - 8][8] = true
    fixed[n - 8][8] = true
  }
  format(dark, () => false)
  // The data, in a zigzag of two columns at a time from the right, up and then down.
  let at = 0
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let step = 0; step < n; step++) for (let j = 0; j < 2; j++) {
      const x = right - j
      const y = ((right + 1) & 2) === 0 ? n - 1 - step : step
      if (fixed[y][x]) continue
      dark[y][x] = at < words.length * 8 && ((words[at >> 3] >> (7 - (at & 7))) & 1) === 1
      at++
    }
  }
  const masked = number => {
    const m = dark.map((row, y) => row.map((on, x) => (fixed[y][x] ? on : on !== MASKS[number](x, y))))
    // Level L and the mask, with ten bits that correct them, as the standard writes them.
    const value = (1 << 3) | number
    let rest = value
    for (let i = 0; i < 10; i++) rest = (rest << 1) ^ ((rest >> 9) * 0x537)
    const code = ((value << 10) | rest) ^ 0x5412
    format(m, i => ((code >> i) & 1) === 1)
    return m
  }
  if (mask !== null) return masked(mask)
  return MASKS.map((_, number) => masked(number)).reduce((best, m) => (penalty(m) < penalty(best) ? m : best))
}

/** The code as an SVG picture: black on white with the clear edge it needs, whatever the page's colours. */
export function qrSvg(text, { label = 'A code to scan with your phone' } = {}) {
  const m = qr(text)
  if (!m) return ''
  const n = m.length + 8
  let path = ''
  for (const [y, row] of m.entries()) for (let x = 0; x < row.length; x++) {
    if (!row[x]) continue
    let wide = 1
    while (row[x + wide]) wide++
    path += `M${x + 4} ${y + 4}h${wide}v1h-${wide}z`
    x += wide - 1
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="${label}"><rect width="${n}" height="${n}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`
}
