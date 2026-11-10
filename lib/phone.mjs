/**
 * Review from a phone. Off until the person turns it on. Turning it on asks Tailscale, the person's own private network, to
 * serve the local page over HTTPS at this computer's name in that network, so a phone's microphone works. Nothing is opened to
 * the internet: Tailscale Funnel is never used, and an address that Funnel has opened is refused. It turns itself off after 30
 * minutes. The Markback server still listens only on this computer; Tailscale passes the phone's requests to it here.
 *
 *   <home>/phone.json   while it is on: the name the page is served at, who may reach it, and when it turns off
 */

import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { HOME, writeAtomic } from './store.mjs'

/** How long it stays on. REVIEW_PHONE_MINUTES can only make it shorter, for a test. */
export const MINUTES = Math.min(30, Number(process.env.REVIEW_PHONE_MINUTES) || 30)
const STATE = join(HOME, 'phone.json')
/** The HTTPS ports tried at this computer's name, in order. One that already serves something else is left alone. */
const PORTS = [443, 8443, 10000]
/** The Mac App Store's Tailscale puts nothing on the PATH: its command line is the app's own program. REVIEW_TAILSCALE_APP moves it, for a test. */
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
  atComputer: 'Do this at the computer.',
}

/**
 * What a phone may ask for: the page and its files, the screens and their pictures, and sending answers. A phone reviews and
 * marks, nothing more. Anything that runs something on this computer (taking a picture through its browser, a sample, the work
 * queue) is not here, and nor is anything added later until it is put here.
 */
export function phoneMay(method, path) {
  if (method === 'GET') return ['/api/queue', '/api/history', '/api/phone'].includes(path) || path.startsWith('/images/') || path.startsWith('/inbox/') || !path.startsWith('/api/')
  if (method === 'POST') return ['/api/send', '/api/set-aside', '/api/phone'].includes(path)
  return false
}

/** The Tailscale program, in this order: the one named, the one on the PATH, or the Mac app's own. Not installed only when none is there. */
const programs = () => (process.env.REVIEW_TAILSCALE ? [process.env.REVIEW_TAILSCALE] : ['tailscale', ...(process.platform === 'darwin' || process.env.REVIEW_TAILSCALE_APP ? [MAC_APP] : [])])

/**
 * Every word given to Tailscale passes here. Only reading its state and `serve`, which stays inside the tailnet, are let through:
 * `funnel` opens a page to the internet and is refused whoever asks, and up, down, logout and set are never run.
 */
export function allowed(args) {
  if (args.some(word => /funnel/i.test(String(word)))) throw new PhoneProblem(WORDS.never)
  if (!['version', 'status', 'serve'].includes(args[0])) throw new PhoneProblem(`Markback does not run tailscale ${args[0]}.`)
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

const parse = text => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** The state file, or null when it is off, past its time, or not readable. */
export function phoneNow() {
  if (!existsSync(STATE)) return null
  const state = parse(readFileSync(STATE, 'utf8'))
  if (!state || typeof state.host !== 'string' || !state.host || !(Date.parse(state.until) > Date.now())) return null
  return state
}
/** On, but its time is up or the file is broken: it is to be turned off. */
export const phoneStale = () => existsSync(STATE) && !phoneNow()

/** What the page and the command say: on or off, the address, and when it turns off. */
export function phoneStatus() {
  const state = phoneNow()
  return state ? { on: true, url: state.url, until: state.until, login: state.login, minutes: MINUTES } : { on: false, minutes: MINUTES }
}

const hostOf = text => {
  try {
    return new URL(`http://${text}`).hostname.toLowerCase()
  } catch {
    return ''
  }
}
/** Who Tailscale says is asking. It removes this header from what a caller sends, and writes its own. */
const loginOf = req => String(req.headers['tailscale-user-login'] ?? '').trim().toLowerCase()

/**
 * A request that came through Tailscale while it is on: it names the one address that was set up, and Tailscale says it is
 * from a device signed in as the same person as this computer. Funnel traffic and tagged devices carry no such name.
 */
export function fromPhone(req, state = phoneNow()) {
  if (!state) return false
  if (hostOf(req.headers.host) !== state.host) return false
  return !!state.login && loginOf(req) === state.login
}

const serveStatus = async () => {
  const got = await run(['serve', 'status', '--json'])
  return (got.ok && parse(got.out.trim() || '{}')) || {}
}
const proxyAt = (serve, name) => serve.Web?.[name]?.Handlers?.['/']?.Proxy ?? ''
const takenAt = (serve, name, port) => !!serve.TCP?.[port] || !!serve.Web?.[name] || !!serve.AllowFunnel?.[name]

/** Turns it on, or starts its 30 minutes again. Throws a PhoneProblem that says what to do when it cannot. */
export async function phoneOn({ port }) {
  const status = await run(['status', '--json'])
  const tail = parse(status.out)
  if (!tail) throw new PhoneProblem(/logged out|needs ?login/i.test(status.out + status.err) ? WORDS.notSignedIn : WORDS.notRunning)
  if (tail.BackendState !== 'Running') throw new PhoneProblem(['NeedsLogin', 'NeedsMachineAuth'].includes(tail.BackendState) ? WORDS.notSignedIn : WORDS.notRunning)
  const host = String(tail.Self?.DNSName ?? '').replace(/\.$/, '').toLowerCase()
  if (!host) throw new PhoneProblem(WORDS.notSignedIn)
  if (!(tail.CertDomains ?? []).some(name => String(name).toLowerCase() === host)) throw new PhoneProblem(WORDS.noHttps)
  const login = String(tail.User?.[tail.Self?.UserID]?.LoginName ?? '').trim().toLowerCase()
  if (!login || tail.Self?.Tags?.length) throw new PhoneProblem(WORDS.tagged)

  const target = `http://127.0.0.1:${port}`
  const before = await serveStatus()
  const mine = PORTS.find(p => proxyAt(before, `${host}:${p}`) === target)
  const httpsPort = mine ?? PORTS.find(p => !takenAt(before, `${host}:${p}`, p))
  if (!httpsPort) throw new PhoneProblem(WORDS.noPort)
  const name = `${host}:${httpsPort}`
  const url = `https://${host}${httpsPort === 443 ? '' : `:${httpsPort}`}`
  if (before.AllowFunnel?.[name]) throw new PhoneProblem(WORDS.funnel(url))

  // In the background, so it outlasts this command. No --yes: a question from Tailscale is never answered for the person.
  const served = await run(['serve', '--bg', `--https=${httpsPort}`, target], { timeout: 20000 })
  if (!served.ok) throw new PhoneProblem(/not enabled|enable https|certificate/i.test(served.err + served.out) ? WORDS.noHttps : `Tailscale did not start serving: ${(served.err || served.out).trim().split('\n')[0] || 'it did not say why'}.`)
  // Looked at again once it is on: what is served must be this page, to the tailnet only.
  const after = await serveStatus()
  const state = { host, port: httpsPort, url, target, login, onAt: new Date().toISOString(), until: new Date(Date.now() + MINUTES * 60000).toISOString() }
  if (after.AllowFunnel?.[name] || proxyAt(after, name) !== target) {
    await run(['serve', `--https=${httpsPort}`, 'off'])
    throw new PhoneProblem(after.AllowFunnel?.[name] ? WORDS.funnel(url) : 'Tailscale did not start serving the review page.')
  }
  mkdirSync(HOME, { recursive: true })
  writeAtomic(STATE, JSON.stringify(state, null, 2))
  return phoneStatus()
}

const readState = () => (existsSync(STATE) ? parse(readFileSync(STATE, 'utf8')) : null)

/** Turns it off. The page stops answering that name at once; then Tailscale is told to stop serving it. True when it was on. */
export async function phoneOff() {
  const state = readState()
  if (!existsSync(STATE)) return false
  rmSync(STATE, { force: true })
  if (!state?.port || !state.host) return true
  try {
    // Only what Markback set up: if that address now serves something else, it is the person's and stays.
    if (proxyAt(await serveStatus(), `${state.host}:${state.port}`) === state.target) await run(['serve', `--https=${state.port}`, 'off'])
  } catch {
    // No Tailscale to tell. The page already refuses that name.
  }
  return true
}

/** The same, for a server that is closing and cannot wait. */
export function phoneOffSync() {
  const state = readState()
  if (!existsSync(STATE)) return false
  rmSync(STATE, { force: true })
  if (!state?.port || !state.host) return true
  for (const program of programs()) {
    try {
      const serve = parse(execFileSync(program, allowed(['serve', 'status', '--json']), { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || '{}') ?? {}
      if (proxyAt(serve, `${state.host}:${state.port}`) === state.target) execFileSync(program, allowed(['serve', `--https=${state.port}`, 'off']), { timeout: 5000, stdio: 'ignore' })
      break
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'EACCES') break
    }
  }
  return true
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
