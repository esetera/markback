/**
 * Waking an agent. A line to copy is not enough: when work waits and no agent listens, the running server starts the
 * project's agent by itself, with the command that agent registered.
 *
 *   <home>/work/wake.json        how to start the agent: the command, the folder, who it is, and on or off
 *   <home>/work/wake.log         what each run printed
 *   <home>/work/wake-last.json   the last run: when, for what work, how it ended
 *
 * The command is set only from the command line (`review wake set`), by the agent during setup or by the person. Nothing the
 * page or the HTTP API can reach sets or changes it: a web page must never be able to make this computer run something. The
 * server imports only what reads the command and what turns it on and off.
 *
 * The woken agent runs with the permissions the person already gave that tool. Markback adds none, and passes no flag that
 * skips a permission prompt: the command is run as it was registered, with only {prompt} filled in.
 */

import { spawn } from 'node:child_process'
import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { slug, writeAtomic } from './store.mjs'
import { WORK, locked, readJson } from './work.mjs'
import { standing } from './listen.mjs'

const WAKE = join(WORK, 'wake.json')
const LOG = join(WORK, 'wake.log')
const LAST = join(WORK, 'wake-last.json')
const DESKTOP = join(WORK, 'desktop-wake')

const desktopFile = app => join(DESKTOP, `${slug(app)}.json`)

export const readDesktopWake = app => readJson(desktopFile(app))

/** A Codex Desktop heartbeat polls its own review. The server never starts a Codex process for it. */
export function setDesktopWake(app, thread = process.env.CODEX_THREAD_ID) {
  if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(thread ?? '')) {
    throw new Error('Set this up from the Codex Desktop chat that will review this app.')
  }
  locked(() => {
    mkdirSync(DESKTOP, { recursive: true })
    writeAtomic(desktopFile(app), JSON.stringify({ thread, on: true }))
  })
}

export function switchDesktopWake(app, on) {
  return locked(() => {
    const held = readDesktopWake(app)
    if (!held) return false
    writeAtomic(desktopFile(app), JSON.stringify({ ...held, on }))
    return true
  })
}

export function clearDesktopWake(app, thread = process.env.CODEX_THREAD_ID) {
  return locked(() => {
    const held = readDesktopWake(app)
    if (!held?.thread || held.thread !== thread) return false
    rmSync(desktopFile(app), { force: true })
    return true
  })
}

/** What the woken agent is told. Fixed: nothing from the page or the queue is put into a command. */
export const PROMPT = 'Markback: work is waiting. Run `review work` and do what it says: take approved items and build them, read new marks and act on them. When you finish, keep `review work wait` running.'

/** How to start the agent, or null when none is set. */
export function readWake() {
  const held = readJson(WAKE)
  return held && typeof held.run === 'string' && held.run.trim() ? { run: held.run, in: String(held.in ?? ''), by: String(held.by ?? 'your agent'), on: held.on !== false, ...(held.path ? { path: String(held.path) } : {}) } : null
}

/** From the command line only. The search path of the shell that sets it is kept, so the server finds the same program. */
export function setWake({ run, folder, by = 'your agent' }) {
  const line = String(run ?? '').trim()
  if (!line) throw new Error('Say the command: review wake set --run "<command with {prompt} in it>"')
  if (!line.includes('{prompt}')) throw new Error('The command needs {prompt} where the words for the agent go.')
  if (!argvOf(line, '').length) throw new Error('That command cannot be read.')
  mkdirSync(WORK, { recursive: true })
  const wake = { run: line, in: resolve(String(folder || process.cwd())), by: String(by), on: true, path: process.env.PATH ?? '', setAt: new Date().toISOString() }
  writeAtomic(WAKE, JSON.stringify(wake, null, 2))
  return readWake()
}

/** On or off. It never makes one: with no command set, there is nothing to turn on. */
export function switchWake(on) {
  const held = readJson(WAKE)
  if (!readWake()) return null
  writeAtomic(WAKE, JSON.stringify({ ...held, on: !!on }, null, 2))
  return readWake()
}

export function clearWake() {
  rmSync(WAKE, { force: true })
}

/**
 * The command as a program and its arguments, with {prompt} filled in. No shell reads it, so nothing in the words for the
 * agent can be run as a command, and quotes are only for keeping words together.
 */
export function argvOf(line, prompt = PROMPT) {
  return [...String(line).matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(m => (m[1] ?? m[2] ?? m[3]).replaceAll('{prompt}', prompt))
}

/** The last thing a run printed, for the page to show when it failed. */
export function lastLogLine() {
  try {
    return readFileSync(LOG, 'utf8').slice(-4000).split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('--- ')).at(-1)?.slice(0, 300) ?? ''
  } catch {
    return ''
  }
}

export const lastRun = () => readJson(LAST)

/** Starts the command on its own, so it outlasts the server. What it prints goes to the log. */
function startRun(wake, onEnd) {
  mkdirSync(WORK, { recursive: true })
  appendFileSync(LOG, `--- ${new Date().toISOString()} waking ${wake.by}: ${wake.run} (in ${wake.in})\n`)
  const out = openSync(LOG, 'a')
  const [program, ...args] = argvOf(wake.run)
  // A run started here is a new one of its own, not one inside the session that started the server.
  const { CLAUDECODE, CLAUDE_CODE_ENTRYPOINT, ...env } = process.env
  let ended = false
  const end = (code, words = '') => {
    if (ended) return
    ended = true
    if (words) appendFileSync(LOG, `${words}\n`)
    onEnd(code)
  }
  try {
    const child = spawn(program, args, { cwd: wake.in || undefined, detached: true, stdio: ['ignore', out, out], env: { ...env, ...(wake.path ? { PATH: wake.path } : {}) } })
    child.on('error', error => end(-1, `It did not start: ${error.message}`))
    child.on('exit', code => end(code ?? -1))
    return child.pid ?? 0
  } catch (error) {
    end(-1, `It did not start: ${error.message}`)
    return 0
  } finally {
    closeSync(out)
  }
}

/**
 * The heartbeat. The server calls `check` about every 20 seconds. It starts the command when: wake is on, work waits that
 * no agent will hear, it has been so for `quiet`, no run is in flight, the last run ended at least `gap` ago, and the same
 * work was not woken for within `backoff`. One run at a time. A run that ends with the same work still unheard has failed.
 * With wake off or not set, a check is one small file read; with nothing waiting it starts nothing and writes nothing.
 */
export function createWaker({ quiet = 60_000, backoff = 600_000, late = 120_000, gap = 30_000, now = Date.now, look = standing, start = startRun } = {}) {
  let since = 0
  let run = lastRun()
  // A run from before this server started cannot be watched: it is taken as ended.
  if (run?.running) run = { ...run, running: false }
  const save = () => {
    try {
      writeAtomic(LAST, JSON.stringify(run, null, 2))
    } catch {
      // The record is for reading later. The run itself is not held up for it.
    }
  }
  function check() {
    const wake = readWake()
    if (!wake?.on) {
      since = 0
      return 'off'
    }
    const { unheard, sig } = look()
    if (!(unheard.queue + unheard.ideas + unheard.marks)) {
      since = 0
      return 'nothing'
    }
    since ||= now()
    if (run?.running) return 'running'
    if (now() - since < quiet) return 'soon'
    // A short rest after any run, so a command that ends at once is never started over and over.
    if (run?.endedAt && now() - Date.parse(run.endedAt) < gap) return 'resting'
    if (run && run.for === sig && now() - run.at < backoff) return 'woken'
    const mine = (run = { at: now(), startedAt: new Date(now()).toISOString(), for: sig, by: wake.by, run: wake.run, running: true })
    mine.pid = start(wake, code => {
      const after = look()
      Object.assign(mine, { running: false, endedAt: new Date(now()).toISOString(), code, failed: after.sig === mine.for && !!after.sig })
      save()
    })
    save()
    return 'started'
  }
  /** For the page: whether wake is set, the command it will run, and how the last run for this work stands. */
  function view(listening = look()) {
    const wake = readWake()
    if (!wake) return null
    const waits = listening.unheard.queue + listening.unheard.ideas + listening.unheard.marks
    const forThis = run && run.for === listening.sig
    const status = !wake.on ? 'off' : !waits ? 'ready' : forThis && !run.running && run.failed ? 'failed' : forThis && run.running && now() - run.at > late ? 'late' : 'waking'
    return { on: wake.on, run: wake.run, in: wake.in, by: wake.by, status, ...(status === 'failed' || status === 'late' ? { lastLine: lastLogLine(), code: run.code ?? null } : {}) }
  }
  return { check, view, last: () => run }
}
