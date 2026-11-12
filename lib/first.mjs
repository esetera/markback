/**
 * The first minute: show a running app, or a sample, in the review page with nothing else set up. A picture of an app is taken
 * by a Chrome already on this computer, with nothing sent anywhere.
 */

import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { SAMPLE, sketch } from './sketch.mjs'
import { HOME, push } from './store.mjs'
import { PAGE_SCRIPT, checkWords, readWords } from './words.mjs'
import { localBrowser, needsLocalBrowser } from './capture-browser.mjs'

const run = promisify(execFile)
const SHOTS = join(HOME, 'shots')
const CHROMES = {
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', '/usr/bin/microsoft-edge'],
  win32: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'],
}
// A REVIEW_CHROME that names no file means none: a Chrome found elsewhere would not be the one asked for.
export const findChrome = () => (process.env.REVIEW_CHROME ? (existsSync(process.env.REVIEW_CHROME) ? process.env.REVIEW_CHROME : null) : (CHROMES[process.platform] ?? []).find(path => existsSync(path)) ?? null)

/** What to do when no picture can be taken here, said before anything is waited for. A sandbox often has no Chrome. */
export const NO_CHROME = 'No Chrome or Edge here, so Markback cannot take pictures (a sandbox often has none). Take the screenshot yourself and push it: review push --app "My app" --screen "Home" --after shot.png'

/** A picture of this address can be taken here: a Chrome, or the small browser for a local page inside Codex's sandbox. */
export const canTakePictures = url => !!findChrome() || (!process.env.REVIEW_CHROME && needsLocalBrowser(url))

export async function browserFor(url) {
  if (!process.env.REVIEW_CHROME && needsLocalBrowser(url)) return localBrowser()
  const executable = findChrome()
  return executable && { executable, flags: [] }
}

/** An address someone typed: localhost:3000 is fine. Only web addresses, unless the caller allows a file on this computer. */
export function addressOf(text, { files = false } = {}) {
  const typed = String(text ?? '').trim()
  if (!typed) throw new Error('Say which address.')
  let url
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `http://${typed}`)
  } catch {
    throw new Error(`${typed} is not an address.`)
  }
  if (!['http:', 'https:', ...(files ? ['file:'] : [])].includes(url.protocol)) throw new Error('Only web addresses can be shown.')
  return url
}

/**
 * Chrome calls its maker by itself: for updates, lists, counts, the time, sign-in and its search page. A picture of a page
 * needs none of it. The features named here are the ones a Chrome of late 2026 still called out for with the plain switches
 * set, found by reading its own network log. A feature name a Chrome does not know is ignored.
 */
const QUIET = [
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-sync',
  '--disable-default-apps',
  '--no-pings',
  '--disable-domain-reliability',
  '--disable-client-side-phishing-detection',
  '--metrics-recording-only',
  '--disable-features=OptimizationHints,MediaRouter,Translate,NetworkTimeServiceQuerying,SafeBrowsingHashPrefixRealTimeLookups,AimEnabled,AimServerEligibilityEnabled,AimServerRequestOnStartupEnabled,PreconnectToSearch,PreconnectToSearchDesktop,PrewarmDefaultSearchEngine',
  '--enable-features=SkipListAccountsWithoutGaiaCookies',
]
/**
 * What every run of Chrome here has: no window, a profile of its own, nothing asked of the person or their keychain, and no
 * calls of its own to anywhere. Only the page it is shown is fetched.
 */
export const chromeFlags = (profile, width = 1440, height = 900) => ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--use-mock-keychain', '--password-store=basic', ...QUIET, `--user-data-dir=${profile}`, `--window-size=${width},${height}`]
/** How long a page gets to settle, in its own time, before its picture is taken. The same on both ways. */
const SETTLE = 4000
/** How long, in real time, a loaded page that never goes quiet is waited for. */
const STUCK = 2000
/** A wait that is only a limit on something else: it never keeps the command alive by itself. */
const atMost = ms => new Promise(resolve => setTimeout(resolve, ms).unref())

/**
 * The picture and the words in it, from one run of Chrome driven over its DevTools address, so both are of the same moment.
 * Any step can fail (an old Chrome, a Node with no WebSocket, a page that never settles): the caller then takes the plain picture.
 */
async function pictureAndWords(browser, url, out, list, { width, height }, ms) {
  if (typeof WebSocket !== 'function') throw new Error('This Node has no WebSocket.')
  const profile = mkdtempSync(join(tmpdir(), 'review-shot-'))
  const child = spawn(browser.executable, [...chromeFlags(profile, width, height), ...browser.flags, '--remote-debugging-port=0', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
  const gone = new Promise(resolve => child.once('exit', resolve).once('error', resolve))
  let socket
  let stop
  const tooLong = new Promise((_, reject) => (stop = setTimeout(() => reject(new Error('It took too long.')), ms)))
  const work = async () => {
    // Chrome says where its DevTools listen once it is ready.
    const address = await new Promise((resolve, reject) => {
      let said = ''
      child.stderr.on('data', chunk => {
        said += chunk
        const found = /DevTools listening on (ws:\/\/\S+)/.exec(said)
        if (found) resolve(found[1])
      })
      gone.then(() => reject(new Error('Chrome stopped before it was ready.')))
      // It says so in well under a second. A program that never does is not a Chrome that can be driven.
      atMost(10000).then(() => reject(new Error('Chrome did not say where its DevTools are.')))
    })
    socket = new WebSocket(address)
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', () => reject(new Error('Chrome did not take the call.')), { once: true })
    })
    let last = 0
    const asked = new Map()
    const heard = new Map()
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.id && asked.has(message.id)) {
        const { resolve, reject } = asked.get(message.id)
        asked.delete(message.id)
        if (message.error) reject(new Error(message.error.message))
        else resolve(message.result)
      } else if (message.method) heard.get(message.method)?.(message.params)
    })
    socket.addEventListener('close', () => {
      for (const { reject } of asked.values()) reject(new Error('Chrome hung up.'))
    })
    let sessionId
    const ask = (method, params = {}) => new Promise((resolve, reject) => {
      asked.set(++last, { resolve, reject })
      socket.send(JSON.stringify({ id: last, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
    const { targetInfos } = await ask('Target.getTargets')
    const page = targetInfos.find(target => target.type === 'page') ?? (await ask('Target.createTarget', { url: 'about:blank' }))
    sessionId = (await ask('Target.attachToTarget', { targetId: page.targetId, flatten: true })).sessionId
    await ask('Page.enable')
    // The same size as the plain picture, at one pixel a point, so a before and an after can be compared.
    await ask('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    // A page that opens a message box would wait for an answer for ever.
    heard.set('Page.javascriptDialogOpening', () => ask('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}))
    // The page gets the same four seconds of its own time as the plain picture gives it, run as fast as it can go: an app
    // that draws a moment after it loads is seen as it ends up. Its clock stands still until the page is on its way.
    const settled = new Promise(resolve => heard.set('Emulation.virtualTimeBudgetExpired', resolve))
    const loaded = new Promise(resolve => heard.set('Page.loadEventFired', resolve))
    if (!browser.realTime) await ask('Emulation.setVirtualTimePolicy', { policy: 'pause' })
    const went = await ask('Page.navigate', { url: url.href })
    if (went.errorText) throw new Error(went.errorText)
    if (browser.realTime) {
      // Single-process Chromium's virtual clock can stall inside Seatbelt.
      await Promise.race([loaded.then(() => atMost(SETTLE)), atMost(SETTLE + STUCK)])
    } else {
      await ask('Emulation.setVirtualTimePolicy', { policy: 'pauseIfNetworkFetchesPending', budget: SETTLE, maxVirtualTimeTaskStarvationCount: 9999 })
      // If a fetch stays open, let the page use the rest of its time without waiting for the network.
      const quiet = await Promise.race([settled.then(() => true), loaded.then(() => atMost(STUCK)).then(() => false), atMost(15000).then(() => false)])
      if (!quiet) {
        const used = (await ask('Runtime.evaluate', { expression: 'performance.now()', returnByValue: true })).result?.value
        const rest = new Promise(resolve => heard.set('Emulation.virtualTimeBudgetExpired', resolve))
        await ask('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: Math.max(1, Math.min(SETTLE, SETTLE - (Number(used) || 0))) })
        await Promise.race([rest, atMost(STUCK)])
      }
    }
    // Read the words and take the picture back-to-back in the same page.
    const found = await ask('Runtime.evaluate', { expression: PAGE_SCRIPT, returnByValue: true })
    if (found.exceptionDetails) throw new Error('The words could not be read.')
    const words = checkWords(found.result.value)
    const shot = await ask('Page.captureScreenshot', { format: 'png' })
    writeFileSync(out, Buffer.from(shot.data, 'base64'))
    writeFileSync(list, JSON.stringify(words))
  }
  try {
    const working = work()
    // Stopped for taking too long, it fails later, when Chrome is hung up on: that is already known.
    working.catch(() => {})
    await Promise.race([working, tooLong])
  } finally {
    clearTimeout(stop)
    try {
      socket?.close()
    } catch {
      // Never opened.
    }
    child.kill()
    await Promise.race([gone, atMost(3000)])
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    // Something Chrome started may still hold its end of this open: it must not keep the command waiting.
    child.stderr.destroy()
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

/**
 * A picture of the page at this address, in a Chrome with a profile of its own that is thrown away. With `words`, a path, the
 * words in the picture are written there too when they can be had: no file there after means the picture has no list.
 */
export async function capture(url, out, { width = 1440, height = 900, words = '' } = {}) {
  if (!canTakePictures(url)) throw new Error(NO_CHROME)
  if (url.protocol !== 'file:') {
    const answered = await fetch(url, { signal: AbortSignal.timeout(8000) }).then(() => true, () => false)
    if (!answered) throw new Error(`Nothing answers at ${url.href}. Is your app running?`)
  }
  const browser = await browserFor(url)
  if (!browser) throw new Error(NO_CHROME)
  // One limit for both ways: the way with words gets the first part of it, and the plain way what is left.
  const until = Date.now() + 45000
  if (words) {
    try {
      await pictureAndWords(browser, url, out, words, { width, height }, 25000)
      return out
    } catch {
      // A picture without words is better than no picture: the plain way follows.
      for (const half of [out, words]) rmSync(half, { force: true })
    }
  }
  const profile = mkdtempSync(join(tmpdir(), 'review-shot-'))
  try {
    const clock = browser.realTime ? `--timeout=${SETTLE}` : `--virtual-time-budget=${SETTLE}`
    await run(browser.executable, [...chromeFlags(profile, width, height), ...browser.flags, clock, `--screenshot=${out}`, url.href], { timeout: Math.max(10000, until - Date.now()) })
  } catch (error) {
    if (!existsSync(out)) throw new Error(`The picture could not be taken: ${String(error.message).split('\n')[0]}`)
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
  if (!existsSync(out)) throw new Error('The picture could not be taken.')
  return out
}

/** Takes the picture with its words when it can. Gives the path of the word list, or '' when there is none. */
export async function captureWithWords(url, out, opts = {}) {
  const list = `${out}.words.json`
  await capture(url, out, { ...opts, words: list })
  try {
    // An empty list says nothing, and a list that does not fit its picture would stop the push.
    if (readWords(list, out).words.length) return list
  } catch {
    // No list was made.
  }
  rmSync(list, { force: true })
  return ''
}

/** Puts a running app in the review page. */
export async function showApp(text, { app = '', screen = 'First look', note = 'Draw on anything. Then press Send.', files = false, kind = 'qa' } = {}) {
  const url = addressOf(text, { files })
  mkdirSync(SHOTS, { recursive: true })
  const out = join(SHOTS, `shot-${Date.now()}.png`)
  const words = await captureWithWords(url, out)
  const name = app || (url.protocol === 'file:' ? 'My app' : url.host)
  const entry = push({ app: name, screen, after: out, note, kind, from: 'Markback', words, url })
  // push kept its own copy of the list.
  if (words) rmSync(words, { force: true })
  return entry
}

/** A sample to try it on, with nothing of your own. */
export function pushSample() {
  mkdirSync(HOME, { recursive: true })
  const picture = join(HOME, 'sample.svg')
  writeFileSync(picture, sketch(SAMPLE))
  return push({ app: 'Sample', screen: 'Try it', after: picture, check: ['Draw a box round something', 'Then press Send'], from: 'the sample' })
}
