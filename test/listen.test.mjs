import './own-home.mjs'
import { folderKey } from '../lib/home.mjs'
/**
 * Approved work must not wait unseen: agents say when they listen, `review work` says all that waits for one, the server wakes
 * an agent when none listens, and Claude Code's hooks keep a session from going idle. All on a store of its own.
 */
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { writePicture } from './helpers.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = join(ROOT, 'review.mjs')
// The person's own store, in this test file's own home folder (see own-home.mjs): what it holds is theirs.
const home = join(realpathSync(process.env.HOME), '.review-wizard')
mkdirSync(home, { recursive: true })
process.env.REVIEW_HOME = home
const children = []
after(() => {
  for (const child of children) child.kill()
  rmSync(noPath, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})
const { answered, askForIdeas, closeRequest, decide, listWork, openRequests, postIdea, pushedFor, setStage, take } = await import('../lib/work.mjs')
const { clearApp, listApps, push, receive } = await import('../lib/store.mjs')
const { GONE_MS, TOLD_MS, hears, listeners, madeBy, noteProject, projectOf, rootOf, standing, unread, waitingWork } = await import('../lib/listen.mjs')
const { LONGEST_MS, argvOf, processStart, clearWake, cmdQuote, createWaker, launchOf, listWakes, promptFor, readWake, setWake, switchDesktopWake, switchWake, wakeSummary } = await import('../lib/wake.mjs')
const { QUEUE_LINE, MARKS_LINE, agentsWords, howWords, signOf, signShows, unheardWords, waited } = await import('../public/listen.js')

const picture = join(home, 'p.png')
writePicture(picture, 40, 30)
const env = { ...process.env, REVIEW_HOME: home }
const cli = (...args) => execFileSync('node', [CLI, ...args], { env, encoding: 'utf8' })
/** The command, run in a folder: a project's own commands see only that project. */
const cliIn = (cwd, ...args) => execFileSync('node', [CLI, ...args], { env, encoding: 'utf8', cwd })
/** The command with its exit code and both of what it printed. */
const run = (args, options = {}) => spawnSync('node', [CLI, ...args], { env, encoding: 'utf8', ...options })
const until = async (get, words = 'It did not come.') => {
  for (let i = 0; i < 200; i++) {
    const got = get()
    if (got) return got
    await new Promise(r => setTimeout(r, 50))
  }
  throw new Error(words)
}
const LISTENING = join(home, 'work', 'listening')
/** A waiting command's file, written by hand: an agent that listens, or one that has gone. */
const fakeListener = (name, fields, ageMs = 0) => {
  mkdirSync(LISTENING, { recursive: true })
  const at = new Date(Date.now() - ageMs).toISOString()
  writeFileSync(join(LISTENING, `${name}.json`), JSON.stringify({ by: 'Claude', what: 'work', app: '', in: '', pid: 1, started: at, beat: at, ...fields }))
  return () => rmSync(join(LISTENING, `${name}.json`), { force: true })
}
const queuedIdea = (target, what) => {
  const asked = askForIdeas({ target, count: 1 })
  const item = postIdea({ request: asked.id, what, why: 'Because', size: 'S' })
  decide(item.id, 'yes')
  return item
}
/** Nothing waits for an agent any more: the next test starts clean. */
const settle = () => {
  for (const item of listWork().filter(i => i.stage === 'queued')) setStage(item.id, 'done')
  for (const asked of openRequests()) closeRequest(asked.id)
  for (const a of listApps()) clearApp(a.name)
  for (const f of existsSync(LISTENING) ? readdirSync(LISTENING) : []) rmSync(join(LISTENING, f), { force: true })
}

test('with nothing to do, review work says so, and work wait ends at its timeout with 1 and how to go on', () => {
  assert.deepEqual(unread(), [], 'the first look: nothing was answered before')
  assert.match(cli('work'), /Nothing is waiting for an agent\./)
  const waited = run(['work', 'wait', '--timeout', '0.3', '--by', 'Claude'])
  assert.equal(waited.status, 1)
  assert.match(waited.stderr, /Nothing was waiting for an agent before the timeout\. Run this again to keep waiting\./)
  assert.deepEqual(listeners(), [], 'a wait that ended at its timeout leaves no sign of listening')
})

test('a wait says it listens while it runs: who, what for, last beat; stopped, its file goes with it', async () => {
  const child = spawn('node', [CLI, 'work', 'wait', '--by', 'Claude', '--timeout', '60'], { env, stdio: 'ignore' })
  children.push(child)
  const [agent] = await until(() => (listeners().length ? listeners() : null))
  assert.deepEqual([agent.by, agent.what, agent.told], ['Claude', 'work', undefined])
  const file = JSON.parse(readFileSync(join(LISTENING, readdirSync(LISTENING).find(f => f.endsWith('.json'))), 'utf8'))
  assert.ok(file.started && file.beat && file.pid === child.pid, 'one file for the command: started, last beat, which process')
  const first = file.beat
  await until(() => JSON.parse(readFileSync(join(LISTENING, readdirSync(LISTENING)[0]), 'utf8')).beat > first, 'the beat is said again every few seconds')
  const ended = new Promise(resolve => child.once('exit', resolve))
  child.kill('SIGTERM')
  await ended
  assert.deepEqual(readdirSync(LISTENING), [], 'stopped: nothing is left that says it listens')
  // review wait on one app and review ideas wait say so too, with the app.
  const onApp = spawn('node', [CLI, 'wait', '--app', 'Some app', '--by', 'Codex'], { env, stdio: 'ignore' })
  const onIdeas = spawn('node', [CLI, 'ideas', 'wait'], { env, stdio: 'ignore' })
  children.push(onApp, onIdeas)
  const both = await until(() => (listeners().length === 2 ? listeners() : null))
  assert.deepEqual(both.map(a => [a.by, a.what, a.app]).sort(), [['Codex', 'wait', 'Some app'], ['an agent', 'ideas', '']])
  onApp.kill('SIGINT')
  onIdeas.kill()
  await until(() => !readdirSync(LISTENING).length)
})

test('a beat older than 15 seconds counts as gone, and whoever reads removes the stale file', () => {
  fakeListener('fresh', { by: 'Fresh' }, GONE_MS - 5000)
  fakeListener('stale', { by: 'Stale' }, GONE_MS + 1000)
  fakeListener('told', { by: 'Told', told: new Date(Date.now() - 60000).toISOString() }, 70000)
  fakeListener('told-long-ago', { by: 'Old', told: new Date(Date.now() - TOLD_MS - 1000).toISOString() }, TOLD_MS + 5000)
  writeFileSync(join(LISTENING, 'broken.json'), '{ not json')
  assert.deepEqual(listeners().map(a => a.by).sort(), ['Fresh', 'Told'], 'one just handed work still counts for a few minutes')
  assert.deepEqual(readdirSync(LISTENING).sort(), ['broken.json', 'fresh.json', 'told.json'], 'the stale ones are removed; one being written is left alone')
  settle()
})

test('review work, case 1: an item in the queue that nobody has taken, top first, with the exact next command', async () => {
  const first = queuedIdea('Reader', 'Sort the list')
  const second = queuedIdea('Reader', 'Bigger type')
  const out = cli('work', '--by', 'Claude')
  assert.match(out, /Queue: 2 items nobody has taken/)
  assert.ok(out.indexOf('1. Sort the list') < out.indexOf('2. Bigger type'), 'top first')
  assert.match(out, /Next: review take --by "Claude"/)
  assert.match(out, /An approved proposal is an instruction to build/)
  assert.deepEqual(JSON.parse(cli('work', '--json')).queue.map(i => i.id), [first.id, second.id])
  const waited = run(['work', 'wait', '--by', 'Claude', '--timeout', '5'])
  assert.equal(waited.status, 0, 'something to do: it ends at once with 0')
  assert.match(waited.stdout, /review take --by "Claude"/)
  assert.deepEqual(listeners().map(a => [a.by, !!a.told]), [['Claude', true]], 'handed work: it counts as hearing while it starts on it')
  // Taken: no longer waiting for an agent.
  take({ by: 'Claude' })
  take({ by: 'Claude' })
  assert.match(cli('work'), /Nothing is waiting/)
  settle()
})

test('review work, case 2: an open request for ideas', () => {
  const asked = askForIdeas({ target: 'The reader', count: 3 })
  const out = cli('work')
  assert.match(out, new RegExp(`${asked.id}: 3 ideas for The reader`))
  assert.match(out, new RegExp(`review ideas post --request ${asked.id}`))
  assert.equal(run(['work', 'wait', '--timeout', '5']).status, 0)
  closeRequest(asked.id)
  assert.match(cli('work'), /Nothing is waiting/)
  settle()
})

test('review work, case 3: answers nobody has read, until a read or a wait prints them', async () => {
  const one = push({ app: 'Answers', screen: 'One', after: picture })
  const two = push({ app: 'Answers', screen: 'Two', after: picture })
  assert.match(cli('work'), /Nothing is waiting/, 'pushed and not answered: nothing for an agent yet')
  receive({ appSlug: one.appSlug, id: one.id, png: null, shapes: [], notes: 'Move it up', verdict: 'changes', imageSize: null })
  receive({ appSlug: two.appSlug, id: two.id, png: null, shapes: [], notes: '', verdict: 'approved', imageSize: null })
  const out = cli('work')
  assert.match(out, /Answers: 2 screens, 1 asks for changes/)
  assert.match(out, /Next: review read --app "Answers" --latest/)
  // A review wait on that app is being given them now: they are not said to another agent.
  const gone = fakeListener('on-app', { what: 'wait', app: 'Answers' })
  assert.deepEqual(waitingWork().answers, [])
  gone()
  assert.equal(run(['work', 'wait', '--timeout', '5']).status, 0)
  assert.match(cli('read', '--app', 'Answers', '--latest'), /Move it up/)
  assert.match(cli('work'), /Nothing is waiting/, 'read: delivered')
  // More marks on a screen already read count again, and a review wait that prints them delivers them.
  const waiting = spawn('node', [CLI, 'wait', '--app', 'Answers'], { env, stdio: 'ignore' })
  children.push(waiting)
  await until(() => listeners().some(a => a.what === 'wait'))
  receive({ appSlug: one.appSlug, id: one.id, png: null, shapes: [], notes: 'And wider', verdict: 'changes', imageSize: null })
  await new Promise(resolve => waiting.once('exit', resolve))
  assert.deepEqual(unread(), [], 'the wait printed it')
  settle()
})

test('who hears what: work wait hears all, wait hears its own app, ideas wait hears only requests', () => {
  const agent = (what, app = '') => [{ by: 'A', what, app }]
  assert.equal(hears(agent('work'), 'queue'), true)
  assert.equal(hears(agent('wait', 'My app'), 'queue', 'My app'), true)
  assert.equal(hears(agent('wait', 'Other'), 'queue', 'My app'), false)
  assert.equal(hears(agent('ideas'), 'queue', 'My app'), false, 'the fault: an agent waiting for ideas does not hear the queue')
  assert.equal(hears(agent('ideas'), 'ideas'), true)
  assert.equal(hears([], 'queue'), false)
})

test('a proposal approved makes work to build, and the server can tell whether an agent will hear it', () => {
  const item = queuedIdea('Flow', 'New look')
  take({ by: 'S', id: item.id })
  const shot = push({ app: 'Flow', screen: 'One', after: picture, kind: 'proposal', item: item.id })
  pushedFor(item.id, 'Flow', 'S', 'proposal')
  const record = receive({ appSlug: shot.appSlug, id: shot.id, png: null, shapes: [], notes: '', verdict: 'approved', imageSize: null })
  const made = madeBy(record, 'ready', answered(record))
  assert.deepEqual(made, { what: 'build', title: 'New look', heard: false })
  const now = standing()
  assert.deepEqual([now.agents, now.unheard], [[], { queue: 1, ideas: 0, marks: 0 }])
  assert.ok(now.sig.includes(item.id), 'the waiting work has a name, to tell the same work from new work')
  const gone = fakeListener('ideas-only', { what: 'ideas' })
  assert.equal(standing().unheard.queue, 1, 'an agent that waits only for ideas does not count')
  gone()
  const heard = fakeListener('work', {})
  assert.deepEqual([standing().unheard.queue, standing().agents.map(a => a.by)], [0, ['Claude']])
  heard()
  // Plain screens: marks make work when the round is complete; a Looks good on its own makes none.
  const a = push({ app: 'Plain', screen: 'A', after: picture })
  const b = push({ app: 'Plain', screen: 'B', after: picture })
  const say = (e, verdict) => receive({ appSlug: e.appSlug, id: e.id, png: null, shapes: [], notes: verdict === 'changes' ? 'x' : '', verdict, imageSize: null })
  assert.equal(madeBy(say(a, 'changes'), null, null), null, 'one screen still waits')
  assert.deepEqual(madeBy(say(b, 'approved'), null, null), { what: 'marks', title: 'Plain', heard: false })
  const c = push({ app: 'Fine', screen: 'C', after: picture })
  assert.equal(madeBy(say(c, 'approved'), null, null), null)
  settle()
})

test('the words on the page: the sign, the notice, and how long it has waited', () => {
  const none = { queue: 0, ideas: 0, marks: 0 }
  assert.equal(signOf(undefined).state, 'none', 'a server from before this: nothing is said')
  assert.deepEqual(signOf({ agents: [], unheard: none, wake: null }), { state: 'off', words: '', tip: 'No agent is listening' })
  assert.deepEqual(signOf({ agents: [{ by: 'Claude', what: 'work' }], unheard: none, wake: null }), { state: 'on', words: '', tip: 'Claude is listening' })
  assert.equal(agentsWords([{ by: 'Claude' }, { by: 'Codex' }, { by: 'Claude' }]), 'Claude and Codex are listening')
  assert.equal(agentsWords([{ by: 'an agent' }]), 'An agent is listening')
  const waits = { agents: [], unheard: { queue: 1, ideas: 0, marks: 0 }, wake: null }
  assert.deepEqual(signOf(waits), { state: 'warn', words: 'No agent is listening', tip: `No agent is listening. 1 item waits in the queue. To start one, tell your agent: "${QUEUE_LINE}"` })
  const said = unheardWords(waits, 'build')
  assert.deepEqual([said.head, said.line, said.setup], ['Approved. No agent is listening, so nothing will be built yet.', QUEUE_LINE, true])
  assert.equal(unheardWords({ ...waits, unheard: { queue: 0, ideas: 0, marks: 2 } }, 'marks').line, MARKS_LINE)
  const waking = { ...waits, wake: { on: true, by: 'Claude', run: 'x', in: '/p', status: 'waking' } }
  assert.equal(signOf(waking).state, 'waking')
  assert.deepEqual([unheardWords(waking, 'build').head, unheardWords(waking, 'build').line], ['Approved. Waking your agent…', ''])
  const failed = unheardWords({ ...waits, wake: { on: true, by: 'Claude', run: 'x', in: '/p', status: 'failed', lastLine: 'command not found' } }, 'build')
  assert.deepEqual([failed.head, failed.log, failed.line], ['Approved. Your agent did not start.', 'command not found', QUEUE_LINE])
  const now = Date.parse('2026-01-02T12:00:00Z')
  assert.deepEqual(['2026-01-02T11:59:50Z', '2026-01-02T11:55:00Z', '2026-01-02T01:00:00Z', '2025-12-30T12:00:00Z'].map(t => waited(t, now)), ['less than 1 min', '5 min', '11 h', '3 days'])
})

/* ---------- waking an agent ---------- */

/** A stand-in for an agent: it writes what it was told to a file, counts its runs, and says one line. */
const standIn = (name, body = '') => {
  const script = join(home, `${name}.mjs`)
  writeFileSync(script, `import { appendFileSync, writeFileSync } from 'node:fs'\nimport { execFileSync } from 'node:child_process'\nwriteFileSync(${JSON.stringify(join(home, `${name}.told`))}, process.argv[2] ?? '')\nwriteFileSync(${JSON.stringify(join(home, `${name}.cwd`))}, process.cwd())\nappendFileSync(${JSON.stringify(join(home, `${name}.runs`))}, 'x')\nconsole.log('stand-in ${name} ran')\n${body}\n`)
  return { run: `node ${script} '{prompt}'`, told: () => readFileSync(join(home, `${name}.told`), 'utf8'), cwd: () => readFileSync(join(home, `${name}.cwd`), 'utf8'), runs: () => (existsSync(join(home, `${name}.runs`)) ? readFileSync(join(home, `${name}.runs`), 'utf8').length : 0) }
}

test('a Desktop heartbeat sees only its own current marks and can be switched off', () => {
  const first = push({ app: 'Desktop Review', screen: 'Home', after: picture })
  const other = push({ app: 'Other Review', screen: 'Home', after: picture })
  const scoped = { ...env, CODEX_THREAD_ID: '79f75609-fc37-491c-b319-78e4582ce0bf' }
  const args = ['wake', 'poll', '--app', first.appSlug]
  const poll = (using = scoped) => JSON.parse(run(args, { env: using }).stdout)
  assert.equal(run(['wake', 'desktop', '--app', first.app], { env: scoped }).status, 0)
  assert.deepEqual(poll().marks, [])
  for (const s of [first, other]) {
    receive({ appSlug: s.appSlug, id: s.id, shapes: [], notes: s.app, verdict: 'changes' })
  }
  assert.deepEqual(poll({ ...env, CODEX_THREAD_ID: 'different' }).marks, [])
  assert.deepEqual(poll().marks.map(r => r.notes), [first.app])
  assert.equal(poll().marks.length, 1, 'polling does not consume the mark')
  assert.deepEqual(standing(undefined, { excludeMarksFor: slug => slug === first.appSlug }).markApps, [other.appSlug])
  assert.equal(switchDesktopWake(first.appSlug, false), true)
  assert.deepEqual(poll().marks, [])
  switchDesktopWake(first.appSlug, true)
  const second = push({ app: first.app, screen: first.screen, after: picture })
  assert.deepEqual(poll().marks, [], 'a new round retires the mark')
  receive({ appSlug: second.appSlug, id: second.id, shapes: [], notes: '', verdict: 'approved' })
  assert.equal(poll().complete, true)
  assert.equal(run(['wake', 'desktop', '--app', first.appSlug, '--off'], { env: scoped }).status, 0)
  assert.equal(poll().owned, false)
  settle()
})

test('the wake command is set from the command line only, kept with its folder and who, and read without a shell', () => {
  const folder = join(home, 'agent-folder')
  mkdirSync(folder)
  assert.equal(readWake(folder), null)
  assert.equal(switchWake(true, { dir: folder }), null, 'nothing set: nothing to turn on')
  assert.throws(() => setWake({ run: 'claude -p hello', folder }), /\{prompt\}/)
  assert.match(cliIn(folder, 'wake'), /No wake command is set for this project/)
  assert.match(cliIn(folder, 'wake', 'set', '--run', "claude -p '{prompt}' --continue", '--by', 'Claude', '--app', 'Agent app'), /Wake is on for Claude[\s\S]*claude -p '\{prompt\}' --continue[\s\S]*For: work on agent-app/)
  const wake = readWake(folder)
  assert.deepEqual([wake.run, wake.in, wake.by, wake.on], ["claude -p '{prompt}' --continue", folder, 'Claude', true])
  const prompt = promptFor(wake)
  assert.deepEqual(argvOf(wake.run, prompt), ['claude', '-p', prompt, '--continue'], 'the prompt is one argument, whatever is in it')
  assert.match(prompt, /project agent-folder, on the reviews agent-app\. Run `review work` in this folder[\s\S]*Leave other projects' work alone/)
  assert.equal(promptFor({ in: '/x/a"b;$(rm)' }, ['ok', 'b`c&d']), promptFor({ in: '/x/abrm' }, ['ok', 'bcd']), 'names go in cleaned: nothing a shell could read')
  assert.doesNotMatch(wake.run, /skip-permissions|bypass|--yolo/, 'no flag that skips a permission prompt')
  assert.match(cliIn(folder, 'wake', 'off'), /Wake is off/)
  assert.equal(readWake(folder).on, false)
  assert.match(cliIn(folder, 'wake', 'on'), /Wake is on/)
  assert.match(cliIn(folder, 'wake', 'clear'), /Cleared/)
  assert.equal(readWake(folder), null)
  assert.equal(projectOf(folder).folder, folder, 'the folder it was set in uses Markback')
  assert.throws(() => setWake({ run: "x '{prompt}'", folder: homedir() }), /project's folder/, 'never for the home folder, which holds every project')
})

test('a routed idea request wakes the Claude project and its approved idea returns to that project', async () => {
  settle()
  const folder = join(home, 'claude-ideas')
  mkdirSync(folder)
  const request = askForIdeas({ target: 'How can the first screen be better?', count: 1, route: 'claude-ideas' })
  assert.equal(askForIdeas({ target: request.target, count: 1, route: 'claude-ideas' }).id, request.id)
  const agent = standIn('claude-ideas-worker', `
    const work = JSON.parse(execFileSync(process.execPath, [${JSON.stringify(CLI)}, 'work', '--json'], { encoding: 'utf8' }))
    if (work.ideas.length !== 1 || work.ideas[0].id !== ${JSON.stringify(request.id)}) throw new Error('The request was not routed here.')
    execFileSync(process.execPath, [${JSON.stringify(CLI)}, 'ideas', 'post', '--request', work.ideas[0].id, '--what', 'Show the next step'])
  `)
  setWake({ folder, run: agent.run, by: 'Claude', app: 'claude-ideas' })
  assert.match(run(['wake', 'kimi', '--session', 'test-session', '--app', 'claude-ideas'], { cwd: folder }).stderr, /already set for Claude/)
  const waker = createWaker({ quiet: 0 })
  assert.equal(waker.check()[readWake(folder).key], 'started')
  await until(() => waker.last(readWake(folder).key)?.running === false)
  assert.equal(waker.last(readWake(folder).key).failed, false)
  const item = listWork().find(i => i.request === request.id)
  assert.equal(item.route, 'claude-ideas')
  decide(item.id, 'yes')
  assert.equal(JSON.parse(cliIn(folder, 'work', '--json')).queue[0].id, item.id)
  clearWake(folder)
  settle()
})

test('the server wakes the agent once for waiting work: not at once, not twice for the same work, one run at a time, and a run that changes nothing has failed', async () => {
  settle()
  const agent = standIn('agent')
  setWake({ run: agent.run, folder: home, by: 'Stand-in', app: 'Wake' })
  let clock = Date.now()
  const waker = createWaker({ quiet: 60_000, backoff: 600_000, now: () => clock })
  const check = () => waker.check()[readWake(home).key]
  assert.equal(check(), 'nothing', 'nothing waits: nothing is started')
  assert.equal(waker.view(readWake(home)).status, 'ready')
  queuedIdea('Wake', 'Build me')
  assert.equal(check(), 'soon', 'an agent may be about to listen: it waits a minute first')
  assert.equal(waker.view(readWake(home)).status, 'waking')
  clock += 61_000
  assert.equal(check(), 'started')
  assert.equal(check(), 'running', 'one run at a time')
  await until(() => waker.last().running === false)
  assert.equal(agent.told(), promptFor(readWake(home), ['wake']), 'it was given the fixed prompt, whole, naming its own reviews')
  assert.equal(agent.runs(), 1)
  assert.deepEqual([waker.last().code, waker.last().failed], [0, true], 'it ended, no agent listens and the work still waits: failed')
  assert.ok(waker.last().endedAt, 'when it ended is recorded')
  const view = waker.view(readWake(home))
  assert.deepEqual([view.status, view.lastLine, view.run], ['failed', 'stand-in agent ran', agent.run], 'the page gets the last line of the log, and the command')
  assert.match(readFileSync(join(home, 'work', 'wake', `${readWake(home).key}.log`), 'utf8'), /waking Stand-in[\s\S]*stand-in agent ran/)
  clock += 5 * 60_000
  assert.equal(check(), 'woken', 'the same work, within ten minutes: not again')
  assert.equal(agent.runs(), 1)
  clock += 6 * 60_000
  assert.equal(check(), 'started', 'after the back-off it tries again')
  await until(() => waker.last().running === false)
  assert.equal(agent.runs(), 2)
  // New work is not the same work: it is woken for, back-off or not, after a short rest from the last run.
  queuedIdea('Wake', 'And me')
  assert.equal(check(), 'resting', 'the last run has only just ended')
  assert.equal(agent.runs(), 2)
  clock += 31_000
  assert.equal(check(), 'started')
  await until(() => waker.last().running === false)
  assert.equal(agent.runs(), 3)
})

/** A waker that knows of no earlier run: the last test's clock ran ahead of the real one. */
const freshWaker = options => {
  rmSync(join(home, 'work', 'wake'), { recursive: true, force: true })
  return createWaker(options)
}
/** What a waker's check did for the one project in this store. */
const only = waker => Object.values(waker.check())[0]

test('no wake when an agent is listening, and none when wake is off', async () => {
  const agent = standIn('quiet')
  const waker = freshWaker({ quiet: 0, backoff: 0 })
  setWake({ run: agent.run, folder: home, by: 'Stand-in', app: 'Wake' })
  const gone = fakeListener('listening', {})
  assert.equal(only(waker), 'nothing', 'an agent hears the work: nothing to wake')
  gone()
  switchWake(false, { dir: home })
  assert.equal(only(waker), 'off')
  assert.equal(waker.view(readWake(home)).status, 'off')
  await new Promise(r => setTimeout(r, 200))
  assert.equal(agent.runs(), 0)
  switchWake(true, { dir: home })
  assert.equal(only(waker), 'started')
  await until(() => waker.last().running === false)
  assert.equal(agent.runs(), 1)
})

test('a woken agent that starts to listen has not failed; a command that cannot start has, and says why', async () => {
  const agent = standIn('listener', `execFileSync('node', [${JSON.stringify(CLI)}, 'work', 'wait', '--by', 'Stand-in', '--timeout', '5'], { stdio: 'ignore' })`)
  const waker = freshWaker({ quiet: 0, backoff: 0 })
  setWake({ run: agent.run, folder: home, by: 'Stand-in', app: 'Wake' })
  assert.equal(only(waker), 'started')
  await until(() => waker.last().running === false)
  assert.equal(waker.last().failed, false)
  assert.deepEqual(listeners().map(a => a.by), ['Stand-in'], 'its heartbeat is there')
  assert.equal(only(waker), 'nothing', 'heard now')
  settle()
  queuedIdea('Wake', 'Nobody home')
  const broken = freshWaker({ quiet: 0, backoff: 0 })
  setWake({ run: "no-such-program-here '{prompt}'", folder: home, by: 'Nobody', app: 'Wake' })
  assert.equal(only(broken), 'started')
  await until(() => broken.last().running === false)
  assert.equal(broken.last().failed, true)
  assert.match(broken.view(readWake(home)).lastLine, /It did not start/)
  clearWake(home)
  settle()
})

const freePort = () => new Promise((resolve, reject) => {
  const probe = createServer()
  probe.once('error', reject)
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address()
    probe.close(() => resolve(String(port)))
  })
})

test('the running server is the heartbeat, and the HTTP API can turn wake on and off but never set the command', async () => {
  const store = realpathSync(mkdtempSync(join(tmpdir(), 'review-wake-')))
  const port = await freePort()
  const its = { ...process.env, REVIEW_HOME: store, REVIEW_PORT: port, REVIEW_WAKE_MS: '100,300,600000,120000' }
  const told = join(store, 'told')
  const script = join(store, 'agent.mjs')
  writeFileSync(script, `import { appendFileSync } from 'node:fs'\nappendFileSync(${JSON.stringify(told)}, process.argv[2] + '\\n')\nconsole.log('the stand-in ran')\n`)
  const at = `http://127.0.0.1:${port}`
  const post = (path, body) => fetch(`${at}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const server = spawn('node', [join(ROOT, 'server.mjs')], { env: its, stdio: 'ignore' })
  children.push(server)
  try {
    for (let i = 0; i < 100 && !(await fetch(`${at}/api/queue`).then(r => r.ok, () => false)); i++) await new Promise(r => setTimeout(r, 100))
    // Not set up: nothing to show, nothing to turn on, and the API makes none.
    assert.equal((await (await fetch(`${at}/api/queue`)).json()).listening.wake, null)
    assert.equal((await post('/api/wake', { on: true, run: 'touch made-by-a-page' })).status, 404)
    // A store other than the person's own keeps its wake command in the person's own folder, never in the store (wake.mjs).
    const wakes = join(realpathSync(process.env.HOME), '.review-wizard', 'store-wakes', folderKey(store))
    const wakeFile = () => join(wakes, readdirSync(wakes).find(f => f.endsWith('.json') && !f.endsWith('.last.json')))
    assert.equal(existsSync(wakes), false, 'a page cannot make a wake command')
    execFileSync('node', [CLI, 'wake', 'set', '--run', `node ${script} '{prompt}'`, '--by', 'Stand-in', '--in', store, '--app', 'App'], { env: its })
    execFileSync('node', ['-e', `import(${JSON.stringify(join(ROOT, 'lib/work.mjs'))}).then(w => { const a = w.askForIdeas({ target: 'App', count: 1 }); const i = w.postIdea({ request: a.id, what: 'Build me', why: 'Why', size: 'S' }); w.decide(i.id, 'yes') })`], { env: its })
    await until(() => existsSync(told), 'the server did not wake the stand-in')
    await new Promise(r => setTimeout(r, 1200))
    assert.deepEqual(readFileSync(told, 'utf8').trim().split('\n'), [promptFor({ in: store }, ['app'])], 'woken once, with the fixed prompt, and not again within the back-off')
    const { listening } = await (await fetch(`${at}/api/work`)).json()
    assert.deepEqual([listening.unheard.queue, listening.wake.on, listening.wake.run, listening.wake.status, listening.wake.lastLine], [1, true, `node ${script} '{prompt}'`, 'failed', 'the stand-in ran'])
    // On and off, and nothing else: a command sent with it is not read.
    const off = await post('/api/wake', { on: false, run: 'touch made-by-a-page', in: '/', by: 'Page' })
    assert.equal(off.status, 200)
    const kept = JSON.parse(readFileSync(wakeFile(), 'utf8'))
    assert.deepEqual([kept.run, kept.in, kept.by, kept.on], [`node ${script} '{prompt}'`, store, 'Stand-in', false])
    assert.equal((await off.json()).listening.wake.status, 'off')
    assert.equal((await post('/api/wake', { run: 'touch made-by-a-page' })).status, 400, 'only on or off is taken')
    assert.equal(JSON.parse(readFileSync(wakeFile(), 'utf8')).run, `node ${script} '{prompt}'`)
    assert.doesNotMatch(readFileSync(join(ROOT, 'server.mjs'), 'utf8'), /setWake/, 'the server does not even load what sets the command')
    // Marks a Codex Desktop heartbeat takes are nobody else's: the page does not say nobody listens for them.
    execFileSync('node', [CLI, 'push', '--app', 'Desk app', '--screen', 'One', '--after', picture], { env: its })
    execFileSync('node', ['-e', `import(${JSON.stringify(join(ROOT, 'lib/store.mjs'))}).then(s => { const a = s.listApps().find(x => x.slug === 'desk-app'); s.receive({ appSlug: a.slug, id: a.screens[0].id, png: null, shapes: [], notes: 'x', verdict: 'changes', imageSize: null }) })`], { env: its })
    const page = async () => (await (await fetch(`${at}/api/queue`)).json()).listening
    assert.equal((await page()).unheard.marks, 1, 'without the heartbeat, they wait unheard')
    mkdirSync(join(store, 'work', 'desktop-wake'), { recursive: true })
    writeFileSync(join(store, 'work', 'desktop-wake', 'desk-app.json'), JSON.stringify({ thread: 'a-thread', on: true }))
    const withDesktop = await page()
    assert.deepEqual([withDesktop.unheard.marks, withDesktop.desktop['desk-app']], [0, { on: true, pending: true }])
    assert.deepEqual(withDesktop.wakes.map(w => [w.by, w.apps]), [['Stand-in', ['app']]], 'each project\'s wake, with its reviews, for the menu')
    // It says that it runs, for the hooks, and says so no more once it is stopped.
    const said = JSON.parse(readFileSync(join(store, 'work', 'server.json'), 'utf8'))
    assert.deepEqual([said.pid, said.port], [server.pid, Number(port)])
    assert.ok(Date.now() - Date.parse(said.beat) < 5000)
    const ended = new Promise(resolve => server.once('exit', resolve))
    server.kill()
    await ended
    assert.equal(existsSync(join(store, 'work', 'server.json')), false)
  } finally {
    server.kill()
    rmSync(store, { recursive: true, force: true })
  }
})

/* ---------- Claude Code's hooks ---------- */

const project = join(home, 'project')
mkdirSync(project)
const SERVER_FILE = join(home, 'work', 'server.json')
/** The review page's server runs, as far as the hooks can tell: this test's own process says so, now. */
let keepUp = true
const serverUp = (fields = {}) => {
  mkdirSync(join(home, 'work'), { recursive: true })
  writeFileSync(SERVER_FILE, JSON.stringify({ pid: process.pid, port: 1, beat: new Date().toISOString(), ...fields }))
  // A server written as it was asked stays as it is. A plain one keeps beating, as a real one does.
  keepUp = !Object.keys(fields).length
}
const serverDown = () => {
  rmSync(SERVER_FILE, { force: true })
  keepUp = false
}
serverUp()
let calls = 0
/** One hook call. Each has its own `n`, as two real stops differ: the same input twice at once is one hook run twice. */
const hook = (input, extra = {}) => {
  if (keepUp) serverUp()
  return run(['work', '--hook'], { input: JSON.stringify({ session_id: 's1', cwd: project, hook_event_name: 'Stop', stop_hook_active: false, n: calls++, ...input }), env: { ...env, ...extra } })
}

test('the hooks do nothing, silently, in a project that does not use Markback', () => {
  queuedIdea('Hooks', 'Waiting work')
  const other = join(home, 'other')
  mkdirSync(other)
  assert.equal(projectOf(other), null)
  for (const event of ['Stop', 'SessionStart']) {
    const out = hook({ cwd: other, hook_event_name: event })
    assert.deepEqual([out.status, out.stdout, out.stderr], [0, '', ''])
  }
  // Input that is not a hook's, or none at all: silence too.
  assert.deepEqual([run(['work', '--hook'], { input: 'not json' }).stdout, run(['work', '--hook'], { input: '' }).status], ['', 0])
  // A folder with the skills that review project puts there uses Markback, and so does one inside a noted folder.
  mkdirSync(join(other, '.agents', 'skills', 'markback'), { recursive: true })
  assert.equal(projectOf(other).folder, other)
  mkdirSync(join(project, '.git'))
  noteProject(join(project, 'src-not-made-yet'), 'Hooks')
  mkdirSync(join(project, 'src'))
  assert.deepEqual(projectOf(join(project, 'src')), { folder: project, apps: ['hooks'] }, 'noted by its repository root, from a subfolder')
  assert.equal(rootOf(join(project, 'src')), project)
})

test('Stop with work waiting: the stop is blocked with what to do, never twice in a row for the same reason, and once only when another stop hook already holds it', () => {
  const blocked = JSON.parse(hook({}).stdout)
  assert.equal(blocked.decision, 'block')
  assert.match(blocked.reason, /work waits for an agent[\s\S]*"Waiting work"[\s\S]*review take --item item-\S+ --by "Claude"[\s\S]*review work wait --by "Claude"/)
  assert.equal(hook({}).stdout, '', 'the same reason again: let through')
  assert.equal(JSON.parse(hook({ session_id: 's2' }).stdout).decision, 'block', 'another session has not been told')
  assert.equal(JSON.parse(hook({ session_id: 's3', stop_hook_active: true }).stdout).decision, 'block', 'continuing from another stop hook: held once for this')
  assert.equal(hook({ session_id: 's3', stop_hook_active: true }).stdout, '', 'and then let through')
  assert.equal(hook({ session_id: 's4' }, { MARKBACK_HOOKS: 'off' }).stdout, '', 'turned off')
  // New work is a new reason.
  queuedIdea('Hooks', 'More work')
  assert.equal(JSON.parse(hook({}).stdout).decision, 'block')
  // Work on another project's review is not this project's to take.
  settle()
  const theirs = queuedIdea('Elsewhere', 'Their item')
  pushedFor(theirs.id, 'Their app', 'S', 'proposal')
  setStage(theirs.id, 'queued')
  assert.doesNotMatch(hook({ session_id: 's5' }).stdout, /Their item/)
  settle()
})

test('Stop with nothing waiting: blocked once to start a wait when none runs for this project, and let through when one does', () => {
  const blocked = JSON.parse(hook({ session_id: 'n1' }).stdout)
  assert.equal(blocked.decision, 'block')
  assert.match(blocked.reason, /nothing waits now, but no agent listens[\s\S]*review work wait --by "Claude"[\s\S]*background/)
  assert.equal(hook({ session_id: 'n1' }).stdout, '', 'once')
  // The session has the wait among its background commands.
  assert.equal(hook({ session_id: 'n2', background_tasks: [{ id: 't1', type: 'shell', status: 'running', command: 'review work wait --by "Claude"' }] }).stdout, '')
  // Or its heartbeat is there, from this project's folder. One from another folder is not this project's.
  const elsewhere = fakeListener('elsewhere', { in: join(home, 'other') })
  assert.equal(JSON.parse(hook({ session_id: 'n3' }).stdout).decision, 'block')
  elsewhere()
  const here = fakeListener('here', { in: project })
  assert.equal(hook({ session_id: 'n4' }).stdout, '')
  here()
})

test('SessionStart says, as context, what waits and to keep the wait running', () => {
  assert.match(hook({ hook_event_name: 'SessionStart', source: 'startup' }).stdout, /Markback is in use in this project\. Nothing waits for an agent now\. Keep `review work wait --by "Claude"` running/)
  queuedIdea('Hooks', 'Start on me')
  assert.match(hook({ hook_event_name: 'SessionStart', source: 'resume' }).stdout, /Work waits for an agent: 1 item in the queue nobody has taken \(top: "Start on me"/)
  const config = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8'))
  for (const event of ['Stop', 'SessionStart']) assert.equal(config.hooks[event][0].hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/review.mjs" work --hook', `${event} runs the check`)
  settle()
})

test('Stop is never held while the review page does not run, and the hook answers in a moment', () => {
  queuedIdea('Hooks', 'Waiting while closed')
  serverDown()
  assert.deepEqual([hook({ session_id: 'd1' }).status, hook({ session_id: 'd1' }).stdout], [0, ''], 'no server: let through')
  serverUp({ beat: new Date(Date.now() - 120_000).toISOString() })
  assert.equal(hook({ session_id: 'd2' }).stdout, '', 'a server that has not said so for two minutes has gone')
  const dead = spawnSync('node', ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' })
  serverUp({ pid: Number(dead.stdout) })
  assert.equal(hook({ session_id: 'd3' }).stdout, '', 'a server whose process has ended has gone')
  assert.match(hook({ session_id: 'd4', hook_event_name: 'SessionStart' }).stdout, /Waiting while closed/, 'a session start is still told: that holds nothing back')
  serverUp()
  const started = Date.now()
  assert.equal(JSON.parse(hook({ session_id: 'd5' }).stdout).decision, 'block')
  assert.ok(Date.now() - started < 3000, 'quick: a few small files, no network')
  settle()
})

test('a Stop hook that keeps the agent going takes the queue item by item, and lets it stop when the queue is empty', () => {
  const items = [queuedIdea('Hooks', 'First'), queuedIdea('Hooks', 'Second')]
  const stop = (active = true) => hook({ session_id: 'c1', stop_hook_active: active }).stdout
  assert.match(JSON.parse(stop(false)).reason, /"First"/)
  assert.equal(stop(), '', 'nothing was taken: the same reason is let through, so it cannot loop')
  take({ by: 'Claude', id: items[0].id })
  assert.match(JSON.parse(stop()).reason, /"Second"/, 'the first was taken: held again for the next')
  take({ by: 'Claude', id: items[1].id })
  assert.match(JSON.parse(stop()).reason, /nothing waits now, but no agent listens/, 'the queue is empty: held once to start a wait')
  assert.equal(stop(), '', 'then it stops')
  // However much new work comes, a chain of holds ends.
  let held = 0
  for (let i = 0; i < 15; i++) {
    queuedIdea('Hooks', `More ${i}`)
    if (stop()) held++
  }
  assert.ok(held < 10, `held ${held} times in a row`)
  settle()
})

/** The command with a search path of our choosing: whether `review` is on it decides what the hooks run. */
const noPath = realpathSync(mkdtempSync(join(tmpdir(), 'review-nopath-')))
const runWithPath = (args, path = noPath, cwd = undefined) => spawnSync(process.execPath, [CLI, ...args], { env: { ...env, PATH: path }, encoding: 'utf8', cwd })

test('review install-skills --hooks puts both hooks in a Claude Code settings file, keeps what is there, and replaces its own', () => {
  const folder = join(home, 'hooked-project')
  const settings = join(folder, '.claude', 'settings.json')
  mkdirSync(join(folder, '.claude'), { recursive: true })
  writeFileSync(settings, JSON.stringify({ model: 'x', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } }))
  const out = runWithPath(['install-skills', '--to', join(home, 'skills-out'), '--hooks', folder])
  assert.match(out.stdout, /Wrote the Stop and SessionStart hooks[\s\S]*If you move Markback, run this again/)
  runWithPath(['install-skills', '--to', join(home, 'skills-out'), '--hooks', folder])
  const got = JSON.parse(readFileSync(settings, 'utf8'))
  assert.equal(got.model, 'x', 'the rest of the file is kept')
  const commands = (event, from = got) => (from.hooks?.[event] ?? []).flatMap(g => g.hooks.map(h => h.command))
  assert.deepEqual(commands('Stop'), ['echo mine', `node "${join(ROOT, 'review.mjs')}" work --hook`], 'the person\'s own hook stays, and ours is there once')
  assert.deepEqual(commands('SessionStart'), [`node "${join(ROOT, 'review.mjs')}" work --hook`])
  assert.equal(got.hooks.Stop.at(-1).hooks[0].timeout, 10)
  // With review on the search path, the hooks name it and not a folder, so moving Markback breaks nothing.
  const bin = join(home, 'bin-with-review')
  mkdirSync(bin)
  writeFileSync(join(bin, 'review'), '#!/bin/sh\n', { mode: 0o755 })
  runWithPath(['install-skills', '--to', join(home, 'skills-out'), '--hooks', folder], bin)
  const named = JSON.parse(readFileSync(settings, 'utf8'))
  assert.deepEqual(commands('Stop', named), ['echo mine', 'review work --hook'], 'the old copy of ours is replaced')
  // Taken out again: only ours go.
  assert.match(runWithPath(['install-skills', '--remove-hooks', folder]).stdout, /Took Markback's hooks out/)
  const left = JSON.parse(readFileSync(settings, 'utf8'))
  assert.deepEqual([left.model, commands('Stop', left), left.hooks.SessionStart], ['x', ['echo mine'], undefined])
  assert.match(runWithPath(['install-skills', '--remove-hooks', folder]).stdout, /Markback has no hooks/)
  writeFileSync(settings, '{ not json')
  const refused = runWithPath(['install-skills', '--to', join(home, 'skills-out'), '--hooks', folder])
  assert.equal(refused.status, 1)
  assert.match(refused.stderr, /not JSON, so it was left alone/)
  assert.equal(readFileSync(settings, 'utf8'), '{ not json', 'never written over')
})

test('the hooks are written through a symlinked settings file, and its mode is kept', () => {
  const folder = join(home, 'linked-project')
  const real = join(home, 'dotfiles', 'claude-settings.json')
  mkdirSync(dirname(real), { recursive: true })
  mkdirSync(join(folder, '.claude'), { recursive: true })
  writeFileSync(real, JSON.stringify({ theme: 'dark' }), { mode: 0o600 })
  chmodSync(real, 0o600)
  symlinkSync(real, join(folder, '.claude', 'settings.json'))
  assert.equal(runWithPath(['install-skills', '--to', join(home, 'skills-out'), '--hooks', folder]).status, 0)
  assert.ok(lstatSync(join(folder, '.claude', 'settings.json')).isSymbolicLink(), 'the link is still a link')
  assert.equal(statSync(real).mode & 0o777, 0o600, 'still private')
  assert.equal(JSON.parse(readFileSync(real, 'utf8')).theme, 'dark')
  assert.equal(JSON.parse(readFileSync(real, 'utf8')).hooks.Stop.length, 1, 'written to the real file')
  runWithPath(['install-skills', '--remove-hooks', folder])
  assert.deepEqual(JSON.parse(readFileSync(real, 'utf8')), { theme: 'dark' })
  assert.equal(statSync(real).mode & 0o777, 0o600)
})

test('the server knows when an agent last said it listens, also after the agent has gone', () => {
  settle()
  rmSync(join(home, 'work', 'last-heard.json'), { force: true })
  assert.equal(standing().heard, '')
  const gone = fakeListener('heard', {}, 2000)
  const beat = JSON.parse(readFileSync(join(LISTENING, 'heard.json'), 'utf8')).beat
  assert.equal(standing().heard, beat)
  gone()
  assert.deepEqual([standing().agents, standing().heard], [[], beat], 'kept when its file goes')
  fakeListener('stale', {}, GONE_MS + 5000)
  assert.equal(standing().heard, beat, 'an older beat does not move it back')
  settle()
})

test('the page shows the sign only when work waits unheard, and says how to start an agent in one sentence', () => {
  const none = { queue: 0, ideas: 0, marks: 0 }
  const shows = l => signShows(signOf(l))
  assert.equal(shows({ agents: [{ by: 'Claude', what: 'work' }], unheard: none, wake: null }), false, 'an agent listens: nothing is shown')
  assert.equal(shows({ agents: [], unheard: none, wake: null }), false, 'nothing waits: nothing is shown')
  assert.equal(shows(undefined), false)
  const waits = { agents: [], unheard: { queue: 1, ideas: 0, marks: 0 }, wake: null }
  assert.equal(shows(waits), true)
  assert.equal(signOf(waits).words, 'No agent is listening')
  assert.equal(howWords(waits), `To start one, tell your agent: "${QUEUE_LINE}"`)
  assert.equal(howWords({ ...waits, wake: { on: false, by: 'Claude', run: 'x', in: '/p', status: 'off' } }), 'To start one, turn on Wake in the menu.')
  assert.match(signOf(waits).tip, /To start one/)
  assert.equal(shows({ ...waits, wake: { on: true, by: 'Claude', run: 'x', in: '/p', status: 'waking' } }), true)
})

/* ---------- one wake for each project ---------- */

test('wake is one command for each project: marks on one project start only its agent, in its folder, told its own reviews', async () => {
  settle()
  rmSync(join(home, 'work', 'wake'), { recursive: true, force: true })
  const a = join(home, 'proj-a')
  const b = join(home, 'proj-b')
  for (const folder of [a, b]) mkdirSync(join(folder, '.git'), { recursive: true })
  const agentA = standIn('agent-a')
  const agentB = standIn('agent-b')
  cliIn(a, 'wake', 'set', '--run', agentA.run, '--by', 'A', '--app', 'App A')
  cliIn(join(b, '.git'), 'wake', 'set', '--run', agentB.run, '--by', 'B', '--app', 'App B')
  assert.deepEqual(listWakes().map(w => [w.in, w.by]), [[a, 'A'], [b, 'B']], 'setting B kept A; B is known by its root, set from inside it')
  assert.match(cliIn(a, 'wake'), /agent-a/)
  assert.doesNotMatch(cliIn(a, 'wake'), /agent-b/)
  assert.match(cliIn(a, 'wake', '--all'), /proj-a[\s\S]*agent-a[\s\S]*proj-b[\s\S]*agent-b/)
  const shot = push({ app: 'App A', screen: 'One', after: picture })
  receive({ appSlug: shot.appSlug, id: shot.id, png: null, shapes: [], notes: 'x', verdict: 'changes', imageSize: null })
  const waker = createWaker({ quiet: 0, backoff: 0, gap: 0 })
  const did = waker.check()
  assert.deepEqual([did[readWake(a).key], did[readWake(b).key]], ['started', 'nothing'])
  await until(() => waker.last(readWake(a).key).running === false)
  assert.deepEqual([agentA.runs(), agentB.runs()], [1, 0], 'B was not woken for A\'s marks')
  assert.equal(agentA.cwd(), a, 'in its own folder')
  assert.match(agentA.told(), /project proj-a, on the reviews app-a\./)
  // The woken agent's review work lists only its own project's work.
  assert.match(cliIn(a, 'work'), /in this project \(reviews: app-a\)[\s\S]*App A/)
  assert.match(cliIn(b, 'work'), /Nothing is waiting for an agent in this project\./)
  assert.match(cliIn(b, 'work', '--all'), /App A/, '--all for every project\'s')
  // Work that belongs to no project with a wake command starts nothing.
  settle()
  const stray = push({ app: 'Nobody app', screen: 'One', after: picture })
  receive({ appSlug: stray.appSlug, id: stray.id, png: null, shapes: [], notes: 'x', verdict: 'changes', imageSize: null })
  queuedIdea('Somewhere else', 'Not for A or B')
  assert.deepEqual(Object.values(createWaker({ quiet: 0, backoff: 0, gap: 0 }).check()), ['nothing', 'nothing'])
  clearWake(a)
  clearWake(b)
  settle()
})

test('a run left by an earlier server is running while its process lives, rests from when it ends, and stops blocking after the longest time', async () => {
  settle()
  rmSync(join(home, 'work', 'wake'), { recursive: true, force: true })
  const folder = join(home, 'proj-restart')
  mkdirSync(folder)
  const agent = standIn('restart')
  setWake({ run: agent.run, folder, by: 'R', app: 'Restart' })
  const wake = readWake(folder)
  const lastFile = join(home, 'work', 'wake', `${wake.key}.last.json`)
  queuedIdea('Restart', 'Build after a restart')
  const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' })
  children.push(sleeper)
  let clock = Date.now()
  await until(() => processStart(sleeper.pid))
  writeFileSync(lastFile, JSON.stringify({ at: clock - 1000, startedAt: new Date(clock - 1000).toISOString(), for: 'older work', running: true, pid: sleeper.pid, started: processStart(sleeper.pid) }))
  const waker = createWaker({ quiet: 0, backoff: 0, gap: 30_000, now: () => clock })
  const check = () => waker.check()[wake.key]
  assert.equal(check(), 'running', 'its process lives, and it is the same one: no second run')
  const ended = new Promise(resolve => sleeper.once('exit', resolve))
  sleeper.kill()
  await ended
  assert.equal(check(), 'resting', 'it ended: the rest counts from then')
  assert.ok(waker.last(wake.key).endedAt)
  assert.equal(agent.runs(), 0)
  clock += 31_000
  assert.equal(check(), 'started')
  await until(() => waker.last(wake.key).running === false)
  assert.equal(agent.runs(), 1)
  // A run that never ends: past the longest time, it no longer blocks, and the page says so.
  const forever = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' })
  children.push(forever)
  const sig = standing(listApps(), { only: ['restart'] }).sig
  writeFileSync(lastFile, JSON.stringify({ at: clock - LONGEST_MS - 1000, startedAt: 'long ago', for: sig, running: true, pid: forever.pid }))
  const later = createWaker({ quiet: 0, backoff: 0, gap: 0, now: () => clock })
  assert.equal(later.view(wake).status, 'stuck')
  assert.match(unheardWords({ agents: [], unheard: { queue: 1, ideas: 0, marks: 0 }, wake: later.view(wake) }).head, /run for over 30 minutes/)
  assert.equal(later.check()[wake.key], 'started', 'past the longest time it no longer blocks a new run')
  await until(() => later.last(wake.key).running === false)
  assert.equal(agent.runs(), 2)
  forever.kill()
  clearWake(folder)
  settle()
})

test('the page speaks of the wake that matters: the worst for work that will wake an agent, or one that is off, or none', () => {
  const v = (status, on = true) => ({ status, on, by: status })
  assert.equal(wakeSummary(0, [{ view: v('ready'), waits: 0 }]), null, 'nothing waits')
  assert.equal(wakeSummary(2, [{ view: v('waking'), waits: 1 }, { view: v('failed'), waits: 1 }]).status, 'failed')
  assert.equal(wakeSummary(2, [{ view: v('waking'), waits: 1 }, { view: v('stuck'), waits: 1 }]).status, 'stuck')
  assert.equal(wakeSummary(3, [{ view: v('waking'), waits: 1 }]), null, 'some work wakes nobody: the page says how to set one up')
  assert.equal(wakeSummary(3, [{ view: v('waking'), waits: 1 }, { view: v('off', false), waits: 2 }]).status, 'off')
})

/* ---------- listening files that lie ---------- */

test('a listening file with a beat from the future, or whose process has ended, is not a listener', () => {
  settle()
  rmSync(join(home, 'work', 'last-heard.json'), { force: true })
  fakeListener('future', { by: 'Future' }, -60_000)
  const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' })
  fakeListener('dead', { by: 'Dead', pid: Number(dead.stdout) })
  fakeListener('alive', { by: 'Alive', pid: process.pid })
  fakeListener('skew', { by: 'Skew' }, -2000)
  assert.deepEqual(listeners().map(a => a.by).sort(), ['Alive', 'Skew'], 'a little clock skew is allowed')
  assert.ok(Date.parse(standing().heard) <= Date.now() + 5000, 'a future beat does not set when an agent was last heard')
  settle()
})

/* ---------- hooks: only this project's work ---------- */

test('the hooks hold an agent only for its own project: not under a noted parent, not with no reviews, not for work naming no review of it', () => {
  settle()
  serverUp()
  const parent = join(home, 'parent')
  mkdirSync(join(parent, 'child'), { recursive: true })
  noteProject(parent, 'Parent app')
  queuedIdea('Parent app', 'Parent work')
  assert.equal(projectOf(join(parent, 'child')), null, 'a folder above that merely contains it does not make it a project')
  assert.equal(hook({ cwd: join(parent, 'child'), session_id: 'p1' }).stdout, '')
  assert.equal(hook({ cwd: join(parent, 'child'), session_id: 'p1', hook_event_name: 'SessionStart' }).stdout, '')
  assert.match(JSON.parse(hook({ cwd: parent, session_id: 'p2' }).stdout).reason, /Parent work/, 'in the project itself it does')
  const bare = join(home, 'bare')
  mkdirSync(bare)
  noteProject(bare)
  assert.deepEqual(projectOf(bare).apps, [])
  for (const event of ['Stop', 'SessionStart']) assert.equal(hook({ cwd: bare, session_id: 'p3', hook_event_name: event }).stdout, '', 'no reviews: nothing is its work')
  assert.equal(waitingWork({ only: [] }).count, 0, 'an empty list is no work, not all of it')
  settle()
  askForIdeas({ target: 'Something else', count: 2 })
  queuedIdea('Another thing', 'Not ours')
  const out = hook({ session_id: 'p4' }).stdout
  assert.doesNotMatch(out, /Not ours|ideas/)
  assert.match(out, /nothing waits now/, 'only the one hold, to start a wait')
  askForIdeas({ target: 'Hooks', count: 1 })
  assert.match(JSON.parse(hook({ session_id: 'p5' }).stdout).reason, /1 request for ideas/, 'a request for this project\'s review is its own')
  settle()
})

test('with the plugin hook and a settings hook both in place, the same input is answered once', async () => {
  const input = JSON.stringify({ session_id: 'dup', cwd: project, hook_event_name: 'SessionStart', source: 'startup' })
  const once = () => new Promise(resolve => {
    const child = spawn('node', [CLI, 'work', '--hook'], { env })
    let out = ''
    child.stdout.on('data', d => { out += d })
    child.on('close', () => resolve(out))
    child.stdin.end(input)
  })
  const both = await Promise.all([once(), once()])
  assert.equal(both.filter(Boolean).length, 1, `answered ${both.filter(Boolean).length} times`)
  assert.match(both.find(Boolean), /Markback is in use in this project/)
})

/* ---------- Windows ---------- */

test('on Windows a .cmd or .bat starts through cmd.exe with every argument quoted, and anything else without it', () => {
  const env = { PATH: 'C:\\npm;C:\\bin', PATHEXT: '.COM;.EXE;.BAT;.CMD', ComSpec: 'C:\\Windows\\system32\\cmd.exe' }
  // Windows does not mind the case of a name.
  const exists = path => ['c:\\npm\\claude.cmd', 'c:\\bin\\tool.exe'].includes(path.toLowerCase())
  const prompt = promptFor({ in: 'C:\\code\\my app' }, ['my-app'])
  const viaCmd = launchOf(['claude', '-p', prompt, '--continue'], { platform: 'win32', env, exists })
  assert.equal(viaCmd.file, env.ComSpec)
  assert.deepEqual(viaCmd.args, ['/d', '/s', '/c', `"C:\\npm\\claude.CMD ${cmdQuote('-p')} ${cmdQuote(prompt)} ${cmdQuote('--continue')}"`])
  assert.deepEqual(viaCmd.options, { windowsHide: true, windowsVerbatimArguments: true })
  assert.equal(cmdQuote('a & b "c" %PATH%'), '^"a^ ^&^ b^ \\^"c\\^"^ ^%PATH^%^"', 'nothing in an argument reaches cmd.exe as a command')
  assert.deepEqual(launchOf(['tool', 'x'], { platform: 'win32', env, exists }), { file: 'C:\\bin\\tool.EXE', args: ['x'], options: { windowsHide: true } })
  assert.deepEqual(launchOf(['claude', 'x'], { platform: 'darwin', env, exists }), { file: 'claude', args: ['x'], options: { windowsHide: true } })
})

test('a run whose pid now belongs to another process is not running: the pid was given again', async () => {
  settle()
  rmSync(join(home, 'work', 'wake'), { recursive: true, force: true })
  const folder = join(home, 'proj-reused')
  mkdirSync(folder)
  const agent = standIn('reused')
  setWake({ run: agent.run, folder, by: 'R', app: 'Reused' })
  const wake = readWake(folder)
  queuedIdea('Reused', 'Build it')
  const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' })
  children.push(other)
  await until(() => processStart(other.pid))
  // The record names a live pid, but a process that started at another time: not the run it was.
  writeFileSync(join(home, 'work', 'wake', `${wake.key}.last.json`), JSON.stringify({ at: Date.now() - 1000, startedAt: 'earlier', for: 'older work', running: true, pid: other.pid, started: 'Mon Jan  1 00:00:00 2001' }))
  const waker = createWaker({ quiet: 0, backoff: 0, gap: 0 })
  assert.equal(waker.check()[wake.key], 'started', 'not held back by someone else\'s process')
  await until(() => waker.last(wake.key).running === false)
  assert.equal(agent.runs(), 1)
  assert.ok(waker.last(wake.key).started, 'a run started here keeps its own start time')
  other.kill()
  clearWake(folder)
  settle()
})

test('a run stays the same run whatever the locale, the time zone and the search path of the server that asks; an unread start time does not end it', async () => {
  const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' })
  children.push(other)
  await until(() => processStart(other.pid))
  const first = processStart(other.pid)
  const kept = { TZ: process.env.TZ, LC_ALL: process.env.LC_ALL, PATH: process.env.PATH }
  try {
    Object.assign(process.env, { TZ: 'Asia/Tokyo', LC_ALL: 'de_DE.UTF-8', PATH: '/nowhere' })
    assert.equal(processStart(other.pid), first, 'the same words for the same process')
  } finally {
    for (const [key, value] of Object.entries(kept)) value === undefined ? delete process.env[key] : (process.env[key] = value)
  }
  // A server that cannot read the start time at all goes by the pid alone: the run is not taken as ended.
  settle()
  rmSync(join(home, 'work', 'wake'), { recursive: true, force: true })
  const folder = join(home, 'proj-unread')
  mkdirSync(folder)
  const agent = standIn('unread')
  setWake({ run: agent.run, folder, by: 'U', app: 'Unread' })
  const wake = readWake(folder)
  queuedIdea('Unread', 'Build it')
  writeFileSync(join(home, 'work', 'wake', `${wake.key}.last.json`), JSON.stringify({ at: Date.now() - 1000, startedAt: 'earlier', for: 'older work', running: true, pid: other.pid, started: first }))
  const waker = createWaker({ quiet: 0, backoff: 0, gap: 0, identify: () => '' })
  assert.equal(waker.check()[wake.key], 'running', 'still the live run')
  assert.equal(agent.runs(), 0)
  other.kill()
  clearWake(folder)
  settle()
})
