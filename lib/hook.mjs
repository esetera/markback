/**
 * For Claude Code's hooks (hooks/hooks.json runs `review work --hook`). Claude Code gives the hook's input as JSON on stdin.
 *
 *   Stop          work waits for this project: the stop is blocked, with what to do. Nothing waits, and no `review work wait`
 *                 runs for this project: blocked once, to start one. So a session never goes idle with nobody listening.
 *   SessionStart  says, as context, what waits and to keep `review work wait` running.
 *
 * Does this project use Markback? Yes when its folder, or its repository's root, has run `review project`, `review push`
 * or `review wake set` (noted in <home>/work/projects.json), or holds `.agents/skills/markback`. A folder above one that
 * did never counts. Only work that names this project's reviews is its own; a project with no reviews yet has none. In any
 * other case the hook prints nothing and ends at once: when in doubt, the agent may stop. MARKBACK_HOOKS=off turns it off
 * everywhere. A stop is never held while the review page's server does not run: nobody can approve anything then, and a
 * session must not be held for a page that is closed.
 *
 * It is quick: it reads a few small files, and asks no server over the network. With the plugin's hooks and the same hooks
 * in a settings file both in place, Claude Code runs both at once with the same input: only the first one answers.
 *
 * It cannot loop. It never blocks twice in a row for the same reason: what it last blocked for is kept for each session,
 * and the same reason within ten minutes is let through. A stop that already continues from a stop hook (`stop_hook_active`)
 * is held again only for new work, as when the agent took the top item and the next one waits, and never more than
 * MAX_CHAIN times in a row. When the queue is empty, it holds once to start a wait, then lets the agent stop.
 */

import { createHash } from 'node:crypto'
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { slug, writeAtomic } from './store.mjs'
import { WORK, readJson } from './work.mjs'
import { listeners, projectOf, serverRunning, waitingWork } from './listen.mjs'

const BLOCKED = join(WORK, 'hooks')
const AGAIN_MS = 10 * 60 * 1000
export const MAX_CHAIN = 10
const WAIT = 'review work wait --by "Claude"'

/** What waits, in one short line. */
function summary(found) {
  const parts = []
  if (found.queue.length) parts.push(`${found.queue.length} item${found.queue.length === 1 ? '' : 's'} in the queue nobody has taken (top: "${found.queue[0].title}", ${found.queue[0].marksBack ? 'marks came back' : found.queue[0].phase === 'build' ? 'approved: build it' : 'develop the proposal'})`)
  if (found.ideas.length) parts.push(`${found.ideas.length} request${found.ideas.length === 1 ? '' : 's'} for ideas`)
  if (found.answers.length) parts.push(`answers nobody has read on ${found.answers.map(a => a.app).join(', ')}`)
  return `${parts.join('; ')}.`
}

/** What to print for one hook input: JSON for a blocked stop, plain words for a session's start, or nothing. */
export function hookAnswer(input, { now = Date.now(), off = process.env.MARKBACK_HOOKS === 'off', running = serverRunning } = {}) {
  if (off || !input || typeof input.cwd !== 'string') return ''
  const project = projectOf(input.cwd)
  if (!project?.apps.length) return ''
  const found = waitingWork({ only: project.apps })
  if (input.hook_event_name === 'SessionStart') {
    return `Markback is in use in this project. ${found.count ? `Work waits for an agent: ${summary(found)} Run \`review work\` and do what it says.` : 'Nothing waits for an agent now.'} Keep \`${WAIT}\` running in the background while you work here. When it ends, do what it prints (take approved items and build them, read marks and act on them), then start it again.\n`
  }
  if (input.hook_event_name !== 'Stop' || !running(now)) return ''
  const listening = listeners(now).some(a => a.what === 'work' && !a.told && !!a.in && projectOf(a.in)?.folder === project.folder) || (input.background_tasks ?? []).some(t => /\bwork\s+wait\b/.test(String(t?.command ?? '')))
  const key = found.count ? `work ${[...found.queue.map(i => `${i.id}:${i.phase}:${i.round}`), ...found.ideas.map(r => r.id), ...found.answers.map(a => `${a.app}:${a.screens}`)].join(' ')}` : listening ? '' : 'listen'
  if (!key) return ''
  const file = join(BLOCKED, `${slug(input.session_id ?? 'session')}.json`)
  const last = readJson(file)
  if (last?.key === key && now - last.at < AGAIN_MS) return ''
  // Held again and again, the chain ends: each link needs new work, and there are only so many links.
  const chain = input.stop_hook_active ? (last?.chain ?? 0) + 1 : 0
  if (chain >= MAX_CHAIN) return ''
  mkdirSync(BLOCKED, { recursive: true })
  // Sessions end and leave their file: a day is long enough to keep one.
  for (const f of readdirSync(BLOCKED)) {
    try {
      if (now - statSync(join(BLOCKED, f)).mtimeMs > 24 * 3600 * 1000) rmSync(join(BLOCKED, f), { force: true })
    } catch {
      // Gone already.
    }
  }
  writeAtomic(file, JSON.stringify({ key, at: now, chain }))
  const reason = found.count
    ? `Markback: work waits for an agent in this project: ${summary(found)} Run \`review work\` and do what it says: take ${found.queue.length ? `the top item with \`review take --item ${found.queue[0].id} --by "Claude"\`` : 'each item it names'}, build it and push the screens; read new marks and act on them. An approved proposal is an instruction to build: do not ask first. When you finish, start \`${WAIT}\` in the background, then stop.`
    : `Markback: nothing waits now, but no agent listens for this project. Before you stop, start \`${WAIT}\` in the background and do not wait for it. It wakes you when the person approves something or sends marks.`
  return `${JSON.stringify({ decision: 'block', reason })}\n`
}

const ONCE = join(BLOCKED, 'once')
const ONCE_MS = 5000

/**
 * True for the first hook to get this exact input, false for a second copy run at the same moment (the plugin's hook and
 * the same hook in a settings file). A file made only if none is there decides it, so two at once cannot both win.
 */
export function firstFor(text, now = Date.now()) {
  mkdirSync(ONCE, { recursive: true })
  const file = join(ONCE, createHash('sha256').update(text).digest('hex').slice(0, 24))
  for (let tries = 0; tries < 2; tries++) {
    try {
      closeSync(openSync(file, 'wx'))
      // Old marks go, so the folder stays small.
      for (const f of readdirSync(ONCE)) {
        try {
          if (now - statSync(join(ONCE, f)).mtimeMs > 60_000) rmSync(join(ONCE, f), { force: true })
        } catch {
          // Gone already.
        }
      }
      return true
    } catch (error) {
      if (error.code !== 'EEXIST') return true
      try {
        if (now - statSync(file).mtimeMs < ONCE_MS) return false
        rmSync(file, { force: true })
      } catch {
        // Taken by the other copy between the two looks: try once more.
      }
    }
  }
  return false
}

/** The command: reads the hook's input, prints the answer. Anything wrong is silence: a hook must never break a session. */
export function sayHook() {
  try {
    const text = readFileSync(0, 'utf8')
    const input = JSON.parse(text)
    if (!firstFor(text)) return
    process.stdout.write(hookAnswer(input))
  } catch {
    // No input, or not a hook's: nothing to say.
  }
}

/* ---------- putting the hooks in, for Claude Code without the plugin ---------- */

export const HOOK_EVENTS = ['Stop', 'SessionStart']
/** One of ours, by what it runs: so a second install replaces it, and taking them out leaves the person's own alone. */
const ours = hook => /review(\.mjs"?|\s)\s*work --hook\b/.test(String(hook?.command ?? ''))

/** The program on the search path, or ''. */
export function onPath(name, path = process.env.PATH ?? '') {
  const ends = process.platform === 'win32' ? ['.cmd', '.exe', ''] : ['']
  for (const dir of path.split(delimiter).filter(Boolean)) {
    for (const end of ends) {
      try {
        if (statSync(join(dir, name + end)).isFile()) return join(dir, name + end)
      } catch {
        // Not here.
      }
    }
  }
  return ''
}

/**
 * What the hooks run. `review` when it is on the search path, so moving the Markback folder breaks nothing. Otherwise
 * review.mjs by its full path, which has to be installed again if the folder moves: there is no other name to find it by.
 */
export const hookCommand = (root, path = process.env.PATH ?? '') => (onPath('review', path) ? 'review work --hook' : `node "${join(root, 'review.mjs')}" work --hook`)

/** The real file behind a settings path, through any symlink, even one whose file is not made yet. */
function realFile(path) {
  try {
    return realpathSync(path)
  } catch {
    try {
      if (lstatSync(path).isSymbolicLink()) return resolve(dirname(path), readlinkSync(path))
    } catch {
      // Nothing there yet.
    }
    return path
  }
}

/**
 * Writes through a symlink to the real file, and keeps the file's mode: a settings file kept private stays private. A new
 * file is written whole beside the real one first and then put in its place, so a crash never leaves half a file.
 */
function writeKeeping(path, text) {
  const real = realFile(path)
  let mode = 0o644
  try {
    mode = statSync(real).mode & 0o777
  } catch {
    // A new file: the usual mode.
  }
  mkdirSync(dirname(real), { recursive: true })
  const temp = `${real}.${process.pid}.tmp`
  writeFileSync(temp, text, { mode })
  chmodSync(temp, mode)
  renameSync(temp, real)
}

function readSettings(settingsPath) {
  if (!existsSync(settingsPath)) return {}
  let settings
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
  } catch {
    throw new Error(`${settingsPath} is not JSON, so it was left alone. Mend it, then run this again.`)
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error(`${settingsPath} is not a settings file, so it was left alone.`)
  return settings
}

/** The settings with every hook of ours taken out, and any group or event left empty by that removed. */
function withoutOurs(settings) {
  const hooks = settings.hooks && typeof settings.hooks === 'object' && !Array.isArray(settings.hooks) ? { ...settings.hooks } : {}
  for (const event of HOOK_EVENTS) {
    if (!Array.isArray(hooks[event])) continue
    hooks[event] = hooks[event].map(group => (Array.isArray(group?.hooks) ? { ...group, hooks: group.hooks.filter(h => !ours(h)) } : group)).filter(group => !Array.isArray(group?.hooks) || group.hooks.length)
    if (!hooks[event].length) delete hooks[event]
  }
  return { ...settings, hooks }
}

/**
 * Puts the two hooks into a Claude Code settings file (a project's .claude/settings.json, or the person's own), for use
 * without the plugin, which has them already. Everything else in the file is kept, and an older copy of ours is replaced.
 * A file that is not JSON is never written over: it may be the person's work. Returns the command the hooks run.
 */
export function installHooks(settingsPath, root, path = process.env.PATH ?? '') {
  const settings = withoutOurs(readSettings(settingsPath))
  const command = hookCommand(root, path)
  for (const event of HOOK_EVENTS) settings.hooks[event] = [...(settings.hooks[event] ?? []), { hooks: [{ type: 'command', command, timeout: 10 }] }]
  writeKeeping(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
  return command
}

/** Takes Markback's hooks out of a settings file, and only those. Returns whether there were any. */
export function removeHooks(settingsPath) {
  if (!existsSync(settingsPath)) return false
  const before = readSettings(settingsPath)
  const after = withoutOurs(before)
  if (JSON.stringify(after.hooks) === JSON.stringify(before.hooks ?? {})) return false
  if (!Object.keys(after.hooks).length) delete after.hooks
  writeKeeping(settingsPath, `${JSON.stringify(after, null, 2)}\n`)
  return true
}
