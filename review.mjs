#!/usr/bin/env node
/**
 * The other end of the wizard, for sessions that push screens and wait for what the reviewer says.
 *
 *   review start [--port 5741]    review stop
 *   review push  --app MyApp --screen "Home" --mode light --after after.png [--before before.png] [--note "..."] [--check "..."]
 *                [--kind proposal|qa] [--item <id>] [--words list.json]   (the words in the picture, so marks can carry them)
 *   review words-script                         the script that makes such a list, to run in the page with a browser tool
 *   review list  [--app MyApp]
 *   review wait  --app MyApp [--all] [--timeout 3600] [--json]
 *   review read  --app MyApp [--since 2026-01-15T10:00:00Z] [--latest] [--json]
 *   review clear --app MyApp
 *
 *   review demo                                 a sample to try it on
 *   review see <address> [--app MyApp]          a picture of your running app, ready to mark
 *   review pdf <file.pdf> [--app MyDoc] [--pages 2-5]   a PDF, a screen for each page (takes push's --note, --check, --kind, --item)
 *   review sketch --in sheet.json --out sheet.svg
 *   review check [--json]                       proves Markback works on this computer, and says what is missing
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
 *   review project [--yes] [--no-open]           in a project's folder: finds its app, takes its main screens, opens
 *                                               them in your browser (the markback command is this)
 *   review open [--app MyApp]                   opens the review page in your browser
 *
 *   review plugin add <folder or git address> [--yes]   review plugin list   review plugin remove <name>
 *   review <plugin> [<command>] ...             a command a plugin adds
 *   review export --app MyApp --as <export> [--out file]   an app's latest answers, turned into text by a plugin
 *
 *   review install-skills [--to ~/.agents/skills | --codex] [--agents-md <project folder> [--no-path]]
 *                                               the skills for Codex, Cursor and others; AGENTS.md for the rest
 */

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HOME, INBOX, PORT, clearApp, isSetAside, listApps, listScreens, push, readInbox, rememberPort, slug } from './lib/store.mjs'
import { pushSample, showApp } from './lib/first.mjs'
import { showPdf } from './lib/pdf.mjs'
import { PAGE_SCRIPT, printable, readWords, sayWords } from './lib/words.mjs'
import { sketch } from './lib/sketch.mjs'
import { installSkills } from './lib/skills.mjs'
import { addPlugins, addsWords, fetchSource, listPlugins, pluginsIn, removePlugin, runCommand, runExport } from './lib/plugins.mjs'
import { findApp, openPage, shootScreens, startApp } from './lib/project.mjs'
import { runChecks, sayResult, sayVerdict, up } from './lib/check.mjs'
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
  } else if (key === 'fetch-browser' || next === undefined || next.startsWith('--')) flags[key] = true // --fetch-browser is a yes, never a name: what follows it is not its value
  else {
    flags[key] = next
    i++
  }
}

// The person said yes to fetching the small browser that pictures need inside a sandbox. Without the flag, nothing is fetched.
if (flags['fetch-browser']) process.env.MARKBACK_FETCH_BROWSER = 'yes'

const fail = message => {
  console.error(message)
  process.exit(1)
}
const need = key => flags[key] || fail(`Missing --${key}`)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** One mark in a line. Its words came from a page or a file: printed with no new lines and no codes, they cannot pass for a line of this report. */
function markLine(s) {
  const box = `x ${s.box.x}, y ${s.box.y}, ${s.box.w}x${s.box.h}`
  const what = s.type === 'text' ? `text "${s.text}"` : s.type === 'arrow' && s.from ? `arrow from ${s.from.x},${s.from.y} to ${s.to.x},${s.to.y}` : s.type === 'words' ? `words "${s.text}"` : s.type === 'pin' ? `said at pin ${s.n ?? ''} "${s.text}"`.replace('  ', ' ') : s.type
  return printable(`${what} (${s.colour ?? s.color}) at ${box}${sayWords(s)}`)
}

/** One feedback record as a change request someone can act on. */
function describe(r) {
  const head = `${r.app} / ${r.screen}${r.mode ? ` (${r.mode})` : ''}, round ${r.round}: ${r.verdict === 'approved' ? (r.noComment ? 'LOOKS GOOD (no comment)' : 'LOOKS GOOD') : 'CHANGES ASKED'}${r.olderPicture ? ' (about an older picture; a new one has been pushed since)' : ''}`
  const lines = [head]
  if (r.notes) lines.push(`  Notes: ${r.notes.replace(/\n/g, '\n         ')}`)
  for (const [i, s] of r.shapes.entries()) lines.push(`  ${i + 1}. ${markLine(s)}`)
  const asked = Array.isArray(r.asked) ? r.asked : []
  if (asked.length) {
    const open = asked.filter(a => a.said !== 'fixed').length
    lines.push(`  Earlier marks: ${asked.length - open} of ${asked.length} ticked fixed${open ? `, ${open} still to do` : ''}`)
    for (const a of asked) lines.push(`    ${a.n}. ${a.said === 'fixed' ? 'fixed' : a.cameBack ? 'came back' : a.said === 'stands' ? 'still stands' : 'not ticked, so still to do'}, from round ${a.round}: ${a.type === 'notes' ? `notes "${printable(a.text)}"` : markLine(a)}`)
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
/** One yes or no from the person at the terminal. Anything but yes is no. */
const askYes = question => new Promise(resolveAnswer => {
  process.stdout.write(question)
  process.stdin.setEncoding('utf8')
  process.stdin.once('data', answer => {
    process.stdin.pause()
    resolveAnswer(/^\s*y(es)?\s*$/i.test(answer))
  })
})
const readPid = () => {
  try {
    return Number(readFileSync(PID_FILE, 'utf8'))
  } catch {
    return 0
  }
}
/** This number is Markback's own server, still running: not a number the system has since given to something else. */
const SERVER = join(dirname(fileURLToPath(import.meta.url)), 'server.mjs')
const ourServer = pid => {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    // Windows has no ps to ask: there a live number is taken as the server, as before.
    if (process.platform === 'win32') return true
    return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).includes(SERVER)
  } catch {
    // Gone, not ours, or no way to tell: never trusted, never signalled.
    return false
  }
}
/** Runs the server on its own, so it outlasts this command. Nothing leaves this computer. */
async function start() {
  const port = Number(flags.port || PORT)
  if (await up(port)) {
    if (flags.port) rememberPort(port)
    return console.log(`Already running: http://localhost:${port}`)
  }
  // A sandbox can stop this command reaching the page while the page runs. Its process still says so.
  if (ourServer(readPid()) && !flags.port) return console.log(`Already running: http://localhost:${port}`)
  mkdirSync(HOME, { recursive: true })
  const child = spawn(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'server.mjs')], { detached: true, stdio: 'ignore', env: { ...process.env, REVIEW_PORT: String(port) } })
  child.unref()
  for (let i = 0; i < 50; i++) {
    if (await up(port)) {
      // Only a server that answered is ours to stop later.
      writeFileSync(PID_FILE, String(child.pid))
      rememberPort(port)
      return console.log(`Open http://localhost:${port}\nYour screens and answers stay on this computer, in ${HOME}`)
    }
    if (child.exitCode !== null) break
    await sleep(100)
  }
  fail(`It did not start. Port ${port} may be taken, or the page may already run there where this command cannot see it. Pushing works without the page: try review push, or review start --port ${port + 1}`)
}

async function stop() {
  if (!existsSync(PID_FILE)) return console.log('It is not running from here.')
  const pid = readPid()
  if (ourServer(pid)) {
    process.kill(pid)
    console.log('Stopped.')
  } else console.log('It was not running.')
  rmSync(PID_FILE, { force: true })
}

if (command === 'push') {
  // A word list that is not right is refused in one line, before anything is queued.
  const words = typeof flags.words === 'string' ? flags.words : flags.words ? fail('--words takes the path of a word list.') : ''
  try {
    if (words) readWords(words, existsSync(need('after')) ? flags.after : '')
  } catch (error) {
    fail(error.message)
  }
  const entry = push({ app: need('app'), screen: need('screen'), mode: flags.mode || '', after: need('after'), before: flags.before || '', note: flags.note || '', check: flags.check ?? [], kind: flags.kind || 'qa', item: typeof flags.item === 'string' ? flags.item : '', from: typeof flags.from === 'string' ? flags.from : 'Claude', words })
  if (entry.item) pushedFor(entry.item, entry.app, entry.from, entry.kind)
  const all = listScreens(entry.appSlug)
  // Long words go unread, and they cost time before anyone can act.
  if ([entry.note, ...(entry.check ?? [])].some(words => words.trim().split(/\s+/).length > 10)) console.error('Too long: say what to look at in ten words or fewer. Only the first sentence shows; the rest waits behind More.')
  console.log(`Queued ${entry.app} / ${entry.screen}${entry.mode ? ` (${entry.mode})` : ''}, round ${entry.round}: ${all.length} screen${all.length === 1 ? '' : 's'} for ${entry.app}. Open http://localhost:${PORT}/#${entry.appSlug}${isSetAside(entry.appSlug) ? `\nThis review is set aside: it is not offered until the reviewer brings it back.` : ''}`)
  const open = (entry.asked ?? []).filter(a => a.state !== 'fixed').length
  // The agent should know the page will ask about these, and that `read` says which still stand.
  if (open) console.log(`${open} earlier mark${open === 1 ? '' : 's'} on this screen ${open === 1 ? 'comes' : 'come'} along as checks: the reviewer ticks each fixed or says it still stands, and review read says which.`)
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
    if (Date.now() > deadline) {
      // Some screens answered and some not: say so, and that nothing is lost. The next run gives every answer together.
      const screens = listScreens(slug(app))
      const left = screens.filter(s => s.status === 'waiting').length
      fail(flags.all && left && left < screens.length ? `Not everything was answered before the timeout: ${left} of ${screens.length} screens of ${app} still wait${left === 1 ? 's' : ''}. ${aside ? 'It is set aside, so no more will come until the reviewer brings it back.' : 'Run this again to keep waiting. It gives every answer when the last one comes.'}` : `No feedback for ${app} before the timeout.${aside ? ' It is set aside, not answered.' : ' Run this again to keep waiting.'}`)
    }
    await sleep(2000)
  }
} else if (command === 'project') {
  await start()
  // Where Codex and Cursor look in a project. Without this computer's paths: the folder may be committed.
  const agentSkills = join(process.cwd(), '.agents', 'skills')
  const fresh = !existsSync(join(agentSkills, 'markback'))
  try {
    installSkills({ to: agentSkills, root: null })
    if (fresh) console.log("Put Markback's skills in .agents/skills, where Codex and other agents find them.")
  } catch (error) {
    if (!['EACCES', 'EPERM', 'EROFS'].includes(error.code)) throw error
    console.warn('Project skill files are read-only in this session. Continuing to the review.')
  }
  const found = await findApp(process.cwd())
  let url = found.running
  if (!url && found.run) {
    let yes = !!flags.yes
    if (!yes && process.stdin.isTTY) yes = await askYes(`Your app runs with ${found.run.command}. ${found.run.port ? 'It is not running.' : 'I can\'t tell whether it is running.'} Start it? [y/N] `)
    if (!yes) {
      console.log(found.run.port ? `Your app runs with ${found.run.command}, and it is not running. Start it yourself, or run this again with --yes to have it started.` : `Your app runs with ${found.run.command}. Its script names no port, so I can't tell whether it is running. Run this again with --yes to start it, and I'll find it where it says it is.`)
      process.exit(2)
    }
    try {
      const started = await startApp(process.cwd(), found.run)
      console.log(`Started on ${started.url} (what it says goes to ${started.log})`)
      url = started.url
    } catch (error) {
      fail(error.message)
    }
  }
  url ??= found.file
  if (!url) {
    console.log('There is no app in this folder yet. Say what you want to your agent, for example: /markback a recipe box for my family')
    process.exit(3)
  }
  let taken
  try {
    taken = await shootScreens(url, found.name)
  } catch (error) {
    fail(error.message)
  }
  console.log(`Took ${taken.length} screen${taken.length === 1 ? '' : 's'} of ${found.name}: ${taken.map(s => s.screen.replace(/^\d+ /, '')).join(', ')}`)
  const page = `http://localhost:${Number(flags.port || PORT)}/#${taken[0].appSlug}`
  const opened = !flags['no-open'] && (await openPage(page))
  console.log(opened ? "I've opened them in your browser. Draw on what you want changed, then press Send." : `Open ${page} to draw on them.`)
  if (opened) console.log(`(The page is ${page} if you need it.)`)
} else if (command === 'open') {
  const page = `http://localhost:${PORT}/${typeof flags.app === 'string' ? `#${slug(flags.app)}` : ''}`
  if (!(await up(PORT))) fail('The review page is not running. Start it with: review start')
  console.log((await openPage(page)) ? `I've opened it in your browser. (${page})` : `Open ${page}`)
} else if (command === 'install-skills') {
  // --codex: into this project, where Codex finds them, and without this computer's paths, since the folder may be committed.
  const to = flags.codex ? join(process.cwd(), '.agents', 'skills') : typeof flags.to === 'string' ? flags.to.replace(/^~(?=\/|$)/, homedir()) : join(homedir(), '.agents', 'skills')
  const project = typeof flags['agents-md'] === 'string' ? flags['agents-md'].replace(/^~(?=\/|$)/, homedir()) : null
  for (const path of installSkills({ to, agentsMdIn: project, pathInAgentsMd: !flags['no-path'], ...(flags.codex ? { root: null } : {}) })) console.log(`Wrote ${path}`)
  console.log(flags.codex ? 'Codex finds them in this project. Now ask Codex: review my app.' : 'Codex and Cursor read skills from ~/.agents/skills. Run this again after updating Markback.')
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
} else if (command === 'words-script') {
  // For a browser tool: run this in the page, and its value is the word list for review push --words.
  console.log(PAGE_SCRIPT)
} else if (command === 'demo') {
  pushSample()
  console.log(`A sample is waiting. Open http://localhost:${PORT}/#sample`)
} else if (command === 'see') {
  try {
    // The address is the first word that is not a flag: --fetch-browser may come before it.
    const address = rest.find((word, i) => !word.startsWith('--') && (i === 0 || rest[i - 1] === '--fetch-browser' || !rest[i - 1].startsWith('--')))
    const shown = await showApp(address ?? flags.url, { app: typeof flags.app === 'string' ? flags.app : '', screen: typeof flags.screen === 'string' ? flags.screen : 'First look', files: true, kind: flags.kind || 'qa' })
    console.log(`It is ready to mark. Open http://localhost:${PORT}/#${shown.appSlug}`)
  } catch (error) {
    fail(error.message)
  }
} else if (command === 'pdf') {
  try {
    // The file is the word that is not a flag or a flag's value, wherever it comes.
    const file = rest.find((word, i) => !word.startsWith('--') && !(i > 0 && rest[i - 1].startsWith('--')))
    const shown = await showPdf(file ?? '', { app: typeof flags.app === 'string' ? flags.app : '', pages: flags.pages, note: typeof flags.note === 'string' ? flags.note : '', check: flags.check ?? [], kind: flags.kind || 'qa', item: typeof flags.item === 'string' ? flags.item : '', from: typeof flags.from === 'string' ? flags.from : 'Claude' })
    const entry = shown.entries[0]
    if (entry.item) pushedFor(entry.item, entry.app, entry.from, entry.kind)
    const many = shown.entries.length
    if ([entry.note, ...(entry.check ?? [])].some(words => words.trim().split(/\s+/).length > 10)) console.error('Too long: say what to look at in ten words or fewer. Only the first sentence shows; the rest waits behind More.')
    console.log(`Queued ${shown.name}, ${many === 1 ? `page ${shown.first}` : `pages ${shown.first} to ${shown.last}`}${shown.total ? ` of ${shown.total}` : ''}. Open http://localhost:${PORT}/#${entry.appSlug}${shown.more ? `\nThere are more pages. Ask for them by number: --pages ${shown.last + 1}-${shown.last + many}` : ''}`)
  } catch (error) {
    fail(error.message)
  }
} else if (command === 'check') {
  // Each line is said as its check ends, so a slow one is seen to be working.
  const { results, code } = await runChecks({ each: flags.json ? undefined : result => console.log(sayResult(result)) })
  console.log(flags.json ? JSON.stringify(results, null, 2) : sayVerdict(results))
  if (code) process.exit(code)
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
} else if (command === 'plugin') {
  const what = rest[0]
  if (what === 'list') {
    const all = listPlugins()
    console.log(all.length ? all.map(p => `${p.name} ${p.version}: ${p.description}\n  ${addsWords(p)}`).join('\n') : 'No plugins. Add one with: review plugin add <folder or git address>')
  } else if (what === 'remove') {
    if (!rest[1] || rest[1].startsWith('--')) fail('Say which: review plugin remove <name>')
    try {
      removePlugin(rest[1])
      console.log(`Removed ${rest[1]}.`)
    } catch (error) {
      fail(error.message)
    }
  } else if (what === 'add' && rest[1] && !rest[1].startsWith('--')) {
    // What happened is decided first and said after the fetched copy is cleaned up: an exit would skip a finally.
    let source
    let outcome
    try {
      source = fetchSource(rest[1])
      const found = pluginsIn(source.dir)
      const have = listPlugins()
      for (const p of found) for (const name of Object.keys(p.exports)) {
        const other = [...have.filter(h => !found.some(f => f.name === h.name)), ...found].find(h => h.name !== p.name && h.exports[name])
        if (other) throw new Error(`${other.name} already adds an export called ${name}. Remove it first, or keep this one out.`)
      }
      console.log('Plugins run code on your computer. Add only ones you trust.')
      for (const p of found) {
        const old = have.find(h => h.name === p.name)
        console.log(`${p.name} ${p.version} adds: ${addsWords(p)}${old ? ` It replaces the ${p.name}${old.version ? ` ${old.version}` : ''} you have.` : ''}`)
      }
      const yes = flags.yes || (process.stdin.isTTY && (await askYes(`Add ${found.length === 1 ? 'it' : `these ${found.length}`}? [y/N] `)))
      if (yes) {
        addPlugins(found)
        outcome = { words: `Added ${found.map(p => p.name).join(', ')}.` }
      } else outcome = { words: process.stdin.isTTY ? 'Nothing added.' : 'Nothing added. Run it again with --yes once you have looked at what it adds.', code: 2 }
    } catch (error) {
      outcome = { problem: error.message }
    } finally {
      source?.done()
    }
    if (outcome.problem) fail(outcome.problem)
    console.log(outcome.words)
    if (outcome.code) process.exit(outcome.code)
  } else fail('review plugin add <folder or git address> | plugin list | plugin remove <name>')
} else if (command === 'export') {
  try {
    const answers = latestPerScreen(readInbox(need('app')))
    if (!answers.length) fail(`No answers yet for ${flags.app}.`)
    const text = await runExport(need('as'), answers, { app: flags.app, home: HOME })
    if (typeof flags.out === 'string') {
      writeFileSync(flags.out, text)
      console.log(`Wrote ${flags.out}`)
    } else process.stdout.write(text.endsWith('\n') ? text : `${text}\n`)
  } catch (error) {
    fail(error.message)
  }
} else if (command && listPlugins().some(p => p.name === command)) {
  try {
    // The words after the command, without the --flags and their values, which come as flags.
    const words = rest.filter((w, i) => !w.startsWith('--') && !(i > 0 && rest[i - 1].startsWith('--') && rest[i - 1].slice(2) in flags && flags[rest[i - 1].slice(2)] !== true))
    await runCommand(command, words[0] ?? null, { args: words, flags, home: HOME, read: readInbox, push })
  } catch (error) {
    fail(error.message)
  }
} else {
  console.log(`review start | stop | check | see | pdf | demo | sketch | push | list | wait | read | clear | ideas | queue | take | show | note | stage | project | open | install-skills | plugin | export   (files under ${HOME}${existsSync(INBOX) ? `, ${readdirSync(INBOX).length} apps with feedback` : ''})`)
  if (command) process.exit(1)
}
