/**
 * Who is listening, and what waits for an agent. Approved work that no agent hears is the fault this is here to stop: every
 * blocking wait says that it runs, every answer says when an agent has read it, and the page and the commands ask here.
 *
 *   <home>/work/listening/<pid>-<id>.json   one waiting command: who, what it waits for, the app, when it last said so
 *   <home>/work/delivered.json              which answers a `review wait` or `review read` has printed
 *   <home>/work/projects.json               the folders that use Markback, and the reviews each one pushed
 *   <home>/work/last-heard.json             when an agent last said that it listens
 *   <home>/work/server.json                 the running server says it runs, with each of its own beats
 */

import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { listApps, listScreens, slug, writeAtomic } from './store.mjs'
import { WORK, listWork, locked, openRequests, readJson } from './work.mjs'

const LISTENING = join(WORK, 'listening')
const DELIVERED = join(WORK, 'delivered.json')
const PROJECTS = join(WORK, 'projects.json')
const HEARD = join(WORK, 'last-heard.json')
const SERVER = join(WORK, 'server.json')

/** A waiting command says it runs this often. One that has said nothing for GONE_MS has gone. */
export const BEAT_MS = 3000
export const GONE_MS = 15000
/** An agent that was just handed work is at it. It counts as hearing for this long after its wait ended. */
export const TOLD_MS = 5 * 60 * 1000
/** How far ahead of this clock a beat may be and still be believed. */
const SKEW_MS = 5000
const now = () => new Date().toISOString()

/* ---------- listening ---------- */

/**
 * Says that this command waits, until it ends. `told()` is for a wait that ends because it has something for its agent: the
 * file stays a few minutes, so the page does not say "nobody listens" while the agent starts on what it was told.
 */
export function listen({ by = 'an agent', what, app = '' }) {
  mkdirSync(LISTENING, { recursive: true })
  // A new wait by the same agent replaces what is left of its last one.
  for (const old of readAll()) if (old.told && old.by === by) rmSync(old.path, { force: true })
  const path = join(LISTENING, `${process.pid}-${Math.random().toString(36).slice(2, 6)}.json`)
  const started = now()
  const say = (extra = {}) => {
    try {
      writeAtomic(path, JSON.stringify({ by, what, app, in: process.cwd(), pid: process.pid, started, beat: now(), ...extra }))
    } catch {
      // A beat that cannot be written is only late. The wait itself still works.
    }
  }
  say()
  const timer = setInterval(say, BEAT_MS)
  timer.unref()
  const gone = () => rmSync(path, { force: true })
  // A wait that is stopped must not look alive: the file goes with it.
  const onInt = () => process.exit(130)
  const onTerm = () => process.exit(143)
  process.on('exit', gone)
  process.once('SIGINT', onInt)
  process.once('SIGTERM', onTerm)
  const done = () => {
    clearInterval(timer)
    process.off('exit', gone)
    process.off('SIGINT', onInt)
    process.off('SIGTERM', onTerm)
  }
  return {
    told() {
      done()
      say({ told: now() })
    },
    stop() {
      done()
      gone()
    },
  }
}

function readAll() {
  if (!existsSync(LISTENING)) return []
  return readdirSync(LISTENING).map(f => {
    const path = join(LISTENING, f)
    return f.endsWith('.json') ? { ...(readJson(path) ?? {}), path } : { path, scrap: true }
  })
}

/** When an agent last said that it listens, or '' when none ever has. Kept when its file goes, so the page can say how long. */
export const lastHeard = () => String(readJson(HEARD)?.at ?? '')

/** The waits that run now, oldest first. Whoever reads cleans up: a file whose command has gone is removed. */
export function listeners(at = Date.now()) {
  const live = []
  const all = readAll()
  // The newest beat, read before a stale file goes with it.
  const newest = all.map(l => l.beat).filter(t => typeof t === 'string' && Date.parse(t) - at <= SKEW_MS).sort().at(-1)
  if (newest && newest > lastHeard()) {
    try {
      writeAtomic(HEARD, JSON.stringify({ at: newest }))
    } catch {
      // Only for saying how long ago. The answer itself does not need it.
    }
  }
  for (const l of all) {
    const last = Date.parse(l.told ?? l.beat ?? '')
    // A beat from the future would look alive until the clock caught up: it is not trusted. A little skew is allowed.
    let alive = at - last <= (l.told ? TOLD_MS : GONE_MS) && last - at <= SKEW_MS
    // A wait whose process has ended has gone, whatever its file says. A told file outlives its wait, on purpose.
    if (alive && !l.told && Number.isInteger(l.pid) && l.pid > 0 && !pidAlive(l.pid)) alive = false
    // Half a file from a command that was killed while it wrote, or one that cannot be read: kept only while it is new.
    if (Number.isNaN(last)) {
      try {
        alive = at - statSync(l.path).mtimeMs <= GONE_MS
      } catch {
        alive = false
      }
      if (alive) continue
    }
    if (!alive) rmSync(l.path, { force: true })
    else live.push({ by: String(l.by ?? 'an agent'), what: l.what, app: l.app ?? '', in: l.in ?? '', only: scopeOf(l.in), started: l.started, ...(l.told ? { told: l.told } : {}) })
  }
  return live.sort((a, b) => String(a.started).localeCompare(String(b.started)))
}

/** Whether a process runs. One that runs as another user is alive, only not ours to signal. */
export function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

/**
 * Which reviews a thing of work is for: a queued item's review, or the target an item or a request for ideas names. Work
 * that names none belongs to no project.
 */
export const namesOf = thing => [...new Set([thing?.app, thing?.target].filter(Boolean).map(slug))]
/** `only` null: every project's work. A list: only work for those reviews, and an empty list is none. */
export const inScope = (only, names) => only === null || only === undefined || names.some(n => only.includes(n))
/** The reviews an agent in this folder should take: its project's, or all of them outside any project. */
export const scopeOf = dir => (dir ? projectOf(dir)?.apps ?? null : null)

/**
 * Whether one of these agents will hear a thing, named by `names` (see namesOf). `review work wait` hears what is in its
 * project, or everything when it runs outside one. `review wait` hears the answers on its own app, and so the item those
 * screens belong to. `review ideas wait` hears only requests for ideas.
 */
export const hears = (agents, kind, names = []) => {
  const list = [].concat(names).filter(Boolean).map(slug)
  return agents.some(a => (a.what === 'work' ? inScope(a.only, list) : kind === 'ideas' ? a.what === 'ideas' : a.what === 'wait' && !!a.app && list.includes(slug(a.app))))
}

/* ---------- delivered: which answers an agent has read ---------- */

/**
 * The inbox does not say whether anyone read an answer, so `review wait` and `review read` write it here when they print one:
 * for each screen, the time of the newest answer printed. The first look in a store takes every answer already there as
 * read (`since`), or a store with a long past would say all of it again.
 */
function readDelivered() {
  const held = readJson(DELIVERED)
  if (held && typeof held.since === 'string' && held.screens && typeof held.screens === 'object') return held
  const fresh = { since: listApps().flatMap(a => a.screens.map(s => s.sentAt || '')).sort().at(-1) ?? '', screens: {} }
  mkdirSync(WORK, { recursive: true })
  writeAtomic(DELIVERED, JSON.stringify(fresh, null, 2))
  return fresh
}

/** These records were printed for an agent. `earlier` ones under a record were printed with it. */
export function markDelivered(records) {
  const flat = records.flatMap(r => [r, ...(r.earlier ?? [])]).filter(r => r?.sentAt && r.screenId)
  if (!flat.length) return
  locked(() => {
    const held = readDelivered()
    for (const r of flat) {
      const key = `${slug(r.app)}/${r.screenId}`
      if (r.sentAt > (held.screens[key] ?? held.since)) held.screens[key] = r.sentAt
    }
    writeAtomic(DELIVERED, JSON.stringify(held, null, 2))
  })
}

/** Screens with an answer that no agent has read: answered on the page, and not printed by a wait or a read since. */
export function unread(apps = listApps()) {
  const held = readDelivered()
  return apps.flatMap(a => a.screens
    .filter(s => s.status !== 'waiting' && s.sentAt && s.sentAt > (held.screens[`${a.slug}/${s.id}`] ?? held.since))
    .map(s => ({ app: a.name, appSlug: a.slug, id: s.id, screen: s.screen, mode: s.mode, status: s.status, sentAt: s.sentAt })))
}

/* ---------- what waits for an agent ---------- */

/** When an item last joined the queue: how long it has waited is counted from here. */
export const queuedSince = item => (item.history ?? []).filter(h => h.stage === 'queued').at(-1)?.at ?? item.at

/**
 * All an agent should act on: items in the queue that nobody has taken, top first; open requests for ideas; and answers
 * nobody has read. Answers on an app that a `review wait` listens to now are left out: they are being delivered there.
 * `only` keeps it to one project's reviews (see scopeOf): null is every project, an empty list is nothing.
 */
export function waitingWork({ agents = listeners(), apps = listApps(), only = null } = {}) {
  const queue = listWork().filter(i => i.stage === 'queued' && inScope(only, namesOf(i)))
  const ideas = openRequests().filter(r => inScope(only, namesOf(r)))
  const waited = agents.filter(a => a.what === 'wait').map(a => slug(a.app))
  const answers = new Map()
  for (const s of unread(apps)) {
    if (waited.includes(s.appSlug) || !inScope(only, [s.appSlug])) continue
    const held = answers.get(s.appSlug) ?? { app: s.app, screens: 0, changes: 0 }
    held.screens++
    if (s.status === 'sent') held.changes++
    answers.set(s.appSlug, held)
  }
  return { queue, ideas, answers: [...answers.values()], count: queue.length + ideas.length + answers.size }
}

/**
 * For the page: who listens, and how much waits that none of them will hear. `sig` names that work, so whoever wakes an
 * agent for it can tell the same work from new work. Nothing here changes from one look to the next while nothing happens.
 * `only` keeps it to one project's reviews, as for waitingWork. Marks on an app that `excludeMarksFor` names are left out:
 * something else (a Codex Desktop heartbeat) takes them.
 */
export function standing(apps = listApps(), { excludeMarksFor = () => false, only = null } = {}) {
  const agents = listeners()
  const queue = listWork().filter(i => i.stage === 'queued' && inScope(only, namesOf(i)) && !hears(agents, 'queue', namesOf(i)))
  const ideas = openRequests().filter(r => inScope(only, namesOf(r)) && !hears(agents, 'ideas', namesOf(r)))
  const marks = unread(apps).filter(s => s.status === 'sent' && inScope(only, [s.appSlug]) && !excludeMarksFor(s.appSlug) && !hears(agents, 'marks', s.app))
  return {
    agents: agents.map(a => ({ by: a.by, what: a.what, app: a.app, ...(a.told ? { told: a.told } : {}) })),
    heard: lastHeard(),
    unheard: { queue: queue.length, ideas: ideas.length, marks: marks.length },
    markApps: [...new Set(marks.map(s => s.appSlug))],
    sig: [...queue.map(i => `${i.id}:${i.phase}:${i.round}`), ...ideas.map(r => r.id), ...marks.map(s => `${s.appSlug}/${s.id}@${s.sentAt}`)].sort().join(' '),
  }
}

/**
 * What an answer has just made for an agent to do, or null. An item's screens make work when the last one is answered and
 * the item joins the queue: to build, or for another round. Plain screens make work when the round is complete and some of
 * it asks for changes. `heard` says whether an agent that listens now will get it.
 */
export function madeBy(record, stageBefore, item) {
  let made = null
  if (item && stageBefore === 'ready' && item.stage === 'queued') made = { what: item.marksBack ? 'round' : 'build', title: item.title }
  else if (!item && !record.olderPicture) {
    const screens = listScreens(slug(record.app))
    const fresh = unread([{ slug: slug(record.app), name: record.app, screens }])
    if (!screens.some(s => s.status === 'waiting') && fresh.some(s => s.status === 'sent')) made = { what: 'marks', title: record.app }
  }
  return made && { ...made, heard: hears(listeners(), made.what === 'marks' ? 'marks' : 'queue', item ? namesOf(item) : record.app) }
}

/* ---------- is the server running ---------- */

/** A server that has not said so for this long has gone. It says so about every 20 seconds. */
export const SERVER_GONE_MS = 60_000

/** The server says it runs. Written with each of its beats, and removed when it stops. */
export function serverBeat(port) {
  mkdirSync(WORK, { recursive: true })
  writeAtomic(SERVER, JSON.stringify({ pid: process.pid, port, beat: now() }))
}
export const serverGone = () => {
  if (readJson(SERVER)?.pid === process.pid) rmSync(SERVER, { force: true })
}

/**
 * Whether the review page's server runs now: it said so lately, and its process is alive. One small file read and no network,
 * so a hook can ask it in a moment, with or without the server.
 */
export function serverRunning(at = Date.now()) {
  const held = readJson(SERVER)
  if (!held || !Number.isInteger(held.pid) || !(Math.abs(at - Date.parse(held.beat)) <= SERVER_GONE_MS)) return false
  return pidAlive(held.pid)
}

/* ---------- which folders use Markback ---------- */

const folderOf = dir => resolve(String(dir))
/** Never a project: everything is inside them. */
const tooBroad = folder => folder === homedir() || folder === resolve(sep)

/**
 * The folder a project is known by: the nearest folder above that holds `.git` (a repository's root), or the folder itself
 * outside a repository. Never the home folder or the root.
 */
export function rootOf(dir) {
  const start = folderOf(dir)
  for (let folder = start; !tooBroad(folder); folder = resolve(folder, '..')) {
    if (existsSync(join(folder, '.git'))) return folder
    if (resolve(folder, '..') === folder) break
  }
  return start
}

const readProjects = () => {
  const held = readJson(PROJECTS)
  return held && typeof held === 'object' && !Array.isArray(held) ? held : {}
}

/**
 * A folder uses Markback from the first time `review project`, `review push` or `review wake set` runs in it. It is noted by
 * its root (see rootOf), so a push from a subfolder counts for the whole repository. The reviews it pushed are kept with it,
 * so a session there can be told what waits for its own project and not for another one's.
 */
export function noteProject(dir, app = '') {
  const folder = projectOf(dir)?.folder ?? rootOf(dir)
  if (tooBroad(folder)) return
  try {
    const held = readProjects()
    const apps = held[folder]?.apps ?? []
    if (held[folder] && (!app || apps.includes(slug(app)))) return
    locked(() => {
      const all = readProjects()
      all[folder] = { apps: [...new Set([...(all[folder]?.apps ?? []), ...(app ? [slug(app)] : [])])], at: all[folder]?.at ?? now() }
      writeAtomic(PROJECTS, JSON.stringify(all, null, 2))
    })
  } catch {
    // Only a note. The push itself must not fail for it.
  }
}

/**
 * The project a folder is in, or null when it does not use Markback. Only an exact match counts: the folder itself, or its
 * repository's root (see rootOf), noted here or holding `.agents/skills/markback`, which `review project` puts there. A
 * folder above that merely contains it never does, or one push from a parent would make every folder below a project.
 * `apps` is empty when none are known, and then no work is this project's.
 */
export function projectOf(dir) {
  const held = readProjects()
  const here = folderOf(dir)
  for (const folder of [...new Set([here, rootOf(dir)])]) {
    if (tooBroad(folder)) continue
    if (held[folder]) return { folder, apps: Array.isArray(held[folder].apps) ? held[folder].apps : [] }
    if (existsSync(join(folder, '.agents', 'skills', 'markback'))) return { folder, apps: [] }
  }
  return null
}

/** The reviews noted for exactly this project folder. */
export const appsOf = folder => {
  const apps = readProjects()[folderOf(folder)]?.apps
  return Array.isArray(apps) ? apps : []
}
