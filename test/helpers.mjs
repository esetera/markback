import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc = bytes => {
  let c = 0xffffffff
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const head = Buffer.alloc(4)
  head.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const end = Buffer.alloc(4)
  end.writeUInt32BE(crc(body))
  return Buffer.concat([head, body, end])
}

/** A plain grey picture, so a test needs no picture files and no install. `patch` puts a dark box on it. */
export function writePicture(path, width = 800, height = 500, patch = null) {
  const size = Buffer.alloc(13)
  size.writeUInt32BE(width, 0)
  size.writeUInt32BE(height, 4)
  size.set([8, 2, 0, 0, 0], 8)
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0xdd)])
  const patched = patch && Buffer.from(row)
  if (patch) patched.fill(0x22, 1 + patch.x * 3, 1 + (patch.x + patch.w) * 3)
  const rows = Buffer.concat(Array.from({ length: height }, (_, y) => (patch && y >= patch.y && y < patch.y + patch.h ? patched : row)))
  writeFileSync(path, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', size), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]))
}

/**
 * A stand-in for tesseract, for REVIEW_TESSERACT: it prints, as tesseract's TSV, the words it is given, as though it had read
 * them off a picture of this size. `wait` is how long it takes, in milliseconds. A word with `sure` below 30 is a poor guess.
 */
export function writeReader(path, size, words, { wait = 0 } = {}) {
  const head = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext'
  const rows = [head, `1\t1\t0\t0\t0\t0\t0\t0\t${size.w}\t${size.h}\t-1\t`, ...words.map((w, n) => `4\t1\t1\t1\t${n + 1}\t0\t${w.x}\t${w.y}\t${w.w}\t${w.h}\t-1\t\n5\t1\t1\t1\t${n + 1}\t1\t${w.x}\t${w.y}\t${w.w}\t${w.h}\t${w.sure ?? 96}\t${w.t}`)]
  writeFileSync(path, `#!/usr/bin/env node\nsetTimeout(() => process.stdout.write(${JSON.stringify(`${rows.join('\n')}\n`)}), ${wait})\n`, { mode: 0o755 })
  return path
}
