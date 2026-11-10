/**
 * Whether an agent is listening, in words. Plain functions with no page in them, so the review page, the work page and the
 * tests all say the same. `listening` is what the server sends with the queue: `{ agents, unheard, wake }`. A server from
 * before this sends none, and then nothing is said.
 */

/** The lines a person can give an agent, when nothing can wake it for them. */
export const QUEUE_LINE = 'Take the next item from the Markback queue and build it.'
export const MARKS_LINE = 'Read my marks in Markback and act on them.'
export const IDEAS_LINE = 'Answer my request for ideas in Markback.'
export const SETUP_LINE = 'Set up Markback to wake you when work waits.'

/** "Claude", "Claude and Codex", "Claude, Codex and Kimi". */
export function names(agents) {
  const all = [...new Set(agents.map(a => a.by))]
  const words = all.length > 1 ? `${all.slice(0, -1).join(', ')} and ${all.at(-1)}` : all[0] ?? ''
  return words.charAt(0).toUpperCase() + words.slice(1)
}
const many = agents => new Set(agents.map(a => a.by)).size > 1

/** How long ago, short: "less than 1 min", "5 min", "11 h", "3 days". */
export function waited(since, now = Date.now()) {
  const min = Math.max(0, Math.round((now - Date.parse(since)) / 60000))
  if (min < 1) return 'less than 1 min'
  if (min < 60) return `${min} min`
  return min < 2880 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} days`
}

export const unheardCount = listening => (listening ? listening.unheard.queue + listening.unheard.ideas + listening.unheard.marks : 0)

/** What waits that no agent will hear: "1 item waits in the queue. Marks on 2 screens wait." */
export function waitsWords(unheard) {
  const parts = []
  if (unheard.queue) parts.push(`${unheard.queue} item${unheard.queue === 1 ? ' waits' : 's wait'} in the queue.`)
  if (unheard.marks) parts.push(`Marks on ${unheard.marks} screen${unheard.marks === 1 ? '' : 's'} wait.`)
  if (unheard.ideas) parts.push(`${unheard.ideas} request${unheard.ideas === 1 ? '' : 's'} for ideas wait${unheard.ideas === 1 ? 's' : ''}.`)
  return parts.join(' ')
}

/** The line that fits what waits. */
export const lineFor = unheard => (unheard.queue ? QUEUE_LINE : unheard.marks ? MARKS_LINE : unheard.ideas ? IDEAS_LINE : QUEUE_LINE)

/** "Claude is listening", or "Claude was told 2 min ago" when its wait has just handed it work. */
export function agentsWords(agents, now = Date.now()) {
  const live = agents.filter(a => !a.told)
  if (live.length) return `${names(live)} ${many(live) ? 'are' : 'is'} listening`
  return agents.length ? `${names(agents)} ${many(agents) ? 'were' : 'was'} told ${waited(agents.map(a => a.told).sort().at(-1), now)} ago` : ''
}

/**
 * The small sign: `state` is 'none' (an older server: say nothing), 'on', 'off', 'waking' or 'warn'. Only 'waking' and 'warn'
 * are shown (see signShows): while an agent listens, or nothing waits, there is nothing the person needs to do. `words` show
 * beside the sign. `tip` is the whole of it, for the hover, with how to start an agent in one sentence.
 */
export function signOf(listening, now = Date.now()) {
  if (!listening?.unheard) return { state: 'none', words: '', tip: '' }
  const { agents, unheard, wake } = listening
  const waits = unheardCount(listening)
  const who = agentsWords(agents, now)
  if (!waits) return who ? { state: 'on', words: '', tip: who } : { state: 'off', words: '', tip: 'No agent is listening' }
  const what = waitsWords(unheard)
  if (wake?.status === 'waking') return { state: 'waking', words: 'Waking your agent…', tip: `Waking ${wake.by}. ${what}` }
  // An agent that listens for something else does not hear this.
  return { state: 'warn', words: who ? 'Not heard yet' : 'No agent is listening', tip: `${who ? `${who}, but not for this` : 'No agent is listening'}. ${what} ${howWords(listening)}` }
}

/** Whether the sign is shown at all: only when the person should know, because work waits that no agent will hear. */
export const signShows = sign => sign.state === 'warn' || sign.state === 'waking'

/** How to start an agent, in one short sentence. */
export const howWords = listening => (listening.wake && !listening.wake.on ? 'To start one, turn on Wake in the menu.' : `To start one, tell your agent: "${lineFor(listening.unheard)}"`)

/**
 * What to say when work waits and nobody hears it: one plain line, a second when there is more to do, the last line of the
 * wake log when a run failed, and the line to give an agent when nothing can wake it. `made` is what an answer just made
 * ('build', 'round' or 'marks'), or null when the person only asked.
 */
export function unheardWords(listening, made = null) {
  const { unheard, wake, agents } = listening
  const done = made === 'build' ? 'Approved. ' : made ? 'Your marks are in. ' : ''
  const stays = made === 'build' || (!made && unheard.queue) ? 'nothing will be built yet' : !made && !unheard.marks && unheard.ideas ? 'no ideas will come yet' : 'nothing will change yet'
  const line = made === 'marks' ? MARKS_LINE : made ? QUEUE_LINE : lineFor(unheard)
  if (wake?.status === 'waking') return { state: 'waking', head: `${done}Waking your agent…`, sub: `${wake.by} starts by itself. This takes a minute or two.`, log: '', line: '', setup: false }
  if (wake?.status === 'failed' || wake?.status === 'late' || wake?.status === 'stuck') {
    const head = { failed: 'Your agent did not start.', late: 'Your agent was started, but it does not listen yet.', stuck: 'Your agent has run for over 30 minutes and does not listen.' }[wake.status]
    const sub = { failed: 'The wake command ended, and the work still waits.', late: 'It can be slow. If nothing happens, start it yourself.', stuck: 'Markback no longer waits for it, and starts it again for new work.' }[wake.status]
    return { state: 'warn', head: `${done}${head}`, sub: `${sub} Open your agent and give it this line:`, log: wake.lastLine ?? '', line, setup: false }
  }
  const nobody = agents.length ? `${agentsWords(agents)}, but not for this, so ${stays}.` : `No agent is listening, so ${stays}.`
  return { state: 'warn', head: `${done}${nobody}`, sub: wake ? 'Wake is off. Turn it on in the menu, or give your agent this line:' : 'Give your agent this line:', log: '', line, setup: !wake }
}

/** The quiet line when an agent will hear it. */
export const heardWords = (agents, now = Date.now()) => {
  const live = agents.filter(a => !a.told)
  return live.length ? `${names(live)} ${many(live) ? 'are' : 'is'} listening and will take this.` : `${agentsWords(agents, now)}.`
}
