/**
 * Waking an agent. A line to copy is not enough: when work waits and no agent listens, the running server starts the
 * project's agent by itself, with the command that agent registered. One command for each project, never one for the whole
 * computer: a project's agent is started only for work on that project's reviews, in that project's folder, and told which
 * reviews are its own. Work that belongs to no project with a wake command starts nothing.
 *
 *   <home>/work/wake/<key>.json        one project's command: the folder, who it is, and on or off
 *   <home>/work/wake/<key>.log         what each of its runs printed
 *   <home>/work/wake/<key>.last.json   its last run: when, which process, for what work, how it ended
 *
 * The command is set only from the command line (`review wake set`), by the agent during setup or by the person. Nothing the
 * page or the HTTP API can reach sets or changes it: a web page must never be able to make this computer run something. The
 * server imports only what reads the command and what turns it on and off.
 *
 * The woken agent runs with the permissions the person already gave that tool. Markback adds none, and passes no flag that
 * skips a permission prompt: the command is run as it was registered, with only {prompt} filled in.
 */

import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { listApps, slug, writeAtomic } from './store.mjs'
import { WORK, locked, readJson } from './work.mjs'
import { appsOf, noteProject, pidAlive, projectOf, rootOf, standing } from './listen.mjs'

const WAKES = join(WORK, 'wake')
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

/* ---------- one command for each project ---------- */

/** A run that has gone this long no longer stops a new one: it may never end, and the work must not wait for ever. */
export const LONGEST_MS = 30 * 60 * 1000

/** A project's files are named by its folder: readable, and never the same for two folders. */
const keyOf = folder => `${slug(basename(folder)) || 'project'}-${createHash('sha256').update(folder).digest('hex').slice(0, 10)}`
const fileOf = (folder, kind = '') => join(WAKES, `${keyOf(folder)}${kind}`)

/** The project a command run in this folder is for: the one it is in, or the folder's own root (see rootOf). */
export const projectFolder = dir => projectOf(dir)?.folder ?? rootOf(dir)

const shape = held => (held && typeof held.run === 'string' && held.run.trim() && typeof held.in === 'string' && held.in
  ? { key: keyOf(held.in), run: held.run, in: held.in, by: String(held.by ?? 'your agent'), on: held.on !== false, ...(held.path ? { path: String(held.path) } : {}) }
  : null)

/** This project's command, or null when none is set. */
export const readWake = (dir = process.cwd()) => shape(readJson(fileOf(projectFolder(dir), '.json')))

/** Every project's command. */
export function listWakes() {
  if (!existsSync(WAKES)) return []
  // A file whose name is not its folder's is not trusted: it would be checked under one name and run under another.
  return readdirSync(WAKES).filter(f => f.endsWith('.json') && !f.endsWith('.last.json')).map(f => [f, shape(readJson(join(WAKES, f)))]).filter(([f, w]) => w && f === `${w.key}.json`).map(([, w]) => w).sort((a, b) => a.in.localeCompare(b.in))
}

/**
 * From the command line only, in the project's folder. The search path of the shell that sets it is kept, so the server
 * finds the same program. `app` notes a review as this project's, for a project that has pushed none yet.
 */
export function setWake({ run, folder = process.cwd(), by = 'your agent', app = '' }) {
  const line = String(run ?? '').trim()
  if (!line) throw new Error('Say the command: review wake set --run "<command with {prompt} in it>"')
  if (!line.includes('{prompt}')) throw new Error('The command needs {prompt} where the words for the agent go.')
  if (!argvOf(line, '').length) throw new Error('That command cannot be read.')
  const at = projectFolder(folder)
  if (at === homedir() || at === resolve(sep)) throw new Error('Run this in your project\'s folder: the home folder holds every project.')
  noteProject(at, app)
  mkdirSync(WAKES, { recursive: true })
  writeAtomic(fileOf(at, '.json'), JSON.stringify({ run: line, in: at, by: String(by), on: true, path: process.env.PATH ?? '', setAt: new Date().toISOString() }, null, 2))
  return readWake(at)
}

const byKeyOrDir = ({ key = null, dir = process.cwd() } = {}) => (key ? listWakes().find(w => w.key === key) ?? null : readWake(dir))

/** On or off, for one project, by its key (the page) or its folder (the command line). It never makes one. */
export function switchWake(on, where = {}) {
  const wake = byKeyOrDir(where)
  if (!wake) return null
  const held = readJson(fileOf(wake.in, '.json'))
  writeAtomic(fileOf(wake.in, '.json'), JSON.stringify({ ...held, on: !!on }, null, 2))
  return readWake(wake.in)
}

export function clearWake(dir = process.cwd()) {
  const folder = projectFolder(dir)
  for (const kind of ['.json', '.last.json']) rmSync(fileOf(folder, kind), { force: true })
}

/** Names as they go into the words for the agent: letters, numbers, spaces, dots, dashes. Nothing a shell could read. */
const plain = text => String(text).replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 60)

/**
 * What the woken agent is told: fixed words, with the project's folder name and its reviews, cleaned. Nothing typed on the
 * page goes in. It says which work is its own, so the agent never takes another project's.
 */
export function promptFor(wake, apps = appsOf(wake.in)) {
  const reviews = apps.map(plain).filter(Boolean)
  return `Markback: work is waiting for the project ${plain(basename(wake.in)) || 'in this folder'}${reviews.length ? `, on the reviews ${reviews.join(', ')}` : ''}. Run \`review work\` in this folder and do what it says. It lists only this project's work: take approved items and build them, read new marks and act on them. Leave other projects' work alone. When you finish, keep \`review work wait\` running.`
}

/**
 * The command as a program and its arguments, with {prompt} filled in. No shell reads it, so nothing in the words for the
 * agent can be run as a command, and quotes are only for keeping words together.
 */
export function argvOf(line, prompt = '') {
  return [...String(line).matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(m => (m[1] ?? m[2] ?? m[3]).replaceAll('{prompt}', prompt))
}

/* ---------- starting it, on any system ---------- */

/** What cmd.exe reads as more than a letter. Each gets a ^ before it, so cmd takes it as it is. */
const CMD_META = /([()\][%!^"`<>&|;, *?])/g

/** One argument for a .cmd or .bat file: quoted as Windows programs read their arguments, then kept from cmd.exe. */
export const cmdQuote = arg => `"${String(arg).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`.replace(CMD_META, '^$1')

/** The file Windows would run for this name: on the search path, with the endings PATHEXT lists. */
function findOnWindows(program, env, exists) {
  const ends = /\.[^\\/.]+$/.test(program) ? [''] : (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
  const dirs = /[\\/]/.test(program) ? [''] : (env.PATH ?? env.Path ?? '').split(';').filter(Boolean)
  for (const dir of dirs) {
    for (const end of ends) {
      const path = dir ? `${dir.replace(/[\\/]+$/, '')}\\${program}${end}` : `${program}${end}`
      if (exists(path)) return path
    }
  }
  return null
}

/**
 * How to start a program and its arguments with no shell. On Windows a .cmd or .bat (as npm puts in for claude and codex)
 * cannot start without cmd.exe, so cmd.exe runs it, with every argument quoted here and no other words in the line.
 */
export function launchOf([program, ...args], { platform = process.platform, env = process.env, exists = existsSync } = {}) {
  const options = { windowsHide: true }
  if (platform !== 'win32') return { file: program, args, options }
  const found = findOnWindows(program, env, exists) ?? program
  if (!/\.(cmd|bat)$/i.test(found)) return { file: found, args, options }
  const line = [found.replace(CMD_META, '^$1'), ...args.map(cmdQuote)].join(' ')
  return { file: env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], options: { ...options, windowsVerbatimArguments: true } }
}

/** The last thing a project's run printed, for the page to show when it failed. */
export function lastLogLine(folder) {
  try {
    return readFileSync(fileOf(folder, '.log'), 'utf8').slice(-4000).split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('--- ')).at(-1)?.slice(0, 300) ?? ''
  } catch {
    return ''
  }
}

export const lastRun = (dir = process.cwd()) => readJson(fileOf(projectFolder(dir), '.last.json'))

/** Starts the command on its own, so it outlasts the server. What it prints goes to the project's log. */
function startRun(wake, prompt, onEnd) {
  mkdirSync(WAKES, { recursive: true })
  const logFile = fileOf(wake.in, '.log')
  appendFileSync(logFile, `--- ${new Date().toISOString()} waking ${wake.by}: ${wake.run} (in ${wake.in})\n`)
  const out = openSync(logFile, 'a')
  // A run started here is a new one of its own, not one inside the session that started the server.
  const { CLAUDECODE, CLAUDE_CODE_ENTRYPOINT, ...env } = process.env
  if (wake.path) {
    // Windows spells it Path, and two spellings in one block would be two values.
    for (const name of Object.keys(env)) if (name.toUpperCase() === 'PATH') delete env[name]
    env.PATH = wake.path
  }
  let ended = false
  const end = (code, words = '') => {
    if (ended) return
    ended = true
    if (words) appendFileSync(logFile, `${words}\n`)
    onEnd(code)
  }
  try {
    const { file, args, options } = launchOf(argvOf(wake.run, prompt), { env })
    const child = spawn(file, args, { ...options, cwd: wake.in, detached: true, stdio: ['ignore', out, out], env })
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
 * When the system says this process started, as a mark of which process it is: a pid can be given again to another one
 * once the first ends. Read with ps, no shell. '' where it cannot be told (Windows, or no such process): the pid alone then.
 */
export function processStart(pid) {
  if (process.platform === 'win32' || !pid) return ''
  try {
    return execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

/** What waits in one project that no agent will hear. */
const lookFor = wake => standing(listApps(), { only: appsOf(wake.in) })
const total = unheard => unheard.queue + unheard.ideas + unheard.marks

/**
 * The heartbeat. The server calls `check` about every 20 seconds, and each project with a command is looked at on its own.
 * A project's command is started when: it is on, work on that project's reviews waits that no agent will hear, it has been
 * so for `quiet`, none of its runs is in flight, its last run ended at least `gap` ago, and the same work was not woken for
 * within `backoff`. One run at a time for each project. A run that ends with the same work still unheard has failed.
 *
 * A run is known by its process. One left by an earlier server is still running only while that process lives, and its
 * rest counts from when it was seen to end. A run older than `longest` no longer stops a new one, since it may never end.
 */
export function createWaker({ quiet = 60_000, backoff = 600_000, late = 120_000, gap = 30_000, longest = LONGEST_MS, now = Date.now, look = lookFor, start = startRun, alive = pidAlive, identify = processStart, wakes = listWakes } = {}) {
  const runs = new Map()
  const since = new Map()
  const iso = () => new Date(now()).toISOString()
  const save = wake => {
    try {
      mkdirSync(WAKES, { recursive: true })
      writeAtomic(fileOf(wake.in, '.last.json'), JSON.stringify(runs.get(wake.key), null, 2))
    } catch {
      // The record is for reading later. The run itself is not held up for it.
    }
  }
  /** Ended now, as far as this server can tell. Failed when the work it was for still waits unheard. */
  const ended = (wake, run, code) => {
    const after = look(wake)
    Object.assign(run, { running: false, endedAt: iso(), code, failed: after.sig === run.for && !!after.sig })
    delete run.watched
  }
  function runOf(wake) {
    if (!runs.has(wake.key)) {
      const held = readJson(fileOf(wake.in, '.last.json'))
      runs.set(wake.key, held)
      // From an earlier server: no word comes when it ends, so its process is asked instead.
      if (held?.running) held.watched = false
    }
    const run = runs.get(wake.key)
    // Alive only while it is the same process: a pid given again to something else is not the run.
    const same = () => run.pid && alive(run.pid) && (!run.started || identify(run.pid) === run.started)
    if (run?.running && run.watched === false && !same()) {
      ended(wake, run, run.code ?? null)
      save(wake)
    }
    return run
  }
  function checkOne(wake) {
    if (!wake.on) {
      since.delete(wake.key)
      return 'off'
    }
    const run = runOf(wake)
    const { unheard, sig } = look(wake)
    if (!total(unheard)) {
      since.delete(wake.key)
      return 'nothing'
    }
    if (!since.has(wake.key)) since.set(wake.key, now())
    if (run?.running && now() - run.at < longest) return 'running'
    if (now() - since.get(wake.key) < quiet) return 'soon'
    // A short rest after any run, so a command that ends at once is never started over and over.
    if (run?.endedAt && now() - Date.parse(run.endedAt) < gap) return 'resting'
    if (run && run.for === sig && now() - run.at < backoff) return 'woken'
    const mine = { at: now(), startedAt: iso(), for: sig, by: wake.by, run: wake.run, in: wake.in, running: true }
    runs.set(wake.key, mine)
    mine.pid = start(wake, promptFor(wake), code => {
      ended(wake, mine, code)
      // A run that outlived `longest` may end after a newer one began: the newer one's record is not written over.
      if (runs.get(wake.key) === mine) save(wake)
    })
    // Read once, now, so a later server can tell this process from another given the same pid.
    if (mine.running && mine.pid) mine.started = identify(mine.pid)
    save(wake)
    return 'started'
  }
  /** Each project with a command, and what its check did: 'off', 'nothing', 'running', 'soon', 'resting', 'woken' or 'started'. */
  const check = () => Object.fromEntries(wakes().map(wake => [wake.key, checkOne(wake)]))
  /** For the page: one project's command, and how its last run stands for the work that waits there now. */
  function view(wake, listening = look(wake)) {
    const run = runOf(wake)
    const forThis = run && run.for === listening.sig
    const age = run ? now() - run.at : 0
    const status = !wake.on ? 'off' : !total(listening.unheard) ? 'ready' : forThis && !run.running && run.failed ? 'failed' : forThis && run.running && age > longest ? 'stuck' : forThis && run.running && age > late ? 'late' : 'waking'
    return { key: wake.key, on: wake.on, run: wake.run, in: wake.in, name: basename(wake.in), by: wake.by, status, ...(['failed', 'late', 'stuck'].includes(status) ? { lastLine: lastLogLine(wake.in), code: run.code ?? null } : {}) }
  }
  /** One project's last run, by its key; with no key, the only project's. */
  const last = key => runs.get(key ?? [...runs.keys()][0]) ?? null
  return { check, view, last }
}

/**
 * One wake for the page to speak of, from every project's: `total` is all the work that waits unheard, and each of
 * `projects` is a project's view and how much of that work is its own. When every bit of it will wake an agent, the one
 * that stands worst is said (failed, stuck, late, then waking). When some will not, a project whose wake is off is said, so
 * the person can turn it on; or none, and the page says how to set one up.
 */
export function wakeSummary(total, projects) {
  if (!total) return null
  const covering = projects.filter(p => p.waits && p.view.on)
  if (covering.reduce((n, p) => n + p.waits, 0) >= total) {
    const order = ['failed', 'stuck', 'late', 'waking']
    return covering.map(p => p.view).sort((a, b) => (order.indexOf(a.status) + 1 || 9) - (order.indexOf(b.status) + 1 || 9))[0]
  }
  return projects.find(p => p.waits && !p.view.on)?.view ?? null
}
