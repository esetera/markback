#!/usr/bin/env node
/**
 * The review wizard's little server: serves the page, the queued screens and their pictures, and writes what the
 * reviewer sends into the inbox. Nothing to install: plain Node.
 */

import { createServer } from 'node:http'
import { readFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join, normalize, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HOME, IMAGES, INBOX, PORT, WHERE, storeIdNow, listApps, readInbox, receive, replyToReading, setAside } from './lib/store.mjs'
import { filmOf, leftOutLine, saveFilm, savedPart } from './lib/film.mjs'
import { pushSample, showApp } from './lib/first.mjs'
import { linkIn, LINK_OUT } from './lib/home.mjs'
import { makeSecret } from './lib/trust.mjs'
import { hasReader, stopReading, wordsForPicture } from './lib/read-words.mjs'
import { addNote, answered, askForIdeas, decide, listRequests, listWork, reorder, requestBuild } from './lib/work.mjs'
import { PhoneProblem, WORDS as PHONE_WORDS, cleanStale, phoneDoor, phoneMay, warmUp } from './lib/phone.mjs'
import { appsOf, madeBy, serverBeat, serverGone, standing } from './lib/listen.mjs'
// Only what reads the wake command and turns it on and off. What sets the command is not imported here, on purpose:
// nothing a web page can reach may decide what this computer runs.
import { WAKES, WAKES_IN_STORE, createWaker, listDesktopWakes, listWakes, readDesktopWake, switchDesktopWake, switchWake, wakeSummary } from './lib/wake.mjs'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), 'public')
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' }
const MAX_BODY = 80 * 1024 * 1024

/** A wizard picture's address in the page, or '' when the file is not one of the wizard's own. */
const urlFor = (root, prefix, path) => (path && path.startsWith(root + sep) && existsSync(path) ? `${prefix}${path.slice(root.length + 1).split(sep).map(encodeURIComponent).join('/')}` : '')

/** What was said about one screen in every round so far, newest first, with addresses for its pictures. */
function history(appSlug, id) {
  return readInbox(appSlug)
    .filter(r => r.screenId === id)
    .reverse()
    .map(r => ({
      round: r.round,
      verdict: r.verdict,
      notes: r.notes ?? '',
      marks: Array.isArray(r.shapes) ? r.shapes.length : 0,
      noComment: r.noComment === true,
      olderPicture: r.olderPicture === true,
      // What was said of the earlier marks, so the page shows it again on coming back.
      said: Object.fromEntries((Array.isArray(r.asked) ? r.asked : []).filter(a => a.said).map(a => [a.n, a.said])),
      sentAt: r.sentAt,
      annotatedUrl: urlFor(INBOX, '/inbox/', r.annotatedImage),
      afterUrl: urlFor(IMAGES, '/images/', r.afterImage),
      beforeUrl: urlFor(IMAGES, '/images/', r.beforeImage),
      // What the agent read each mark to mean, with where the mark is, so the page can put each beside its own.
      ...(r.inferred ? { answer: basename(r.file), readings: r.inferred.filter(x => r.shapes?.[x.n - 1]?.box).map(x => ({ n: x.n, text: x.text, from: x.from, reply: x.reply ?? null, box: r.shapes[x.n - 1].box })) } : {}),
    }))
}

/** True while a film is being saved. */
let filming = false

/** One screen's film for the page: each round, and the steps that play, with addresses for the pictures. */
function film(appSlug, id) {
  const made = filmOf(appSlug, id)
  if (!made) return null
  const address = path => urlFor(IMAGES, '/images/', path) || urlFor(INBOX, '/inbox/', path)
  const part = savedPart(made)
  return {
    screen: made.screen,
    mode: made.mode,
    finished: made.finished,
    missing: made.missing,
    seconds: made.seconds,
    // A round is shown in the strip as it was left: marked, when it was marked.
    rounds: made.rounds.map(r => ({ round: r.round, url: address(r.marked.at(-1) ?? r.picture), answer: r.answer })),
    steps: made.steps.map(step => ({ at: step.at, url: address(step.file), marked: step.marked, seconds: step.seconds })),
    // What Save the film would hold, said before it is pressed: why it cannot be saved, or the older rounds a file leaves out.
    save: { why: part.why, leftOut: leftOutLine(part) },
  }
}

/** A file under root, or null when the path tries to leave it. */
function inside(root, rel) {
  const path = normalize(join(root, rel))
  return path.startsWith(root + sep) && existsSync(path) && statSync(path).isFile() ? path : null
}

function sendFile(res, path, cache) {
  res.writeHead(200, { 'content-type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream', 'cache-control': cache })
  res.end(readFileSync(path))
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function body(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('Too big'))
        req.destroy()
      } else chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * The heartbeat that wakes an agent: about every 20 seconds, the same list `review work` reads. The times can be set for a
 * test with REVIEW_WAKE_MS="every,quiet,backoff,late,gap" in milliseconds.
 */
const [wakeEvery = 20_000, quiet, backoff, late, gap] = (process.env.REVIEW_WAKE_MS ?? '').split(',').filter(Boolean).map(Number)
/** A Codex Desktop heartbeat takes work it has registered for. */
const desktopOn = slug => readDesktopWake(slug)?.on === true
const desktopBuilds = slug => {
  const wake = readDesktopWake(slug)
  return wake?.on === true && wake.builds === true
}
const desktopIdeas = slug => {
  const wake = readDesktopWake(slug)
  return wake?.on === true && wake.ideas === true
}
const commandWork = (apps, only = null) => standing(apps, { excludeMarksFor: desktopOn, excludeBuildsFor: desktopBuilds, excludeIdeasFor: desktopIdeas, only })
const waker = createWaker({ look: wake => commandWork(listApps(), appsOf(wake.in)), ...(quiet >= 0 ? { quiet } : {}), ...(backoff >= 0 ? { backoff } : {}), ...(late >= 0 ? { late } : {}), ...(gap >= 0 ? { gap } : {}) })
const total = unheard => unheard.queue + unheard.ideas + unheard.marks
/** Who listens, what waits unheard, and whether an agent will be woken for it: with every answer the pages poll. */
const listening = (apps = listApps()) => {
  const now = commandWork(apps)
  const held = listDesktopWakes()
  // Marks waiting for a Desktop heartbeat are counted only for its own sign.
  const pendingMarks = held.length ? standing(apps).markApps : []
  const desktop = Object.fromEntries(held.map(([slug, d]) => [slug, { on: d.on, pending: pendingMarks.includes(slug), ...(d.builds ? { builds: true } : {}), ...(d.ideas ? { ideas: true } : {}) }]))
  const wakes = listWakes().map(wake => {
    const there = commandWork(apps, appsOf(wake.in))
    return { view: { ...waker.view(wake, there), apps: appsOf(wake.in) }, waits: total(there.unheard) }
  })
  return { agents: now.agents, heard: now.heard, unheard: now.unheard, wake: wakeSummary(total(now.unheard), wakes), wakes: wakes.map(w => w.view), desktop }
}

// A request goes only to an agent already enabled through the CLI. The brief is data in the work queue.
function workTargets(apps, status = listening(apps), capability = 'builds') {
  const enabled = new Set([
    ...Object.entries(status.desktop).filter(([, wake]) => wake.on && wake[capability]).map(([app]) => app),
    ...status.wakes.filter(wake => wake.on).flatMap(wake => wake.apps),
  ])
  return [...enabled].map(slug => ({ slug, name: apps.find(app => app.slug === slug)?.name ?? slug }))
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const hostOf = text => {
  try {
    return new URL(text).hostname
  } catch {
    return ''
  }
}
const localHost = req => LOCAL_HOSTS.has(hostOf(`http://${req.headers.host}`))
/** Asked by this site's own page, not by another site open in the same browser. */
function ownPage(req) {
  // A picture or script tag on another site sends no origin, but the browser says where it came from.
  // Following a link here is fine: that opens the page, and the other site sees nothing.
  if (['cross-site', 'same-site'].includes(req.headers['sec-fetch-site']) && req.headers['sec-fetch-mode'] !== 'navigate') return false
  if (!req.headers.origin) return true
  try {
    return new URL(req.headers.origin).host === req.headers.host
  } catch {
    return false
  }
}
/** A request a proxy handed on: Tailscale's own headers, or the ones any proxy adds. The page's own listener never takes one. */
const proxied = req => Object.keys(req.headers).some(name => name.startsWith('tailscale-') || ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto'].includes(name))

/**
 * Review from a phone: the door, a listener of its own on this computer, open only while it is on. Tailscale serves the door,
 * and only the door, so every request on it is a phone's, whatever name it gives: the door lets in only the person's own login,
 * and the handler lets those use only what phoneMay names.
 */
const phone = phoneDoor({ serverPort: PORT, handle: (req, res) => handle(req, res, true) })

/**
 * What a phone is sent, built from short lists of fields rather than by taking some away: nothing of this computer goes, no
 * path, no folder, no command an agent is woken with, no line of its log. A field added later is not sent until it is put here.
 */
const pick = (from, names) => Object.fromEntries(names.filter(name => from?.[name] !== undefined).map(name => [name, from[name]]))
const SCREEN = ['app', 'appSlug', 'id', 'screen', 'mode', 'note', 'check', 'from', 'kind', 'item', 'order', 'round', 'after', 'before', 'words', 'status', 'pushedAt', 'sentAt']
const forPhone = {
  apps: apps => apps.map(a => ({
    slug: a.slug,
    name: a.name,
    // Feedback is only counted by the page: its names, never where they are.
    screens: a.screens.map(s => ({ ...pick(s, SCREEN), ...(s.choice ? { choice: forPhone.choice(s.choice) } : {}), feedback: (s.feedback ?? []).map(() => 'sent'), ...(s.inferred ? { inferred: pick(s.inferred, ['posted', 'from', 'changed']) } : {}) })),
    ...(a.setAside ? { setAside: pick(a.setAside, ['at', 'isNew']) } : {}),
  })),
  listening: l => ({
    agents: (l.agents ?? []).map(a => pick(a, ['by', 'what', 'app', 'told'])),
    heard: l.heard,
    unheard: pick(l.unheard, ['queue', 'ideas', 'marks']),
    // Whether an agent is being woken, and by whom: never how.
    wake: l.wake ? pick(l.wake, ['status', 'on', 'by']) : null,
    wakes: [],
    desktop: Object.fromEntries(Object.entries(l.desktop ?? {}).map(([slug, d]) => [slug, pick(d, ['on', 'pending'])])),
  }),
  phone: status => pick(status, ['on', 'stuck', 'minutes']),
  records: records => records.map(r => ({
    ...pick(r, ['round', 'verdict', 'notes', 'marks', 'noComment', 'olderPicture', 'sentAt', 'annotatedUrl', 'afterUrl', 'beforeUrl', 'answer']),
    ...(r.readings ? { readings: r.readings.map(forPhone.reading) } : {}),
  })),
  // The person's reply as words and a time: never its stamp.
  reading: x => ({ ...pick(x, ['n', 'text', 'from']), reply: x.reply ? pick(x.reply, ['yes', 'text', 'at']) : null, ...(x.box ? { box: pick(x.box, ['x', 'y', 'w', 'h']) } : {}) }),
  // The word list's name in the store, or why there is none: never where the store is.
  words: got => pick(got, ['words', 'why', 'reading']),
  film: f => f && {
    ...pick(f, ['screen', 'mode', 'finished', 'missing', 'seconds']),
    rounds: f.rounds.map(r => ({ round: r.round, url: r.url, answer: r.answer && pick(r.answer, ['verdict', 'notes', 'marks', 'noComment']) })),
    steps: f.steps.map(step => pick(step, ['at', 'url', 'marked', 'seconds'])),
    save: pick(f.save, ['why']),
  },
  record: record => pick(record, ['verdict', 'round', 'sentAt', 'olderPicture']),
  // A lineup: the question, and each option's letter, label and place in the picture. Never where its pictures are kept.
  choice: c => ({ question: c.question, options: (c.options ?? []).map(o => ({ key: o.key, label: o.label, box: pick(o.box, ['x', 'y', 'w', 'h']) })) }),
  made: made => made && pick(made, ['what', 'title', 'heard']),
}

/** Every request: from this computer on the page's own listener, or from a phone through the door. */
async function handle(req, res, fromPhone = false) {
  const url = new URL(req.url, 'http://localhost')
  // Only this computer's own pages: another site open in the browser must not write here, or read by renaming itself.
  if (fromPhone ? !ownPage(req) : proxied(req) || !localHost(req) || !ownPage(req)) return json(res, 403, { error: 'Only this computer can use this.' })
  if (fromPhone && !phoneMay(req.method, url.pathname)) return json(res, 403, { error: PHONE_WORDS.atComputer })
  try {
    // Which store this page shows: a command on the same port can then tell whether its pushes are here. `reader`: whether this
    // computer can read words off a picture, so the page shows the words tool only where it can work.
    if (req.method === 'GET' && url.pathname === '/api/queue') {
      const apps = listApps()
      const status = listening(apps)
      // `remote`: asked through the phone's door, so the page offers only what a phone may do. No build targets or idea
      // requests: those are for the computer's own page.
      if (fromPhone) return json(res, 200, { apps: forPhone.apps(apps), listening: forPhone.listening(status), phone: forPhone.phone(phone.status()), reader: hasReader(), remote: true })
      const ideaRequests = listRequests().filter(r => r.status === 'open' || r.posted).slice(-8)
      return json(res, 200, { apps, listening: status, buildTargets: workTargets(apps, status), ideaRequests, reader: hasReader(), store: storeIdNow(), pid: process.pid, phone: phone.status() })
    }
    if (req.method === 'GET' && url.pathname === '/api/phone') return json(res, 200, fromPhone ? forPhone.phone(phone.status()) : phone.status())
    if (req.method === 'POST' && url.pathname === '/api/phone') {
      const input = JSON.parse(await body(req))
      // Turned on only from this computer itself: a phone can turn it off, never on or on for longer.
      if (input.on === true && fromPhone) return json(res, 403, { error: 'Turn it on at the computer.' })
      if (input.on !== true && fromPhone) {
        // Closing the door drops every connection through it, this one too: the answer goes first.
        res.on('finish', () => void phone.off())
        return json(res, 200, { on: false, minutes: phone.status().minutes })
      }
      try {
        if (input.on !== true) await phone.off()
        // The certificate is made while the person reaches for the phone, not while the phone waits.
        else void warmUp((await phone.on()).url)
        return json(res, 200, phone.status())
      } catch (error) {
        if (error instanceof PhoneProblem) return json(res, 400, { error: error.message })
        throw error
      }
    }
    // A store a project's .markback named may hold no link: one added while the page runs would send this write anywhere.
    if (req.method === 'POST' && WHERE.project && linkIn(HOME)) return json(res, 409, { error: `Not saved: ${LINK_OUT}.` })
    if (req.method === 'POST' && url.pathname === '/api/read-words') {
      // A picture pushed with no word list: its words are read here, once, and the list is kept beside it. The answer comes at
      // once, reading or not, so a read never holds one of the few connections a browser opens to a server.
      const input = JSON.parse(await body(req))
      const got = wordsForPicture(String(input.after ?? ''))
      return json(res, 200, fromPhone ? forPhone.words(got) : got)
    }
    if (req.method === 'GET' && url.pathname.startsWith('/images/')) {
      const path = inside(IMAGES, decodeURIComponent(url.pathname.slice('/images/'.length)))
      // Pushed pictures are never changed in place (a new push makes a new name), so they can be kept.
      return path ? sendFile(res, path, 'max-age=31536000, immutable') : json(res, 404, { error: 'No such picture' })
    }
    if (req.method === 'GET' && url.pathname === '/api/history') {
      const records = history(url.searchParams.get('app') ?? '', url.searchParams.get('id') ?? '')
      return json(res, 200, { records: fromPhone ? forPhone.records(records) : records })
    }
    if (req.method === 'GET' && url.pathname === '/api/film') {
      const made = film(url.searchParams.get('app') ?? '', url.searchParams.get('id') ?? '')
      return json(res, 200, { film: fromPhone ? forPhone.film(made) : made })
    }
    if (req.method === 'GET' && url.pathname === '/api/film/file') {
      // The film as a video, made when asked for and not kept. It needs ffmpeg: without it, a plain line says so.
      const made = filmOf(url.searchParams.get('app') ?? '', url.searchParams.get('id') ?? '')
      if (!made) return json(res, 404, { error: 'No such screen' })
      // One at a time: each takes the computer's whole attention for a while, and a second would only slow the first.
      if (filming) return json(res, 409, { error: 'A film is being made already. Try again when it is done.' })
      const dir = mkdtempSync(join(tmpdir(), 'markback-film-'))
      filming = true
      try {
        const out = join(dir, 'film.mp4')
        await saveFilm(made, out)
        res.writeHead(200, { 'content-type': 'video/mp4', 'cache-control': 'no-store', 'content-disposition': `attachment; filename="${made.appSlug}-${made.id}-film.mp4"` })
        return res.end(readFileSync(out))
      } catch (error) {
        return json(res, 400, { error: error.message })
      } finally {
        filming = false
        rmSync(dir, { recursive: true, force: true })
      }
    }
    if (req.method === 'GET' && url.pathname.startsWith('/inbox/')) {
      // Marked pictures the reviewer sent earlier; each send makes a new name, so they can be kept too.
      const path = inside(INBOX, decodeURIComponent(url.pathname.slice('/inbox/'.length)))
      return path && extname(path).toLowerCase() === '.png' ? sendFile(res, path, 'max-age=31536000, immutable') : json(res, 404, { error: 'No such picture' })
    }
    if (req.method === 'POST' && url.pathname === '/api/show') {
      const input = JSON.parse(await body(req))
      try {
        // Said back, so the page can tell a new project from another round of one that is here.
        const had = new Set(listApps().map(a => a.slug))
        const entry = await showApp(input.url)
        return json(res, 200, { appSlug: entry.appSlug, name: entry.app, round: entry.round, existed: had.has(entry.appSlug) })
      } catch (error) {
        return json(res, 400, { error: error.message })
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/sample') return json(res, 200, { appSlug: pushSample().appSlug })
    if (req.method === 'GET' && url.pathname === '/api/work') {
      const apps = listApps()
      const status = listening(apps)
      return json(res, 200, { items: listWork(), requests: listRequests(), listening: status, ideaTargets: workTargets(apps, status, 'ideas') })
    }
    if (req.method === 'POST' && url.pathname.startsWith('/api/work/')) {
      const input = JSON.parse(await body(req))
      const action = url.pathname.slice('/api/work/'.length)
      if (action === 'build') {
        const target = workTargets(listApps()).find(option => option.slug === input.target)
        if (!target) return json(res, 409, { error: 'That agent is no longer connected. Turn on wake and try again.' })
        try {
          return json(res, 200, { item: requestBuild({ target: target.slug, brief: input.brief, requestId: input.requestId }) })
        } catch (error) {
          return json(res, 400, { error: error.message })
        }
      }
      if (action === 'ask') {
        const apps = listApps()
        const targets = workTargets(apps, listening(apps), 'ideas')
        const selected = targets.find(option => option.slug === input.route)
        if (input.route && !selected) return json(res, 409, { error: 'That workspace is no longer connected.' })
        const route = selected?.slug ?? (targets.length === 1 ? targets[0].slug : '')
        return json(res, 200, { request: askForIdeas({ target: input.target, count: input.count, route }) })
      }
      if (action === 'decide') return json(res, 200, { item: decide(String(input.id), String(input.decision)) })
      if (action === 'note') return json(res, 200, { item: addNote(String(input.id), input.text, 'reviewer', { page: true }) })
      if (action === 'order' && Array.isArray(input.ids)) {
        reorder(input.ids)
        return json(res, 200, { ok: true })
      }
      return json(res, 404, { error: 'Not found' })
    }
    if (req.method === 'POST' && url.pathname === '/api/wake') {
      // On or off, and nothing else: whatever else is sent is not read. The command comes only from `review wake set`.
      const input = JSON.parse(await body(req))
      if (typeof input.on !== 'boolean') return json(res, 400, { error: 'Say on or off.' })
      // Which project's, by the key the page was given. With one project only, that one. Never this server's own folder.
      const wakes = listWakes()
      const key = typeof input.key === 'string' ? input.key : wakes.length === 1 ? wakes[0].key : ''
      const changed = typeof input.app === 'string' ? switchDesktopWake(input.app, input.on) : key && switchWake(input.on, { key })
      if (!changed) return json(res, 404, { error: 'Wake is not set up for this review.' })
      return json(res, 200, { ok: true, listening: listening() })
    }
    if (req.method === 'POST' && url.pathname === '/api/set-aside') {
      const input = JSON.parse(await body(req))
      if (!Array.isArray(input.slugs)) return json(res, 400, { error: 'Say which.' })
      setAside(input.slugs.map(String), input.aside !== false)
      return json(res, 200, { ok: true })
    }
    if (req.method === 'POST' && url.pathname === '/api/reading') {
      const input = JSON.parse(await body(req))
      try {
        const reading = replyToReading({ appSlug: String(input.appSlug), id: String(input.id), answer: String(input.answer), n: Number(input.n), yes: input.yes === true, text: typeof input.text === 'string' ? input.text : '' })
        return json(res, 200, { ok: true, reading: fromPhone ? forPhone.reading(reading) : reading })
      } catch (error) {
        return json(res, 400, { error: error.message })
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/send') {
      const input = JSON.parse(await body(req))
      const png = input.png ? Buffer.from(String(input.png).replace(/^data:image\/png;base64,/, ''), 'base64') : null
      let record
      try {
        record = receive({
        appSlug: input.appSlug,
        id: input.id,
        png,
        shapes: Array.isArray(input.shapes) ? input.shapes : [],
        notes: String(input.notes ?? ''),
        verdict: input.verdict === 'approved' ? 'approved' : 'changes',
        imageSize: input.imageSize ?? null,
        noComment: input.noComment === true && input.verdict === 'approved',
        after: typeof input.after === 'string' ? input.after : '',
        round: Number(input.round) || null,
        said: input.said && typeof input.said === 'object' ? input.said : null,
        unanswered: Array.isArray(input.unanswered) ? input.unanswered : [],
        back: Array.isArray(input.back) ? input.back : [],
        checked: Array.isArray(input.checked) ? input.checked : [],
        choice: typeof input.choice === 'string' ? input.choice : null,
        // A page that showed a lineup always says what was chosen, null for none. One that says nothing never showed it.
        choiceShown: Object.hasOwn(input, 'choice'),
      })
      } catch (error) {
        // An answer the store will not take: the reason goes back to the page that sent it, which shows it.
        if (error.refused) return json(res, 400, { error: error.message })
        throw error
      }
      if (!record) return json(res, 200, { ok: true, olderPicture: true })
      const stageBefore = record.item ? listWork().find(i => i.id === record.item)?.stage : null
      const made = madeBy(record, stageBefore, answered(record))
      console.log(`received ${record.app} / ${record.screen}${record.mode ? ` (${record.mode})` : ''}: ${record.verdict}, ${record.shapes.length} marks`)
      if (fromPhone) return json(res, 200, { ok: true, record: forPhone.record(record), ...(made ? { made: forPhone.made(made) } : {}), listening: forPhone.listening(listening()) })
      return json(res, 200, { ok: true, record, ...(made ? { made } : {}), listening: listening() })
    }
    if (req.method === 'GET') {
      const path = inside(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname)
      if (path) return sendFile(res, path, 'no-cache')
    }
    json(res, 404, { error: 'Not found' })
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : String(error) })
  }
}
const server = createServer(handle)

if (WAKES_IN_STORE) console.error(`Not running the wake commands in ${join(HOME, 'work', 'wake')}: they came with the project's store. Set one on this computer with review wake set, kept in ${WAKES}.`)

// The secret that stamps the person's decisions, made on the first start, in the person's own Markback folder.
try {
  makeSecret()
} catch (error) {
  console.error(`Answers cannot be stamped as yours: ${error.message}. In a project's store they will read as the project's words.`)
}

if (WHERE.problem) {
  console.error(`Not starting: ${WHERE.problem}`)
  process.exit(1)
}

server.on('error', error => {
  if (error.code !== 'EADDRINUSE') throw error
  console.error(`Port ${PORT} is taken. Choose another: review start --port ${PORT + 1}`)
  process.exit(1)
})
// Review from a phone turns itself off when its time is up.
setInterval(() => void phone.tick().catch(() => undefined), 1000).unref()
// Whoever starts this server: what one before it left in Tailscale is taken down first, before anything listens.
for (const problem of await cleanStale(PORT)) console.error(problem)
// This computer only: nothing here is reachable from another machine.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Markback on http://localhost:${PORT}, with screens and marks in ${HOME}`)
  const beat = () => {
    // Its notes go in the store too: not while a link in a .markback store could send them elsewhere.
    if (WHERE.project && linkIn(HOME)) return console.error(`Not saving: ${LINK_OUT}.`)
    try {
      // Said first, so a hook knows the page runs even when a look below fails.
      serverBeat(PORT)
      waker.check()
    } catch (error) {
      console.error(`wake: ${error.message}`)
    }
  }
  // The first look also notes which answers were already here, so only later ones count as unread.
  beat()
  try {
    standing()
  } catch {
    // The pages ask again.
  }
  setInterval(beat, wakeEvery)
})
// Stopped, it must not look as if it runs: the hooks ask before they hold an agent back.
process.on('exit', () => {
  // Review from a phone goes off with the server: its door closes, and its entry in Tailscale is taken down.
  phone.offSync()
  serverGone()
})
// Stopped (review stop, or Ctrl-C): a reader still at work stops too, rather than go on after the server.
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void stopReading().finally(() => process.exit(0)))
