import { createListener, findRoute, installPack } from './mic.js'
import { SETUP_LINE, signOf, signShows, unheardWords, waited } from './listen.js'

/**
 * Ideas and the queue. It reads the same files the sessions read, every few seconds, so it says what is true. Nothing here
 * thinks: asking for ideas writes a request, and a session answers it.
 */

const $ = id => document.getElementById(id)
const esc = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const svg = body => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
const ICONS = {
  up: svg('<path d="M8 13V3M4 7l4-4 4 4"/>'),
  down: svg('<path d="M8 3v10M4 9l4 4 4-4"/>'),
  note: svg('<path d="M2.5 3h11v8h-6l-3 2.5V11h-2z"/>'),
  mic: svg('<rect x="6" y="1.5" width="4" height="8" rx="2"/><path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5M5.5 14.5h5"/>'),
}
const STAGES = [['queued', 'Queued'], ['progress', 'In progress'], ['ready', 'Ready for you'], ['done', 'Done']]

const state = {
  page: location.hash === '#ideas' ? 'ideas' : 'queue',
  items: [],
  requests: [],
  // Who listens and what waits unheard. Unset with a server from before it said so.
  listening: null,
  open: new Set(),
  folded: new Set(['done', 'later', 'no']),
  focus: null,
  drafts: new Map(),
  target: '',
  count: 10,
}

const post = async (action, body) => {
  const res = await fetch(`/api/work/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const got = await res.json()
  if (!res.ok) throw new Error(got.error || 'That did not work.')
  return got
}

let toastTimer = 0
function toast(words) {
  $('toast').textContent = words
  $('toast').hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { $('toast').hidden = true }, 3200)
}
const attempt = async run => {
  try {
    await run()
    await load(true)
  } catch (error) {
    toast(error.message)
  }
}

let last = ''
async function load(force = false) {
  const got = await (await fetch('/api/work', { cache: 'no-store' })).json()
  const text = JSON.stringify(got)
  if (text === last && !force) return
  last = text
  state.items = got.items
  state.requests = got.requests
  state.listening = got.listening ?? null
  // Never redraw under someone's hands.
  if (!dragging) render()
}

/* ---------- drawing ---------- */

/* What is asked, in plain words in its own column. Marks back says something, so it is in ink. */
const phaseWords = item => (item.marksBack ? `<span class="phase marks">Marks back, round ${item.round}</span>` : `<span class="phase">${item.phase === 'build' ? 'Build it' : 'Proposal'}</span>`)
const when = iso => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const inStage = stage => state.items.filter(i => i.stage === stage)

/**
 * Columns that say the same on every row are left out. What it is for shows when there is more than one; who has it shows
 * only in progress, and only when that is not the same session for all: the section head says it then.
 */
const workItems = () => state.items.filter(i => STAGES.some(([stage]) => stage === i.stage))
const showTarget = () => new Set(workItems().map(i => i.target)).size > 1
const owners = () => new Set(inStage('progress').map(i => i.owner || ''))
const showWho = () => owners().size > 1
const columns = () => ['34px', 'minmax(0, 1fr)', '150px', ...(showTarget() ? ['140px'] : []), ...(showWho() ? ['150px'] : []), '140px'].join(' ')

/** When it last joined the queue: how long it has waited is counted from here. */
const queuedSince = item => (item.history ?? []).filter(h => h.stage === 'queued').at(-1)?.at ?? item.at
const copyRow = line => `<div class="copy-line"><code>${esc(line)}</code><button class="btn" data-copy="${esc(line)}">Copy</button></div>`
/** At the top, when what is on this page waits and no agent will hear it: what that means, and what to do. */
function listenStrip(kind) {
  const l = state.listening
  if (!l?.unheard?.[kind]) return ''
  const w = unheardWords({ agents: l.agents, wake: l.wake, unheard: { queue: 0, ideas: 0, marks: 0, [kind]: l.unheard[kind] } })
  return `<div class="heard-strip${w.state === 'warn' ? ' warn' : ''}" role="status"><p>${esc(w.head)}</p><p class="sub">${esc(w.sub)}</p>${w.log ? `<p class="sub">It last said:</p><pre>${esc(w.log)}</pre>` : ''}${w.line ? copyRow(w.line) : ''}${w.setup ? `<p class="sub">Your agent can start by itself next time. Ask it once:</p>${copyRow(SETUP_LINE)}` : ''}</div>`
}

function row(item, at, stage) {
  const queued = stage === 'queued'
  const lane = inStage(stage)
  const notes = item.notes?.length ?? 0
  return `<div class="row" tabindex="0" data-id="${esc(item.id)}"${queued ? ' draggable="true"' : ''} aria-label="${esc(item.title)}" style="grid-template-columns: ${columns()}">
    <span class="pos">${queued ? at + 1 : ''}</span>
    <span class="cell"><span class="name">${esc(item.title)}</span>${queued ? `<span class="wait${state.listening?.unheard?.queue ? ' unheard' : ''}">Waiting ${waited(queuedSince(item))}. No agent has taken it.</span>` : ''}</span>
    ${phaseWords(item)}
    ${showTarget() ? `<span class="target" title="${esc(item.target)}">${esc(item.target)}</span>` : ''}
    ${showWho() ? `<span class="who">${esc(stage === 'progress' ? item.owner : '')}</span>` : ''}
    <span class="acts">
      ${stage === 'ready' && item.app ? `<a class="btn${at === 0 ? ' primary' : ''}" href="/#${esc(slugOf(item.app))}">Review</a>` : ''}
      ${queued ? `<button class="tool" data-up aria-label="Move up" title="Move up (⇧↑)"${at === 0 ? ' disabled' : ''}>${ICONS.up}</button><button class="tool" data-down aria-label="Move down" title="Move down (⇧↓)"${at === lane.length - 1 ? ' disabled' : ''}>${ICONS.down}</button>` : ''}
      <button class="tool note-btn${notes ? ' has-notes' : ''}" data-open aria-label="${notes ? `${notes} note${notes === 1 ? '' : 's'}` : 'Notes'}" title="Notes (N)">${ICONS.note}${notes ? `<span>${notes}</span>` : ''}</button>
    </span>
  </div>${state.open.has(item.id) ? `<div class="open" data-open-for="${esc(item.id)}">
    ${item.why ? `<p>${esc(item.why)}</p>` : ''}
    ${(item.notes ?? []).map(n => `<div class="note-line"><b>${esc(n.by)}</b><time>${when(n.at)}</time>${esc(n.text)}</div>`).join('')}
    <div class="note-add"><textarea data-note-box rows="1" placeholder="Add a note">${esc(state.drafts.get(item.id) ?? '')}</textarea><button class="btn" data-add-note>Add</button></div>
  </div>` : ''}`
}
const slugOf = text => String(text).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

const EMPTY_WORDS = { queued: 'queued', progress: 'in progress', ready: 'ready for you', done: 'done' }
/** "Nothing queued, in progress or done." */
const nothingLine = stages => {
  const words = stages.map(stage => EMPTY_WORDS[stage])
  return `Nothing ${words.length > 1 ? `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}` : words[0]}.`
}

/** Sections with something in them, in order. The empty ones say so together, in one quiet line at the foot. */
function queuePage() {
  const empty = STAGES.filter(([stage]) => !inStage(stage).length).map(([stage]) => stage)
  const one = owners().size === 1 ? [...owners()][0] : ''
  return `${listenStrip('queue')}${STAGES.filter(([stage]) => !empty.includes(stage)).map(([stage, words]) => {
    const list = inStage(stage)
    const shown = stage === 'done' ? list.slice().reverse() : list
    const folded = state.folded.has(stage)
    const head = stage === 'done'
      ? `<button data-fold="${stage}" aria-expanded="${!folded}">${folded ? '▸' : '▾'} ${words}</button>`
      : words
    const by = stage === 'progress' && one ? ` · ${esc(one)}` : ''
    return `<section><h2 class="section-head">${head} <span>${list.length}${by}</span></h2>
      ${folded ? '' : `<div class="rows" data-lane="${stage}">${shown.map((item, at) => row(item, at, stage)).join('')}</div>`}</section>`
  }).join('')}${empty.length ? `<p class="empty-line">${nothingLine(empty)}</p>` : ''}`
}

const decideButtons = item => `<span class="acts"><button class="btn" data-decide="yes" title="Y">Yes</button>${item.stage === 'no' ? '' : '<button class="btn" data-decide="no" title="N">No</button>'}${item.stage === 'later' ? '' : '<button class="btn" data-decide="later" title="L">Later</button>'}</span>`
// Who it is for only when there is more than one to tell apart.
const manyTargets = () => new Set(state.items.filter(i => ['idea', 'later', 'no'].includes(i.stage)).map(i => i.target)).size > 1
const ideaRow = item => `<div class="idea" tabindex="0" data-id="${esc(item.id)}"><div><div class="what">${esc(item.title)}</div><div class="why">${esc(item.why)}</div>${manyTargets() ? `<div class="for">${esc(item.target)}</div>` : ''}</div><span class="size" title="Size">${esc(item.size)}</span>${decideButtons(item)}</div>`

function ideasPage() {
  const asked = state.requests.filter(r => r.status === 'open')
  const known = [...new Set([...state.requests.map(r => r.target)])]
  const fresh = inStage('idea')
  const section = (stage, words) => {
    const list = inStage(stage)
    if (!list.length) return ''
    const folded = state.folded.has(stage)
    return `<section><h2 class="section-head"><button data-fold="${stage}" aria-expanded="${!folded}">${folded ? '▸' : '▾'} ${words}</button> <span>${list.length}</span></h2>${folded ? '' : `<div class="rows">${list.map(ideaRow).join('')}</div>`}</section>`
  }
  return `${listenStrip('ideas')}<form class="ask" id="askForm">
      <label for="target">Ideas for</label>
      <input id="target" list="targets" placeholder="An app, a server, anything" value="${esc(state.target)}" autocomplete="off">
      <datalist id="targets">${known.map(t => `<option value="${esc(t)}">`).join('')}</datalist>
      <label for="count">How many</label>
      <input id="count" type="number" min="1" max="50" value="${state.count}">
      <button class="btn primary">Get ideas</button>
    </form>
    ${asked.map(r => `<p class="waiting-line">Asked for ${r.count} on ${esc(r.target)}. ${r.posted ? `${r.posted} so far.` : 'Waiting for a session.'}</p>`).join('')}
    <h2 class="section-head">To decide <span>${fresh.length}</span></h2>
    ${fresh.length ? `<div class="rows">${fresh.map(ideaRow).join('')}</div>` : '<div class="empty-line">Nothing</div>'}
    ${section('later', 'Later')}${section('no', 'No')}`
}

function render() {
  const typing = document.activeElement?.closest?.('#askForm, [data-note-box]')
  if (typing) return
  for (const b of document.querySelectorAll('[data-page]')) b.classList.toggle('on', b.dataset.page === state.page)
  document.title = `Markback · ${state.page === 'ideas' ? 'Ideas' : 'Queue'}`
  $('page').innerHTML = `<div class="work-inner">${state.page === 'ideas' ? ideasPage() : queuePage()}</div>`
  if (state.focus) document.querySelector(`[data-id="${CSS.escape(state.focus)}"]`)?.focus({ preventScroll: false })
  // Said only when work waits that no agent will hear. While one listens, the bar says nothing.
  const sign = signOf(state.listening)
  $('heardLine').className = `heard-line is-${sign.state}`
  $('heardLine').textContent = signShows(sign) ? sign.words : ''
  $('heardLine').title = sign.tip
  renderMic()
}

/* ---------- order: drag, buttons or keys ---------- */

const queuedIds = () => inStage('queued').map(i => i.id)
function moveTo(ids) {
  const byId = new Map(state.items.map(i => [i.id, i]))
  // Shown at once; the file follows.
  ids.forEach((id, rank) => { byId.get(id).rank = rank })
  state.items.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
  render()
  void attempt(() => post('order', { ids }))
}
function moveBy(id, by) {
  const ids = queuedIds()
  const at = ids.indexOf(id)
  const to = at + by
  if (at < 0 || to < 0 || to >= ids.length) return
  ids.splice(at, 1)
  ids.splice(to, 0, id)
  state.focus = id
  moveTo(ids)
}

let dragging = null
const page = $('page')
page.addEventListener('dragstart', event => {
  const row = event.target.closest?.('.row[draggable="true"]')
  if (!row) return
  dragging = row.dataset.id
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', dragging)
  row.classList.add('dragging')
})
const clearMarks = () => document.querySelectorAll('.drop-before, .drop-after').forEach(el => el.classList.remove('drop-before', 'drop-after'))
const dropSpot = event => {
  const row = event.target.closest?.('[data-lane="queued"] .row')
  if (!row || row.dataset.id === dragging) return null
  const box = row.getBoundingClientRect()
  return { row, after: event.clientY > box.top + box.height / 2 }
}
page.addEventListener('dragover', event => {
  if (!dragging) return
  const spot = dropSpot(event)
  clearMarks()
  if (!spot) return
  event.preventDefault()
  spot.row.classList.add(spot.after ? 'drop-after' : 'drop-before')
})
page.addEventListener('drop', event => {
  if (!dragging) return
  const spot = dropSpot(event)
  if (!spot) return
  event.preventDefault()
  const moved = dragging
  const ids = queuedIds().filter(id => id !== moved)
  const at = ids.indexOf(spot.row.dataset.id) + (spot.after ? 1 : 0)
  ids.splice(at, 0, moved)
  dragging = null
  state.focus = moved
  clearMarks()
  moveTo(ids)
})
page.addEventListener('dragend', () => {
  dragging = null
  clearMarks()
  render()
})

/* ---------- presses ---------- */

function toggleOpen(id, into = false) {
  if (state.open.has(id) && !into) state.open.delete(id)
  else state.open.add(id)
  state.focus = id
  render()
  if (state.open.has(id) && into) document.querySelector(`[data-open-for="${CSS.escape(id)}"] [data-note-box]`)?.focus()
}
function addNoteFrom(box) {
  const id = box.closest('[data-open-for]').dataset.openFor
  const text = box.value.trim()
  if (!text) return
  mic.listener?.stop()
  state.drafts.delete(id)
  box.value = ''
  box.blur()
  state.focus = id
  void attempt(() => post('note', { id, text }))
}
function decideOn(id, decision) {
  // The next one is ready for the next press.
  const rows = [...document.querySelectorAll('.idea')].map(el => el.dataset.id)
  state.focus = rows[rows.indexOf(id) + 1] ?? rows[rows.indexOf(id) - 1] ?? null
  void attempt(() => post('decide', { id, decision }))
}
page.addEventListener('click', event => {
  const fold = event.target.closest('[data-fold]')
  if (fold) {
    const key = fold.dataset.fold
    if (state.folded.has(key)) state.folded.delete(key)
    else state.folded.add(key)
    return render()
  }
  const copy = event.target.closest('[data-copy]')
  if (copy) {
    // The clipboard can be refused. The line is selected instead, ready to copy with the keys.
    return void (navigator.clipboard?.writeText(copy.dataset.copy) ?? Promise.reject(new Error('no clipboard'))).then(() => { copy.textContent = 'Copied' }, () => {
      getSelection().selectAllChildren(copy.previousElementSibling)
      copy.textContent = 'Selected: copy it'
    })
  }
  const add = event.target.closest('[data-add-note]')
  if (add) return addNoteFrom(add.parentElement.querySelector('[data-note-box]'))
  const row = event.target.closest('[data-id]')
  if (!row) return undefined
  const id = row.dataset.id
  const decision = event.target.closest('[data-decide]')?.dataset.decide
  if (decision) return decideOn(id, decision)
  if (event.target.closest('[data-up]')) return moveBy(id, -1)
  if (event.target.closest('[data-down]')) return moveBy(id, 1)
  if (event.target.closest('a')) return undefined
  if (row.classList.contains('row')) return toggleOpen(id)
  return undefined
})
page.addEventListener('input', event => {
  const box = event.target.closest?.('[data-note-box]')
  if (box) state.drafts.set(box.closest('[data-open-for]').dataset.openFor, box.value)
})
page.addEventListener('submit', event => {
  event.preventDefault()
  const target = $('target').value.trim()
  state.count = Number($('count').value) || 10
  state.target = target
  if (!target) return toast('Say what the ideas are for.')
  document.activeElement?.blur()
  return void attempt(() => post('ask', { target, count: state.count }))
})
for (const b of document.querySelectorAll('[data-page]')) b.onclick = () => showPage(b.dataset.page)
function showPage(name) {
  state.page = name
  state.focus = null
  location.replace(`#${name}`)
  render()
}

document.addEventListener('keydown', event => {
  const typing = event.target.closest?.('input, textarea')
  const box = event.target.closest?.('[data-note-box]')
  const mod = event.metaKey || event.ctrlKey
  if (box && event.key === 'Enter' && (mod || !event.shiftKey)) {
    event.preventDefault()
    return addNoteFrom(box)
  }
  if (event.key === 'Escape' && typing) return event.target.blur()
  if (typing || mod || event.altKey) return undefined
  const key = event.key.toLowerCase()
  if (key === 'r') location.href = '/'
  else if (key === 'q') showPage('queue')
  else if (key === 'i') showPage('ideas')
  else if (key === 'd') pressMic()
  const row = event.target.closest?.('[data-id]')
  const rows = [...document.querySelectorAll('[data-id]')]
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const by = event.key === 'ArrowDown' ? 1 : -1
    if (row && event.shiftKey) return moveBy(row.dataset.id, by)
    const next = rows[Math.max(0, Math.min(rows.length - 1, rows.indexOf(row) + by))]
    next?.focus()
    state.focus = next?.dataset.id ?? null
    return undefined
  }
  if (!row) return undefined
  const id = row.dataset.id
  if (row.classList.contains('idea')) {
    const decision = { y: 'yes', n: 'no', l: 'later' }[key]
    if (decision) decideOn(id, decision)
  } else if (key === 'n') {
    event.preventDefault()
    toggleOpen(id, true)
  } else if (key === 'enter') {
    toggleOpen(id)
  }
  return undefined
})

/* ---------- speaking a note ---------- */

const mic = { route: null, listener: null }
function renderMic() {
  const button = $('micBtn')
  const route = mic.route
  // A note is the only thing to speak into, and those are on the queue.
  button.hidden = !route || state.page !== 'queue'
  if (!route) return
  const on = !!mic.listener?.on
  button.classList.toggle('listening', on)
  button.innerHTML = `${ICONS.mic}<span>${on ? 'Listening' : route.route === 'cloud' ? `Speak (${route.goesTo} cloud)` : 'Speak'}</span><span class="kbd">D</span>`
  button.title = route.route === 'none' ? route.why : 'Speak into the open note'
}
const noteBox = () => document.activeElement?.closest?.('[data-note-box]') ?? document.querySelector('[data-note-box]')
async function pressMic() {
  const route = mic.route
  if (!route) return
  if (route.route === 'none') return toast(route.why)
  if (mic.listener?.on) return mic.listener.stop()
  if (!noteBox()) return toast('Open a note first: press N on a row.')
  if (route.route === 'install') {
    if (!confirm('Fetch a language pack? About 60 MB, once, from Google. After that, speech stays on this computer.')) return
    await installPack(route.lang)
    mic.route = { ...route, route: 'device' }
  }
  if (mic.route.route === 'cloud') {
    let allowed = false
    try {
      allowed = localStorage.getItem('review:ui:mic-cloud') === 'on'
    } catch {
      allowed = false
    }
    if (!allowed) {
      if (!confirm(`This browser sends the sound to ${route.goesTo} to turn it into words. Turn it on?`)) return
      try {
        localStorage.setItem('review:ui:mic-cloud', 'on')
      } catch {
        // It asks again next time.
      }
    }
  }
  const box = noteBox()
  box.focus()
  mic.listener ??= createListener({ box: noteBox, local: mic.route.route === 'device', lang: route.lang, onState: renderMic, onProblem: toast })
  mic.listener.start()
}
$('micBtn').onclick = () => void pressMic()
void findRoute().then(route => {
  mic.route = route
  renderMic()
})

await load(true)
setInterval(() => void load().catch(() => undefined), 3000)
// How long each item has waited is said again every minute, also when nothing else changes.
setInterval(() => !dragging && render(), 60000)
