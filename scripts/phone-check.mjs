#!/usr/bin/env node
/**
 * Checks, against the real Tailscale, what the tests can only assume of it. Run it on the computer with review from a phone
 * turned on (review phone on): node scripts/phone-check.mjs [--port 5741] [--and-off]
 * It asks Tailscale only what Markback itself asks (status and serve status), and makes a few requests to the https address from
 * this computer, which is one of the person's own devices. --and-off then turns it off and checks that only its entry went.
 * Each line says pass or fail, and what it means.
 */
import { request } from 'node:https'
import { PORT } from '../lib/store.mjs'
import { tailscaleJson } from '../lib/phone.mjs'

const words = process.argv.slice(2)
const port = words.includes('--port') ? Number(words[words.indexOf('--port') + 1]) : PORT
let failed = 0
const say = (ok, text) => {
  if (!ok) failed++
  console.log(`${ok ? 'pass' : 'FAIL'}  ${text}`)
}
const note = text => console.log(`note  ${text}`)

/** One https request to the address, with the headers given: Host can be set, which fetch does not allow. */
const ask = (url, path, headers = {}) => new Promise(resolve => {
  const at = new URL(url)
  const req = request({ host: at.hostname, port: at.port || 443, path, servername: at.hostname, headers, timeout: 60000 }, res => {
    let text = ''
    res.on('data', chunk => (text += chunk))
    res.on('end', () => resolve({ status: res.statusCode, text }))
  })
  req.on('timeout', () => req.destroy(new Error('no answer in a minute')))
  req.on('error', error => resolve({ status: 0, text: error.message }))
  req.end()
})

const status = await fetch(`http://127.0.0.1:${port}/api/phone`).then(r => r.json(), () => null)
if (!status) {
  console.log(`The review page does not answer on port ${port}. Start it, turn on review from your phone, and run this again.`)
  process.exit(1)
}
if (!status.on || status.stuck) {
  console.log(status.stuck ? status.problem : 'Review from your phone is off. Turn it on with: review phone on, then run this again.')
  process.exit(1)
}
const url = status.url
const name = `${new URL(url).hostname}:${new URL(url).port || 443}`
console.log(`Checking ${url}\n`)

// 1. What status --json says, in the shape Markback reads.
const tail = await tailscaleJson(['status', '--json'])
const host = String(tail?.Self?.DNSName ?? '').replace(/\.$/, '').toLowerCase()
say(!!tail && tail.BackendState === 'Running' && host === new URL(url).hostname, `status --json: running, and Self.DNSName is the address's name (${host || 'none'})`)
say((tail?.CertDomains ?? []).map(String).map(s => s.toLowerCase()).includes(host), 'status --json: CertDomains holds that name (HTTPS is on)')
say(String(tail?.User?.[tail?.Self?.UserID]?.LoginName ?? '').toLowerCase() === status.login, `status --json: the login of this computer's person is ${status.login}`)

// 2. What serve status --json says: Markback's entry, in the shape it reads, to the tailnet only.
const serve = await tailscaleJson(['serve', 'status', '--json'])
const proxy = serve?.Web?.[name]?.Handlers?.['/']?.Proxy ?? ''
say(/^http:\/\/127\.0\.0\.1:\d+$/.test(proxy) && !proxy.endsWith(`:${port}`), `serve status --json: Web["${name}"].Handlers["/"].Proxy is the door, not the page's own port (${proxy || 'none'})`)
say(!!serve?.TCP?.[String(new URL(url).port || 443)]?.HTTPS, 'serve status --json: TCP[port].HTTPS is on')
say(!serve?.AllowFunnel?.[name], 'serve status --json: no Funnel for it: nothing is open to the internet')
const others = Object.keys(serve?.Web ?? {}).filter(n => n !== name)
if (others.length) note(`Tailscale serves other things too, which Markback leaves alone: ${others.join(', ')}`)

// 3. Through Tailscale, from this computer: the certificate, and the login Tailscale writes.
const started = Date.now()
const plain = await ask(url, '/api/queue')
say(plain.status === 200, `the https address answers with a good certificate, and Tailscale wrote this person's login (${plain.status || plain.text}; ${Math.round((Date.now() - started) / 1000)} s)`)

// 4. A login sent by the caller: Tailscale must put its own in its place.
const forged = await ask(url, '/api/queue', { 'Tailscale-User-Login': 'someone-else@example.com' })
say(forged.status === 200, `a Tailscale-User-Login sent by the caller is replaced by Tailscale's own (${forged.status === 403 ? 'it was passed on: the door refused it, but Tailscale did not replace it' : forged.status || forged.text})`)

// 5. A Host that says this computer: the door gives a phone's rights only, whatever Tailscale hands on.
const local = await ask(url, '/api/work', { Host: 'localhost' })
say(local.status === 403 || local.status === 400 || local.status === 404 || local.status === 421, `Host: localhost through the address does not reach the work queue (${local.status || local.text})`)
const named = await ask(url, '/api/queue', { Host: 'localhost' })
note(named.status === 200 ? 'Tailscale hands on the Host the caller sent' : `with Host: localhost Tailscale answered ${named.status || named.text}: it routes by the name, and does not hand that Host on`)
const work = await ask(url, '/api/work')
say(work.status === 403, `the work queue is refused through Tailscale (${work.status || work.text})`)

// 6. Turned off: only Markback's entry goes.
if (words.includes('--and-off')) {
  const before = Object.keys(serve?.Web ?? {})
  const off = await fetch(`http://127.0.0.1:${port}/api/phone`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on: false }) }).then(r => r.json())
  const after = await tailscaleJson(['serve', 'status', '--json'])
  const left = Object.keys(after?.Web ?? {})
  say(!off.stuck && !left.includes(name), `turned off: Tailscale no longer serves ${name}`)
  say(before.filter(n => n !== name).every(n => left.includes(n)), 'turned off: every other entry is still there')
} else note('add --and-off to check that turning it off removes only its own entry')

note('not checked from here: that a phone of another person, a tagged device or Funnel traffic carries no login (the door refuses those without one)')
console.log(failed ? `\n${failed} failed.` : '\nAll passed.')
process.exit(failed ? 1 : 0)
