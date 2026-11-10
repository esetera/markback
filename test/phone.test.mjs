/**
 * Review from a phone, without Tailscale: a stand-in program takes its place (REVIEW_TAILSCALE), so nothing here runs the real
 * one or changes a real network. Each test has a store, a server and a stand-in of its own. A phone's request is sent to the
 * door the stand-in was told to serve, as Tailscale hands it on: with the name the phone asked for, and who asked.
 */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { createServer as createHttpServer, request } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { standInTailscale, writePicture } from './helpers.mjs'
import { qr, qrSvg } from '../public/qr.js'
import { allowed, phoneMay, warmUp } from '../lib/phone.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = join(ROOT, 'review.mjs')
const work = mkdtempSync(join(tmpdir(), 'review-phone-'))
const servers = []
after(() => {
  for (const server of servers) server.kill('SIGKILL')
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
const served = tail => tail.state().serve.Web ?? {}
/** The door's port, from what the stand-in serves at an address. */
const doorOf = (tail, at = `${NAME}:443`) => new URL(served(tail)[at]?.Handlers['/'].Proxy ?? 'http://127.0.0.1:1').port
/** The path Tailscale was told to put in front of every request: the door's secret. */
const secretOf = (tail, at = `${NAME}:443`) => new URL(served(tail)[at]?.Handlers['/'].Proxy ?? 'http://127.0.0.1:1').pathname.replace(/\/$/, '')
const records = home => (existsSync(join(home, 'phone')) ? readdirSync(join(home, 'phone')) : [])

/** One request to a port on this computer, without a proxy's help: every header is as given. */
const send = (port, path, { method = 'GET', headers = {}, body = null } = {}) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port, path, method, agent: false, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers } }, res => {
    let text = ''
    res.on('data', chunk => (text += chunk))
    res.on('end', () => resolve({ status: res.statusCode, text }))
  })
  req.on('error', reject)
  req.end(body ? JSON.stringify(body) : undefined)
})
const refused = port => send(port, '/').then(() => false, error => error.code === 'ECONNREFUSED')

/** A server on a store, with its port; `home` shares a store between servers. */
async function startServer(env) {
  const server = spawn('node', [join(ROOT, 'server.mjs')], { env, stdio: 'ignore' })
  servers.push(server)
  for (let i = 0; i < 100; i++) {
    if (await fetch(`http://127.0.0.1:${env.REVIEW_PORT}/api/queue`).then(r => r.ok, () => false)) break
    await sleep(100)
  }
  return server
}

/** A store, a stand-in Tailscale and, unless `page` is false, a running review page. */
async function rig({ page = true, tailscale = {}, env: more = {}, home = mkdtempSync(join(work, 'home-')), tail = standInTailscale(mkdtempSync(join(work, 'tailscale-')), tailscale) } = {}) {
  const port = await freePort()
  const env = { ...process.env, REVIEW_HOME: home, REVIEW_PORT: port, REVIEW_TAILSCALE: tail.program, REVIEW_PHONE_WARM: 'off', ...more }
  const review = (...words) => {
    const ran = spawnSync('node', [CLI, ...words], { env, encoding: 'utf8' })
    return { code: ran.status, out: ran.stdout, err: ran.stderr }
  }
  const server = page ? await startServer(env) : null
  /** As a phone asks through Tailscale: to the door, with the tailnet name and the login Tailscale writes. */
  // The secret path Tailscale puts in front, unless `bare`: as a page that renamed itself to the door would ask.
  const ask = (path, { host = NAME, login = ME, at, bare = false, headers = {}, ...rest } = {}) => send(doorOf(tail, at), `${bare ? '' : secretOf(tail, at)}${path}`, { headers: { host, ...(login ? { 'tailscale-user-login': login } : {}), ...headers }, ...rest })
  /** As this computer's own page asks. */
  const local = (path, { headers = {}, ...rest } = {}) => send(port, path, { headers: { host: `127.0.0.1:${port}`, ...headers }, ...rest })
  return { home, tail, port, env, review, ask, local, server }
}

test('review phone: off until it is turned on, then it says the address and when it turns off, and off turns it off', async () => {
  const r = await rig()
  const first = r.review('phone')
  assert.match(first.out, /Review from your phone is off/)
  assert.match(first.out, /It needs Tailscale on this computer and on the phone, signed in as the same person/)
  assert.deepEqual(r.tail.calls(), [], 'asking whether it is on asks Tailscale nothing')

  const on = r.review('phone', 'on')
  assert.equal(on.code, 0, on.err)
  assert.match(on.out, /Open https:\/\/my-mac\.example\.ts\.net on your phone/)
  assert.match(on.out, /Nothing is open to the internet/)
  assert.match(on.out, /turns itself off at .*in 30 minutes/)
  assert.match(on.out, /signed in to your Tailscale as alice@example\.com/)
  assert.match(on.out, /Getting it ready for the phone: the first time can take half a minute…\nReady\./)
  // Tailscale serves the door, a listener of its own on this computer, not the page's own port.
  const door = doorOf(r.tail)
  assert.notEqual(door, r.port)
  assert.ok(r.tail.calls().includes(`serve --bg --https=443 http://127.0.0.1:${door}${secretOf(r.tail)}`), 'the door, with its secret path in front')
  assert.deepEqual(Object.keys(served(r.tail)), [`${NAME}:443`])
  assert.equal(r.tail.calls().some(call => /funnel/.test(call)), false, 'Funnel is never asked for')
  assert.match(r.review('phone').out, /is on\.\nOpen https:\/\/my-mac\.example\.ts\.net/)
  assert.equal((await r.ask('/api/queue')).status, 200, 'on: the phone is answered at the door')

  const off = r.review('phone', 'off')
  assert.match(off.out, /Review from your phone is off/)
  assert.deepEqual(served(r.tail), {}, 'Tailscale no longer serves it')
  assert.ok(r.tail.calls().includes('serve --https=443 off'))
  assert.equal(await refused(door), true, 'and the door is closed')
  assert.deepEqual(records(r.home), [])
  assert.match(r.review('phone', 'off').out, /was not on/)
})

test('the door lets in only the person\'s own login, whatever name a request gives, and never with the rights of the computer', async () => {
  const r = await rig()
  r.review('phone', 'on')
  const origin = `https://${NAME}`
  assert.equal((await r.ask('/')).status, 200)
  // Someone else in the tailnet, a tagged device and Funnel traffic carry another login or none.
  for (const login of ['bob@example.com', '']) {
    const got = await r.ask('/api/queue', { login })
    assert.equal(got.status, 403, login || 'no login')
    assert.match(got.text, /Only your own devices/)
  }
  // The first request with the secret said Tailscale hands on the phone's name: from then on the name must be the tailnet's.
  assert.equal(JSON.parse((await r.local('/api/phone')).text).hostGuard, true)
  for (const host of ['localhost', `127.0.0.1:${r.port}`, '[::1]', 'evil.example.com']) assert.equal((await r.ask('/api/queue', { host })).status, 404, host)
  // Another site's page on the phone cannot read or write through the door.
  assert.equal((await r.ask('/api/queue', { headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors' } })).status, 403)
  assert.equal((await r.ask('/api/set-aside', { method: 'POST', headers: { origin: 'https://evil.example.com' }, body: { slugs: [] } })).status, 403)
  assert.equal((await r.ask('/api/set-aside', { method: 'POST', headers: { origin }, body: { slugs: [] } })).status, 200, 'the page itself, at that address, may write')
  // A phone can turn it off.
  const door = doorOf(r.tail)
  assert.equal((await r.ask('/api/phone', { method: 'POST', headers: { origin }, body: { on: false } })).status, 200)
  for (let i = 0; i < 30 && !(await refused(door)); i++) await sleep(50)
  assert.equal(await refused(door), true)
  for (let i = 0; i < 30 && Object.keys(served(r.tail)).length; i++) await sleep(50)
  assert.deepEqual(served(r.tail), {})
})

test('where Tailscale hands on another name, a name that says this computer still has only a phone\'s rights', async () => {
  const r = await rig()
  r.review('phone', 'on')
  // The first request with the secret comes with a name that is not the tailnet's: no name guard, and still only a phone.
  assert.equal((await r.ask('/api/queue', { host: `127.0.0.1:${doorOf(r.tail)}` })).status, 200)
  assert.equal(JSON.parse((await r.local('/api/phone')).text).hostGuard, false)
  for (const host of ['localhost', `127.0.0.1:${r.port}`, '[::1]']) {
    assert.equal((await r.ask('/api/queue', { host })).status, 200, `${host}: the review is there`)
    assert.equal((await r.ask('/api/work', { host })).status, 403, `${host}: the work queue is not`)
    assert.equal((await r.ask('/api/work/ask', { host, method: 'POST', headers: { origin: `http://${host}` }, body: { target: 'x' } })).status, 403)
    assert.equal((await r.ask('/api/show', { host, method: 'POST', headers: { origin: `http://${host}` }, body: { url: 'http://localhost:1/' } })).status, 403)
    assert.equal((await r.ask('/api/phone', { host, method: 'POST', headers: { origin: `http://${host}` }, body: { on: true } })).status, 403, `${host}: it cannot be kept on from a phone`)
    for (const login of ['bob@example.com', '']) assert.equal((await r.ask('/api/queue', { host, login })).status, 403)
  }
})

test('a page that renames itself to the door, and sends the login itself, gets nothing without the secret Tailscale adds', async () => {
  const r = await rig()
  const on = r.review('phone', 'on')
  const door = doorOf(r.tail)
  const secret = secretOf(r.tail)
  assert.match(secret, /^\/[\w-]{32}$/, 'a long random path, made new each time')
  // Same origin as the door, owner's login, every name: 404, with no hint.
  for (const host of [`evil.example.com:${door}`, `127.0.0.1:${door}`, NAME]) {
    for (const path of ['/', '/api/queue', '/app.js', '/api/phone/echo', `${secret.slice(0, -1)}x/api/queue`, `/x${secret}/api/queue`]) {
      const got = await r.ask(path, { host, bare: true, headers: { origin: `http://${host}` } })
      assert.equal(got.status, 404, `${host} ${path}`)
      assert.equal(got.text, 'Not found')
    }
    assert.equal((await r.ask('/api/send', { host, bare: true, method: 'POST', headers: { origin: `http://${host}` }, body: { appSlug: 'x', id: 'y' } })).status, 404)
  }
  // The secret is never said: not to the page, not by the command, not in what a phone is sent.
  assert.equal(on.out.includes(secret.slice(1)), false)
  assert.equal((await r.local('/api/phone')).text.includes(secret.slice(1)), false)
  assert.equal((await r.local('/api/queue')).text.includes(secret.slice(1)), false)
  assert.equal((await r.ask('/api/queue')).text.includes(secret.slice(1)), false)
  assert.equal((await r.ask('/')).text.includes(secret.slice(1)), false)
  // Kept only in the server's own record, which only this computer's person may read.
  const { statSync, readFileSync } = await import('node:fs')
  const file = join(r.home, 'phone', `${r.port}.json`)
  assert.equal(statSync(file).mode & 0o777, 0o600)
  assert.equal(statSync(join(r.home, 'phone')).mode & 0o077, 0)
  assert.ok(readFileSync(file, 'utf8').includes(secret.slice(1)))
  // Opened again: a new secret, and the old one opens nothing.
  r.review('phone', 'off')
  r.review('phone', 'on')
  assert.notEqual(secretOf(r.tail), secret)
  assert.equal((await r.ask(`${secret}/api/queue`, { bare: true })).status, 404)
})

test('where Tailscale will not serve a path, the door knows its requests by the tailnet name, and says so', async () => {
  const r = await rig({ tailscale: { noPath: true } })
  assert.equal(r.review('phone', 'on').code, 0)
  const calls = r.tail.calls().filter(call => call.startsWith('serve --bg'))
  assert.equal(calls.length, 2)
  assert.match(calls[0], /^serve --bg --https=443 http:\/\/127\.0\.0\.1:\d+\/[\w-]{32}$/, 'a path was asked for first')
  assert.match(calls[1], /^serve --bg --https=443 http:\/\/127\.0\.0\.1:\d+$/)
  const status = JSON.parse((await r.local('/api/phone')).text)
  assert.equal(status.guard, 'host')
  assert.equal(status.hostGuard, true)
  assert.equal((await r.ask('/api/queue')).status, 200, 'the tailnet name, and the owner')
  assert.equal((await r.ask('/api/queue', { host: `${NAME}:443` })).status, 200)
  for (const host of [`evil.example.com:${doorOf(r.tail)}`, 'localhost', `127.0.0.1:${doorOf(r.tail)}`]) assert.equal((await r.ask('/api/queue', { host })).status, 404, host)
  assert.equal((await r.ask('/api/queue', { login: 'bob@example.com' })).status, 403)
  const echo = JSON.parse((await r.ask('/api/phone/echo')).text)
  assert.deepEqual(echo, { host: NAME, guard: 'host', hostGuard: true })
  r.review('phone', 'off')
  assert.deepEqual(served(r.tail), {})
})

test('the page\'s own listener never takes a request a proxy handed on', async () => {
  const r = await rig()
  r.review('phone', 'on')
  assert.equal((await r.local('/api/work')).status, 200, 'this computer, as before')
  for (const headers of [{ 'tailscale-user-login': ME }, { 'Tailscale-User-Name': 'Alice' }, { 'x-forwarded-for': '100.101.102.103' }, { 'x-forwarded-host': NAME }, { 'x-forwarded-proto': 'https' }]) {
    for (const path of ['/', '/api/queue', '/api/work']) assert.equal((await r.local(path, { headers })).status, 403, `${JSON.stringify(headers)} ${path}`)
    assert.equal((await r.local('/api/phone', { method: 'POST', headers, body: { on: true } })).status, 403)
  }
  // Another name than this computer's is refused there too, as before.
  assert.equal((await r.local('/api/queue', { headers: { host: NAME } })).status, 403)
})

test('a phone reviews and marks, nothing more: what runs things on this computer, or is not named, is refused', async () => {
  const r = await rig()
  r.review('phone', 'on')
  const origin = `https://${NAME}`
  for (const path of ['/', '/index.html', '/app.js', '/annotate.js', '/mic.js', '/qr.js', '/flow.js', '/style.css', '/icon.svg', '/api/queue', '/api/history?app=x&id=y', '/api/phone']) assert.equal((await r.ask(path)).status, 200, path)
  assert.equal((await r.ask('/images/nothing.png')).status, 404, 'pictures are asked for, and there is none')
  assert.equal((await r.ask('/inbox/nothing.png')).status, 404)
  // The film of a screen plays on a phone: its rounds are read. Making it into a video file runs ffmpeg here: refused.
  assert.equal((await r.ask('/api/film?app=x&id=y')).status, 200)
  assert.equal((await r.ask('/api/film/file?app=x&id=y')).status, 403)
  assert.equal(phoneMay('GET', '/api/film/file'), false)
  // An answer reaches the page (a screen that is not there is its own matter); the browser tests send real ones this way.
  assert.notEqual((await r.ask('/api/send', { method: 'POST', headers: { origin }, body: { appSlug: 'none', id: 'none' } })).status, 403, 'answers are let through')
  const refusedHere = [['POST', '/api/show', { url: 'http://localhost:1/' }], ['POST', '/api/sample', {}], ['GET', '/api/work'], ['POST', '/api/work/ask', { target: 'x' }], ['POST', '/api/work/decide', { id: 'x', decision: 'yes' }], ['GET', '/api/anything-new'], ['GET', '/work.html'], ['GET', '/work.js'], ['GET', '/a-file-added-later.js'], ['GET', '/images/'], ['GET', '/x/../api/work'], ['HEAD', '/'], ['PUT', '/api/send', {}], ['DELETE', '/api/queue']]
  for (const [method, path, body] of refusedHere) {
    const got = await r.ask(path, { method, headers: { origin }, body: body ?? null })
    assert.equal(got.status, 403, `${method} ${path}`)
  }
  assert.equal(phoneMay('GET', '/api/queue'), true)
  assert.equal(phoneMay('POST', '/api/send'), true)
  assert.equal(phoneMay('POST', '/api/show'), false)
  assert.equal(phoneMay('GET', '/api/plugins'), false)
  assert.equal(phoneMay('GET', '/work.html'), false)
  assert.equal(phoneMay('POST', '/api/film'), false)
  assert.equal(phoneMay('PATCH', '/'), false)
})

test('a phone is sent nothing of this computer: no path, no folder, no wake command, in any reply', async () => {
  const r = await rig()
  // A project folder with a picture in it, pushed from there, a wake command set there, and marks that wait unheard.
  const project = mkdtempSync(join(work, 'project-folder-'))
  const picture = join(project, 'home-shot.png')
  writePicture(picture, 800, 500)
  const inProject = (...words) => spawnSync('node', [CLI, ...words], { env: r.env, cwd: project, encoding: 'utf8' })
  assert.equal(inProject('push', '--app', 'Leak', '--screen', 'Home', '--after', picture).status, 0)
  assert.equal(inProject('push', '--app', 'Leak', '--screen', 'Other', '--after', picture).status, 0)
  const command = 'secret-agent-command --resume {prompt}'
  assert.equal(inProject('wake', 'set', '--run', command, '--by', 'Tester', '--app', 'Leak').status, 0)
  r.review('phone', 'on')
  const origin = `https://${NAME}`
  const queue = JSON.parse((await r.local('/api/queue')).text)
  const home = queue.apps[0].screens.find(x => x.id === 'home')
  const answer = { appSlug: 'leak', id: 'home', after: home.after, round: home.round, verdict: 'changes', notes: 'Move it', shapes: [{ type: 'box', colour: 'red', box: { x: 1, y: 1, w: 9, h: 9 } }], imageSize: { w: 800, h: 500 }, png: null }
  const replies = {
    queue: await r.ask('/api/queue'),
    send: await r.ask('/api/send', { method: 'POST', headers: { origin }, body: answer }),
    queueAfter: await r.ask('/api/queue'),
    history: await r.ask('/api/history?app=leak&id=home'),
    film: await r.ask('/api/film?app=leak&id=home'),
    phone: await r.ask('/api/phone'),
  }
  // The same, asked at the computer, does hold them: so the test has something to find.
  const atComputer = (await r.local('/api/queue')).text
  assert.ok(atComputer.includes(project) && atComputer.includes('secret-agent-command'), 'the computer\'s own page is told where and how')
  for (const [name, got] of Object.entries(replies)) {
    assert.equal(got.status, 200, name)
    for (const secret of [project, r.home, work, 'secret-agent-command', tmpdir(), secretOf(r.tail).slice(1)]) assert.equal(got.text.includes(secret), false, `${name} holds ${secret}`)
    assert.equal(/"(source|run|in|lastLine|annotatedImage|afterImage|beforeImage|pushedFrom)"/.test(got.text), false, `${name}: ${got.text.slice(0, 200)}`)
  }
  // What the phone's page needs is there.
  const sent = JSON.parse(replies.queueAfter.text)
  assert.equal(sent.remote, true)
  assert.deepEqual(sent.apps[0].screens.map(x => x.status).sort(), ['sent', 'waiting'])
  assert.ok(sent.listening.unheard.marks >= 1)
  assert.equal(JSON.parse(replies.history.text).records[0].verdict, 'changes')
})

test('the page turns it on and off too, from this computer', async () => {
  const r = await rig()
  assert.deepEqual(JSON.parse((await r.local('/api/phone')).text), { on: false, minutes: 30 })
  const on = JSON.parse((await r.local('/api/phone', { method: 'POST', body: { on: true } })).text)
  assert.equal(on.on, true)
  assert.equal(on.url, `https://${NAME}`)
  assert.equal(JSON.parse((await r.local('/api/queue')).text).phone.url, `https://${NAME}`, 'the page hears of it with the queue')
  assert.equal(JSON.parse((await r.local('/api/phone', { method: 'POST', body: { on: false } })).text).on, false)
  assert.deepEqual(served(r.tail), {})
  // What stops it is said in the page as the command says it, and nothing is left open.
  r.tail.set({ https: false })
  const no = await r.local('/api/phone', { method: 'POST', body: { on: true } })
  assert.equal(no.status, 400)
  assert.match(JSON.parse(no.text).error, /HTTPS is not turned on for your tailnet/)
  assert.deepEqual(records(r.home), [])
})

test('it turns itself off when its time is up', async () => {
  // A short time for the test: the setting can only make it shorter than 30 minutes.
  const r = await rig({ env: { REVIEW_PHONE_MINUTES: '0.02' } })
  assert.equal(r.review('phone', 'on').code, 0)
  const door = doorOf(r.tail)
  assert.equal((await r.ask('/api/queue')).status, 200)
  for (let i = 0; i < 80 && (Object.keys(served(r.tail)).length || records(r.home).length); i++) await sleep(100)
  assert.deepEqual(served(r.tail), {}, 'the server told Tailscale to stop serving it')
  assert.equal(await refused(door), true)
  assert.match(r.review('phone').out, /is off/)
  const long = await rig({ env: { REVIEW_PHONE_MINUTES: '600' } })
  assert.match(long.review('phone', 'on').out, /in 30 minutes/, 'never longer than 30 minutes')
})

test('review stop and the server stopping turn it off; after a hard stop, the next server takes the entry down before it listens', async () => {
  const r = await rig()
  r.review('phone', 'on')
  assert.match(r.review('stop').out, /Review from your phone is off/)
  assert.deepEqual(served(r.tail), {})
  // Stopped by something else, with it on.
  const s = await rig()
  s.review('phone', 'on')
  s.server.kill()
  await new Promise(resolve => s.server.once('exit', resolve))
  assert.deepEqual(served(s.tail), {}, 'it took its entry down as it went')
  assert.deepEqual(records(s.home), [])
  // Killed outright: the entry stays, pointing at a door that is closed, until something looks.
  const k = await rig()
  k.review('phone', 'on')
  const door = doorOf(k.tail)
  k.server.kill('SIGKILL')
  await new Promise(resolve => k.server.once('exit', resolve))
  assert.ok(served(k.tail)[`${NAME}:443`])
  assert.equal(await refused(door), true, 'nothing answers behind it')
  // The page started again however it is started (here not by review start): the entry is gone before it answers.
  await startServer(k.env)
  assert.deepEqual(served(k.tail), {})
  assert.deepEqual(records(k.home), [])
  assert.equal(JSON.parse((await k.local('/api/phone')).text).on, false)
  // With no page at all, review phone looks, and takes it down too.
  const l = await rig()
  l.review('phone', 'on')
  l.server.kill('SIGKILL')
  await new Promise(resolve => l.server.once('exit', resolve))
  assert.match(l.review('phone').out, /is off/)
  assert.deepEqual(served(l.tail), {})
})

test('two pages on one store each take down only the entry they made', async () => {
  const tail = standInTailscale(mkdtempSync(join(work, 'tailscale-')))
  const home = mkdtempSync(join(work, 'home-'))
  const a = await rig({ home, tail })
  const b = await rig({ home, tail })
  assert.match(a.review('phone', 'on').out, /Open https:\/\/my-mac\.example\.ts\.net on/)
  assert.match(b.review('phone', 'on').out, /Open https:\/\/my-mac\.example\.ts\.net:8443 on/, 'the next port: the first is the other page\'s')
  assert.equal(records(home).length, 2)
  a.review('phone', 'off')
  assert.deepEqual(Object.keys(served(tail)), [`${NAME}:8443`], 'only its own is gone')
  assert.equal((await b.ask('/api/queue', { at: `${NAME}:8443` })).status, 200)
  assert.equal(JSON.parse((await b.local('/api/phone')).text).on, true)
  // One killed outright: a page started later takes down the dead one's entry and leaves the live one's.
  a.review('phone', 'on')
  a.server.kill('SIGKILL')
  await new Promise(resolve => a.server.once('exit', resolve))
  const c = await rig({ home, tail })
  assert.deepEqual(Object.keys(served(tail)), [`${NAME}:8443`])
  assert.equal(JSON.parse((await b.local('/api/phone')).text).on, true)
  assert.equal(JSON.parse((await c.local('/api/phone')).text).on, false)
  b.review('phone', 'off')
  assert.deepEqual(served(tail), {})
  assert.deepEqual(records(home), [])
})

test('when Tailscale cannot take it down, it says so with the command, shows it as open, and tries again', async () => {
  const r = await rig()
  r.review('phone', 'on')
  const door = doorOf(r.tail)
  r.tail.set({ down: true })
  const off = r.review('phone', 'off')
  assert.match(off.out, /Could not turn it off in Tailscale: failed to connect to local Tailscale service; is Tailscale running\? Run: tailscale serve --https=443 off/)
  assert.equal(await refused(door), true, 'the door is closed at once, whatever Tailscale says')
  const status = JSON.parse((await r.local('/api/phone')).text)
  assert.equal(status.on, true, 'still shown as open: it is, in Tailscale')
  assert.equal(status.stuck, true)
  assert.match(r.review('phone').out, /still open in Tailscale\. Could not turn it off/)
  assert.equal(records(r.home).length, 1, 'the record stays, so it is tried again')
  // Tailscale back: the next off takes it down.
  r.tail.set({ down: false })
  assert.match(r.review('phone', 'off').out, /Review from your phone is off/)
  assert.deepEqual(served(r.tail), {})
  assert.deepEqual(records(r.home), [])
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
    assert.deepEqual(records(r.home), [], 'nothing is on')
    assert.equal(r.tail.calls().some(call => /^serve --bg/.test(call)), false, 'and Tailscale was not asked to serve')
    assert.equal(r.tail.calls().some(call => /^(up|down|login|logout|set|install)\b/.test(call)), false, 'nor to sign in, start or change anything')
  }
  assert.match(none.review('phone', 'sideways').err, /review phone \| phone on \| phone off/)
})

test('the Mac App Store Tailscale is found at the app\'s own program, with none on the PATH; not installed only when neither is there', async () => {
  // A PATH with only node on it, so no tailscale is found there, and the app at a place of the test's own.
  const app = join(mkdtempSync(join(work, 'apps-')), 'Tailscale.app', 'Contents', 'MacOS', 'Tailscale')
  const r = await rig({ env: { REVIEW_TAILSCALE: '', REVIEW_TAILSCALE_APP: app, PATH: dirname(process.execPath) } })
  const missing = r.review('phone', 'on')
  assert.equal(missing.code, 1)
  assert.match(missing.err, /^Tailscale is not installed: get it for this computer and your phone at https:\/\/tailscale\.com\/download/)
  // The stand-in put where the App Store puts the app: it is the one asked, and it serves the door.
  mkdirSync(dirname(app), { recursive: true })
  copyFileSync(r.tail.program, app)
  const on = r.review('phone', 'on')
  assert.equal(on.code, 0, on.err)
  assert.match(on.out, /Open https:\/\/my-mac\.example\.ts\.net on your phone/)
  assert.ok(r.tail.calls().some(call => call.startsWith('serve --bg --https=443 http://127.0.0.1:')))
  assert.match(r.review('phone', 'off').out, /is off/)
  assert.deepEqual(served(r.tail), {})
})

test('nothing is opened to the internet: Funnel is refused, however it is asked for or found', async () => {
  const r = await rig()
  for (const words of [['phone', 'on', '--funnel'], ['phone', 'on', '--public'], ['phone', 'funnel']]) {
    const ran = r.review(...words)
    assert.equal(ran.code, 1)
    assert.match(ran.err, /Markback never opens the review page to the internet\. It does not use Tailscale Funnel\./)
  }
  assert.deepEqual(r.tail.calls(), [], 'Tailscale was not even asked')
  // Funnel already on at the first port: that address is not used.
  r.tail.set({ serve: { AllowFunnel: { [`${NAME}:443`]: true } } })
  assert.match(r.review('phone', 'on').out, /:8443 on your phone/, 'the address Funnel opened is left alone')
  r.review('phone', 'off')
  assert.deepEqual(r.tail.state().serve.AllowFunnel, { [`${NAME}:443`]: true })
  // Funnel comes on with the serve: it is found on the look that follows, taken down, and refused.
  const late = await rig({ tailscale: { funnelOnServe: true } })
  const ran = late.review('phone', 'on')
  assert.equal(ran.code, 1)
  assert.match(ran.err, /Funnel is on/)
  assert.deepEqual(served(late.tail), {}, 'what was just served is taken down again')
  assert.deepEqual(records(late.home), [])
})

test('only the exact commands Markback uses reach Tailscale', () => {
  for (const args of [['version'], ['status', '--json'], ['serve', 'status', '--json'], ['serve', '--bg', '--https=443', 'http://127.0.0.1:5000'], ['serve', '--https=8443', 'off']]) assert.deepEqual(allowed(args), args)
  for (const args of [['funnel', '443'], ['serve', '--funnel'], ['up'], ['down'], ['logout'], ['login'], ['set', '--ssh'], ['serve', 'reset'], ['serve', '--tcp=22', 'tcp://localhost:22'], ['serve', '--bg', '--https=443', '--set-path=/x', 'http://127.0.0.1:5000'], ['serve', '--bg', '--https=443', 'http://example.com'], ['serve', '--https=443', 'off', '--yes'], ['status']]) {
    assert.throws(() => allowed(args), /never opens|does not run tailscale/, args.join(' '))
  }
})

test('what Tailscale already serves for the person is left alone', async () => {
  const theirs = { TCP: { 443: { HTTPS: true } }, Web: { [`${NAME}:443`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:3000' } } } } }
  const r = await rig({ tailscale: { serve: theirs } })
  const on = r.review('phone', 'on')
  assert.match(on.out, /Open https:\/\/my-mac\.example\.ts\.net:8443 on your phone/, 'the next port, not theirs')
  assert.equal((await r.ask('/api/queue', { at: `${NAME}:8443` })).status, 200)
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

test('scripts/phone-check.mjs, for the real Tailscale, says plainly when there is nothing to check', async () => {
  const r = await rig()
  const check = (...words) => spawnSync('node', [join(ROOT, 'scripts', 'phone-check.mjs'), ...words], { env: r.env, encoding: 'utf8' })
  const away = check('--port', await freePort())
  assert.equal(away.status, 1)
  assert.match(away.stdout, /The review page does not answer on port \d+/)
  const off = check()
  assert.equal(off.status, 1)
  assert.match(off.stdout, /Review from your phone is off\. Turn it on with: review phone on/)
  assert.deepEqual(r.tail.calls(), [], 'and Tailscale was not asked')
})

test('every file the review page loads is one a phone may load', async () => {
  const { readFileSync } = await import('node:fs')
  const PUBLIC = join(ROOT, 'public')
  const wanted = new Set(['/'])
  for (const [, path] of readFileSync(join(PUBLIC, 'index.html'), 'utf8').matchAll(/(?:src|href)="(\/[^"]+)"/g)) wanted.add(path)
  // And what each script imports, and what those import.
  const scripts = [...wanted].filter(path => path.endsWith('.js'))
  while (scripts.length) {
    const file = scripts.pop()
    for (const [, name] of readFileSync(join(PUBLIC, file), 'utf8').matchAll(/^import .* from '\.\/([\w-]+\.js)'/gm)) {
      if (!wanted.has(`/${name}`)) scripts.push(`/${name}`)
      wanted.add(`/${name}`)
    }
  }
  for (const path of wanted) assert.equal(phoneMay('GET', path), true, path)
  assert.ok(wanted.has('/app.js') && wanted.has('/qr.js'))
})
