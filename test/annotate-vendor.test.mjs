import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fromTypeScript, OUTPUT } from '../scripts/vendor-annotate.mjs'

test('public/annotate.js matches the TypeScript it is copied from', { skip: process.env.MARKBACK_ANNOTATE_FROM ? false : 'set MARKBACK_ANNOTATE_FROM to compare' }, () => {
  assert.equal(readFileSync(OUTPUT, 'utf8'), fromTypeScript(process.env.MARKBACK_ANNOTATE_FROM))
})
