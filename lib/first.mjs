/**
 * The first minute: show a running app, or a sample, in the review page with nothing else set up. A picture of an app is taken
 * by a Chrome already on this computer, with nothing sent anywhere.
 */

import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { SAMPLE, sketch } from './sketch.mjs'
import { HOME, push } from './store.mjs'

const run = promisify(execFile)
const SHOTS = join(HOME, 'shots')
const CHROMES = {
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', '/usr/bin/microsoft-edge'],
  win32: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'],
}
export const findChrome = () => (process.env.REVIEW_CHROME && existsSync(process.env.REVIEW_CHROME) ? process.env.REVIEW_CHROME : (CHROMES[process.platform] ?? []).find(path => existsSync(path)) ?? null)

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

/** A picture of the page at this address, in a Chrome with a profile of its own that is thrown away. */
export async function capture(url, out, { width = 1440, height = 900 } = {}) {
  const chrome = findChrome()
  if (!chrome) throw new Error('Taking a picture needs Chrome or Edge on this computer. You can push a screenshot of your own with review push.')
  if (url.protocol !== 'file:') {
    const answered = await fetch(url, { signal: AbortSignal.timeout(8000) }).then(() => true, () => false)
    if (!answered) throw new Error(`Nothing answers at ${url.href}. Is your app running?`)
  }
  const profile = mkdtempSync(join(tmpdir(), 'review-shot-'))
  try {
    await run(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--use-mock-keychain', '--password-store=basic', `--user-data-dir=${profile}`, `--window-size=${width},${height}`, '--virtual-time-budget=4000', `--screenshot=${out}`, url.href], { timeout: 45000 })
  } catch (error) {
    if (!existsSync(out)) throw new Error(`The picture could not be taken: ${String(error.message).split('\n')[0]}`)
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
  if (!existsSync(out)) throw new Error('The picture could not be taken.')
  return out
}

/** Puts a running app in the review page. */
export async function showApp(text, { app = '', screen = 'First look', note = 'Draw on anything. Then press Send.', files = false, kind = 'qa' } = {}) {
  const url = addressOf(text, { files })
  mkdirSync(SHOTS, { recursive: true })
  const out = join(SHOTS, `shot-${Date.now()}.png`)
  await capture(url, out)
  const name = app || (url.protocol === 'file:' ? 'My app' : url.host)
  return push({ app: name, screen, after: out, note, kind, from: 'Markback' })
}

/** A sample to try it on, with nothing of your own. */
export function pushSample() {
  mkdirSync(HOME, { recursive: true })
  const picture = join(HOME, 'sample.svg')
  writeFileSync(picture, sketch(SAMPLE))
  return push({ app: 'Sample', screen: 'Try it', after: picture, check: ['Draw a box round something', 'Then press Send'], from: 'the sample' })
}
