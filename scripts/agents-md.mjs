#!/usr/bin/env node
// Writes AGENTS.md at the repo root from skills/*/SKILL.md. `--check` fails when it is out of date, without writing.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, agentsMd } from '../lib/skills.mjs'

const path = join(ROOT, 'AGENTS.md')
const made = agentsMd()
if (process.argv.includes('--check')) {
  let now = ''
  try {
    now = readFileSync(path, 'utf8')
  } catch {
    // Missing counts as out of date.
  }
  if (now !== made) {
    console.error('AGENTS.md is out of date with skills/. Run: node scripts/agents-md.mjs')
    process.exit(1)
  }
  console.log('AGENTS.md matches the skills.')
} else {
  writeFileSync(path, made)
  console.log(`Wrote ${path}`)
}
