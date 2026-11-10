/**
 * Review from a phone. Off until the person turns it on. Turning it on opens a second listener on this computer only, the phone's
 * door, and asks Tailscale, the person's own private network, to serve it over HTTPS at this computer's name in that network, so
 * a phone's microphone works. Every request on the door is a phone's: it needs the person's own login, which Tailscale writes,
 * and it may use only what a review needs. The page's own listener never takes a request that came through a proxy. Nothing is
 * opened to the internet: Tailscale Funnel is never used, and an address that Funnel has opened is refused. It turns itself off
 * after 30 minutes, and when the server stops.
 *
 *   <home>/phone/<port>.json   while it is on, one for each server (by its port): what it asked Tailscale to serve, and until when
 */

import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { HOME, writeAtomic } from './store.mjs'

/** How long it stays on. REVIEW_PHONE_MINUTES can only make it shorter, for a test. */
export const MINUTES = Math.min(30, Number(process.env.REVIEW_PHONE_MINUTES) || 30)
const RECORDS = join(HOME, 'phone')
/** The HTTPS ports tried at this computer's name, in order. One that already serves something else is left alone. */
const PORTS = [443, 8443, 10000]
/** The Mac App Store's Tailscale puts nothing on the PATH: its command line is the app's own program. */
const MAC_APP = process.env.REVIEW_TAILSCALE_APP || '/Applications/Tailscale.app/Contents/MacOS/Tailscale'

/** Something the person can put right. Its words say what to do. */
export class PhoneProblem extends Error {}

export const WORDS = {
  noProgram: 'Tailscale is not installed: get it for this computer and your phone at https://tailscale.com/download, and sign in on both.',
  notRunning: 'Tailscale is not running. Open Tailscale on this computer, then try again.',
  notSignedIn: 'Tailscale is not signed in. Open Tailscale on this computer and sign in, then try again.',
  noHttps: 'HTTPS is not turned on for your tailnet. Turn on HTTPS Certificates at https://login.tailscale.com/admin/dns, then try again.',
  tagged: 'This computer is in your tailnet as a tagged device, not as a person. Markback cannot tell your devices from others, so it stays off.',
  noPort: `Tailscale already serves other things on ports ${PORTS.join(', ')} of this computer. Markback leaves them alone. Free one, then try again.`,
  funnel: address => `Tailscale Funnel is on for ${address}, which opens it to the internet. Markback will not serve the review page there. Turn Funnel off for it first.`,
  never: 'Markback never opens the review page to the internet. It does not use Tailscale Funnel.',
  stuck: (why, port) => `Could not turn it off in Tailscale: ${why}. Run: tailscale serve --https=${port} off`,
  atComputer: 'Do this at the computer.',
  notYours: 'Only your own devices can use this, signed in to Tailscale as the same person as the computer.',
}

/** The page and the files it loads. Named one by one, so a file added later is not served to a phone until it is put here. */
const PAGE = new Set(['/', '/index.html', '/app.js', '/annotate.js', '/mic.js', '/qr.js', '/flow.js', '/listen.js', '/style.css', '/icon.svg'])
/**
 * What a phone may ask for: the page, the screens and their pictures, and sending answers. A phone reviews and marks, nothing
 * more. Anything that runs something on this computer (taking a picture through its browser, a sample, the work queue) is not
 * here, and nor is anything added later until it is put here.
 */
export function phoneMay(method, path) {
  if (method === 'GET') return PAGE.has(path) || ['/api/queue', '/api/history', '/api/phone'].includes(path) || /^\/(images|inbox)\/[^/]+/.test(path)
  if (method === 'POST') return ['/api/send', '/api/set-aside', '/api/phone'].includes(path)
  return false
}

/**
 * The Tailscale program, in this order: the one named, the one on the PATH, or the Mac app's own. Not installed only when none is
 * there. REVIEW_TAILSCALE and REVIEW_TAILSCALE_APP are for tests, which must never run the real one; honoured anywhere, since a
 * person who sets them chooses which program is run, as with the PATH.
 */
const programs = () => (process.env.REVIEW_TAILSCALE ? [process.env.REVIEW_TAILSCALE] : ['tailscale', ...(process.platform === 'darwin' || process.env.REVIEW_TAILSCALE_APP ? [MAC_APP] : [])])

/** The only commands Markback gives Tailscale, word for word: reading its state, serving the door, and taking that down. */
const FORMS = [
  ['version'],
  ['status', '--json'],
  ['serve', 'status', '--json'],
  ['serve', '--bg', /^--https=\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/],
  ['serve', /^--https=\d+$/, 'off'],
]
/** Every command passes here. Funnel opens a page to the internet and is refused whoever asks; so is any other form. */
export function allowed(args) {
  if (args.some(word => /funnel/i.test(String(word)))) throw new PhoneProblem(WORDS.never)
  const fits = form => form.length === args.length && form.every((want, i) => (want instanceof RegExp ? want.test(String(args[i])) : want === args[i]))
  if (!FORMS.some(fits)) throw new PhoneProblem(`Markback does not run tailscale ${args.join(' ')}.`)
  return args
}

function run(args, { timeout = 30000 } = {}) {
  allowed(args)
  const tryOne = ([program, ...rest]) => new Promise((resolve, reject) => {
    if (!program) return reject(new PhoneProblem(WORDS.noProgram))
    execFile(program, args, { timeout, encoding: 'utf8' }, (error, stdout, stderr) => {
      // Not there: try the next place it could be.
      if (error && (error.code === 'ENOENT' || error.code === 'EACCES')) return resolve(tryOne(rest))
      resolve({ ok: !error, out: String(stdout ?? ''), err: String(stderr ?? '') })
    })
  })
  return tryOne(programs())
}
/** The same, for a server that is closing and cannot wait. */
function runSync(args) {
  allowed(args)
  for (const program of programs()) {
    try {
      return { ok: true, out: execFileSync(program, args, { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }), err: '' }
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EACCES') continue
      return { ok: false, out: String(error.stdout ?? ''), err: String(error.stderr ?? error.message) }
    }
  }
  throw new PhoneProblem(WORDS.noProgram)
}

const parse = text => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
const firstLine = got => (got.err || got.out).trim().split('\n')[0] || 'it did not say why'
const proxyAt = (serve, name) => serve.Web?.[name]?.Handlers?.['/']?.Proxy ?? ''
const takenAt = (serve, name, port) => !!serve.TCP?.[port] || !!serve.Web?.[name] || !!serve.AllowFunnel?.[name]
/** What Tailscale serves now, or a PhoneProblem when it cannot say. */
const serveStatus = got => {
  if (!got.ok) throw new PhoneProblem(firstLine(got))
  return parse(got.out.trim() || '{}') ?? {}
}

const recordFile = port => join(RECORDS, `${port}.json`)
const readRecord = file => (existsSync(file) ? parse(readFileSync(file, 'utf8')) : null)
const saveRecord = record => {
  mkdirSync(RECORDS, { recursive: true })
  writeAtomic(recordFile(record.serverPort), JSON.stringify(record, null, 2))
}
const alive = pid => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

/**
 * Takes down the one entry a record says Markback made, and looks again to be sure. Another entry, or one that now serves
 * something else, is the person's and stays. With no Tailscale on this computer there is nothing to take down. Written once for
 * both ways of calling: `call` gives what a command printed, now or later. '' when it is gone, else what to tell the person.
 */
function* removing(record) {
  const name = `${record.host}:${record.httpsPort}`
  try {
    if (proxyAt(serveStatus(yield ['serve', 'status', '--json']), name) === record.target) {
      const off = yield ['serve', `--https=${record.httpsPort}`, 'off']
      if (!off.ok) throw new PhoneProblem(firstLine(off))
      if (proxyAt(serveStatus(yield ['serve', 'status', '--json']), name) === record.target) throw new PhoneProblem('it still serves the review page')
    }
    return ''
  } catch (error) {
    if (error.message === WORDS.noProgram) return ''
    return WORDS.stuck(error.message.replace(/\.$/, ''), record.httpsPort)
  }
}
async function removeEntry(record) {
  const steps = removing(record)
  let at = steps.next()
  while (!at.done) {
    let got
    try {
      got = await run(at.value)
    } catch (error) {
      at = steps.throw(error)
      continue
    }
    at = steps.next(got)
  }
  return at.value
}
function removeEntrySync(record) {
  const steps = removing(record)
  let at = steps.next()
  while (!at.done) {
    let got
    try {
      got = runSync(at.value)
    } catch (error) {
      at = steps.throw(error)
      continue
    }
    at = steps.next(got)
  }
  return at.value
}

/**
 * Takes down what a server that is gone left in Tailscale, before anything else listens: an entry whose door is closed points at
 * a port another program could take. `ours` is this server's port: a record for it is from one that ran here before. A record
 * stays until its entry is gone, and the next look tries again. Says what could not be taken down.
 */
export async function cleanStale(ours = null) {
  if (!existsSync(RECORDS)) return []
  const problems = []
  for (const name of readdirSync(RECORDS).filter(n => n.endsWith('.json'))) {
    const file = join(RECORDS, name)
    const record = readRecord(file)
    if (record && record.pid !== process.pid && alive(record.pid) && String(record.serverPort) !== String(ours)) continue
    const problem = record?.host ? await removeEntry(record) : ''
    if (problem) {
      saveRecord({ ...record, problem, triedAt: Date.now() })
      problems.push(problem)
    } else rmSync(file, { force: true })
  }
  return problems
}

/** Who Tailscale says is asking. It removes this header from what a caller sends, and writes its own. */
const loginOf = req => String(req.headers['tailscale-user-login'] ?? '').trim().toLowerCase()

/**
 * The phone's door for the server on `serverPort`. `handle(req, res)` is the page's handler, given only requests from the
 * person's own devices. `on()` opens it, or gives it 30 more minutes; `off()` closes it and takes down its entry in Tailscale.
 */
export function phoneDoor({ serverPort, handle }) {
  const file = recordFile(serverPort)
  let door = null
  const sockets = new Set()

  function status() {
    const record = readRecord(file)
    if (!record) return { on: false, minutes: MINUTES }
    // Not taken down in Tailscale yet: it is shown as open until it really is closed.
    if (record.problem) return { on: true, stuck: true, problem: record.problem, url: record.url, login: record.login, minutes: MINUTES }
    return { on: true, url: record.url, until: record.until, login: record.login, minutes: MINUTES }
  }

  // Every request here is a phone's, whatever name it gives. Without the person's own login, nothing.
  function gate(req, res) {
    const record = readRecord(file)
    if (!record || record.problem || !record.login || loginOf(req) !== record.login) {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      return res.end(JSON.stringify({ error: WORDS.notYours }))
    }
    return handle(req, res)
  }

  function closeDoor() {
    if (!door) return
    door.close()
    for (const socket of sockets) socket.destroy()
    sockets.clear()
    door = null
  }

  async function on() {
    let record = readRecord(file)
    if (record?.problem && (await off()).problem) throw new PhoneProblem(readRecord(file).problem)
    record = readRecord(file)
    if (record && door) {
      saveRecord({ ...record, until: new Date(Date.now() + MINUTES * 60000).toISOString() })
      return status()
    }
    const got = await run(['status', '--json'])
    const tail = parse(got.out)
    if (!tail) throw new PhoneProblem(/logged out|needs ?login/i.test(got.out + got.err) ? WORDS.notSignedIn : WORDS.notRunning)
    if (tail.BackendState !== 'Running') throw new PhoneProblem(['NeedsLogin', 'NeedsMachineAuth'].includes(tail.BackendState) ? WORDS.notSignedIn : WORDS.notRunning)
    const host = String(tail.Self?.DNSName ?? '').replace(/\.$/, '').toLowerCase()
    if (!host) throw new PhoneProblem(WORDS.notSignedIn)
    if (!(tail.CertDomains ?? []).some(name => String(name).toLowerCase() === host)) throw new PhoneProblem(WORDS.noHttps)
    const login = String(tail.User?.[tail.Self?.UserID]?.LoginName ?? '').trim().toLowerCase()
    if (!login || tail.Self?.Tags?.length) throw new PhoneProblem(WORDS.tagged)

    const before = serveStatus(await run(['serve', 'status', '--json']))
    const httpsPort = PORTS.find(p => !takenAt(before, `${host}:${p}`, p))
    if (!httpsPort) throw new PhoneProblem(WORDS.noPort)
    const name = `${host}:${httpsPort}`
    const url = `https://${host}${httpsPort === 443 ? '' : `:${httpsPort}`}`

    // The door: this computer only, a port of its own, open only while this is on.
    const server = createServer(gate)
    server.on('connection', socket => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
    })
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    door = server
    const target = `http://127.0.0.1:${server.address().port}`
    record = { pid: process.pid, serverPort: Number(serverPort), host, httpsPort, url, target, login, onAt: new Date().toISOString(), until: new Date(Date.now() + MINUTES * 60000).toISOString() }
    // Written before Tailscale is asked: a server that dies meanwhile leaves a record, so its entry is found and taken down.
    saveRecord(record)
    try {
      // In the background, so it outlasts this command. No --yes: a question from Tailscale is never answered for the person.
      const served = await run(['serve', '--bg', `--https=${httpsPort}`, target], { timeout: 20000 })
      if (!served.ok) throw new PhoneProblem(/not enabled|enable https|certificate/i.test(served.err + served.out) ? WORDS.noHttps : `Tailscale did not start serving: ${firstLine(served)}.`)
      // Looked at again once it is on: what is served must be the door, to the tailnet only.
      const after = serveStatus(await run(['serve', 'status', '--json']))
      if (after.AllowFunnel?.[name]) throw new PhoneProblem(WORDS.funnel(url))
      if (proxyAt(after, name) !== target) throw new PhoneProblem('Tailscale did not start serving the review page.')
    } catch (error) {
      closeDoor()
      if (!(await removeEntry(record))) rmSync(file, { force: true })
      throw error
    }
    return status()
  }

  /** The door closes at once; then its entry is taken down. The record stays until it is. */
  async function off() {
    closeDoor()
    const record = readRecord(file)
    if (!record) return { was: false, problem: '' }
    const problem = await removeEntry(record)
    if (problem) saveRecord({ ...record, problem, triedAt: Date.now() })
    else rmSync(file, { force: true })
    return { was: true, problem }
  }

  function offSync() {
    closeDoor()
    const record = readRecord(file)
    if (!record) return
    const problem = removeEntrySync(record)
    if (problem) saveRecord({ ...record, problem, triedAt: Date.now() })
    else rmSync(file, { force: true })
  }

  /** Each second: past its time, it turns off. Not yet taken down in Tailscale: tried again every half minute. */
  let busy = false
  async function tick() {
    const record = readRecord(file)
    if (busy || !record) return
    const due = record.problem ? Date.now() - (record.triedAt ?? 0) > 30000 : !(Date.parse(record.until) > Date.now()) || !door
    if (!due) return
    busy = true
    try {
      await off()
    } finally {
      busy = false
    }
  }

  return { on, off, offSync, status, tick }
}

/** What Tailscale says, as JSON, for scripts/phone-check.mjs: only the reading forms pass. Null when it cannot say. */
export async function tailscaleJson(args) {
  if (args.at(-1) !== '--json') throw new PhoneProblem(`Markback does not run tailscale ${args.join(' ')}.`)
  const got = await run(args)
  return got.ok ? parse(got.out) : null
}

/**
 * Tailscale makes the address's certificate on its first visit, which can take half a minute. Visited once from here as soon as
 * it is on, so the phone's first load is quick. True when it answered. REVIEW_PHONE_WARM=off leaves it, for a test.
 */
export async function warmUp(url, ms = 60000) {
  if (process.env.REVIEW_PHONE_WARM === 'off') return true
  try {
    await fetch(url, { signal: AbortSignal.timeout(ms) })
    return true
  } catch {
    return false
  }
}

/** How long is left, in words. */
export const leftWords = until => {
  const minutes = Math.max(1, Math.round((Date.parse(until) - Date.now()) / 60000))
  return `${minutes} minute${minutes === 1 ? '' : 's'}`
}
