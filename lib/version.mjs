/**
 * Which code this is: a short hash of the files that make the review page. The page says it, so `review start` can tell a page
 * still running older code (from before an update) from one running this code, and put the new one in its place.
 */

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let made

export function codeVersion() {
  if (made) return made
  const hash = createHash('sha256')
  const files = ['server.mjs', ...['lib', 'public'].flatMap(dir => readdirSync(join(ROOT, dir)).sort().map(name => join(dir, name)))]
  for (const file of files) {
    try {
      hash.update(file).update(readFileSync(join(ROOT, file)))
    } catch {
      // A folder, or a file that has just gone: the rest still say which code this is.
    }
  }
  made = hash.digest('hex').slice(0, 12)
  return made
}
