#!/usr/bin/env node
/**
 * The other end of the wizard, for sessions that push screens and wait for what the reviewer says.
 *
 *   review start [--port 5741]    review stop
 *   review push  --app MyApp --screen "Home" --mode light --after after.png [--before before.png] [--note "..."] [--check "..."]
 *                [--kind proposal|qa] [--item <id>]
 *   review list  [--app MyApp]
 *   review wait  --app MyApp [--all] [--timeout 3600] [--json]
 *   review read  --app MyApp [--since 2026-01-15T10:00:00Z] [--latest] [--json]
 *   review clear --app MyApp
 *
 *   review demo                                 a sample to try it on
 *   review see <address> [--app MyApp]          a picture of your running app, ready to mark
 *   review sketch --in sheet.json --out sheet.svg
 *
 *   review ideas [--json]                       what has been asked for and not answered
 *   review ideas wait [--timeout 3600]          blocks until someone asks
 *   review ideas post --request <id> --what "..." --why "..." --size S|M|L
 *   review ideas close --request <id>
 *
 *   review queue [--json]                       the work, in order
 *   review take [--by "who"] [--item <id>]      the top of the line, or that one
 *   review show --item <id> [--json]            one item, with its notes: read again while working
 *   review note --item <id> --text "..." [--by "who"]
 *   review stage --item <id> --to queued|progress|ready|done
 *
 *   review install-skills [--to ~/.agents/skills] [--agents-md <project folder> [--no-path]]
 *                                               the skills for Codex, Cursor, Gemini CLI and others; AGENTS.md for the rest
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HOME, INBOX, PORT, clearApp, isSetAside, listApps, listScreens, push, readInbox, rememberPort, slug } from './lib/store.mjs'
import { pushSample, showApp } from './lib/first.mjs'
import { sketch } from './lib/sketch.mjs'
import { installSkills } from './lib/skills.mjs'
import { addNote, closeRequest, listWork, openRequests, postIdea, pushedFor, setStage, take } from './lib/work.mjs'

const [command, ...rest] = process.argv.slice(2)
const flags = {}
for (let i = 0; i < rest.length; i++) {
  const arg = rest[i]
  if (!arg.startsWith('--')) continue
  const key = arg.slice(2)
  const next = rest[i + 1]
  // Said more than once, it is a list.
  if (key === 'check') {
    if (next !== undefined && !next.startsWith('--')) (flags.check ??= []).push(next)
    if (next !== undefined && !next.startsWith('--')) i++
  } else if (next === undefined || next.startsWith('--')) flags[key] = true
  else {
    flags[key] = next
    i++
  }
}

const fail = message => {
  console.error(message)
  process.exit(1)
}
const need = key => flags[key] || fail(`Missing --${key}`)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** One feedback record as a change request someone can act on. */
function describe(r) {
  const head = `${r.app} / ${r.screen}${r.mode ? ` (${r.mode})` : ''}, round ${r.round}: ${r.verdict === 'approved' ? (r.noComment ? 'LOOKS GOOD (no comment)' : 'LOOKS GOOD') : 'CHANGES ASKED'}${r.olderPicture ? ' (about an older picture; a new one has been pushed since)' : ''}`
  const lines = [head]
  if (r.notes) lines.push(`  Notes: ${r.notes.replace(/\n/g, '\n         ')}`)
  for (const [i, s] of r.shapes.entries()) {
    const box = `x ${s.box.x}, y ${s.box.y}, ${s.box.w}x${s.box.h}`
    const what = s.type === 'text' ? `text "${s.text}"` : s.type === 'arrow' ? `arrow from ${s.from.x},${s.from.y} to ${s.to.x},${s.to.y}` : s.type
    lines.push(`  ${i + 1}. ${what} (${s.colour}) at ${box}`)
  }
  if (r.annotatedImage) lines.push(`  Marked picture: ${r.annotatedImage}`)
  lines.push(`  After: ${r.afterImage}${r.beforeImage ? `\n  Before: ${r.beforeImage}` : ''}`)
  lines.push(`  File: ${r.file}`)
  for (const e of r.earlier ?? []) lines.push(`  Also said, and still stands:\n${describe(e).replace(/^/gm, '    ')}`)
  return lines.join('\n')
}

const print = records => {
  if (flags.json) console.log(JSON.stringify(records, null, 2))
  else console.log(records.map(describe).join('\n\n') || 'No feedback yet.')
}

/**
 * The newest record per screen. Marks sent again add to the ones before (each marked copy holds only what was new), so when it
 * asks for changes, what else was asked of that picture comes with it under `earlier`, oldest first, along with anything said
 * about the picture just before it. A Looks good pressed over changes replaces them, and stands alone.
 */
const latestPerScreen = records => {
  const byScreen = new Map()
  for (const r of records) {
    const key = `${slug(r.app)}/${r.screenId}`
    byScreen.set(key, [...(byScreen.get(key) ?? []), r])
  }
  return [...byScreen.values()].map(list => {
    const top = list.filter(r => !r.olderPicture).at(-1) ?? list.at(-1)
    const earlier = list.filter(r => r !== top && r.verdict === 'changes' && (r.olderPicture ? r.round >= top.round - 1 : top.verdict === 'changes' && r.round === top.round))
    return earlier.length ? { ...top, earlier } : top
  })
}

const STAGE_WORDS = { idea: 'Idea', later: 'Later', no: 'No', queued: 'Queued', progress: 'In progress', ready: 'Ready for you', done: 'Done' }
const itemLine = i => `${i.id}  ${i.title}  [${i.phase === 'build' ? 'Build' : 'Proposal'}${i.round > 1 ? `, round ${i.round}` : ''}${i.owner ? `, ${i.owner}` : ''}]`

/** One item as a session should read it: what, why, and every note so far. */
function showItem(item) {
  if (flags.json) return console.log(JSON.stringify(item, null, 2))
  console.log(`${item.title}\n  Id: ${item.id}\n  For: ${item.target}\n  Stage: ${STAGE_WORDS[item.stage]}\n  Do: ${item.phase === 'build' ? 'build it, then push the screens with --kind qa' : 'develop the UX, then push the screens with --kind proposal'}, with --item ${item.id}\n  Round: ${item.round}${item.marksBack ? ' (marks came back: read them with review read)' : ''}${item.app ? `\n  Screens under: ${item.app}` : ''}\n  Size: ${item.size}\n  Why: ${item.why || '(not said)'}`)
  for (const note of item.notes ?? []) console.log(`  Note from ${note.by}, ${note.at}: ${note.text}`)
}

async function ideas(what) {
  if (what === 'post') {
    const item = postIdea({ request: need('request'), what: need('what'), why: flags.why || '', size: flags.size || 'M' })
    if (item.title.split(/\s+/).length > 12 || item.why.split(/\s+/).length > 15) console.error('Too long: one short line for what, and one for why.')
    return console.log(item.id)
  }
  if (what === 'close') return console.log(`Closed ${closeRequest(need('request')).id}`)
  const say = requests => {
    if (flags.json) return console.log(JSON.stringify(requests, null, 2))
    if (!requests.length) return console.log('Nobody is asking.')
    for (const r of requests) console.log(`${r.id}: ${r.count - r.posted} ideas for ${r.target}. Study it first, then: review ideas post --request ${r.id} --what "..." --why "..." --size S|M|L`)
  }
  if (what === 'list') return say(openRequests())
  if (what !== 'wait') fail('review ideas | ideas wait | ideas post | ideas close')
  const deadline = Date.now() + Number(flags.timeout || 3600) * 1000
  for (;;) {
    const open = openRequests()
    if (open.length) return say(open)
    if (Date.now() > deadline) fail('Nobody asked before the timeout.')
    await sleep(2000)
  }
}

const PID_FILE = join(HOME, 'server.pid')
const up = port => fetch(`http://127.0.0.1:${port}/api/queue`).then(r => r.ok, () => false)

/** Runs the server on its own, so it outlasts this command. Nothing leaves this computer. */
async function start() {
  const port = Number(flags.port || PORT)
  if (await up(port)) {
    if (flags.port) rememberPort(port)
    return console.log(`Already running: http://localhost:${port}`)
  }
  mkdirSync(HOME, { recursive: true })
  const child = spawn(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'server.mjs')], { detached: true, stdio: 'ignore', env: { ...process.env, REVIEW_PORT: String(port) } })
  child.unref()
  writeFileSync(PID_FILE, String(child.pid))
  for (let i = 0; i < 50; i++) {
    if (await up(port)) {
      rememberPort(port)
      return console.log(`Open http://localhost:${port}\nYour screens and answers stay on this computer, in ${HOME}`)
    }
    if (child.exitCode !== null) break
    await sleep(100)
  }
  fail(`It did not start. Port ${port} may be taken: try review start --port ${port + 1}`)
}

async function stop() {
  if (!existsSync(PID_FILE)) return console.log('It is not running from here.')
  try {
    process.kill(Number(readFileSync(PID_FILE, 'utf8')))
    console.log('Stopped.')
  } catch {
    console.log('It was not running.')
  }
  rmSync(PID_FILE, { force: true })
}

if (command === 'push') {
  const entry = push({ app: need('app'), screen: need('screen'), mode: flags.mode || '', after: need('after'), before: flags.before || '', note: flags.note || '', check: flags.check ?? [], kind: flags.kind || 'qa', item: typeof flags.item === 'string' ? flags.item : '', from: typeof flags.from === 'string' ? flags.from : 'Claude' })
  if (entry.item) pushedFor(entry.item, entry.app, entry.from, entry.kind)
  const all = listScreens(entry.appSlug)
  // Long words go unread, and they cost time before anyone can act.
  if ([entry.note, ...(entry.check ?? [])].some(words => words.trim().split(/\s+/).length > 10)) console.error('Too long: say what to look at in ten words or fewer. Only the first sentence shows; the rest waits behind More.')
  console.log(`Queued ${entry.app} / ${entry.screen}${entry.mode ? ` (${entry.mode})` : ''}, round ${entry.round}: ${all.length} screen${all.length === 1 ? '' : 's'} for ${entry.app}. Open http://localhost:${PORT}/#${entry.appSlug}${isSetAside(entry.appSlug) ? `\nThis review is set aside: it is not offered until the reviewer brings it back.` : ''}`)
} else if (command === 'list') {
  const apps = listApps().filter(a => !flags.app || a.slug === slug(flags.app))
  if (!apps.length) console.log('Nothing queued.')
  for (const a of apps) {
    console.log(`${a.name}${a.setAside ? ` (set aside${a.setAside.isNew ? ', with something new' : ''})` : ''}`)
    for (const s of a.screens) console.log(`  ${s.status.padEnd(8)} ${s.screen}${s.mode ? ` (${s.mode})` : ''}, round ${s.round}`)
  }
} else if (command === 'read') {
  let records = readInbox(flags.app || undefined)
  if (flags.since) records = records.filter(r => r.sentAt > flags.since)
  if (flags.latest) records = latestPerScreen(records)
  print(records)
} else if (command === 'wait') {
  // Waits for feedback sent after it started. With --all, waits until every queued screen of the app has been
  // answered in its current round, then prints the answers.
  const app = need('app')
  const started = new Date().toISOString()
  const deadline = Date.now() + Number(flags.timeout || 3600) * 1000
  const done = () => {
    const fresh = readInbox(app).filter(r => r.sentAt > started)
    if (!flags.all) return fresh.length ? fresh : null
    const screens = listScreens(slug(app))
    if (!screens.length || screens.some(s => s.status === 'waiting')) return null
    return latestPerScreen(readInbox(app).filter(r => screens.some(s => s.id === r.screenId && (s.round === r.round || r.olderPicture))))
  }
  let told = false
  for (;;) {
    const records = done()
    if (records) {
      print(records)
      break
    }
    // Set aside is not an answer. Whoever waits should know why nothing is coming.
    const aside = isSetAside(app)
    if (aside && !told) {
      told = true
      console.error(`${app} is set aside by the reviewer. Nothing has been answered, and it is not offered until it is brought back. Still waiting.`)
    }
    if (Date.now() > deadline) fail(`No feedback for ${app} before the timeout.${aside ? ' It is set aside, not answered.' : ''}`)
    await sleep(2000)
  }
} else if (command === 'install-skills') {
  const to = typeof flags.to === 'string' ? flags.to.replace(/^~(?=\/|$)/, homedir()) : join(homedir(), '.agents', 'skills')
  const project = typeof flags['agents-md'] === 'string' ? flags['agents-md'].replace(/^~(?=\/|$)/, homedir()) : null
  for (const path of installSkills({ to, agentsMdIn: project, pathInAgentsMd: !flags['no-path'] })) console.log(`Wrote ${path}`)
  console.log('Codex, Cursor and Gemini CLI read skills from ~/.agents/skills. Run this again after updating Markback.')
} else if (command === 'clear') {
  clearApp(need('app'))
  console.log(`Took ${flags.app} off the review page. Its feedback stays in ${join(INBOX, slug(flags.app))}.`)
} else if (command === 'start') {
  await start()
} else if (command === 'stop') {
  await stop()
} else if (command === 'sketch') {
  writeFileSync(need('out'), sketch(JSON.parse(readFileSync(need('in'), 'utf8'))))
  console.log(`Wrote ${flags.out}`)
} else if (command === 'demo') {
  pushSample()
  console.log(`A sample is waiting. Open http://localhost:${PORT}/#sample`)
} else if (command === 'see') {
  try {
    const shown = await showApp(rest[0] && !rest[0].startsWith('--') ? rest[0] : flags.url, { app: typeof flags.app === 'string' ? flags.app : '', screen: typeof flags.screen === 'string' ? flags.screen : 'First look', files: true, kind: flags.kind || 'qa' })
    console.log(`It is ready to mark. Open http://localhost:${PORT}/#${shown.appSlug}`)
  } catch (error) {
    fail(error.message)
  }
} else if (command === 'ideas') {
  await ideas(rest[0] && !rest[0].startsWith('--') ? rest[0] : 'list')
} else if (command === 'queue') {
  const items = listWork().filter(i => !['idea', 'later', 'no'].includes(i.stage))
  if (flags.json) console.log(JSON.stringify(items, null, 2))
  else console.log(['queued', 'progress', 'ready', 'done'].map(stage => `${STAGE_WORDS[stage]}\n${items.filter(i => i.stage === stage).map(i => `  ${itemLine(i)}`).join('\n') || '  Nothing'}`).join('\n'))
} else if (command === 'take') {
  const item = take({ by: typeof flags.by === 'string' ? flags.by : 'a session', id: typeof flags.item === 'string' ? flags.item : null })
  if (!item) console.log('Nothing is queued.')
  else showItem(item)
} else if (command === 'show') {
  const item = listWork().find(i => i.id === need('item'))
  if (!item) fail(`No item ${flags.item}`)
  showItem(item)
} else if (command === 'note') {
  showItem(addNote(need('item'), need('text'), typeof flags.by === 'string' ? flags.by : 'a session'))
} else if (command === 'stage') {
  showItem(setStage(need('item'), need('to'), typeof flags.by === 'string' ? flags.by : 'a session'))
} else {
  console.log(`review start | stop | see | demo | sketch | push | list | wait | read | clear | ideas | queue | take | show | note | stage | install-skills   (files under ${HOME}${existsSync(INBOX) ? `, ${readdirSync(INBOX).length} apps with feedback` : ''})`)
  if (command) process.exit(1)
}
