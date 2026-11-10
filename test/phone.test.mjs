/**
 * Review from a phone on the same Wi-Fi. The door for the phone is opened on 127.0.0.1 here (REVIEW_PHONE_HOST), so a test never
 * listens on the real network. Each test has a store and a server of its own.
 */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { request } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { qr, qrSvg } from '../public/qr.js'
import { isPrivate, localAddress } from '../lib/phone.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = join(ROOT, 'review.mjs')
const work = mkdtempSync(join(tmpdir(), 'review-phone-'))
const servers = []
after(() => {
  for (const server of servers) server.kill()
  rmSync(work, { recursive: true, force: true })
})
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const freePort = () => new Promise((resolve, reject) => {
  const probe = createServer()
  probe.once('error', reject)
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address()
    probe.close(() => resolve(String(port)))
  })
})

/** A store and, unless `page` is false, a running review page. */
async function rig({ page = true, env: more = {} } = {}) {
  const home = mkdtempSync(join(work, 'home-'))
  const port = await freePort()
  const env = { ...process.env, REVIEW_HOME: home, REVIEW_PORT: port, REVIEW_PHONE_HOST: '127.0.0.1', ...more }
  const review = (...words) => {
    const ran = spawnSync('node', [CLI, ...words], { env, encoding: 'utf8' })
    return { code: ran.status, out: ran.stdout, err: ran.stderr }
  }
  let server = null
  if (page) {
    server = spawn('node', [join(ROOT, 'server.mjs')], { env, stdio: 'ignore' })
    servers.push(server)
    for (let i = 0; i < 100; i++) {
      if (await fetch(`http://127.0.0.1:${port}/api/queue`).then(r => r.ok, () => false)) break
      await sleep(100)
    }
  }
  return { home, port, env, review, server }
}
/** The page on this computer, as its own page asks. */
const local = async (r, path, body) => (await fetch(`http://127.0.0.1:${r.port}${path}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})).json()

/** One request to an address, as a phone's browser would send it: with the headers given, and without following a redirect. */
const ask = (address, path, { method = 'GET', headers = {}, body = null } = {}) => new Promise((resolve, reject) => {
  const { hostname, port } = new URL(address)
  const req = request({ host: hostname, port, path, method, agent: false, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers } }, res => {
    let text = ''
    res.on('data', chunk => (text += chunk))
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }))
  })
  req.on('error', reject)
  req.end(body ? JSON.stringify(body) : undefined)
})
const refused = (address, path = '/') => ask(address, path).then(() => false, error => error.code === 'ECONNREFUSED')

test('review phone: off until it is turned on, then the address with its code, and off closes it', async () => {
  const r = await rig()
  assert.match(r.review('phone').out, /Review from your phone is off\. The page answers this computer only\./)
  assert.deepEqual(await local(r, '/api/phone'), { on: false, minutes: 30 })

  const on = r.review('phone', 'on')
  assert.equal(on.code, 0, on.err)
  const url = on.out.match(/http:\/\/127\.0\.0\.1:\d+\/\?key=[\w-]+/)?.[0]
  assert.ok(url, on.out)
  assert.notEqual(new URL(url).port, r.port, 'a door of its own, not the page this computer uses')
  assert.match(on.out, /on the same Wi-Fi as this computer/)
  assert.match(on.out, /The code at the end of the address is new each time\. Others on the network see nothing without it\./)
  assert.match(on.out, /It turns itself off at .*To turn it off now: review phone off/)
  assert.equal(new URL(url).searchParams.get('key').length, 24, 'eighteen random bytes: not to be guessed')
  const status = await local(r, '/api/phone')
  assert.equal(status.on, true)
  assert.equal(status.url, url)
  assert.ok(Date.parse(status.until) - Date.now() > 29 * 60000, 'for 30 minutes')
  assert.match(r.review('phone').out, /is on\./)
  assert.equal((await ask(url, `/?key=${status.url.split('key=')[1]}`)).status, 303, 'the door answers')

  assert.match(r.review('phone', 'off').out, /Review from your phone is off/)
  assert.equal(await refused(url), true, 'off: nothing listens there any more')
  assert.equal((await local(r, '/api/phone')).on, false)
  assert.match(r.review('phone', 'off').out, /was not on/)
  assert.match(r.review('phone', 'sideways').err, /review phone \| phone on \| phone off/)
})

test('the door lets in only the code: once in the address, then kept by the browser', async () => {
  const r = await rig()
  const { url } = await local(r, '/api/phone', { on: true })
  const key = new URL(url).searchParams.get('key')
  const door = new URL(url).origin
  // Without the code, or with a wrong one, nothing: not the page, not the screens, not a write.
  for (const path of ['/', '/api/queue', '/api/phone', '/app.js', '/?key=wrong', `/?key=${key.slice(0, -1)}x`]) {
    const got = await ask(door, path)
    assert.equal(got.status, 403, path)
    assert.match(got.text, /needs the code from the computer/)
  }
  assert.equal((await ask(door, '/api/set-aside', { method: 'POST', body: { slugs: ['x'] } })).status, 403)
  assert.equal((await ask(door, '/', { headers: { cookie: 'markback-key=wrong' } })).status, 403)

  // The address from the code: the browser keeps the code, and the address it goes on to has lost it.
  const first = await ask(door, `/?undo=40&key=${key}`)
  assert.equal(first.status, 303)
  assert.equal(first.headers.location, '/?undo=40')
  assert.match(first.headers['set-cookie'][0], new RegExp(`^markback-key=${key}; Path=/; HttpOnly; SameSite=Strict$`))
  const cookie = `markback-key=${key}`
  assert.equal((await ask(door, '/', { headers: { cookie } })).status, 200)
  const queue = JSON.parse((await ask(door, '/api/queue', { headers: { cookie } })).text)
  assert.deepEqual(queue.apps, [])
  assert.equal((await ask(door, '/api/set-aside', { method: 'POST', headers: { cookie, origin: door }, body: { slugs: [] } })).status, 200, 'the page at the door may write')
  // Another site open on the phone cannot write or read through the door, even with the browser's cookie.
  assert.equal((await ask(door, '/api/set-aside', { method: 'POST', headers: { cookie, origin: 'http://evil.example.com' }, body: { slugs: [] } })).status, 403)
  assert.equal((await ask(door, '/api/queue', { headers: { cookie, 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors' } })).status, 403)
  // Taking a picture drives this computer's browser: not from the phone.
  assert.equal((await ask(door, '/api/show', { method: 'POST', headers: { cookie, origin: door }, body: { url: 'http://localhost:1/' } })).status, 403)
  // The phone can close the door, and cannot open it or keep it open longer.
  const again = await ask(door, '/api/phone', { method: 'POST', headers: { cookie, origin: door }, body: { on: true } })
  assert.equal(again.status, 403)
  assert.match(again.text, /Turn it on at the computer/)
  assert.equal((await ask(door, '/api/phone', { method: 'POST', headers: { cookie, origin: door }, body: { on: false } })).status, 200)
  // It closes as soon as its answer has gone.
  for (let i = 0; i < 30 && !(await refused(door)); i++) await sleep(50)
  assert.equal(await refused(door), true)

  // Opened again: a new door with a new code. The old code opens nothing.
  const next = await local(r, '/api/phone', { on: true })
  assert.notEqual(next.url, url)
  const old = await ask(new URL(next.url).origin, '/', { headers: { cookie } })
  assert.equal(old.status, 403)
  // Turned on while on: the same door and code, for 30 minutes from now.
  const still = await local(r, '/api/phone', { on: true })
  assert.equal(still.url, next.url)
  // The page this computer uses is as it was: another name than this computer's is refused there.
  assert.equal((await ask(`http://127.0.0.1:${r.port}`, '/api/queue', { headers: { host: 'phone.example' } })).status, 403)
})

test('it turns itself off when its time is up, and never stays on longer than 30 minutes', async () => {
  // A short time for the test: the setting can only make it shorter than 30 minutes.
  const r = await rig({ env: { REVIEW_PHONE_MINUTES: '0.02' } })
  const { url } = await local(r, '/api/phone', { on: true })
  assert.equal((await ask(url, new URL(url).pathname + new URL(url).search)).status, 303)
  for (let i = 0; i < 60 && !(await refused(url)); i++) await sleep(100)
  assert.equal(await refused(url), true)
  assert.equal((await local(r, '/api/phone')).on, false)
  const long = await rig({ env: { REVIEW_PHONE_MINUTES: '600' } })
  assert.equal((await local(long, '/api/phone', { on: true })).minutes, 30)
})

test('review stop closes the door with the page', async () => {
  const r = await rig({ page: false })
  assert.match(r.review('start').out, /Open http:\/\/localhost/)
  const on = r.review('phone', 'on')
  const url = on.out.match(/http:\/\/127\.0\.0\.1:\d+\/\?key=[\w-]+/)[0]
  assert.match(r.review('stop').out, /Stopped\. Review from your phone is off\./)
  for (let i = 0; i < 30 && !(await refused(url)); i++) await sleep(100)
  assert.equal(await refused(url), true)
  assert.match(r.review('phone').out, /is off\. The review page is not running/)
  assert.match(r.review('phone', 'on').err, /The review page is not running\. Start it with: review start/)
})

test('when it cannot open, it says why in plain words, and nothing is open', async () => {
  // An address this computer does not have: listening there fails.
  const r = await rig({ env: { REVIEW_PHONE_HOST: '192.0.2.1' } })
  const ran = r.review('phone', 'on')
  assert.equal(ran.code, 1)
  assert.match(ran.err, /could not listen for your phone at 192\.0\.2\.1/)
  assert.equal((await local(r, '/api/phone')).on, false)
})

test('the address is one only a local network uses, never one the internet reaches', () => {
  for (const ip of ['10.0.0.5', '192.168.1.20', '172.16.0.1', '172.31.255.1']) assert.equal(isPrivate(ip), true, ip)
  for (const ip of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '169.254.1.1', '100.64.0.1', '127.0.0.1', '']) assert.equal(isPrivate(ip), false, ip)
  const saved = process.env.REVIEW_PHONE_HOST
  delete process.env.REVIEW_PHONE_HOST
  try {
    const net = (address, more = {}) => ({ address, family: 'IPv4', internal: false, ...more })
    assert.equal(localAddress({ lo0: [net('127.0.0.1', { internal: true })], en9: [net('203.0.113.7'), { address: 'fd00::1', family: 'IPv6', internal: false }], en0: [net('169.254.3.3'), net('192.168.1.20')] }), '192.168.1.20')
    assert.equal(localAddress({ lo0: [net('127.0.0.1', { internal: true })], en0: [net('203.0.113.7')] }), '', 'none: it stays closed')
  } finally {
    if (saved !== undefined) process.env.REVIEW_PHONE_HOST = saved
  }
})

test('the code to scan: right for a known address, and none for one that is too long', () => {
  // Read back by Chrome's own reader (BarcodeDetector); the browser tests read the one the page shows the same way.
  const rows = qr('https://my-mac.example.ts.net').map(row => row.map(on => (on ? '#' : '.')).join(''))
  assert.deepEqual(rows, [
    '#######.#...#...#.#######',
    '#.....#..###..#...#.....#',
    '#.###.#.###.###.#.#.###.#',
    '#.###.#.###..##.#.#.###.#',
    '#.###.#.#...#####.#.###.#',
    '#.....#...#.###...#.....#',
    '#######.#.#.#.#.#.#######',
    '..........###...#........',
    '####..#.#.#...#.##..###.#',
    '.##.....#.##..#.##.#...#.',
    '.##...#.####..#..####....',
    '.#...#...#####.#.#..###..',
    '..#.#.#.#######...#.#.###',
    '...##...#...####.####...#',
    '.#.#.##..#...##..##.#.##.',
    '#...##.##..#.....####...#',
    '..#.#.##..#..#..#########',
    '........#..#.#..#...#.#.#',
    '#######..##...#.#.#.#.###',
    '#.....#..##....##...#....',
    '#.###.#..#..#...######.##',
    '#.###.#.####.#...##.#####',
    '#.###.#.#.##.#...##.#.##.',
    '#.....#.##..##...##.#.#..',
    '#######.#....##..########',
  ])
  // Each size holds what the standard says it does, and one byte more takes the next size.
  for (const [bytes, size] of [[17, 21], [18, 25], [32, 25], [33, 29], [53, 29], [54, 33], [78, 33], [79, 37], [106, 37]]) assert.equal(qr('x'.repeat(bytes)).length, size)
  assert.equal(qr('x'.repeat(107)), null)
  assert.equal(qrSvg('x'.repeat(107)), '')
  assert.match(qrSvg('https://my-mac.example.ts.net'), /^<svg [^>]*viewBox="0 0 33 33"/, 'with the clear edge a reader needs')
})

test('review phone --code: the terminal draws the same code, with its clear edge', async () => {
  const r = await rig()
  const out = r.review('phone', 'on', '--code').out
  const url = out.match(/http:\/\/127\.0\.0\.1:\d+\/\?key=[\w-]+/)[0]
  const lines = out.split('\n').filter(line => /^[█▀▄ ]+$/.test(line) && line.includes('█'))
  const m = qr(url)
  const n = m.length
  assert.equal(lines.length, Math.ceil((n + 8) / 2))
  // Back to the rows of the code: a full block is light above and below, a space dark in both, a half block one of each.
  const rows = []
  for (const line of lines) {
    rows.push([...line].map(c => c === ' ' || c === '▄'))
    rows.push([...line].map(c => c === ' ' || c === '▀'))
  }
  for (let y = -4; y < n + 4; y++) for (let x = -4; x < n + 4; x++) {
    const inside = x >= 0 && y >= 0 && x < n && y < n
    assert.equal(rows[y + 4][x + 4], inside ? m[y][x] : false, `${x},${y}`)
  }
})
