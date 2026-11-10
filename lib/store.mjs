/**
 * Where screens wait for review and where feedback lands. Everything is plain files, so the CLI and the server never
 * need each other: a push works with the wizard closed, and the wizard picks it up on its next look.
 *
 *   <home>/queue/<app>/<screen>.json   one screen waiting (or reviewed), with its status
 *   <home>/images/<app>/<screen>-{after,before}.png   copies of the pushed pictures
 *   <home>/images/<app>/<screen>-words-<time>.json    the words in the after picture, when the push gave them
 *   <home>/inbox/<app>/<screen>-<time>.{png,json}   what the reviewer sent back
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { DEFAULT_PORT, isPort, storeId, whereStore } from './home.mjs'
import { keptWords, marksWithWords, readWords } from './words.mjs'

/** Which store, why, and what to say about it: --home, REVIEW_HOME, a project's .markback, or ~/.review-wizard. */
export const WHERE = whereStore()
export const HOME = WHERE.home
/** Where plugins are kept: never a store a project's .markback chose, since a plugin runs code. */
export const OWN_HOME = WHERE.own
/** What the review page says it serves, so a command can tell its own store's page from another's on the same port. */
export const STORE_ID = storeId(HOME)
const PORT_FILE = join(HOME, 'port')
/** REVIEW_PORT, or the one `review start` chose for this store, or the project's .markback, or the usual one. */
export const PORT = [process.env.REVIEW_PORT, readPortFile(), WHERE.port].map(Number).find(port => isPort(port)) ?? DEFAULT_PORT
function readPortFile() {
  try {
    return readFileSync(PORT_FILE, 'utf8').trim()
  } catch {
    return ''
  }
}
export const rememberPort = port => {
  mkdirSync(HOME, { recursive: true })
  writeFileSync(PORT_FILE, String(port))
}
export const QUEUE = join(HOME, 'queue')
export const IMAGES = join(HOME, 'images')
export const INBOX = join(HOME, 'inbox')

export const slug = text => String(text).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled'

/** Light and dark are separate screens. */
export const screenId = (screen, mode) => (mode ? `${slug(screen)}-${slug(mode)}` : slug(screen))

/** Writes through a temporary file so a reader never sees half a file. */
export function writeAtomic(path, data) {
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, data)
  renameSync(tmp, path)
}

const readJson = path => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/** What is being asked of the reviewer: a new idea to shape, or something built to check. */
export const KINDS = ['qa', 'proposal']

/** Queues one screen. Pushing the same app, screen and mode again starts a new round on the same step. */
export function push({ app, screen, mode = '', after, before = '', note = '', check = [], from = 'Claude', kind = 'qa', item = '', place = null, madeFrom = null, words = '' }) {
  if (!app || !screen || !after) throw new Error('push needs an app, a screen name and the after picture.')
  if (!KINDS.includes(kind)) throw new Error(`--kind must be ${KINDS.join(' or ')}.`)
  for (const file of [after, before].filter(Boolean)) if (!existsSync(file)) throw new Error(`No picture at ${file}`)
  // Checked before anything is written: a list that is not right queues nothing.
  const list = words ? readWords(words, after) : null
  const appSlug = slug(app)
  const id = screenId(screen, mode)
  mkdirSync(join(QUEUE, appSlug), { recursive: true })
  mkdirSync(join(IMAGES, appSlug), { recursive: true })
  const path = join(QUEUE, appSlug, `${id}.json`)
  const old = readJson(path)
  const stamp = Date.now()
  const copy = (file, kind) => {
    const name = `${id}-${kind}-${stamp}${extname(file) || '.png'}`
    copyFileSync(file, join(IMAGES, appSlug, name))
    return `${appSlug}/${name}`
  }
  // The words in the after picture, kept beside it under the same time, so each picture has its own list.
  const keep = () => {
    const name = `${id}-words-${stamp}.json`
    writeAtomic(join(IMAGES, appSlug, name), JSON.stringify(list))
    return `${appSlug}/${name}`
  }
  // A place given by the caller, a page number say, keeps screens in that order however they were pushed.
  const order = place ?? old?.order ?? Math.max(0, ...listScreens(appSlug).map(s => s.order + 1))
  const entry = {
    app,
    appSlug,
    id,
    screen,
    mode,
    note,
    ...(check.some(line => String(line).trim()) ? { check: check.filter(line => String(line).trim()) } : {}),
    from,
    kind,
    ...(item ? { item } : {}),
    order,
    round: (old?.round ?? 0) + 1,
    after: copy(after, 'after'),
    before: before ? copy(before, 'before') : '',
    ...(list ? { words: keep() } : {}),
    source: madeFrom ?? { after, before },
    status: 'waiting',
    pushedAt: new Date(stamp).toISOString(),
    sentAt: null,
    feedback: old?.feedback ?? [],
  }
  writeAtomic(path, JSON.stringify(entry, null, 2))
  return entry
}

export function listScreens(appSlug) {
  const dir = join(QUEUE, appSlug)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => readJson(join(dir, f)))
    .filter(Boolean)
    // Two screens can share a place, a page of a PDF and a plain screen say: then their names decide, the same way every time.
    .sort((a, b) => a.order - b.order || String(a.id ?? '').localeCompare(String(b.id ?? '')))
}

/**
 * Set aside: not answered, nothing in the inbox, only not offered next. Kept here with the queue, as a file beside the apps'
 * folders, so it outlasts a browser. `upTo` is the newest push it covered: a later one stays set aside, and says it is new.
 */
const SET_ASIDE = () => join(QUEUE, 'set-aside.json')
/** With no prototype, so an app called Constructor is not found set aside. A broken file means nothing is: all is offered again. */
const readAside = () => {
  const held = readJson(SET_ASIDE())
  return Object.assign(Object.create(null), held && typeof held === 'object' && !Array.isArray(held) ? held : {})
}
export const isSetAside = app => !!readAside()[slug(app)]
export function setAside(slugs, aside = true) {
  const held = readAside()
  for (const raw of slugs) {
    const appSlug = slug(raw)
    if (!aside) {
      delete held[appSlug]
      continue
    }
    const screens = listScreens(appSlug)
    if (screens.length) held[appSlug] = { at: new Date().toISOString(), upTo: new Date(latest(screens)).toISOString() }
  }
  mkdirSync(QUEUE, { recursive: true })
  writeAtomic(SET_ASIDE(), JSON.stringify(held, null, 2))
  return held
}

export function listApps() {
  if (!existsSync(QUEUE)) return []
  const aside = readAside()
  return readdirSync(QUEUE, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      const screens = listScreens(d.name)
      const held = aside[d.name]
      return { slug: d.name, name: screens[0]?.app ?? d.name, screens, ...(held ? { setAside: { at: held.at, isNew: screens.some(s => Date.parse(s.pushedAt) > Date.parse(held.upTo)) } } : {}) }
    })
    .filter(a => a.screens.length)
    .sort((a, b) => latest(b.screens) - latest(a.screens))
}
const latest = screens => Math.max(...screens.map(s => Date.parse(s.pushedAt)))

/** Takes the app off the wizard. Its inbox stays, and so do the pictures the inbox points at. */
/** Takes one screen off the page. What was said about it stays in the inbox. */
export function removeScreen(appSlug, id) {
  // Only a name this module would have made: never a path that leads out of the app's folder.
  if (slug(appSlug) !== appSlug || !/^[a-z0-9-]+$/.test(id)) throw new Error(`No screen ${id}`)
  rmSync(join(QUEUE, appSlug, `${id}.json`), { force: true })
}

export function clearApp(app) {
  rmSync(join(QUEUE, slug(app)), { recursive: true, force: true })
  if (readAside()[slug(app)]) setAside([app], false)
}

const stampForFile = iso => iso.replace(/[:.]/g, '-')

/**
 * Saves what the reviewer sent for one screen and marks the screen done. `after` is the picture it was said about. When that
 * has been replaced since, the screen has not been answered: a Looks good says nothing about the new picture and is dropped
 * (null comes back), and marks and notes are kept in the inbox against the old picture, flagged, with the screen still waiting.
 */
export function receive({ appSlug, id, png, shapes, notes, verdict, imageSize, noComment = false, after = '', round = null }) {
  const path = join(QUEUE, slug(appSlug), `${slug(id)}.json`)
  const entry = readJson(path)
  if (!entry) throw new Error(`No queued screen ${appSlug}/${id}`)
  const older = !!after && after !== entry.after
  if (older && verdict === 'approved') return null
  // The list of the picture the marks were drawn on. An older picture's list has its picture's name, with words for after.
  const wordsFile = older ? (basename(dirname(after)) === entry.appSlug ? join(entry.appSlug, basename(after).replace(/-after-(\d+)\.[^.]+$/, '-words-$1.json')) : '') : (entry.words ?? '')
  const list = /-words-\d+\.json$/.test(wordsFile) ? keptWords(join(IMAGES, wordsFile)) : null
  const dir = join(INBOX, entry.appSlug)
  mkdirSync(dir, { recursive: true })
  // Two in one millisecond must not be one file: that would lose the first answer.
  let time = Date.now()
  while (existsSync(join(dir, `${entry.id}-${stampForFile(new Date(time).toISOString())}.json`))) time++
  const at = new Date(time).toISOString()
  const base = join(dir, `${entry.id}-${stampForFile(at)}`)
  const record = {
    app: entry.app,
    screen: entry.screen,
    screenId: entry.id,
    mode: entry.mode,
    kind: entry.kind ?? 'qa',
    ...(entry.item ? { item: entry.item } : {}),
    round: older ? (round ?? entry.round) : entry.round,
    verdict,
    notes: notes.trim(),
    shapes: marksWithWords(shapes, list),
    imageSize,
    sentAt: at,
    annotatedImage: `${base}.png`,
    // The wizard's own copies: they stay put even when the pushed files were in a scratch folder.
    afterImage: join(IMAGES, older ? basename(dirname(after)) === entry.appSlug ? join(entry.appSlug, basename(after)) : entry.after : entry.after),
    beforeImage: !older && entry.before ? join(IMAGES, entry.before) : '',
    pushedFrom: entry.source,
    pushedAt: entry.pushedAt,
  }
  // Sent with the whole set without being looked at one by one: approved, and says so.
  if (noComment) record.noComment = true
  if (older) record.olderPicture = true
  if (png) writeAtomic(`${base}.png`, png)
  else delete record.annotatedImage
  // The JSON lands last: whoever waits on the inbox sees the picture already in place.
  writeAtomic(`${base}.json`, JSON.stringify(record, null, 2))
  if (!older) {
    entry.status = verdict === 'approved' ? 'approved' : 'sent'
    entry.sentAt = at
  }
  entry.feedback = [...(entry.feedback ?? []), `${base}.json`]
  writeAtomic(path, JSON.stringify(entry, null, 2))
  return record
}

/** Every feedback file for an app (or all apps), oldest first. */
export function readInbox(app) {
  if (!existsSync(INBOX)) return []
  const apps = app ? [slug(app)] : readdirSync(INBOX)
  const out = []
  for (const a of apps) {
    const dir = join(INBOX, a)
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue
      const record = readJson(join(dir, f))
      if (record) out.push({ ...record, file: join(dir, f) })
    }
  }
  return out.sort((x, y) => x.sentAt.localeCompare(y.sentAt))
}
