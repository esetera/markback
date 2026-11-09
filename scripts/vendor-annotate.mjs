#!/usr/bin/env node
/**
 * public/annotate.js is Markback's own copy of a drawing code that is also kept, in TypeScript, in another project. This
 * refreshes the copy from that file with its types stripped, so Markback stays plain JavaScript with nothing to install.
 *
 *   node scripts/vendor-annotate.mjs --from path/to/annotate.ts
 *
 * Set MARKBACK_ANNOTATE_FROM to that file and `npm test` checks the two still match. A maintainers' tool: the TypeScript is
 * not public, and stripping types needs Node 22.13 or later.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const OUTPUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'annotate.js')
export const fromTypeScript = file => stripTypeScriptTypes(readFileSync(file, 'utf8'), { mode: 'strip' }).replace(/^(?:[ \t]+\n)+/gm, '\n').replace(/\n{3,}/g, '\n\n')
  // What the source says about where else it runs is that project's business, not Markback's.
  .replace(/ *\* Plain TypeScript with erasable[\s\S]*?\*\/\n/, ' */\n')

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--from')
  const from = at >= 0 ? process.argv[at + 1] : process.env.MARKBACK_ANNOTATE_FROM
  if (!from) throw new Error('Say which file: --from path/to/annotate.ts')
  writeFileSync(OUTPUT, fromTypeScript(from))
  console.log(`public/annotate.js from ${from}`)
}
