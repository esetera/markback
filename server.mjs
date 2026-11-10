#!/usr/bin/env node
/**
 * The review wizard's little server: serves the page, the queued screens and their pictures, and writes what the
 * reviewer sends into the inbox. Nothing to install: plain Node.
 */

import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HOME, IMAGES, INBOX, PORT, STORE_ID, WHERE, listApps, readInbox, receive, setAside } from './lib/store.mjs'
import { pushSample, showApp } from './lib/first.mjs'
import { linkIn, LINK_OUT } from './lib/home.mjs'
import { addNote, answered, askForIdeas, decide, listRequests, listWork, reorder } from './lib/work.mjs'
import { madeBy, serverBeat, serverGone, standing } from './lib/listen.mjs'
// Only what reads the wake command and turns it on and off. What sets the command is not imported here, on purpose:
// nothing a web page can reach may decide what this computer runs.
import { createWaker, readDesktopWake, switchDesktopWake, switchWake } from './lib/wake.mjs'

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
      sentAt: r.sentAt,
      annotatedUrl: urlFor(INBOX, '/inbox/', r.annotatedImage),
      afterUrl: urlFor(IMAGES, '/images/', r.afterImage),
      beforeUrl: urlFor(IMAGES, '/images/', r.beforeImage),
    }))
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
const commandWork = apps => standing(apps, { excludeMarksFor: slug => readDesktopWake(slug)?.on === true })
const waker = createWaker({ look: commandWork, ...(quiet >= 0 ? { quiet } : {}), ...(backoff >= 0 ? { backoff } : {}), ...(late >= 0 ? { late } : {}), ...(gap >= 0 ? { gap } : {}) })
/** Who listens, what waits unheard, and whether an agent will be woken for it: with every answer the pages poll. */
const listening = (apps = listApps()) => {
  const now = standing(apps)
  const desktop = Object.fromEntries(apps.flatMap(({ slug }) => {
    const held = readDesktopWake(slug)
    return held ? [[slug, { on: held.on, pending: now.markApps.includes(slug) }]] : []
  }))
  return { agents: now.agents, unheard: now.unheard, wake: waker.view(now.markApps.some(slug => desktop[slug]?.on) ? commandWork(apps) : now), desktop }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const hostOf = text => {
  try {
    return new URL(text).hostname
  } catch {
    return ''
  }
}
function isLocal(req) {
  if (!LOCAL_HOSTS.has(hostOf(`http://${req.headers.host}`))) return false
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  // Only this computer's own pages: another site open in the browser must not write here, or read by renaming itself.
  if (!isLocal(req)) return json(res, 403, { error: 'Only this computer can use this.' })
  try {
    // Which store this page shows: a command on the same port can then tell whether its pushes are here.
    if (req.method === 'GET' && url.pathname === '/api/queue') {
      const apps = listApps()
      return json(res, 200, { apps, listening: listening(apps), store: STORE_ID })
    }
    // A store a project's .markback named may hold no link: one added while the page runs would send this write anywhere.
    if (req.method === 'POST' && WHERE.from === 'file' && linkIn(HOME)) return json(res, 409, { error: `Not saved: ${LINK_OUT}.` })
    if (req.method === 'GET' && url.pathname.startsWith('/images/')) {
      const path = inside(IMAGES, decodeURIComponent(url.pathname.slice('/images/'.length)))
      // Pushed pictures are never changed in place (a new push makes a new name), so they can be kept.
      return path ? sendFile(res, path, 'max-age=31536000, immutable') : json(res, 404, { error: 'No such picture' })
    }
    if (req.method === 'GET' && url.pathname === '/api/history') {
      return json(res, 200, { records: history(url.searchParams.get('app') ?? '', url.searchParams.get('id') ?? '') })
    }
    if (req.method === 'GET' && url.pathname.startsWith('/inbox/')) {
      // Marked pictures the reviewer sent earlier; each send makes a new name, so they can be kept too.
      const path = inside(INBOX, decodeURIComponent(url.pathname.slice('/inbox/'.length)))
      return path && extname(path).toLowerCase() === '.png' ? sendFile(res, path, 'max-age=31536000, immutable') : json(res, 404, { error: 'No such picture' })
    }
    if (req.method === 'POST' && url.pathname === '/api/show') {
      const input = JSON.parse(await body(req))
      try {
        return json(res, 200, { appSlug: (await showApp(input.url)).appSlug })
      } catch (error) {
        return json(res, 400, { error: error.message })
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/sample') return json(res, 200, { appSlug: pushSample().appSlug })
    if (req.method === 'GET' && url.pathname === '/api/work') return json(res, 200, { items: listWork(), requests: listRequests(), listening: listening() })
    if (req.method === 'POST' && url.pathname.startsWith('/api/work/')) {
      const input = JSON.parse(await body(req))
      const action = url.pathname.slice('/api/work/'.length)
      if (action === 'ask') return json(res, 200, { request: askForIdeas({ target: input.target, count: input.count }) })
      if (action === 'decide') return json(res, 200, { item: decide(String(input.id), String(input.decision)) })
      if (action === 'note') return json(res, 200, { item: addNote(String(input.id), input.text) })
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
      const changed = typeof input.app === 'string' ? switchDesktopWake(input.app, input.on) : switchWake(input.on)
      if (!changed) return json(res, 404, { error: 'Wake is not set up for this review.' })
      return json(res, 200, { ok: true, listening: listening() })
    }
    if (req.method === 'POST' && url.pathname === '/api/set-aside') {
      const input = JSON.parse(await body(req))
      if (!Array.isArray(input.slugs)) return json(res, 400, { error: 'Say which.' })
      setAside(input.slugs.map(String), input.aside !== false)
      return json(res, 200, { ok: true })
    }
    if (req.method === 'POST' && url.pathname === '/api/send') {
      const input = JSON.parse(await body(req))
      const png = input.png ? Buffer.from(String(input.png).replace(/^data:image\/png;base64,/, ''), 'base64') : null
      const record = receive({
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
      })
      if (!record) return json(res, 200, { ok: true, olderPicture: true })
      const stageBefore = record.item ? listWork().find(i => i.id === record.item)?.stage : null
      const made = madeBy(record, stageBefore, answered(record))
      console.log(`received ${record.app} / ${record.screen}${record.mode ? ` (${record.mode})` : ''}: ${record.verdict}, ${record.shapes.length} marks`)
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
})

if (WHERE.problem) {
  console.error(`Not starting: ${WHERE.problem}`)
  process.exit(1)
}

server.on('error', error => {
  if (error.code !== 'EADDRINUSE') throw error
  console.error(`Port ${PORT} is taken. Choose another: review start --port ${PORT + 1}`)
  process.exit(1)
})
// This computer only: nothing here is reachable from another machine.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Markback on http://localhost:${PORT}, with screens and marks in ${HOME}`)
  const beat = () => {
    // Its notes go in the store too: not while a link in a .markback store could send them elsewhere.
    if (WHERE.from === 'file' && linkIn(HOME)) return console.error(`Not saving: ${LINK_OUT}.`)
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
process.on('exit', serverGone)
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => process.exit(0))
