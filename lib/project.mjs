/**
 * Starting from a project folder, with nothing typed: how its app runs, whether it is running, and its main screens. The
 * person never pastes an address. Starting their app runs their code, so that waits for their yes.
 */

import { execFile, execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { browserFor, captureWithWords, chromeFlags } from './first.mjs'
import { HOME, PORT, push } from './store.mjs'

const run = promisify(execFile)
/** The scripts that run an app, best first. */
const SCRIPTS = ['dev', 'start', 'serve', 'preview']
const MOST_SCREENS = 5

const readJson = path => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/** The port a script says, or the one its tool uses by default. */
export function portOf(script) {
  const said = /(?:--port[= ]|-p |PORT=)(\d{2,5})/.exec(script)
  if (said) return Number(said[1])
  if (/\bvite\b|svelte-kit/.test(script)) return /\bpreview\b/.test(script) ? 4173 : 5173
  if (/\bastro\b/.test(script)) return 4321
  if (/\bng serve\b/.test(script)) return 4200
  if (/http\.server/.test(script)) return 8000
  if (/http-server/.test(script)) return 8080
  if (/\bnext\b|react-scripts|\bnuxt\b|\bremix\b|\bserve\b/.test(script)) return 3000
  return null
}

const answers = url => fetch(url, { signal: AbortSignal.timeout(600) }).then(r => r.status < 500, () => false)

/**
 * What the folder holds: `running` (an address that answers), `run` (a script that would start it, and where), `file` (a
 * page that opens as it is), or none of these: no app yet.
 */
export async function findApp(dir) {
  const folder = resolve(dir)
  const found = { name: basename(folder) }
  const pkg = readJson(join(folder, 'package.json'))
  const script = SCRIPTS.find(name => pkg?.scripts?.[name])
  if (script) {
    const port = portOf(pkg.scripts[script])
    found.run = { command: `npm run ${script}`, script, port }
    // Only its own port: something else on a common port may be another project's app, and is not this one.
    if (port && (await answers(`http://localhost:${port}/`))) found.running = `http://localhost:${port}/`
  }
  if (!found.running && !found.run) {
    const page = ['index.html', 'public/index.html', 'dist/index.html', 'build/index.html'].map(p => join(folder, p)).find(p => existsSync(p))
    if (page) found.file = pathToFileURL(page).href
  }
  return found
}

/** Runs the project's script, on its own, and waits until it answers. Its output goes to a log under the store. */
export async function startApp(dir, runIt, { waitMs = 60000 } = {}) {
  const logs = join(HOME, 'logs')
  mkdirSync(logs, { recursive: true })
  const log = join(logs, `${basename(resolve(dir))}.log`)
  // A fresh log each run: an address from an earlier run must not be mistaken for this one.
  const out = openSync(log, 'w')
  // Windows runs npm through its shell; the script name is one of a fixed few, never words from elsewhere.
  const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', runIt.script], { cwd: dir, detached: true, shell: process.platform === 'win32', stdio: ['ignore', out, out], env: { ...process.env, BROWSER: 'none' } })
  child.unref()
  const until = Date.now() + waitMs
  while (Date.now() < until) {
    // Its own port, or the address it says it is on.
    const said = /https?:\/\/(?:localhost|127\.0\.0\.1):(\d{2,5})/.exec(readFileSync(log, 'utf8'))
    const port = runIt.port ?? (said ? Number(said[1]) : null)
    if (port && port !== PORT && (await answers(`http://localhost:${port}/`))) return { url: `http://localhost:${port}/`, pid: child.pid, log }
    if (child.exitCode !== null) throw new Error(`It stopped before it answered. What it said is in ${log}`)
    await new Promise(r => setTimeout(r, 500))
  }
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    else process.kill(-child.pid)
  } catch {
    // Already gone.
  }
  throw new Error(`It did not answer within ${Math.round(waitMs / 1000)} seconds, so it was stopped. What it said is in ${log}`)
}

/** The app's own links from a page: same place, no anchors or mail, in order, each once, with the words on them. */
export function linksIn(html, base) {
  const home = new URL(base)
  const seen = new Set([home.href.replace(/#.*$/, '')])
  const out = []
  for (const [, href, inner] of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url
    try {
      url = new URL(href, home)
    } catch {
      continue
    }
    // A page on disk leads only to pages in its own folder: every file: address has the same origin, so that says nothing.
    const inside = home.protocol === 'file:' ? url.protocol === 'file:' && url.pathname.startsWith(home.pathname.replace(/[^/]*$/, '')) : url.origin === home.origin && /^https?:$/.test(url.protocol)
    if (!inside) continue
    url.hash = ''
    if (seen.has(url.href)) continue
    seen.add(url.href)
    const words = inner.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim()
    out.push({ url: url.href, name: words || url.pathname.split('/').filter(Boolean).pop() || 'Home' })
  }
  return out
}

/** The page as the browser builds it, so links an app draws with script count too. */
async function pageHtml(url) {
  const browser = await browserFor(new URL(url))
  if (!browser) return ''
  const profile = mkdtempSync(join(tmpdir(), 'review-dom-'))
  try {
    const clock = browser.realTime ? '--timeout=4000' : '--virtual-time-budget=4000'
    const { stdout } = await run(browser.executable, [...chromeFlags(profile), ...browser.flags, clock, '--dump-dom', url], { timeout: 45000, maxBuffer: 20 * 1024 * 1024 })
    return stdout
  } catch {
    return ''
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
}

/** Pictures of the main screens: the first page and the ones it links to, a few at most, as one review named for the folder. */
export async function shootScreens(url, name, { most = MOST_SCREENS } = {}) {
  const screens = [{ url, name: 'Home' }, ...linksIn(await pageHtml(url), url)].slice(0, most)
  const shots = join(HOME, 'shots')
  mkdirSync(shots, { recursive: true })
  const taken = []
  let firstError
  for (const [n, screen] of screens.entries()) {
    const out = join(shots, `${Date.now()}-${n}.png`)
    let words
    try {
      words = await captureWithWords(new URL(screen.url), out)
    } catch (error) {
      firstError ??= error
      continue
    }
    taken.push(push({ app: name, screen: `${n + 1} ${screen.name}`.slice(0, 80), after: out, check: n ? [] : ['Draw on what you want changed'], from: 'Markback', words }))
    // push kept its own copy of the list.
    if (words) rmSync(words, { force: true })
  }
  if (!taken.length) throw new Error(`No picture could be taken of ${url}.${firstError ? ` ${firstError.message}` : ''}`)
  return taken
}

/** Opens the review page in the person's own browser. MARKBACK_OPEN_WITH names another program; MARKBACK_NO_OPEN=1 skips it. */
export async function openPage(url) {
  if (process.env.MARKBACK_NO_OPEN === '1') return false
  const [cmd, ...args] = process.env.MARKBACK_OPEN_WITH ? [process.env.MARKBACK_OPEN_WITH] : process.platform === 'darwin' ? ['open'] : process.platform === 'win32' ? ['cmd', '/c', 'start', '""'] : ['xdg-open']
  // Opened once the program has started: a browser may take its time, and it is the person's from then on.
  return new Promise(done => {
    const child = spawn(cmd, [...args, url], { detached: true, stdio: 'ignore' })
    child.once('spawn', () => {
      child.unref()
      done(true)
    })
    child.once('error', () => done(false))
  })
}
