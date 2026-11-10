/**
 * Ideas and the queue of work, as plain files beside the screens, so the page and every session read the same truth.
 *
 *   <home>/work/requests/<id>.json   someone asked for ideas; a session answers
 *   <home>/work/items/<id>.json      one idea or piece of work, with its stage, its place in line and its notes
 *
 * An item's life: idea, then Yes makes it queued. A session takes the top one (in progress), pushes screens (ready), and the
 * answers move it on by themselves: marks send it back to queued for another round; a proposal approved is queued to build;
 * a build approved is done.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { HOME, listScreens, slug, writeAtomic } from './store.mjs'

const WORK = join(HOME, 'work')
const REQUESTS = join(WORK, 'requests')
const ITEMS = join(WORK, 'items')
const LOCK = join(WORK, '.lock')

export const SIZES = ['S', 'M', 'L']
export const STAGES = ['idea', 'later', 'no', 'queued', 'progress', 'ready', 'done']
const LOCK_STALE_MS = 5000

const readJson = path => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}
const allIn = dir => (existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.json')).map(f => readJson(join(dir, f))).filter(Boolean) : [])
const now = () => new Date().toISOString()
const newId = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

/** One writer at a time: the page and a session may both change an item, and neither may lose the other's note. */
function locked(fn) {
  mkdirSync(WORK, { recursive: true })
  const until = Date.now() + 3000
  for (;;) {
    try {
      mkdirSync(LOCK)
      break
    } catch {
      try {
        if (Date.now() - statSync(LOCK).mtimeMs > LOCK_STALE_MS) rmSync(LOCK, { recursive: true, force: true })
      } catch {
        // It has just gone: the next try takes it.
      }
      if (Date.now() > until) throw new Error('The work files are busy. Try again.')
    }
  }
  try {
    return fn()
  } finally {
    rmSync(LOCK, { recursive: true, force: true })
  }
}

const itemPath = id => join(ITEMS, `${slug(id)}.json`)
function saveItem(item) {
  mkdirSync(ITEMS, { recursive: true })
  writeAtomic(itemPath(item.id), JSON.stringify(item, null, 2))
  return item
}
function mustItem(id) {
  const item = readJson(itemPath(id))
  if (!item) throw new Error(`No item ${id}`)
  return item
}
const toStage = (item, stage, by) => {
  item.stage = stage
  item.history = [...(item.history ?? []), { at: now(), stage, by: by || '' }]
  return item
}
const nextRank = () => Math.max(-1, ...allIn(ITEMS).map(i => i.rank ?? -1)) + 1

/* ---------- ideas ---------- */

export function askForIdeas({ target, count = 10 }) {
  const what = String(target ?? '').trim()
  if (!what) throw new Error('Say what the ideas are for.')
  const many = Math.max(1, Math.min(50, Math.round(Number(count)) || 10))
  mkdirSync(REQUESTS, { recursive: true })
  const request = { id: newId('ask'), target: what, count: many, status: 'open', at: now(), posted: 0 }
  writeAtomic(join(REQUESTS, `${request.id}.json`), JSON.stringify(request, null, 2))
  return request
}

export const listRequests = () => allIn(REQUESTS).sort((a, b) => a.at.localeCompare(b.at))
export const openRequests = () => listRequests().filter(r => r.status === 'open')

export function postIdea({ request, what, why = '', size = 'M' }) {
  const words = String(what ?? '').trim()
  if (!words) throw new Error('An idea needs --what.')
  const sized = SIZES.includes(String(size).toUpperCase()) ? String(size).toUpperCase() : 'M'
  return locked(() => {
    const path = join(REQUESTS, `${slug(request)}.json`)
    const asked = readJson(path)
    if (!asked) throw new Error(`No request ${request}`)
    const item = saveItem({ id: newId('item'), title: words, why: String(why).trim(), size: sized, target: asked.target, request: asked.id, stage: 'idea', phase: 'proposal', round: 1, owner: '', rank: nextRank(), notes: [], at: now(), history: [] })
    asked.posted += 1
    if (asked.posted >= asked.count) asked.status = 'answered'
    writeAtomic(path, JSON.stringify(asked, null, 2))
    return item
  })
}

export function closeRequest(request) {
  return locked(() => {
    const path = join(REQUESTS, `${slug(request)}.json`)
    const asked = readJson(path)
    if (!asked) throw new Error(`No request ${request}`)
    asked.status = 'answered'
    writeAtomic(path, JSON.stringify(asked, null, 2))
    return asked
  })
}

/** Yes puts it at the bottom of the line. No and Later only put it away, so either can be taken back. */
export function decide(id, decision) {
  const stage = { yes: 'queued', no: 'no', later: 'later' }[decision]
  if (!stage) throw new Error('Say yes, no or later.')
  return locked(() => {
    const item = mustItem(id)
    if (!['idea', 'later', 'no'].includes(item.stage)) throw new Error('That one has already started.')
    if (stage === 'queued') item.rank = nextRank()
    return saveItem(toStage(item, stage, 'reviewer'))
  })
}

/* ---------- the queue ---------- */

export const listWork = () => allIn(ITEMS).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))

/** The new order of some items, first first. Anything not named keeps its place behind them. */
export function reorder(ids) {
  return locked(() => {
    const named = ids.map(String)
    const rest = listWork().filter(i => !named.includes(i.id))
    ;[...named.map(id => readJson(itemPath(id))).filter(Boolean), ...rest].forEach((item, rank) => {
      if (item.rank !== rank) saveItem({ ...item, rank })
    })
  })
}

export function addNote(id, text, by = 'reviewer') {
  const words = String(text ?? '').trim()
  if (!words) throw new Error('A note needs words.')
  return locked(() => {
    const item = mustItem(id)
    item.notes = [...(item.notes ?? []), { at: now(), by, text: words }]
    return saveItem(item)
  })
}

/** Gives a session the top of the line, or the one it names. Null when nothing is queued. */
export function take({ by = 'a session', id = null } = {}) {
  return locked(() => {
    const item = id ? mustItem(id) : listWork().find(i => i.stage === 'queued')
    if (!item) return null
    if (id && item.stage !== 'queued') throw new Error(`${item.title} is not queued: it is ${item.stage}.`)
    item.owner = by
    return saveItem(toStage(item, 'progress', by))
  })
}

export function setStage(id, stage, by = 'a session') {
  if (!STAGES.includes(stage)) throw new Error(`Stage must be one of ${STAGES.join(', ')}.`)
  return locked(() => {
    const item = mustItem(id)
    if (stage === 'queued') item.owner = ''
    return saveItem(toStage(item, stage, by))
  })
}

/**
 * Screens pushed for an item: they wait for the reviewer now. What they are decides what an approval means, so a proposal
 * pushed again after it was approved is a proposal, and approving it cannot finish a build.
 */
export function pushedFor(id, app, by = 'a session', kind = 'qa') {
  return locked(() => {
    const item = mustItem(id)
    item.app = app
    item.phase = kind === 'proposal' ? 'proposal' : 'build'
    return saveItem(toStage(item, 'ready', by))
  })
}

/**
 * An answer came in on a screen of an item. When all its screens have one, the item moves on: any marks send it back for
 * another round, and approval takes a proposal on to be built and a build to done.
 */
export function answered(record) {
  if (!record?.item || !existsSync(itemPath(record.item))) return null
  return locked(() => {
    const item = mustItem(record.item)
    if (item.stage !== 'ready') return item
    const screens = listScreens(slug(record.app)).filter(s => s.item === item.id)
    if (screens.some(s => s.status === 'waiting')) return item
    const anyMarks = screens.some(s => s.status === 'sent')
    item.owner = ''
    if (anyMarks) {
      item.round = (item.round ?? 1) + 1
      item.marksBack = true
      return saveItem(toStage(item, 'queued', 'reviewer'))
    }
    item.marksBack = false
    if (item.phase === 'proposal') {
      item.phase = 'build'
      item.round = 1
      return saveItem(toStage(item, 'queued', 'reviewer'))
    }
    return saveItem(toStage(item, 'done', 'reviewer'))
  })
}
