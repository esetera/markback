/**
 * Whose words a record is. A store other than the person's own Markback folder may have come with a project (a clone, a zip),
 * and anything in it could be written to look like the person's decision. So the review page stamps each record that carries
 * a decision of the person's (an answer, a yes in the queue, an approval that moves an item on, a request for ideas, a note
 * typed on the page) with an HMAC, made with a secret that is kept only in the person's own Markback folder, over the record
 * and the store's real path. A record a project brought has no stamp it could have made: it is the project's words.
 *
 * The secret is made the first time the page starts, readable by the person alone. A command that cannot read it (some
 * sandboxes) cannot check a stamp, and says so: it never takes an unchecked record for the person's.
 */

import { createHmac, randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defaultHome } from './home.mjs'

const secretFile = () => join(defaultHome(), 'secret')
let known

/** The secret, or null when there is none yet or it cannot be read here. */
export function readSecret() {
  if (known) return known
  try {
    const text = readFileSync(secretFile(), 'utf8').trim()
    if (/^[0-9a-f]{64}$/.test(text)) known = Buffer.from(text, 'hex')
  } catch {
    // Not made yet, or not readable from here.
  }
  return known ?? null
}

/** The secret, made now when there is none. Only what writes the person's decisions calls this. */
export function makeSecret() {
  if (readSecret()) return known
  mkdirSync(defaultHome(), { recursive: true, mode: 0o700 })
  try {
    // Made only if none is there, so two pages starting at once cannot each make one.
    writeFileSync(secretFile(), `${randomBytes(32).toString('hex')}\n`, { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
  chmodSync(secretFile(), 0o600)
  known = undefined
  return readSecret()
}

const macWith = (secret, kind, store, content) => createHmac('sha256', secret).update(JSON.stringify([kind, store, content])).digest('hex')

/** The stamp for one record, or '' when no secret can be made here. */
export function stampOf(kind, store, content) {
  let secret = null
  try {
    secret = makeSecret()
  } catch {
    // No stamp: the record then reads as unconfirmed in a project's store, which is the safe way to be wrong.
  }
  return secret ? macWith(secret, kind, store, content) : ''
}

/** true when the stamp is the page's, false when it is not, null when this command cannot read the secret to check. */
export function checkStamp(kind, store, content, mac) {
  const secret = readSecret()
  if (!secret) return null
  return typeof mac === 'string' && mac === macWith(secret, kind, store, content)
}

/** A name for a store that says nothing of where it is, unless one knows the secret. '' when the secret cannot be read. */
export function saltedId(store) {
  const secret = readSecret()
  return secret ? createHmac('sha256', secret).update(`store:${store}`).digest('hex').slice(0, 16) : ''
}
