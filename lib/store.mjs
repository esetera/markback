/**
 * Where screens wait for review and where feedback lands. Everything is plain files, so the CLI and the server never
 * need each other: a push works with the wizard closed, and the wizard picks it up on its next look.
 *
 *   <home>/queue/<app>/<screen>.json   one screen waiting (or reviewed), with its status
 *   <home>/images/<app>/<screen>-{after,before}-<time>.<ext>   copies of the pushed pictures, one for each push
 *   <home>/images/<app>/<screen>-words-<time>.json    the words in the after picture, given with the push or read off it later
 *   <home>/inbox/<app>/<screen>-<time>.{png,json}   what the reviewer sent back
 *   <home>/inferred/<app>/<screen>.json   what the agent read each mark to mean, and what the reviewer said back
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { keptWords, marksWithWords, readWords } from './words.mjs'

export const HOME = process.env.REVIEW_HOME || join(homedir(), '.review-wizard')
const PORT_FILE = join(HOME, 'port')
/** REVIEW_PORT, or the one `review start --port` chose, or the usual one. */
export const PORT = Number(process.env.REVIEW_PORT || readPortFile() || 5741)
function readPortFile() {
  try {
    return readFileSync(join(process.env.REVIEW_HOME || join(homedir(), '.review-wizard'), 'port'), 'utf8').trim()
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
export const INFERRED = join(HOME, 'inferred')

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

export function liveAddress(value) {
  try {
    const url = new URL(value)
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url.href
  } catch {
    // Screens without a web address still work as ordinary screenshots.
  }
  return ''
}

/** Queues one screen. Pushing the same app, screen and mode again starts a new round on the same step. */
export function push({ app, screen, mode = '', after, before = '', note = '', check = [], from = 'Claude', kind = 'qa', item = '', place = null, madeFrom = null, words = '', url = '' }) {
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
  const round = (old?.round ?? 0) + 1
  const pushed = copy(after, 'after')
  const liveUrl = liveAddress(url)
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
    round,
    after: pushed,
    before: before ? copy(before, 'before') : '',
    ...(liveUrl ? { liveUrl } : {}),
    ...(list ? { words: keep() } : {}),
    source: madeFrom ?? { after, before },
    status: 'waiting',
    pushedAt: new Date(stamp).toISOString(),
    sentAt: null,
    feedback: old?.feedback ?? [],
    // Every picture of this review and its round, for the film: a name alone cannot say its round once one is gone, and a
    // clear starts this list again with the review.
    pictures: [...(Array.isArray(old?.pictures) ? old.pictures : []), { round, after: pushed }],
  }
  const asked = carriedOver(old)
  if (asked.length) entry.asked = asked
  // The last round's picture: with no before, the page compares with it to see whether a fixed mark came back.
  if (asked.some(a => a.state === 'fixed') && old?.after) entry.lastAfter = old.after
  writeAtomic(path, JSON.stringify(entry, null, 2))
  return entry
}

/** Small marks, a pin or an arrow's head, get a place big enough to see. */
const AROUND = 24
/** Where a mark is, for the check it becomes. An arrow is about what its head points at. */
function placeOfMark(shape) {
  const spot = shape.type === 'arrow' ? shape.to : shape.type === 'pin' ? shape.at : null
  if (spot && Number.isFinite(spot.x) && Number.isFinite(spot.y)) return { x: spot.x - AROUND, y: spot.y - AROUND, w: AROUND * 2, h: AROUND * 2 }
  return shape.box ?? null
}

/** This entry's own answers in a round, oldest first. Never chosen by round number alone: a review cleared and pushed afresh starts at round 1 again, and its old answers stay in the inbox. */
const answersOf = (entry, round = entry.round) => (entry.feedback ?? []).map(readJson).filter(r => r && r.round === round && !r.olderPicture)
/** A Looks good the person pressed on that screen. One sent with the rest, unseen, is not. */
const pressedGood = r => r.verdict === 'approved' && !r.noComment
const wordsOf = r => new Map((Array.isArray(r?.asked) ? r.asked : []).map(a => [a.n, a.said ?? null]))
const sayable = word => (word === 'fixed' || word === 'stands' ? word : null)

/**
 * Marks become checks. Each mark asked for in the last round comes to the next one, so the page can ask whether it was fixed,
 * at its place, and the agent hears which still stand. One not ticked stays open. One ticked fixed is kept as fixed, so the
 * page can flag it when the picture changes there again. The newest answer of the round says where each stands.
 */
function carriedOver(old) {
  if (!old) return []
  const answers = answersOf(old)
  const top = answers.at(-1)
  const words = wordsOf(top)
  const kept = (old.asked ?? []).map(a => {
    if (!top && !a.flagged) return a
    const word = words.get(a.n)
    // Came back, or flagged and not answered: asked again.
    if (a.state === 'fixed') {
      const { flagged, ...rest } = a
      // A page flagged it this round and nobody said it was still fixed: it is never carried on as fixed.
      if (word === 'stands') return { ...rest, state: 'open', cameBack: true }
      if (flagged || (words.has(a.n) && !word)) return { ...rest, state: 'open' }
      return rest
    }
    if (word !== 'fixed') return a
    const { cameBack, ...rest } = a
    // Seen fixed on this round's picture: a later one is compared with it.
    return { ...rest, state: 'fixed', fixedIn: old.round, checkedAfter: old.after }
  })
  let n = Math.max(0, ...kept.map(a => a.n))
  // Only the changes since the last Looks good: one pressed over them took them back.
  const lastGood = answers.findLastIndex(r => r.verdict === 'approved')
  const fresh = answers.slice(lastGood + 1).flatMap(r => [
    ...(Array.isArray(r.shapes) ? r.shapes : []).filter(shape => placeOfMark(shape)).map(shape => ({
      type: shape.type,
      colour: shape.colour ?? shape.color ?? '',
      // A 48 pixel square round an arrow's head or a pin's spot; any other mark's own box.
      box: placeOfMark(shape),
      ...(shape.from && shape.to ? { from: shape.from, to: shape.to } : {}),
      ...(shape.at ? { at: shape.at } : {}),
      ...(shape.text ? { text: shape.text } : {}),
      ...(shape.words ? { words: shape.words } : {}),
      ...(shape.element ? { element: shape.element } : {}),
      size: r.imageSize ?? null,
    })),
    // Notes are asked for too, though they have no place.
    ...(r.notes?.trim() ? [{ type: 'notes', text: r.notes.trim() }] : []),
  ])
  return [...kept, ...fresh.map(a => ({ n: ++n, round: old.round, ...a, state: 'open' }))]
}

/**
 * Where each earlier mark stands after this answer, so the newest record always says it in full. Words said before in this
 * round stand until the person changes them; a word given now wins. A pressed Looks good ticks every open one fixed, and a
 * changes answer after it takes that back: only words said for themselves stand. A screen sent with the rest unseen ticks none.
 */
function saidOfAsked(entry, said, verdict, noComment, unanswered = []) {
  // `unanswered`: the held marks the page flagged as came back? on this picture. Kept on the entry too, so a later answer in
  // the round that does not say them, from another tab or a retry, still cannot carry them on as fixed.
  const words = wordsOf(answersOf(entry).filter(r => !pressedGood(r)).at(-1))
  // Sent with the rest, unseen, a screen says nothing new of them, whatever ticks rode along.
  for (const [n, word] of Object.entries(said && typeof said === 'object' && !noComment ? said : {})) words.set(Number(n), sayable(word))
  const notAnswered = new Set([...(Array.isArray(unanswered) ? unanswered : []).map(Number), ...(entry.asked ?? []).filter(a => a.flagged).map(a => a.n)])
  const pressed = verdict === 'approved' && !noComment
  return (entry.asked ?? []).flatMap(a => {
    const word = sayable(words.get(a.n))
    const { state, fixedIn, cameBack, size, flagged, checkedAfter, ...mark } = a
    // A held one is told when the person said something of it: came back, or still fixed.
    if (state === 'fixed') {
      if (word === 'stands' && !pressed) return [{ ...mark, said: 'stands', cameBack: true, fixedIn }]
      if (word === 'fixed') return [{ ...mark, said: 'fixed', fixedIn }]
      // The page flagged it as came back? and the person said nothing: told as not answered, never as fixed.
      return notAnswered.has(a.n) ? [{ ...mark, said: null, cameBack: true, fixedIn }] : []
    }
    return [{ ...mark, said: pressed ? 'fixed' : word, ...(cameBack ? { cameBack: true } : {}) }]
  })
}

/**
 * The held marks after an answer. One flagged and not said to be still fixed stays flagged, so the round cannot end with it
 * fixed. One said still fixed, or seen unchanged by a page that looked, is compared next with this picture.
 */
function heldAfter(entry, asked, flaggedNow, checked, noComment) {
  const told = new Map(asked.map(a => [a.n, a]))
  const seen = new Set(noComment ? [] : (Array.isArray(checked) ? checked : []).map(Number))
  return entry.asked.map(a => {
    if (a.state !== 'fixed') return a
    const word = told.get(a.n)?.said
    if (word === 'fixed' || (seen.has(a.n) && !flaggedNow.includes(a.n) && !a.flagged)) {
      const { flagged, ...rest } = a
      return { ...rest, checkedAfter: entry.after }
    }
    return flaggedNow.includes(a.n) || word === null ? { ...a, flagged: true } : a
  })
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
      // When readings came or were answered: the page looks again only when this changes.
      const screens = listScreens(d.name).map(s => {
        const read = readJson(readingsPath(d.name, s.id))
        return read?.changed ? { ...s, inferred: { posted: read.posted ?? '', from: read.from ?? '', changed: read.changed } } : s
      })
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

/** The name of the word list for a kept after picture: the same time, so each picture has its own. '' for any other name. */
export const wordsNameFor = after => (/-after-\d+\.[^./]+$/.test(String(after)) ? String(after).replace(/-after-(\d+)\.[^./]+$/, '-words-$1.json') : '')

const stampForFile = iso => iso.replace(/[:.]/g, '-')

/**
 * Saves what the reviewer sent for one screen and marks the screen done. `after` is the picture it was said about. When that
 * has been replaced since, the screen has not been answered: a Looks good says nothing about the new picture and is dropped
 * (null comes back), and marks and notes are kept in the inbox against the old picture, flagged, with the screen still waiting.
 */
export function receive({ appSlug, id, png, shapes, notes, verdict, imageSize, noComment = false, after = '', round = null, said = null, unanswered = [], back = [], checked = [] }) {
  // `back` is what the page flagged as came back? on this screen; `unanswered` is its older name.
  const flaggedNow = [...(Array.isArray(back) ? back : []), ...(Array.isArray(unanswered) ? unanswered : [])].map(Number)
  const path = join(QUEUE, slug(appSlug), `${slug(id)}.json`)
  const entry = readJson(path)
  if (!entry) throw new Error(`No queued screen ${appSlug}/${id}`)
  const older = !!after && after !== entry.after
  if (older && verdict === 'approved') return null
  // The list of the picture the marks were drawn on. An older picture's list has its picture's name, with words for after.
  // With none given, a list read off the picture may be there under the picture's own name.
  const wordsFile = older ? (basename(dirname(after)) === entry.appSlug ? wordsNameFor(join(entry.appSlug, basename(after))) : '') : (entry.words ?? wordsNameFor(entry.after))
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
    // The words were read off the picture, not taken from the page: a few may be wrong.
    ...(list?.read && list.words.length ? { wordsRead: true } : {}),
    imageSize,
    sentAt: at,
    annotatedImage: `${base}.png`,
    // The wizard's own copies: they stay put even when the pushed files were in a scratch folder.
    afterImage: join(IMAGES, older ? basename(dirname(after)) === entry.appSlug ? join(entry.appSlug, basename(after)) : entry.after : entry.after),
    beforeImage: !older && entry.before ? join(IMAGES, entry.before) : '',
    pushedFrom: entry.source,
    pushedAt: entry.pushedAt,
  }
  // The earlier marks belong to the picture on show. An answer about an older one says nothing of them.
  // The store records what it is sent: a tick never changes a verdict.
  const asked = older ? [] : saidOfAsked(entry, said, verdict, noComment, flaggedNow)
  if (asked.length) record.asked = asked
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
    if (entry.asked) entry.asked = heldAfter(entry, asked, flaggedNow, checked, noComment)
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
    const read = new Map()
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue
      const record = readJson(join(dir, f))
      if (!record) continue
      if (!read.has(record.screenId)) read.set(record.screenId, readJson(readingsPath(a, record.screenId))?.answers ?? {})
      const inferred = read.get(record.screenId)[f]
      // `answer` is the name review inferred --answer takes for it.
      out.push({ ...record, answer: record.sentAt, ...(Array.isArray(inferred) && inferred.length ? { inferred } : {}), file: join(dir, f) })
    }
  }
  return out.sort((x, y) => x.sentAt.localeCompare(y.sentAt))
}

/*
 * What the agent read each mark to mean, said back before it builds, so a wrong reading is caught early. One file a screen,
 * kept apart from the inbox so a reader of answers never takes it for one. Each reading belongs to the answer it read, by that
 * answer's file name: a new answer starts with none, and the old ones stay with what they read.
 *
 *   { "posted": time, "from": "Claude", "changed": time, "answers": { "<answer file>": [{ "n": 1, "text": "…", "from": "Claude", "at": time,
 *     "reply": { "yes": true, "at": time } | { "text": "…", "at": time } }] } }
 */
const readingsPath = (appSlug, id) => join(INFERRED, appSlug, `${id}.json`)
const READING_WORDS = 300

/** The name an answer goes by for `review inferred --answer`: the time it was sent, as `review read` prints it. */
export const answerId = record => record.sentAt
const FROM_LONGEST = 40

/**
 * Says what the agent read one mark to mean, on the answer it read: `answer` names it, and can be left out when only one answer
 * stands for the picture on show. Said again, it replaces the first.
 */
export function postReading({ app, screen, mode = '', mark, text, from = 'Claude', answer = '' }) {
  const appSlug = slug(app)
  // Named without its mode, a screen that has only one is still that screen.
  const named = listScreens(appSlug).filter(s => slug(s.screen) === slug(screen) && (!mode || s.id === screenId(screen, mode)))
  const entry = named.length === 1 ? named[0] : null
  if (!entry) throw new Error(named.length ? `${screen} is in light and dark: say which with --mode.` : `No screen ${screen}${mode ? ` (${mode})` : ''} in ${app}.`)
  const id = entry.id
  const said = readInbox(appSlug).filter(r => r.screenId === id && !r.olderPicture)
  if (!said.length) throw new Error(`Nothing has been said on ${entry.screen} yet.`)
  // The page shows readings only on the answers standing for the picture on show. A Looks good stands alone.
  const round = said.filter(r => r.round === entry.round)
  if (!round.length) throw new Error(`${entry.screen} has a new round since that answer. Say what you read before you push again.`)
  const standing = round.slice(round.findLastIndex(r => r.verdict !== 'changes') + 1)
  if (!standing.length) throw new Error(`${entry.screen} was answered Looks good: there are no marks to read.`)
  const choices = () => standing.map(r => `${answerId(r)} (${r.shapes.length} mark${r.shapes.length === 1 ? '' : 's'})`).join(', ')
  const wanted = String(answer || '')
  const record = wanted ? standing.find(r => answerId(r) === wanted || basename(r.file) === wanted || basename(r.file, '.json') === wanted) : standing.length === 1 ? standing[0] : null
  if (!record) throw new Error(wanted ? `No answer ${wanted} stands on ${entry.screen}. Its answers: ${choices()}.` : `${entry.screen} has ${standing.length} answers on this picture: say which with --answer. ${choices()}.`)
  const n = Number(mark)
  if (!Number.isInteger(n) || n < 1 || n > record.shapes.length) throw new Error(record.shapes.length ? `--mark is a number from 1 to ${record.shapes.length}, as review read gives them.` : `That answer has no marks, only notes.`)
  const words = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, READING_WORDS)
  if (!words) throw new Error('Say what you read in --text.')
  // A name, in one short line: it is shown on the card, in a notice and in a tip.
  const name = String(from ?? '').replace(/\s+/g, ' ').trim().slice(0, FROM_LONGEST) || 'Claude'
  const reading = { n, text: words, from: name, at: new Date().toISOString() }
  writeReadings(appSlug, id, file => {
    const list = (file.answers[basename(record.file)] ??= []).filter(r => r.n !== n)
    file.answers[basename(record.file)] = [...list, reading].sort((x, y) => x.n - y.n)
    file.posted = reading.at
    file.from = name
  })
  return { record, reading }
}

/** What the reviewer said back to one reading: yes, or a correction in their own words. */
export function replyToReading({ appSlug, id, answer, n, yes = false, text = '' }) {
  if (slug(appSlug) !== appSlug || !/^[a-z0-9-]+$/.test(id) || basename(String(answer)) !== answer) throw new Error('No such reading.')
  const words = String(text).replace(/\s+/g, ' ').trim().slice(0, READING_WORDS)
  if (!yes && !words) throw new Error('Say yes, or say what you meant.')
  let found = null
  writeReadings(appSlug, id, file => {
    found = (Object.hasOwn(file.answers, answer) && file.answers[answer].find?.(r => r.n === Number(n))) || null
    if (!found) return false
    found.reply = yes ? { yes: true, at: new Date().toISOString() } : { text: words, at: new Date().toISOString() }
  })
  if (!found) throw new Error('No such reading.')
  return found
}

function writeReadings(appSlug, id, change) {
  const path = readingsPath(appSlug, id)
  const file = readJson(path) ?? {}
  file.answers = file.answers && typeof file.answers === 'object' ? file.answers : {}
  // Nothing changed: nothing written, so the page has nothing new to look at.
  if (change(file) === false) return
  file.changed = new Date().toISOString()
  mkdirSync(dirname(path), { recursive: true })
  writeAtomic(path, JSON.stringify(file, null, 2))
}
