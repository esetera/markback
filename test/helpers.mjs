import { deflateSync } from 'node:zlib'
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

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
 * A stand-in for the Tailscale program, so a test never touches the real one. It answers `status --json`, `serve status --json`,
 * `serve --bg --https=<port> <target>` and `serve --https=<port> off` as Tailscale does, keeps what it "serves" in a file beside
 * it, and writes down every call. `set` changes what it says: `down` (not running), `backend`, `https`, `tags`, `funnelOnServe`,
 * `noPath` (it will not serve a target with a path).
 */
export function standInTailscale(dir, initial = {}) {
  const program = join(dir, 'tailscale.mjs')
  const file = join(dir, 'tailscale.json')
  // Written whole, under another name, then renamed: a test that reads it while the stand-in writes never sees half of it.
  const write = data => {
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(data))
    renameSync(tmp, file)
  }
  const state = () => {
    for (let tries = 0; ; tries++) {
      try {
        return JSON.parse(readFileSync(file, 'utf8'))
      } catch (error) {
        if (tries >= 20) throw error
        // A copy of the stand-in still at work: a moment later the file is whole again.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
      }
    }
  }
  const set = patch => write({ ...(existsSync(file) ? state() : {}), ...patch })
  set({ host: 'my-mac.example.ts.net', login: 'alice@example.com', backend: 'Running', https: true, down: false, tags: [], funnelOnServe: false, noPath: false, serve: {}, calls: [], ...initial })
  writeFileSync(program, `#!/usr/bin/env node
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
const file = ${JSON.stringify(file)}
const s = JSON.parse(readFileSync(file, 'utf8'))
const words = process.argv.slice(2)
s.calls.push(words.join(' '))
const save = () => {
  const tmp = file + '.' + process.pid + '.tmp'
  writeFileSync(tmp, JSON.stringify(s))
  renameSync(tmp, file)
}
save()
const stop = (text, code = 1) => { console.error(text); process.exit(code) }
if (words[0] === 'version') console.log('1.80.0')
else if (s.down) stop('failed to connect to local Tailscale service; is Tailscale running?')
else if (words[0] === 'status') console.log(JSON.stringify({ BackendState: s.backend, Self: { DNSName: s.backend === 'Running' ? s.host + '.' : '', UserID: 7, Tags: s.tags.length ? s.tags : undefined }, User: { 7: { ID: 7, LoginName: s.tags.length ? 'tagged-devices' : s.login } }, CertDomains: s.https ? [s.host] : null }))
else if (words[0] === 'serve' && words[1] === 'status') console.log(JSON.stringify(s.serve))
else if (words[0] === 'serve') {
  const port = (words.find(w => w.startsWith('--https=')) ?? '--https=443').slice(8)
  const name = s.host + ':' + port
  if (!s.https) stop('Serve is not enabled on your tailnet.')
  if (s.noPath && words.at(-1) !== 'off' && new URL(words.at(-1)).pathname !== '/') stop('invalid target: a path is not supported')
  if (words.at(-1) === 'off') {
    delete s.serve.TCP?.[port]
    delete s.serve.Web?.[name]
    delete s.serve.AllowFunnel?.[name]
  } else {
    s.serve.TCP = { ...s.serve.TCP, [port]: { HTTPS: true } }
    s.serve.Web = { ...s.serve.Web, [name]: { Handlers: { '/': { Proxy: words.at(-1) } } } }
    if (s.funnelOnServe) s.serve.AllowFunnel = { ...s.serve.AllowFunnel, [name]: true }
    console.log('Available within your tailnet:\\n\\nhttps://' + s.host + '/\\n|-- proxy ' + words.at(-1) + '\\n\\nServe started and running in the background.')
  }
  save()
} else stop('unknown command')
`)
  chmodSync(program, 0o755)
  return { program, state, set, calls: () => state().calls }
}

/**
 * A stand-in for what `tailscale serve` does with a request: it sends it on to the target the stand-in Tailscale serves at
 * `name`, with the target's path in front of the request's, the Host as the phone sent it, and the login it writes itself in
 * place of any the caller sent. Returns the port it listens on, here, and how to close it.
 */
export async function standInProxy(tail, name) {
  const { createServer, request } = await import('node:http')
  const server = createServer((req, res) => {
    const proxy = tail.state().serve.Web?.[name]?.Handlers?.['/']?.Proxy
    if (!proxy) {
      res.writeHead(502)
      return res.end()
    }
    const target = new URL(proxy)
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([key]) => !key.startsWith('tailscale-')))
    headers['tailscale-user-login'] = tail.state().login
    const on = request({ host: target.hostname, port: target.port, method: req.method, path: target.pathname.replace(/\/$/, '') + req.url, headers }, answer => {
      res.writeHead(answer.statusCode, answer.headers)
      answer.pipe(res)
    })
    on.on('error', () => {
      res.writeHead(502)
      res.end()
    })
    req.pipe(on)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { port: server.address().port, close: () => server.close() }
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
