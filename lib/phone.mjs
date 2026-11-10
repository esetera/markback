/**
 * Review from a phone on the same Wi-Fi. Off until the person turns it on. The review page itself listens on this computer only,
 * always. Turning this on opens a second door, on this computer's address in the local network, and every request through it
 * must carry a code that is made new each time it is turned on: others on the network who do not have the code see nothing.
 * It turns itself off after 30 minutes, when it is turned off, and when the server stops. It changes no settings of the system or
 * the network: it only listens, as any program may.
 */

import { createServer } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { networkInterfaces } from 'node:os'

/** How long it stays on. REVIEW_PHONE_MINUTES can only make it shorter, for a test. */
export const MINUTES = Math.min(30, Number(process.env.REVIEW_PHONE_MINUTES) || 30)
/** The browser keeps the code in this cookie once the address has been opened, so it leaves the address bar. */
const COOKIE = 'markback-key'

/** Something the person can put right. Its words say what to do. */
export class PhoneProblem extends Error {}

export const WORDS = {
  noNetwork: 'This computer is not on a local network. Join the same Wi-Fi as your phone, then try again.',
  noListen: (address, code) => `Markback could not listen for your phone at ${address}${code ? ` (${code})` : ''}. Check that this computer is on the Wi-Fi, then try again.`,
  noKey:'This address needs the code from the computer. Scan the code on the computer again.',
  atComputer: 'Turn it on at the computer.',
}

/** An address only a local network uses: 10.x, 172.16-31.x and 192.168.x. Never one the internet can reach. */
export function isPrivate(address) {
  const [a, b] = String(address).split('.').map(Number)
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
}

/** This computer's address on the local network, or '' when it has none. REVIEW_PHONE_HOST names one, for a test. */
export function localAddress(nets = networkInterfaces()) {
  if (process.env.REVIEW_PHONE_HOST) return process.env.REVIEW_PHONE_HOST
  for (const list of Object.values(nets)) for (const net of list ?? []) {
    if (net.family === 'IPv4' && !net.internal && isPrivate(net.address)) return net.address
  }
  return ''
}

const cookieOf = req => {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=')
    if (name === COOKIE) return value.join('=')
  }
  return ''
}
/** Compared in the same time whatever it holds, so the code cannot be guessed a letter at a time. */
const same = (a, b) => {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * The door for a phone. `handle(req, res)` is the page's own handler: a request reaches it only with the code. `on()` opens it,
 * or gives it 30 more minutes; `off()` closes it and drops every connection through it at once.
 */
export function phoneDoor(handle) {
  let door = null
  const sockets = new Set()
  let timer = null

  const status = () => (door ? { on: true, url: door.url, address: door.address, until: new Date(door.until).toISOString(), minutes: MINUTES } : { on: false, minutes: MINUTES })

  function gate(req, res) {
    const url = new URL(req.url, 'http://phone')
    const given = url.searchParams.get('key')
    if (!door || !(same(given ?? '', door.key) || same(cookieOf(req), door.key))) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      return res.end(WORDS.noKey)
    }
    // Opened from the code: the browser keeps it, and the address bar and its history lose it.
    if (given !== null) {
      url.searchParams.delete('key')
      res.writeHead(303, { location: `${url.pathname}${url.search}`, 'set-cookie': `${COOKIE}=${door.key}; Path=/; HttpOnly; SameSite=Strict`, 'cache-control': 'no-store' })
      return res.end()
    }
    return handle(req, res)
  }

  async function on() {
    if (door) {
      door.until = Date.now() + MINUTES * 60000
      return status()
    }
    const address = localAddress()
    if (!address) throw new PhoneProblem(WORDS.noNetwork)
    const server = createServer(gate)
    server.on('connection', socket => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
    })
    // Any free port: the address is in the code, so nobody types it.
    await new Promise((resolve, reject) => {
      server.once('error', error => reject(new PhoneProblem(WORDS.noListen(address, error.code))))
      server.listen(0, address, resolve)
    })
    const key = randomBytes(18).toString('base64url')
    const shown = address.includes(':') ? `[${address}]` : address
    door = { server, key, address, url: `http://${shown}:${server.address().port}/?key=${key}`, until: Date.now() + MINUTES * 60000 }
    timer = setInterval(() => door && Date.now() >= door.until && off(), 1000)
    timer.unref()
    return status()
  }

  function off() {
    if (!door) return false
    door.server.close()
    for (const socket of sockets) socket.destroy()
    sockets.clear()
    clearInterval(timer)
    door = null
    return true
  }

  return { on, off, status }
}
