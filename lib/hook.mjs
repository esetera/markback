/**
 * For Claude Code's hooks (hooks/hooks.json runs `review work --hook`). Claude Code gives the hook's input as JSON on stdin.
 *
 *   Stop          work waits for this project: the stop is blocked, with what to do. Nothing waits, and no `review work wait`
 *                 runs for this project: blocked once, to start one. So a session never goes idle with nobody listening.
 *   SessionStart  says, as context, what waits and to keep `review work wait` running.
 *
 * Does this project use Markback? Yes when its folder, or one above it, has run `review project`, `review push` or
 * `review wake set` (noted in <home>/work/projects.json), or holds `.agents/skills/markback`. In any other project the hook
 * prints nothing and ends at once. MARKBACK_HOOKS=off turns it off everywhere. A stop is never held while the review page's
 * server does not run: nobody can approve anything then, and a session must not be held for a page that is closed.
 *
 * It is quick: it reads a few small files, and asks no server over the network.
 *
 * It cannot loop. It never blocks twice in a row for the same reason: what it last blocked for is kept for each session,
 * and the same reason within ten minutes is let through. A stop that already continues from a stop hook (`stop_hook_active`)
 * is held again only for new work, as when the agent took the top item and the next one waits, and never more than
 * MAX_CHAIN times in a row. When the queue is empty, it holds once to start a wait, then lets the agent stop.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
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
  if (!project) return ''
  const found = waitingWork({ only: project.apps })
  if (input.hook_event_name === 'SessionStart') {
    return `Markback is in use in this project. ${found.count ? `Work waits for an agent: ${summary(found)} Run \`review work\` and do what it says.` : 'Nothing waits for an agent now.'} Keep \`${WAIT}\` running in the background while you work here. When it ends, do what it prints (take approved items and build them, read marks and act on them), then start it again.\n`
  }
  if (input.hook_event_name !== 'Stop' || !running(now)) return ''
  const inside = dir => !!dir && (resolve(dir) === project.folder || resolve(dir).startsWith(project.folder + sep))
  const listening = listeners(now).some(a => a.what === 'work' && !a.told && inside(a.in)) || (input.background_tasks ?? []).some(t => /\bwork\s+wait\b/.test(String(t?.command ?? '')))
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
    ? `Markback: work waits for an agent in this project: ${summary(found)} Run \`review work\` and do what it says: take the top item with \`review take --by "Claude"\`, build it and push the screens; read new marks and act on them. An approved proposal is an instruction to build: do not ask first. When you finish, start \`${WAIT}\` in the background, then stop.`
    : `Markback: nothing waits now, but no agent listens for this project. Before you stop, start \`${WAIT}\` in the background and do not wait for it. It wakes you when the person approves something or sends marks.`
  return `${JSON.stringify({ decision: 'block', reason })}\n`
}

/** The command: reads the hook's input, prints the answer. Anything wrong is silence: a hook must never break a session. */
export function sayHook() {
  try {
    process.stdout.write(hookAnswer(JSON.parse(readFileSync(0, 'utf8'))))
  } catch {
    // No input, or not a hook's: nothing to say.
  }
}

/* ---------- putting the hooks in, for Claude Code without the plugin ---------- */

export const HOOK_EVENTS = ['Stop', 'SessionStart']
/** One of ours, by what it runs: so a second install replaces it and leaves the person's own hooks alone. */
const ours = hook => /review(\.mjs"?|\s)\s*work --hook\b/.test(String(hook?.command ?? ''))

/**
 * Puts the two hooks into a Claude Code settings file (a project's .claude/settings.json, or the person's own), for use
 * without the plugin, which has them already. `root` is the folder that holds review.mjs. Everything else in the file is
 * kept, and an older copy of ours is replaced. A file that is not JSON is never written over: it may be the person's work.
 */
export function installHooks(settingsPath, root) {
  let settings = {}
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
    } catch {
      throw new Error(`${settingsPath} is not JSON, so it was left alone. Mend it, then run this again.`)
    }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error(`${settingsPath} is not a settings file, so it was left alone.`)
  }
  const command = `node "${join(root, 'review.mjs')}" work --hook`
  settings.hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {}
  for (const event of HOOK_EVENTS) {
    const kept = (Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [])
      .map(group => ({ ...group, hooks: (group?.hooks ?? []).filter(h => !ours(h)) }))
      .filter(group => group.hooks.length)
    settings.hooks[event] = [...kept, { hooks: [{ type: 'command', command, timeout: 10 }] }]
  }
  mkdirSync(dirname(settingsPath), { recursive: true })
  writeAtomic(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
  return command
}
