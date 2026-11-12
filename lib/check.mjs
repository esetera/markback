/**
 * review check: proves Markback works on this computer, and says plainly what is missing. It runs a whole round against itself,
 * with a store and a review page of its own that are thrown away after. The person's own store and page are never changed.
 */

import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { deflateSync } from 'node:zlib'
import { capture, findChrome } from './first.mjs'
import { needsLocalBrowser } from './capture-browser.mjs'
import { pagePictures } from './pdf.mjs'
import { PORT, writeAtomic } from './store.mjs'

const run = promisify(execFile)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = join(ROOT, 'review.mjs')
const SERVER = join(ROOT, 'server.mjs')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const APP = 'Markback check'
const REPORT = 'https://github.com/esetera/markback/issues'
/** Only the first line of what went wrong: the rest is for programmers. */
const firstLine = error => String(error?.stderr || error?.message || error).trim().split('\n')[0].replace(/[.:]+$/, '')

// A port that takes the call and never answers is not the page.
export const up = port => fetch(`http://127.0.0.1:${port}/api/queue`, { signal: AbortSignal.timeout(1500) }).then(r => r.ok, () => false)

/** A port nothing uses now, so the check never meets the person's own page. */
export const freePort = () => new Promise((resolve, reject) => {
  const probe = createServer()
  probe.once('error', reject)
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address()
    probe.close(() => resolve(port))
  })
})

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
const PNG_START = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** A small plain grey picture, made here so the check needs no picture files. */
export function tinyPng(width = 120, height = 80) {
  const size = Buffer.alloc(13)
  size.writeUInt32BE(width, 0)
  size.writeUInt32BE(height, 4)
  size.set([8, 2, 0, 0, 0], 8)
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0xdd)])
  return Buffer.concat([PNG_START, chunk('IHDR', size), chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))), chunk('IEND', Buffer.alloc(0))])
}

/** A real PDF of one blank page, written by hand so the check needs no PDF files. */
export function tinyPdf() {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] >>']
  let text = '%PDF-1.4\n'
  const at = objects.map((body, n) => {
    const offset = text.length
    text += `${n + 1} 0 obj\n${body}\nendobj\n`
    return offset
  })
  const xref = text.length
  return `${text}xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${at.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
}

/** 1. Node is new enough. */
export function checkNode(version = process.versions.node) {
  const [major, minor] = String(version).split('.').map(Number)
  const ok = major > 22 || (major === 22 && minor >= 6)
  return { name: 'node', ok, required: true, words: ok ? `Node ${version}` : `This is Node ${version}. Markback needs Node 22.6 or later. Get it from https://nodejs.org` }
}

/** 2. Files can be written the way the store writes them: through a temporary file, then a rename. */
export function checkStore(home) {
  try {
    mkdirSync(home, { recursive: true })
    const file = join(home, 'check.txt')
    writeAtomic(file, 'ok')
    if (readFileSync(file, 'utf8') !== 'ok') throw new Error('what was written did not read back')
    rmSync(file)
    return { name: 'store', ok: true, required: true, words: 'Files can be written' }
  } catch (error) {
    return { name: 'store', ok: false, required: true, words: `Files cannot be written in ${dirname(home)}: ${firstLine(error)}. Allow writing there, or free some space, then run review check again.` }
  }
}

/** Starts a review page of the check's own. Gives its port and a way to stop it that ends only when it has gone. */
export async function startPage(home, port, { server = SERVER } = {}) {
  const child = spawn(process.execPath, [server], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, REVIEW_HOME: home, REVIEW_PORT: String(port) } })
  let said = ''
  child.stderr.on('data', part => (said += part))
  const gone = new Promise(resolve => {
    child.once('exit', resolve)
    child.once('error', resolve)
  })
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill()
    await gone
  }
  for (let i = 0; i < 100; i++) {
    if (await up(port)) return { port, stop, kill: () => child.kill() }
    if (child.exitCode !== null) break
    await sleep(100)
  }
  await stop()
  throw new Error(said.trim().split('\n').pop() || 'it did not answer')
}

/** 3. The review page starts and answers. The page comes back too, for the round to use and for the caller to stop. */
export async function checkPage(home, { start = startPage } = {}) {
  try {
    const page = await start(home, await freePort())
    return { page, result: { name: 'page', ok: true, required: true, words: 'The review page starts' } }
  } catch (error) {
    return { page: null, result: { name: 'page', ok: false, required: true, words: `The review page did not start: ${firstLine(error)}. Run it by hand to see why: node ${SERVER}` } }
  }
}

/** Sends an answer the way the page does when someone presses Send: reads the queue, then posts the marks and the marked picture. */
export async function sendAnswer(port, { app, notes, png }) {
  const at = `http://127.0.0.1:${port}`
  const queue = await fetch(`${at}/api/queue`, { signal: AbortSignal.timeout(5000) }).then(r => r.json())
  const screen = queue.apps?.flatMap(a => a.screens).find(s => s.app === app)
  if (!screen) throw new Error('the review page does not show the picture that was pushed')
  const body = { appSlug: screen.appSlug, id: screen.id, after: screen.after, round: screen.round, verdict: 'changes', notes, shapes: [{ type: 'box', colour: 'red', box: { x: 10, y: 10, w: 40, h: 20 } }], imageSize: { w: 120, h: 80 }, png: `data:image/png;base64,${png.toString('base64')}` }
  const res = await fetch(`${at}/api/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) })
  const result = await res.json().catch(() => ({}))
  if (!res.ok || !result.record) throw new Error(result.error || 'the review page did not take the answer')
  return result.record
}

/**
 * 4. A whole round, with the real commands: review push queues a picture, review wait waits for it, an answer goes to the page
 * as the page sends it, and review wait prints that answer. If this works, an agent and a person can work together here.
 */
export async function checkRound({ home, work, port, send = sendAnswer }) {
  const failed = (what, error) => ({ name: 'round', ok: false, required: true, words: `A whole round did not work: ${what}${error ? ` (${firstLine(error)})` : ''}. Get a new copy of Markback and run review check again. If it still fails, report it at ${REPORT}` })
  const env = { ...process.env, REVIEW_HOME: home, REVIEW_PORT: String(port) }
  const png = tinyPng()
  const picture = join(work, 'check.png')
  const notes = `Check ${Date.now()}`
  writeFileSync(picture, png)
  try {
    await run(process.execPath, [CLI, 'push', '--app', APP, '--screen', 'Round', '--after', picture, '--check', 'Does a round work?', '--from', 'Markback'], { env, timeout: 20000 })
  } catch (error) {
    return failed('review push did not queue the picture', error)
  }
  // The same command an agent runs. It starts before the answer goes, as in real use.
  const waiting = run(process.execPath, [CLI, 'wait', '--app', APP, '--all', '--json', '--timeout', '20'], { env, timeout: 30000 })
  const waited = waiting.then(out => ({ out }), error => ({ error }))
  try {
    await send(port, { app: APP, notes, png })
  } catch (error) {
    waiting.child.kill()
    await waited
    return failed('the review page did not take the answer', error)
  }
  const { out, error } = await waited
  if (error) return failed('review wait did not give the answer', error)
  let records
  try {
    records = JSON.parse(out.stdout)
  } catch {
    return failed('review wait did not print the answer')
  }
  const back = records.find(r => r.notes === notes)
  if (!back || back.verdict !== 'changes' || back.shapes?.length !== 1) return failed('the answer that came back is not the one that was sent')
  if (!back.annotatedImage || !existsSync(back.annotatedImage)) return failed('the marked picture did not arrive')
  return { name: 'round', ok: true, required: true, words: 'A whole round works: a picture went in, and the answer came back' }
}

/** 5. A browser that can take pictures. Without one, pushing your own screenshots still works, so this only warns. */
export async function checkPictures(work, { find = findChrome, take = capture } = {}) {
  const without = 'review project and review see cannot take pictures. review push with your own screenshots still works.'
  const chrome = find()
  const local = find === findChrome && !process.env.REVIEW_CHROME && needsLocalBrowser(pathToFileURL(work))
  if (!local && !chrome) return { name: 'pictures', ok: false, required: false, words: `No Chrome or Edge here (a sandbox often has none). ${without}` }
  const name = local ? 'Local Chrome' : basename(chrome).replace(/\.exe$/i, '')
  try {
    const page = join(work, 'check.html')
    const out = join(work, 'shot.png')
    writeFileSync(page, '<!doctype html><title>Check</title><h1>Markback check</h1>')
    await take(pathToFileURL(page), out, { width: 400, height: 300 })
    if (!readFileSync(out).subarray(0, 8).equals(PNG_START)) throw new Error('what it made is not a picture')
    return { name: 'pictures', ok: true, required: false, words: `${name} takes pictures` }
  } catch (error) {
    return { name: 'pictures', ok: false, required: false, words: `${name} could not take a picture: ${firstLine(error)}. ${without}` }
  }
}

/** 6. A PDF page can be drawn. Only review pdf needs this, so it only warns. */
export async function checkPdf(work, { draw = pagePictures } = {}) {
  try {
    const file = join(work, 'check.pdf')
    const dir = join(work, 'pages')
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, tinyPdf())
    const { pictures } = await draw(file, dir, { from: 1, to: 1 })
    if (pictures.length !== 1) throw new Error('no page was drawn')
    return { name: 'pdf', ok: true, required: false, words: 'PDF pages can be drawn' }
  } catch (error) {
    const none = /needs pdftoppm/.test(String(error?.message))
    return { name: 'pdf', ok: false, required: false, words: none ? 'review pdf needs pdftoppm on this computer. It comes with Poppler. All other commands work without it.' : `A PDF page could not be drawn: ${firstLine(error)}. review pdf needs pdftoppm, which comes with Poppler. All other commands work without it.` }
  }
}

/** 7. The person's own review page: only looked at, never changed. Not a check, so ok is null. */
export async function checkOwnPage({ port = PORT, look = up } = {}) {
  const running = await look(port)
  return { name: 'your-page', ok: null, required: false, words: running ? `Your review page is running at http://localhost:${port}` : `Your review page is not running. Start it with: review start` }
}

/** 8. Speech happens in the browser, where a command cannot go. */
export const checkSpeaking = () => ({ name: 'speaking', ok: null, required: false, words: 'Speaking cannot be checked from a command. The review page says which speech service it would use.' })

/**
 * Every check in order: [{ name, ok, required, words }], and the exit code: 1 when a required check fails. `ok` is null for a
 * line that only informs. The page of its own is stopped and its folder removed whatever happens. `each` gets a result as it comes.
 */
export async function runChecks({ node = process.versions.node, tmp = tmpdir(), start = startPage, send = sendAnswer, find = findChrome, take = capture, draw = pagePictures, ownPort = PORT, look = up, each = () => {} } = {}) {
  const results = []
  let dir = null
  let page = null
  // A check that throws is a check that failed: the ones after it still run.
  const add = async (name, required, check) => {
    let result
    try {
      result = await check()
    } catch (error) {
      result = { name, ok: false, required, words: `${name} could not be checked: ${firstLine(error)}.` }
    }
    results.push(result)
    each(result)
    return result
  }
  // Stopped from outside, as an agent's command timeout does: the page and the folder must not outlive this command.
  const stopped = () => {
    page?.kill?.()
    if (dir) rmSync(dir, { recursive: true, force: true })
    process.exit(1)
  }
  process.once('SIGINT', stopped)
  process.once('SIGTERM', stopped)
  try {
    await add('node', true, () => checkNode(node))
    const store = await add('store', true, () => {
      dir = mkdtempSync(join(tmp, 'review-check-'))
      mkdirSync(join(dir, 'work'))
      return checkStore(join(dir, 'store'))
    })
    const home = dir && join(dir, 'store')
    const work = dir && join(dir, 'work')
    const skipped = (name, required, why) => add(name, required, () => ({ name, ok: false, required, words: why }))
    if (store.ok) {
      await add('page', true, async () => {
        const started = await checkPage(home, { start })
        page = started.page
        return started.result
      })
    } else await skipped('page', true, 'The review page was not started, because files cannot be written.')
    if (page) await add('round', true, () => checkRound({ home, work, port: page.port, send }))
    else await skipped('round', true, 'A whole round was not tried, because the review page did not start.')
    if (store.ok) {
      await add('pictures', false, () => checkPictures(work, { find, take }))
      await add('pdf', false, () => checkPdf(work, { draw }))
    } else {
      await skipped('pictures', false, 'Pictures were not tried, because files cannot be written.')
      await skipped('pdf', false, 'PDFs were not tried, because files cannot be written.')
    }
    await add('your-page', false, () => checkOwnPage({ port: ownPort, look }))
    await add('speaking', false, checkSpeaking)
  } finally {
    process.off('SIGINT', stopped)
    process.off('SIGTERM', stopped)
    await page?.stop().catch(() => undefined)
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
  return { results, code: results.some(r => r.required && r.ok === false) ? 1 : 0 }
}

/** One result as a line for a person. */
export const sayResult = r => `${(r.ok === null ? 'note' : r.ok ? 'ok' : r.required ? 'failed' : 'missing').padEnd(8)} ${r.words}`

/** The last line: whether Markback can be relied on here, and how many checks passed. */
export function sayVerdict(results) {
  const checks = results.filter(r => r.ok !== null)
  const count = `${checks.filter(r => r.ok).length} of ${checks.length} checks are ok.`
  if (checks.some(r => r.required && !r.ok)) return `Markback does not work here: ${count}`
  const less = checks.filter(r => !r.ok).map(r => (r.name === 'pdf' ? 'PDFs' : r.name))
  return less.length ? `Markback works, except ${less.join(' and ')}: ${count}` : `Everything works: ${count}`
}
