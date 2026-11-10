#!/usr/bin/env node
/**
 * The review wizard's little server: serves the page, the queued screens and their pictures, and writes what the
 * reviewer sends into the inbox. Nothing to install: plain Node.
 */

import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { IMAGES, INBOX, PORT, listApps, readInbox, receive, setAside } from './lib/store.mjs'
import { pushSample, showApp } from './lib/first.mjs'
import { hasReader, wordsForPicture } from './lib/read-words.mjs'
import { addNote, answered, askForIdeas, decide, listRequests, listWork, reorder } from './lib/work.mjs'

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
    // `reader`: whether this computer can read words off a picture, so the page shows the words tool only where it can work.
    if (req.method === 'GET' && url.pathname === '/api/queue') return json(res, 200, { apps: listApps(), reader: hasReader() })
    if (req.method === 'POST' && url.pathname === '/api/read-words') {
      // A picture pushed with no word list: its words are read here, once, and the list is kept beside it. The answer comes at
      // once, reading or not, so a read never holds one of the few connections a browser opens to a server.
      const input = JSON.parse(await body(req))
      return json(res, 200, wordsForPicture(String(input.after ?? '')))
    }
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
    if (req.method === 'GET' && url.pathname === '/api/work') return json(res, 200, { items: listWork(), requests: listRequests() })
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
      answered(record)
      console.log(`received ${record.app} / ${record.screen}${record.mode ? ` (${record.mode})` : ''}: ${record.verdict}, ${record.shapes.length} marks`)
      return json(res, 200, { ok: true, record })
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

server.on('error', error => {
  if (error.code !== 'EADDRINUSE') throw error
  console.error(`Port ${PORT} is taken. Choose another: review start --port ${PORT + 1}`)
  process.exit(1)
})
// This computer only: nothing here is reachable from another machine.
server.listen(PORT, '127.0.0.1', () => console.log(`Markback on http://localhost:${PORT}`))
