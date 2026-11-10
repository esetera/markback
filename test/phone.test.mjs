/**
 * Review from a phone, without Tailscale: a stand-in program takes its place (REVIEW_TAILSCALE), so nothing here runs the real
 * one or changes a real network. Each test has a store, a server and a stand-in of its own.
 */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer as createHttpServer, request } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { standInTailscale } from './helpers.mjs'
import { qr, qrSvg } from '../public/qr.js'
import { phoneMay, warmUp } from '../lib/phone.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = join(ROOT, 'review.mjs')
const work = mkdtempSync(join(tmpdir(), 'review-phone-'))
const servers = []
after(() => {
  for (const server of servers) server.kill()
  rmSync(work, { recursive: true, force: true })
})
const NAME = 'my-mac.example.ts.net'
const ME = 'alice@example.com'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const freePort = () => new Promise((resolve, reject) => {
  const probe = createServer()
  probe.once('error', reject)
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address()
    probe.close(() => resolve(String(port)))
  })
})

/** A store, a stand-in Tailscale and, unless `page` is false, a running review page. */
async function rig({ page = true, tailscale = {}, env: more = {} } = {}) {
  const home = mkdtempSync(join(work, 'home-'))
  const tail = standInTailscale(mkdtempSync(join(work, 'tailscale-')), tailscale)
  const port = await freePort()
  const env = { ...process.env, REVIEW_HOME: home, REVIEW_PORT: port, REVIEW_TAILSCALE: tail.program, REVIEW_PHONE_WARM: 'off', ...more }
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
  /** One request to the server on this computer, as Tailscale hands one over: with the name it was asked for, and who asked. */
  const ask = (path, { host = NAME, login = ME, method = 'GET', headers = {}, body = null } = {}) => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, agent: false, headers: { host, ...(login ? { 'tailscale-user-login': login } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers } }, res => {
      let text = ''
      res.on('data', chunk => (text += chunk))
      res.on('end', () => resolve({ status: res.statusCode, text }))
    })
    req.on('error', reject)
    req.end(body ? JSON.stringify(body) : undefined)
  })
  return { home, tail, port, env, review, ask, server }
}
const served = tail => tail.state().serve.Web ?? {}

test('review phone: off until it is turned on, then it says the address and when it turns off, and off turns it off', async () => {
  const r = await rig()
  const first = r.review('phone')
  assert.match(first.out, /Review from your phone is off/)
  assert.match(first.out, /It needs Tailscale on this computer and on the phone, signed in as the same person/)
  assert.deepEqual(r.tail.calls(), [], 'asking whether it is on asks Tailscale nothing')
  assert.equal((await r.ask('/api/queue')).status, 403, 'off: the tailnet name is not this computer')

  const on = r.review('phone', 'on')
  assert.equal(on.code, 0, on.err)
  assert.match(on.out, /Open https:\/\/my-mac\.example\.ts\.net on your phone/)
  assert.match(on.out, /Nothing is open to the internet/)
  assert.match(on.out, /turns itself off at .*in 30 minutes/)
  assert.match(on.out, /signed in to your Tailscale as alice@example\.com/)
  assert.match(on.out, /Getting it ready for the phone: the first time can take half a minute…\nReady\./)
  // Tailscale serves this page, on this computer only, to the tailnet: in the background, over HTTPS, and nothing more.
  assert.ok(r.tail.calls().includes(`serve --bg --https=443 http://127.0.0.1:${r.port}`))
  assert.deepEqual(served(r.tail), { [`${NAME}:443`]: { Handlers: { '/': { Proxy: `http://127.0.0.1:${r.port}` } } } })
  assert.equal(r.tail.calls().some(call => /funnel/.test(call)), false, 'Funnel is never asked for')
  assert.deepEqual([...new Set(r.tail.calls().map(call => call.split(' ')[0]))].sort(), ['serve', 'status'], 'only reading its state, and serve')
  assert.match(r.review('phone').out, /is on\.\nOpen https:\/\/my-mac\.example\.ts\.net/)
  assert.equal((await r.ask('/api/queue')).status, 200, 'on: the page answers at the tailnet name')

  const off = r.review('phone', 'off')
  assert.match(off.out, /Review from your phone is off/)
  assert.deepEqual(served(r.tail), {}, 'Tailscale no longer serves it')
  assert.ok(r.tail.calls().includes('serve --https=443 off'))
  assert.equal((await r.ask('/api/queue')).status, 403)
  assert.match(r.review('phone', 'off').out, /was not on/)
})

test('the server lets in the one tailnet name, only while it is on, and only the person\'s own devices', async () => {
  const r = await rig()
  r.review('phone', 'on')
  assert.equal((await r.ask('/')).status, 200, 'the page')
  assert.equal((await r.ask('/api/queue', { host: `${NAME}:443` })).status, 200, 'with its port')
  assert.equal((await r.ask('/api/queue', { host: 'other-mac.example.ts.net' })).status, 403, 'another name in the tailnet')
  assert.equal((await r.ask('/api/queue', { host: 'evil.example.com' })).status, 403)
  assert.equal((await r.ask('/api/queue', { host: `${NAME}.evil.example.com` })).status, 403, 'a name that only starts the same')
  // Who asks is said by Tailscale. Someone else in the tailnet, a tagged device, and Funnel traffic (which has no name) stay out.
  assert.equal((await r.ask('/api/queue', { login: 'bob@example.com' })).status, 403)
  const nameless = await r.ask('/api/queue', { login: '' })
  assert.equal(nameless.status, 403)
  assert.match(nameless.text, /your own devices/)
  // Every other check stands: another site's page cannot read or write here by way of the phone's address.
  assert.equal((await r.ask('/api/queue', { headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors' } })).status, 403)
  assert.equal((await r.ask('/api/set-aside', { method: 'POST', headers: { origin: 'https://evil.example.com' }, body: { slugs: [] } })).status, 403)
  assert.equal((await r.ask('/api/set-aside', { method: 'POST', headers: { origin: `https://${NAME}` }, body: { slugs: [] } })).status, 200, 'the page itself, at that address, may write')
  // A phone can turn it off, and cannot turn it on or keep it on.
  const again = await r.ask('/api/phone', { method: 'POST', headers: { origin: `https://${NAME}` }, body: { on: true } })
  assert.equal(again.status, 403)
  assert.match(again.text, /at the computer/)
  assert.equal((await r.ask('/api/phone', { method: 'POST', headers: { origin: `https://${NAME}` }, body: { on: false } })).status, 200)
  assert.equal((await r.ask('/api/queue')).status, 403, 'off: the same request is refused')
  assert.deepEqual(served(r.tail), {})
  // This computer's own names work as before, on or off.
  assert.equal((await r.ask('/api/queue', { host: `localhost:${r.port}`, login: '' })).status, 200)
})

test('a phone reviews and marks, nothing more: what runs things on this computer is refused through Tailscale', async () => {
  const r = await rig()
  r.review('phone', 'on')
  const origin = `https://${NAME}`
  // What the review page needs.
  for (const path of ['/', '/app.js', '/style.css', '/qr.js', '/api/queue', '/api/history?app=x&id=y', '/api/phone']) assert.equal((await r.ask(path)).status, 200, path)
  assert.equal((await r.ask('/images/nothing.png')).status, 404, 'pictures are asked for, and there is none')
  assert.equal((await r.ask('/inbox/nothing.png')).status, 404)
  // An answer reaches the page (a screen that is not there is its own matter); the browser tests send real ones this way.
  assert.notEqual((await r.ask('/api/send', { method: 'POST', headers: { origin }, body: { appSlug: 'none', id: 'none' } })).status, 403, 'answers are let through')
  // Taking a picture drives this computer's own browser to an address; a sample and the work queue write here. Not from a phone.
  const refusedHere = [['POST', '/api/show', { url: 'http://localhost:1/' }], ['POST', '/api/sample', {}], ['GET', '/api/work'], ['POST', '/api/work/ask', { target: 'x' }], ['POST', '/api/work/decide', { id: 'x', decision: 'yes' }], ['GET', '/api/anything-new'], ['PUT', '/api/send', {}], ['DELETE', '/api/queue']]
  for (const [method, path, body] of refusedHere) {
    const got = await r.ask(path, { method, headers: { origin }, body: body ?? null })
    assert.equal(got.status, 403, `${method} ${path}`)
    assert.match(got.text, /Do this at the computer/)
  }
  // At the computer, the same routes are as they were.
  assert.equal((await r.ask('/api/work', { host: `127.0.0.1:${r.port}`, login: '' })).status, 200)
  // The list itself: what is not named is refused.
  assert.equal(phoneMay('GET', '/api/queue'), true)
  assert.equal(phoneMay('POST', '/api/send'), true)
  assert.equal(phoneMay('POST', '/api/show'), false)
  assert.equal(phoneMay('GET', '/api/plugins'), false)
  assert.equal(phoneMay('POST', '/api/film'), false)
  assert.equal(phoneMay('PATCH', '/'), false)
})

test('the page turns it on and off too, from this computer', async () => {
  const r = await rig()
  const local = { host: `127.0.0.1:${r.port}`, login: '' }
  assert.deepEqual(JSON.parse((await r.ask('/api/phone', local)).text), { on: false, minutes: 30 })
  const on = JSON.parse((await r.ask('/api/phone', { ...local, method: 'POST', body: { on: true } })).text)
  assert.equal(on.on, true)
  assert.equal(on.url, `https://${NAME}`)
  assert.equal(JSON.parse((await r.ask('/api/queue', local)).text).phone.url, `https://${NAME}`, 'the page hears of it with the queue')
  assert.equal(JSON.parse((await r.ask('/api/phone', { ...local, method: 'POST', body: { on: false } })).text).on, false)
  assert.deepEqual(served(r.tail), {})
  // What stops it is said in the page as the command says it.
  r.tail.set({ https: false })
  const no = await r.ask('/api/phone', { ...local, method: 'POST', body: { on: true } })
  assert.equal(no.status, 400)
  assert.match(JSON.parse(no.text).error, /HTTPS is not turned on for your tailnet/)
})

test('it turns itself off when its time is up', async () => {
  // A short time for the test: the setting can only make it shorter than 30 minutes.
  const r = await rig({ env: { REVIEW_PHONE_MINUTES: '0.02' } })
  assert.equal(r.review('phone', 'on').code, 0)
  assert.equal((await r.ask('/api/queue')).status, 200)
  assert.ok(served(r.tail)[`${NAME}:443`])
  for (let i = 0; i < 80 && (served(r.tail)[`${NAME}:443`] || existsSync(join(r.home, 'phone.json'))); i++) await sleep(100)
  assert.deepEqual(served(r.tail), {}, 'the server told Tailscale to stop serving it')
  assert.equal((await r.ask('/api/queue')).status, 403)
  assert.match(r.review('phone').out, /is off/)
  const long = await rig({ env: { REVIEW_PHONE_MINUTES: '600' } })
  assert.match(long.review('phone', 'on').out, /in 30 minutes/, 'never longer than 30 minutes')
})

test('review stop turns it off, and so does the server stopping', async () => {
  const r = await rig()
  r.review('phone', 'on')
  assert.match(r.review('stop').out, /Review from your phone is off/)
  assert.deepEqual(served(r.tail), {})
  // The server is stopped by something else, with it on.
  r.review('phone', 'on')
  assert.ok(served(r.tail)[`${NAME}:443`])
  r.server.kill()
  await new Promise(resolve => r.server.once('exit', resolve))
  assert.deepEqual(served(r.tail), {}, 'it took the phone address down as it went')
  assert.equal(existsSync(join(r.home, 'phone.json')), false)
  // Past its time with no server left to turn it off: the next look turns it off, and says what is true.
  const lone = await rig({ env: { REVIEW_PHONE_MINUTES: '0.005' } })
  lone.review('phone', 'on')
  lone.server.kill('SIGKILL')
  await sleep(500)
  assert.match(lone.review('phone').out, /is off/)
  assert.deepEqual(served(lone.tail), {})
})

test('when it cannot work, it says what to do in plain words', async () => {
  const none = await rig({ env: { REVIEW_TAILSCALE: join(work, 'no-such-program') } })
  const missing = none.review('phone', 'on')
  assert.equal(missing.code, 1)
  assert.equal(missing.err.trim(), 'Tailscale is not installed: get it for this computer and your phone at https://tailscale.com/download, and sign in on both.', 'one plain line, with where to get it')

  const down = await rig({ tailscale: { down: true } })
  assert.match(down.review('phone', 'on').err, /Tailscale is not running\. Open Tailscale on this computer, then try again\./)
  const stopped = await rig({ tailscale: { backend: 'Stopped' } })
  assert.match(stopped.review('phone', 'on').err, /Tailscale is not running/)
  const out = await rig({ tailscale: { backend: 'NeedsLogin' } })
  assert.match(out.review('phone', 'on').err, /Tailscale is not signed in\. Open Tailscale on this computer and sign in, then try again\./)

  const plain = await rig({ tailscale: { https: false } })
  assert.match(plain.review('phone', 'on').err, /HTTPS is not turned on for your tailnet\. Turn on HTTPS Certificates at https:\/\/login\.tailscale\.com\/admin\/dns, then try again\./)

  const tagged = await rig({ tailscale: { tags: ['tag:server'] } })
  assert.match(tagged.review('phone', 'on').err, /tagged device/)

  const closed = await rig({ page: false })
  assert.match(closed.review('phone', 'on').err, /The review page is not running\. Start it with: review start/)

  for (const r of [none, down, stopped, out, plain, tagged, closed]) {
    assert.equal(existsSync(join(r.home, 'phone.json')), false, 'nothing is on')
    assert.equal(r.tail.calls().some(call => /^serve --bg/.test(call)), false, 'and Tailscale was not asked to serve')
    assert.equal(r.tail.calls().some(call => /^(up|down|login|logout|set|install)\b/.test(call)), false, 'nor to sign in, start or change anything')
  }
  assert.match(none.review('phone', 'sideways').err, /review phone \| phone on \| phone off/)
})

test('the Mac App Store Tailscale is found at the app\'s own program, with none on the PATH; not installed only when neither is there', async () => {
  // A PATH with only node on it, so no tailscale is found there, and the app at a place of the test's own.
  const app = join(mkdtempSync(join(work, 'apps-')), 'Tailscale.app', 'Contents', 'MacOS', 'Tailscale')
  const env = { REVIEW_TAILSCALE: '', REVIEW_TAILSCALE_APP: app, PATH: dirname(process.execPath) }
  const r = await rig({ env })
  const missing = r.review('phone', 'on')
  assert.equal(missing.code, 1)
  assert.match(missing.err, /^Tailscale is not installed: get it for this computer and your phone at https:\/\/tailscale\.com\/download/)
  // The stand-in put where the App Store puts the app: it is the one asked, and it serves the page.
  mkdirSync(dirname(app), { recursive: true })
  copyFileSync(r.tail.program, app)
  const on = r.review('phone', 'on')
  assert.equal(on.code, 0, on.err)
  assert.match(on.out, /Open https:\/\/my-mac\.example\.ts\.net on your phone/)
  assert.ok(r.tail.calls().includes(`serve --bg --https=443 http://127.0.0.1:${r.port}`))
  assert.match(r.review('phone', 'off').out, /is off/)
  assert.deepEqual(served(r.tail), {})
})

test('turned on, the address is visited once from here, so Tailscale makes its certificate before the phone asks', async () => {
  let visits = 0
  const site = createHttpServer((req, res) => res.end(String(++visits)))
  await new Promise(resolve => site.listen(0, '127.0.0.1', resolve))
  try {
    assert.equal(await warmUp(`http://127.0.0.1:${site.address().port}/`), true)
    assert.equal(visits, 1)
  } finally {
    site.close()
  }
  // Nothing answers: it says so, and does not wait past its time.
  const started = Date.now()
  assert.equal(await warmUp(`http://127.0.0.1:${await freePort()}/`, 2000), false)
  assert.ok(Date.now() - started < 3000)
})

test('nothing is opened to the internet: Funnel is refused, however it is asked for or found', async () => {
  const r = await rig()
  for (const words of [['phone', 'on', '--funnel'], ['phone', 'on', '--public'], ['phone', 'funnel']]) {
    const ran = r.review(...words)
    assert.equal(ran.code, 1)
    assert.match(ran.err, /Markback never opens the review page to the internet\. It does not use Tailscale Funnel\./)
  }
  assert.deepEqual(r.tail.calls(), [], 'Tailscale was not even asked')

  // Funnel is already on for the address this page would be served at: serving there would be open to the internet.
  const target = `http://127.0.0.1:${r.port}`
  r.tail.set({ serve: { TCP: { 443: { HTTPS: true } }, Web: { [`${NAME}:443`]: { Handlers: { '/': { Proxy: target } } } }, AllowFunnel: { [`${NAME}:443`]: true } } })
  const open = r.review('phone', 'on')
  assert.equal(open.code, 1)
  assert.match(open.err, /Tailscale Funnel is on for https:\/\/my-mac\.example\.ts\.net, which opens it to the internet\. Markback will not serve the review page there/)
  assert.equal(existsSync(join(r.home, 'phone.json')), false)
  assert.equal((await r.ask('/api/queue')).status, 403)

  // Funnel comes on with the serve: it is found on the look that follows, taken down, and refused.
  const late = await rig({ tailscale: { funnelOnServe: true } })
  const ran = late.review('phone', 'on')
  assert.equal(ran.code, 1)
  assert.match(ran.err, /Funnel is on/)
  assert.deepEqual(served(late.tail), {}, 'what was just served is taken down again')
  assert.equal(existsSync(join(late.home, 'phone.json')), false)

  // The one place every Tailscale command passes refuses the word itself, and every command but status and serve.
  const { allowed } = await import('../lib/phone.mjs')
  assert.throws(() => allowed(['funnel', '443']), /never opens the review page to the internet/)
  assert.throws(() => allowed(['serve', '--funnel']), /never opens/)
  for (const word of ['up', 'down', 'logout', 'login', 'set']) assert.throws(() => allowed([word]), new RegExp(`does not run tailscale ${word}`))
  assert.deepEqual(allowed(['serve', 'status', '--json']), ['serve', 'status', '--json'])
})

test('what Tailscale already serves for the person is left alone', async () => {
  const theirs = { TCP: { 443: { HTTPS: true } }, Web: { [`${NAME}:443`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:3000' } } } } }
  const r = await rig({ tailscale: { serve: theirs } })
  const on = r.review('phone', 'on')
  assert.match(on.out, /Open https:\/\/my-mac\.example\.ts\.net:8443 on your phone/, 'the next port, not theirs')
  assert.equal((await r.ask('/api/queue', { host: `${NAME}:8443` })).status, 200)
  r.review('phone', 'off')
  assert.deepEqual(r.tail.state().serve.Web, theirs.Web, 'theirs is still served, and only ours is gone')
  assert.equal(r.tail.calls().includes('serve --https=443 off'), false)
  // If what Markback set up has since been replaced by something of theirs, turning off leaves that alone too.
  r.review('phone', 'on')
  const replaced = r.tail.state().serve
  replaced.Web[`${NAME}:8443`].Handlers['/'].Proxy = 'http://127.0.0.1:4000'
  r.tail.set({ serve: replaced })
  r.review('phone', 'off')
  assert.equal(r.tail.state().serve.Web[`${NAME}:8443`].Handlers['/'].Proxy, 'http://127.0.0.1:4000')
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
  const url = `https://${NAME}`
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
