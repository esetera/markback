import { burnCanvas, changesBetween, COLOURS, fitZoom, isReal, paintChanged, paintMarks, redone, shapeOf, strokeFor, textFor, undone, withMark, withMarks, ZOOM_STEP, ZOOM_WHEEL_STEP, zoomedBy } from './annotate.js'
import { createListener, findRoute, installPack } from './mic.js'
import { afterSend, answerWords, finishedWords, groupsIn, leftBehind, lookOf, nameParts, nextApp, nextWords, orderedApps, placeIn, placeWords, standingAnswer, submitJobs } from './flow.js'

/**
 * The wizard is the review: the picture fills the window, with one thin bar above it, what it is about under that, and a slim
 * foot for notes and answers. Looks good and Send go straight on: the answer waits a few seconds, so it can be undone, then
 * goes by itself, and the next pictures are ready before they are asked for. When the last screen of an app is answered the
 * app is done, with nothing left to press for what was answered already. A drawer over the picture finds apps and screens.
 * The panel view keeps the strip and the details, for those who want them.
 *
 * Draw on the after picture and sending burns the marks into a copy and drops it, with the shapes as numbers, into the inbox.
 * Drafts stay in this browser until they have gone, so nothing is lost by closing it.
 */

const $ = id => document.getElementById(id)
const svg = (body, extra = '') => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`
const ICONS = {
  box: svg('<rect x="2.5" y="3.5" width="11" height="9" rx="0.5"/>'),
  arrow: svg('<path d="M3 13 13 3M6.5 3H13v6.5"/>'),
  pen: svg('<path d="M2.5 13.5 3 10.5 11 2.5l2.5 2.5-8 8z"/><path d="M9.5 4l2.5 2.5"/>'),
  text: svg('<path d="M3 4V3h10v1M8 3v10M6 13h4"/>'),
  pan: svg('<path d="M8 1.5v13M1.5 8h13M8 1.5 6.2 3.3M8 1.5l1.8 1.8M8 14.5l-1.8-1.8M8 14.5l1.8-1.8M1.5 8l1.8-1.8M1.5 8l1.8 1.8M14.5 8l-1.8-1.8M14.5 8l-1.8 1.8"/>'),
  undo: svg('<path d="M5.5 3 2.5 6l3 3"/><path d="M2.5 6H10a3.5 3.5 0 0 1 0 7H6"/>'),
  redo: svg('<path d="M10.5 3l3 3-3 3"/><path d="M13.5 6H6a3.5 3.5 0 0 0 0 7h4"/>'),
  clear: svg('<path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 9h6.6l.7-9M6.7 7v4.5M9.3 7v4.5"/>'),
  mic: svg('<rect x="6" y="1.5" width="4" height="8" rx="2"/><path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5M5.5 14.5h5"/>'),
  tag: svg('<path d="M2 2.5v5l6.5 6.5 5.5-5.5L7.5 2.5H2z"/><path d="M5 5.5v.1" stroke-width="2"/>'),
  changes: svg('<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10M8 6.5v3M6.5 8h3"/>'),
  zoomIn: svg('<circle cx="7" cy="7" r="4.5"/><path d="M10.3 10.3 14 14M5 7h4M7 5v4"/>'),
  zoomOut: svg('<circle cx="7" cy="7" r="4.5"/><path d="M10.3 10.3 14 14M5 7h4"/>'),
  fit: svg('<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>'),
  quiet: svg('<path d="M2.5 6V2.5H6M2.5 2.5l4 4M13.5 6V2.5H10M13.5 2.5l-4 4M2.5 10v3.5H6M2.5 13.5l4-4M13.5 10v3.5H10M13.5 13.5l-4-4"/>'),
  exit: svg('<path d="M6 2.5V6H2.5M6 6 2 2M10 2.5V6h3.5M10 6l4-4M6 13.5V10H2.5M6 10l-4 4M10 13.5V10h3.5M10 10l4 4"/>'),
  sidebar: svg('<rect x="1.5" y="2.5" width="13" height="11" rx="1"/><path d="M5.5 2.5v11"/>'),
  help: svg('<circle cx="8" cy="8" r="6.5"/><path d="M6.2 6.2a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1v.4"/><path d="M8 11.6v.1" stroke-width="2"/>'),
  prev: svg('<path d="M10 3 5 8l5 5"/>'),
  next: svg('<path d="m6 3 5 5-5 5"/>'),
  close: svg('<path d="m4 4 8 8M12 4l-8 8"/>'),
  check: svg('<path d="m3 8.5 3.2 3L13 4.5"/>'),
  list: svg('<path d="M2.5 4h11M2.5 8h11M2.5 12h11"/>'),
  more: svg('<circle cx="3.5" cy="8" r="0.6"/><circle cx="8" cy="8" r="0.6"/><circle cx="12.5" cy="8" r="0.6"/>'),
}
const TOOLS = [
  { id: 'box', tip: 'Box round what is wrong', key: 'B' },
  { id: 'arrow', tip: 'Point with an arrow', key: 'A' },
  { id: 'pen', tip: 'Draw freehand', key: 'P' },
  { id: 'text', tip: 'Write on the picture', key: 'T' },
  { id: 'pan', tip: 'Drag the picture around', key: 'M' },
]
const VIEWS = [
  { id: 'after', label: 'After' },
  { id: 'side', label: 'Side by side' },
  { id: 'before', label: 'Before' },
]
const STATUS = { waiting: 'Waiting', sent: 'Changes sent', approved: 'Approved' }
const KEYS = [
  ['Moving around', [
    [['←', '→'], 'Previous or next screen'],
    [['[', ']'], 'Previous or next app'],
    [['↩'], 'Start the next review, when it is offered'],
    [['S'], 'Stop here: nothing is lost'],
    [['X'], 'Set the rest of this group aside, or the row in the list'],
    [['L'], 'Apps and screens'],
    [['W'], 'Ideas and the queue of work'],
    [['V'], 'After, side by side, before'],
    [['C'], 'Show or hide where it changed'],
    [['I'], 'The rest of the words'],
    [['Q'], 'Panel view'],
    [['F'], 'Full screen'],
    [['Esc'], 'Close or cancel. Words stay'],
    [['?'], 'This list'],
  ]],
  ['Drawing', [
    [['B'], 'Box'], [['A'], 'Arrow'], [['P'], 'Pen'], [['T'], 'Text'], [['M'], 'Move the picture'],
    [['1', '–', '4'], 'Red, amber, blue, black'],
    [['⌘', 'Z'], 'Undo'], [['⇧', '⌘', 'Z'], 'Redo'],
    [['+', '−'], 'Zoom in, zoom out'], [['0'], 'Fit the screen'], [['⌘', 'scroll'], 'Zoom'],
  ]],
  ['Answering', [
    [['N'], 'Write notes on this screen'],
    [['D'], 'Speak your notes'],
    [['G'], 'Looks good, then on to the next'],
    [['⌘', '↩'], 'Send, then on to the next'],
    [['U'], 'Undo the last answer, while it says so'],
    [['⇧', '⌘', '↩'], 'Looks good for all the rest'],
  ]],
]
/** How long an answer can be taken back before it goes. */
const UNDO_MS = Number(new URLSearchParams(location.search).get('undo')) || 4000
const AHEAD = 3
const HELD_PICTURES = 14

const prefs = {
  get(name) {
    try {
      return localStorage.getItem(`review:ui:${name}`)
    } catch {
      return null
    }
  },
  set(name, value) {
    try {
      localStorage.setItem(`review:ui:${name}`, value)
    } catch {
      // Only a convenience.
    }
  },
}

const state = {
  apps: [],
  loaded: false,
  appSlug: null,
  index: 0,
  tool: TOOLS.some(t => t.id === prefs.get('tool')) ? prefs.get('tool') : 'box',
  colour: COLOURS.some(c => c.value === prefs.get('colour')) ? prefs.get('colour') : COLOURS[0].value,
  view: 'after',
  zoom: 1,
  fitted: true,
  size: null,
  shownKey: null,
  busy: false,
  showDone: false,
  end: null,
  stepTo: null,
  stopped: false,
  sideChecks: false,
  arriving: false,
  broken: '',
  moreOf: '',
  lineCut: false,
  changesOn: true,
}
if (prefs.get('strip') === 'hidden') document.body.classList.add('no-strip')
if (prefs.get('details') === 'hidden') document.body.classList.add('no-details')
const panels = () => document.body.classList.contains('panels')
const drafts = new Map()
const histories = new Map()
/** Answered here and not yet in what the server last said: its next answer may be from before this one went. */
const answeredHere = new Map()
let draft = null // the mark being drawn right now
let lastQueue = ''

const store = {
  get(key) {
    try {
      return JSON.parse(localStorage.getItem(`review:${key}`) || 'null')
    } catch {
      return null
    }
  },
  set(key, value) {
    try {
      if (value) localStorage.setItem(`review:${key}`, JSON.stringify(value))
      else localStorage.removeItem(`review:${key}`)
    } catch {
      // Drafts are a convenience; the screen still works without them.
    }
  },
}

const app = () => state.apps.find(a => a.slug === state.appSlug) ?? null
const screen = () => app()?.screens[state.index] ?? null
const keyOf = s => `${s.appSlug}/${s.id}/${s.round}`
/**
 * A draft belongs to one picture. A round number does not say which: clearing an app and pushing it again starts at round 1
 * with a new picture. One saved without its picture (from before they were tied together), or on another picture, can only
 * be trusted so far: a Looks good on it means nothing here, and its marks and words stay in view but go only on a press.
 */
function draftOf(s) {
  const key = keyOf(s)
  const held = drafts.get(key)
  if (held?.after === s.after) return held
  const saved = store.get(key)
  const sure = saved?.after === s.after
  const marks = saved?.marks ?? []
  const notes = saved?.notes ?? ''
  const d = { after: s.after, marks, notes, good: sure && !!saved?.good, pending: sure && !!saved?.pending, pendingAt: (sure && saved?.pendingAt) || 0, unsure: !sure && (marks.some(isReal) || !!notes.trim()), undo: [], redo: [] }
  drafts.set(key, d)
  return d
}
/** What was left unsent on this screen in an older round. */
const leftBehindOn = s => leftBehind(s.round, r => store.get(`${s.appSlug}/${s.id}/${r}`), isReal)
const saveDraft = s => {
  const d = draftOf(s)
  store.set(keyOf(s), d.marks.length || d.notes.trim() || d.good ? { marks: d.marks, notes: d.notes, good: d.good, pending: d.pending, pendingAt: d.pendingAt, after: d.unsure ? undefined : s.after } : null)
}
/** What this screen's draft would send: 'changes', 'approved', or null when nothing is on it yet. */
function verdictOf(s) {
  const d = draftOf(s)
  if (d.marks.some(isReal) || d.notes.trim()) return 'changes'
  return d.good ? 'approved' : null
}
/** Something is on it to go by itself. Marks that cannot be trusted to this picture wait to be looked at. */
const saysAnswer = s => !!verdictOf(s) && !draftOf(s).unsure
const waitingOf = a => (a ? a.screens.filter(s => s.status === 'waiting') : [])
/** What the page will offer next by itself: something to answer, and not set aside. */
const offered = a => openOf(a).length > 0 && !a.setAside
const ordered = () => orderedApps(state.apps)
const nextOffered = slug => nextApp(ordered(), slug, offered)
const placeOf = a => placeIn(a, state.apps)
const sentHere = new Set()
/** Waiting, and not answered here on its way to the server. */
const openOf = a => waitingOf(a).filter(s => !queued.has(keyOf(s)))
const setOf = a => (a ? a.screens.filter(s => s.status === 'waiting' || verdictOf(s)) : [])
function tallyOf(a) {
  const set = setOf(a)
  const changes = set.filter(s => verdictOf(s) === 'changes')
  const good = set.filter(s => verdictOf(s) === 'approved')
  const untouched = set.filter(s => !verdictOf(s))
  return { set, changes, good, untouched, reviewed: changes.length + good.length }
}
const label = s => `${s.screen}${s.mode ? ` (${s.mode})` : ''}`
/** Whose words the note is. Anything already queued came from a session too. */
const fromWords = s => `From ${s?.from || 'Claude'}`
/** A screen as the latest list has it. */
const liveScreen = s => state.apps.find(a => a.slug === s.appSlug)?.screens.find(x => x.id === s.id) ?? null

/* ---------- loading the queue ---------- */

async function loadQueue() {
  const res = await fetch('/api/queue', { cache: 'no-store' })
  const { apps } = await res.json()
  const text = JSON.stringify(apps)
  state.loaded = true
  document.body.classList.remove('loading')
  resendKept()
  if (text === lastQueue) return
  lastQueue = text
  const before = screen()
  // Pushed again while it is on show. What is being written or drawn belongs to the picture it was started on.
  const newer = before && apps.find(a => a.slug === before.appSlug)?.screens.find(x => x.id === before.id)
  const replaced = !!newer && newer.after !== before.after
  if (replaced) closeTextEntry(true)
  const notice = replaced && verdictOf(before) === 'changes' && !queued.has(keyOf(before)) ? `New picture of ${label(before)}. What you had on the old one is kept under Earlier answers.` : ''
  for (const a of apps) {
    for (const s of a.screens) {
      const here = answeredHere.get(keyOf(s))
      if (!here) continue
      if (s.status === 'waiting') {
        s.status = here.status
        s.sentAt = here.sentAt
        s.feedback = [...(s.feedback ?? []), 'here']
      } else answeredHere.delete(keyOf(s))
    }
  }
  state.apps = apps
  const first = !app()
  if (first) {
    resumeAnswers()
    const [hashApp, hashScreen] = decodeURIComponent(location.hash.slice(1)).split('/')
    const wanted = apps.find(a => a.slug === hashApp)
    // Opened plain, it starts at the next thing to review, and says so. A link opens what it names.
    // Set aside stays set aside: a reload on it is not a reason to be back on it.
    state.arriving = (!hashApp || !!wanted?.setAside) && apps.some(offered)
    state.appSlug = (wanted && (offered(wanted) || (hashScreen && !wanted.setAside)) ? wanted : orderedApps(apps).find(offered) ?? wanted ?? apps[0])?.slug ?? null
    const at = wanted?.setAside ? -1 : app()?.screens.findIndex(s => s.id === hashScreen) ?? -1
    state.index = at >= 0 ? at : firstWaiting()
    state.showDone = at < 0 && !!app() && !apps.some(offered)
    // Back on one that is finished, with more to do: say so, rather than leave the reviewer on it wondering.
    if (at >= 0 && app() && !openOf(app()).length && nextOffered(app().slug)) state.end = app().slug
  } else if (before) {
    // Keep the reviewer where they are when another screen is pushed.
    const at = app().screens.findIndex(s => s.id === before.id)
    state.index = at >= 0 ? at : Math.min(state.index, app().screens.length - 1)
  }
  // Something new has come in while the finished page was up. Answers still on their way are not new.
  if (state.showDone && apps.some(offered)) {
    state.showDone = false
    // Still set aside, and not to be landed on: say where next.
    if (app()?.setAside && openOf(app()).length) state.stepTo = nextOffered(state.appSlug)?.slug ?? null
    else state.end = state.appSlug
  }
  // Words still being typed go on with the box: they are about what is on show now.
  if (replaced && document.activeElement === $('notes') && $('notes').value.trim() && screen()) {
    const d = draftOf(screen())
    if (!d.notes) {
      d.notes = $('notes').value
      saveDraft(screen())
    }
  }
  render()
  if (notice) toast(notice)
}

/** Nothing else waits anywhere: the finished page is up, and no key may answer the screen behind it. */
const onDonePage = () => state.stopped || (state.showDone && !state.apps.some(offered))

/** The first with nothing said on it, or else the first still waiting. */
function firstWaiting() {
  const screens = app()?.screens ?? []
  const open = screens.findIndex(s => s.status === 'waiting' && !saysAnswer(s))
  return Math.max(0, open >= 0 ? open : screens.findIndex(s => s.status === 'waiting'))
}

/* ---------- rendering ---------- */

/** Rebuilds a bit of the page only when it changed, so a click is never lost to a rebuild of the same buttons. */
function setHtml(el, html) {
  if (el._html === html) return
  el.innerHTML = html
  el._html = html
}
const esc = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const when = iso => {
  if (!iso) return ''
  const d = new Date(iso)
  const today = new Date().toDateString() === d.toDateString()
  return today ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
const tip = (text, key) => `data-tip="${esc(text)}"${key ? ` data-key="${esc(key)}"` : ''} aria-label="${esc(text)}"`

/** The marker and words for a screen: a solid square once sent, an outlined one for what has not gone yet. */
function statusOf(s) {
  const v = verdictOf(s)
  if (s.status === 'waiting' || queued.has(keyOf(s))) {
    if (v === 'changes') {
      const n = draftOf(s).marks.filter(isReal).length
      return { mk: 'draft-changes', text: n ? `${n} mark${n === 1 ? '' : 's'}` : 'Notes' }
    }
    if (v === 'approved') return { mk: 'draft-good', text: 'Looks good' }
  }
  return { mk: s.status, text: STATUS[s.status] }
}

/* The drawer: what is here, and the other apps. It is drawn only while it is open. */
const drawerOpen = () => !$('drawer').hidden
function renderDrawer() {
  if (!drawerOpen()) return
  const counts = xs => {
    const waiting = xs.reduce((n, x) => n + openOf(x).length, 0)
    const total = xs.reduce((n, x) => n + x.screens.length, 0)
    return `<span class="num${waiting ? ' has' : ''}">${waiting || '–'}</span><span class="num">${total - waiting || '–'}</span>`
  }
  const newWord = xs => (xs.some(x => x.setAside?.isNew) ? '<span class="new">New round</span>' : '')
  const mark = key => `<span class="mark">${foldOpen(key) ? '▾' : '▸'}</span>`
  const pages = (x, deep, parent) => (foldOpen(`a:${x.slug}`) ? x.screens.map((s, i) => {
    const st = statusOf(s)
    return `<div class="row-line"><button class="row-btn page${deep ? ' deep' : ''}${x.slug === state.appSlug && i === state.index && !state.showDone ? ' current' : ''}" data-go-app="${esc(x.slug)}" data-page="${i}" data-parent="${esc(parent)}" title="${esc(label(s))}"><span class="n">${i + 1}</span><span class="name">${esc(label(s))}</span><i class="mk ${st.mk}" title="${esc(st.text)}"></i></button></div>`
  }).join('') : '')
  const appRow = (x, member) => {
    const key = `a:${x.slug}`
    return `<div class="row-line"><button class="row-btn app${member ? ' member' : ''}${x.slug === state.appSlug && !foldOpen(key) ? ' current' : ''}" data-fold="${esc(key)}" data-app="${esc(x.slug)}" aria-expanded="${foldOpen(key)}" ${member ? `data-parent="g:${esc(nameParts(x.name).group)}"` : ''} title="${esc(x.name)}"><span class="name">${mark(key)}${esc(member ? nameParts(x.name).title : x.name)}${newWord([x])}</span>${counts([x])}</button><button class="row-go" data-go-app="${esc(x.slug)}" aria-label="Open ${esc(x.name)}">Open</button><button class="row-aside" data-aside="${esc(x.slug)}" data-to="${x.setAside ? '0' : '1'}">${x.setAside ? 'Bring back' : 'Set aside'}</button></div>${pages(x, member, key)}`
  }
  const groups = groupsIn(state.apps)
  const entries = (keep, bringBack) => {
    const out = []
    const seen = new Set()
    for (const x of ordered()) {
      if (!keep(x)) continue
      const name = nameParts(x.name).group
      if (!name || !groups.has(name)) {
        out.push(appRow(x, false))
        continue
      }
      if (seen.has(name)) continue
      seen.add(name)
      const members = groups.get(name).map(m => m.app).filter(keep)
      const key = `g:${name}`
      const here = members.some(m => m.slug === state.appSlug)
      out.push(`<div class="row-line"><button class="row-btn app group${here && !foldOpen(key) ? ' current' : ''}" data-fold="${esc(key)}" aria-expanded="${foldOpen(key)}" title="${esc(name)}"><span class="name">${mark(key)}${esc(name)}, ${members.length}${newWord(members)}</span>${counts(members)}</button><button class="row-aside" data-aside="${esc(members.map(m => m.slug).join(' '))}" data-to="${bringBack ? '0' : '1'}">${bringBack ? 'Bring back' : 'Set aside'}</button></div>`)
      if (foldOpen(key)) out.push(...members.map(m => appRow(m, true)))
    }
    return out.join('')
  }
  const hasOpen = x => (groups.get(nameParts(x.name).group)?.map(m => m.app) ?? [x]).some(offered)
  const open = entries(x => !x.setAside && hasOpen(x), false)
  const answered = entries(x => !x.setAside && !hasOpen(x), false)
  const aside = entries(x => !!x.setAside, true)
  setHtml($('drawerList'), `${open ? `<div class="drawer-group"><span>To review</span><span>Waiting · Done</span></div>${open}` : ''}${aside ? `<div class="drawer-group"><span>Set aside</span></div>${aside}` : ''}${answered ? `<div class="drawer-group"><span>All answered</span></div>${answered}` : ''}`)
}
/* Every level folds, and starts closed, even the one in use: the outline on its heading shows where you are. A click opens. */
const folds = {}
const foldOpen = key => !!folds[key]
function toggleFold(key) {
  folds[key] = !foldOpen(key)
  renderDrawer()
}
function openDrawer() {
  if (drawerOpen()) return closeDrawer()
  closeTextEntry(true)
  closeMenu()
  $('drawer').hidden = false
  renderDrawer()
  const here = $('drawerList').querySelector('.row-btn.current') ?? $('drawerList').querySelector('.row-btn')
  here?.focus()
  here?.scrollIntoView({ block: 'center' })
}
function closeDrawer() {
  if (!drawerOpen()) return
  $('drawer').hidden = true
  if ($('drawer').contains(document.activeElement)) document.activeElement.blur()
}

/* The strip, in the panel view only: fifty thumbnails nobody is looking at would slow every swap. */
function renderStrip(a) {
  if (!panels() || !a) {
    setHtml($('stripHead'), '')
    setHtml($('screenList'), '')
    return
  }
  const waiting = openOf(a).length
  setHtml($('stripHead'), `<div class="t">${esc(a.name)}</div><div class="s">${a.screens.length} · ${waiting ? `${waiting} waiting` : 'all answered'}</div>`)
  setHtml($('screenList'), a.screens.map((s, i) => {
    const st = statusOf(s)
    return `<button class="shot-row${i === state.index && !state.showDone ? ' current' : ''}" data-i="${i}" title="${esc(label(s))}"><span class="thumb"><img src="/images/${esc(s.after)}" alt="" loading="lazy" decoding="async"></span><span class="st"><i class="mk ${st.mk}"></i><b>${i + 1}. ${esc(st.text)}</b></span></button>`
  }).join(''))
  $('screenList').querySelector('.shot-row.current')?.scrollIntoView({ block: 'nearest' })
}

function renderAnswers(a, s) {
  if (!s) {
    setHtml($('inspHead'), '')
    setHtml($('yourAnswer'), '')
    setHtml($('history'), '')
    setHtml($('aboutNote'), '')
    $('said').hidden = true
    return
  }
  const st = statusOf(s)
  setHtml($('inspHead'), `<h1>${esc(s.screen)}</h1><dl class="meta"><dt>Status</dt><dd><i class="mk ${st.mk}"></i>${esc(st.text)}</dd>${s.mode ? `<dt>Mode</dt><dd>${esc(s.mode[0].toUpperCase() + s.mode.slice(1))}</dd>` : ''}<dt>Round</dt><dd>${s.round}</dd>${s.sentAt ? `<dt>Answered</dt><dd>${esc(when(s.sentAt))}</dd>` : ''}</dl>`)
  // Nothing has been said on most screens, so most swaps ask the server nothing.
  if (!s.feedback?.length && !histories.has(historyKey(s))) histories.set(historyKey(s), [])
  const records = histories.get(historyKey(s))
  const standing = standingAnswer(records, s.round)
  if (!records) void loadHistory(s)
  // Sent with the set with nothing said: its words are the wizard's, not the reviewer's.
  const said = r => (r.notes && !r.noComment ? `<div class="prose">${esc(r.notes)}</div>` : '')
  setHtml($('yourAnswer'), standing ? `<h3>Your answer</h3><div class="round"><div class="rh"><i class="mk ${standing.verdict === 'approved' ? 'approved' : 'sent'}"></i>${esc(answerWords(standing))}<time>${esc(when(standing.sentAt))}</time></div>${said(standing)}${standing.annotatedUrl ? '<div class="prose small">Drawn on the picture.</div>' : ''}</div>` : '')
  const older = (records ?? []).filter(r => r !== standing)
  const left = leftBehindOn(s)
  const leftHtml = left.map(r => `<div class="round"><div class="rh"><i class="mk draft-changes"></i>Round ${r.round} · Not sent${r.marks ? `, ${r.marks} mark${r.marks === 1 ? '' : 's'}` : ''}</div>${r.notes.trim() ? `<div class="prose">${esc(r.notes)}</div>` : ''}<div class="prose small">Left unsent, and the screen has changed since.</div></div>`).join('')
  setHtml($('history'), older.length || left.length ? `<h3>Earlier answers</h3>${leftHtml}${older.map(r => `<div class="round"><div class="rh"><i class="mk ${r.verdict === 'approved' ? 'approved' : 'sent'}"></i>Round ${r.round} · ${esc(answerWords(r))}<time>${esc(when(r.sentAt))}</time></div>${said(r)}${r.annotatedUrl ? `<button class="pic" data-pic="${esc(r.annotatedUrl)}" data-title="Round ${r.round}, as marked" aria-label="Open round ${r.round} as marked"><img src="${esc(r.annotatedUrl)}" alt="" loading="lazy"></button>` : ''}</div>`).join('')}` : '')
  // The small line in the foot, only when there is something behind it.
  const words = standing ? `You sent: ${answerWords(standing)}${standing.notes && !standing.noComment ? `. ${standing.notes}` : ''}` : ''
  const count = older.length + left.length
  const line = [words, count ? `${count} earlier` : ''].filter(Boolean).join(' · ')
  $('said').hidden = !line || panels()
  $('said').textContent = line
  $('said').title = line
  if (!line) document.body.classList.remove('answers-open')
}

/* Proposal says it loudly: this is a new idea to shape, not something built to check. */
function renderKind(s) {
  const proposal = s?.kind === 'proposal'
  $('kindTag').hidden = !s
  $('kindTag').className = `kind${proposal ? ' proposal' : ''}`
  setHtml($('kindTag'), proposal ? `<i>${ICONS.tag}</i><b>Proposal</b>` : 'QA')
}

/* ---------- speaking ---------- */

const mic = { route: null, listener: null, pointer: null, hearing: null }

/**
 * Spoken words on the picture: a short arrow to where the pointer was, so they cover nothing of it, and the words at its tail,
 * in lines that stay on the picture. Below the place, or above it near the foot.
 */
function spokenMarks(words, place) {
  const size = textFor(state.size.w)
  const ctx = $('canvas').getContext('2d')
  ctx.font = `600 ${size}px -apple-system, system-ui, sans-serif`
  const reach = size * 2.6
  const below = place[1] + reach + size * 3 < state.size.h
  const tail = [Math.min(place[0] + reach * 0.7, state.size.w * 0.78), below ? place[1] + reach : place[1] - reach]
  const left = tail[0] + size * 0.4
  const room = state.size.w - left - size
  const lines = []
  for (const word of words.split(' ')) {
    const next = lines.length ? `${lines[lines.length - 1]} ${word}` : word
    if (lines.length && ctx.measureText(next).width <= room) lines[lines.length - 1] = next
    else lines.push(word)
  }
  const top = below ? tail[1] - size * 0.2 : tail[1] - size * 1.3 * lines.length + size * 0.2
  return [
    { tool: 'arrow', a: tail, b: place, color: state.colour, w: strokeFor(state.size.w) },
    ...lines.map((text, n) => ({ tool: 'text', at: [left, top + n * size * 1.3], text, color: state.colour, size })),
  ]
}
function placeSpoken(run) {
  if (!state.size) return
  for (const mark of spokenMarks(run.text, run.at)) commit(mark)
}
function renderMic() {
  const button = $('micBtn')
  const route = mic.route
  button.hidden = !route
  if (!route) return
  const on = !!mic.listener?.on
  button.classList.toggle('listening', on)
  button.classList.toggle('with-words', route.route === 'cloud' || on)
  button.setAttribute('aria-pressed', String(on))
  const cloud = route.route === 'cloud'
  const words = on ? 'Listening' : cloud ? `${route.goesTo} cloud` : ''
  button.innerHTML = `${ICONS.mic}${words ? `<span>${words}</span>` : ''}`
  button.dataset.tip = on ? 'Stop listening' : route.route === 'none' ? route.why : cloud ? `Speak your notes: the sound goes to ${route.goesTo}` : route.route === 'install' ? 'Speak your notes: fetches a language pack once' : 'Speak your notes: stays on this computer'
}
async function pressMic() {
  const route = mic.route
  if (!route) return
  if (route.route === 'none') return toast(route.why)
  if (mic.listener?.on) return mic.listener.stop()
  if (route.route === 'install') {
    if (!(await ask('Fetch a language pack?', 'About 60 MB, once, from Google. After that, speech stays on this computer.', 'Fetch it', 'Not now'))) return
    toast('Fetching the language pack…')
    try {
      await installPack(route.lang)
    } catch (error) {
      return toast('The language pack did not come', error.message, { problem: true })
    }
    mic.route = { ...route, route: 'device' }
    renderMic()
  }
  if (mic.route.route === 'cloud' && prefs.get('mic-cloud') !== 'on') {
    if (!(await ask(`Send your voice to ${route.goesTo}?`, `This browser sends the sound to ${route.goesTo} to turn it into words. Nothing else on this page goes with it.`, 'Turn it on', 'Keep it off'))) return
    prefs.set('mic-cloud', 'on')
  }
  mic.listener ??= createListener({
    box: () => $('notes'),
    local: mic.route.route === 'device',
    lang: route.lang,
    onCommand: command => {
      if (command === 'good') void looksGood(true)
      else if (command === 'next') go(state.index + 1)
      else if (command === 'back') go(state.index - 1)
      else if (command === 'send') sendCurrent()
    },
    onState: renderMic,
    onProblem: words => toast(words, '', { problem: true }),
    pointAt: () => mic.pointer,
    onPlaced: placeSpoken,
    onHearing: (words, place) => {
      mic.hearing = words && place && state.size ? spokenMarks(words, place) : null
      paint()
    },
  })
  mic.listener.start()
}
void findRoute().then(route => {
  mic.route = route
  renderMic()
})

/* A press away: all that was said about the screen, over the picture so the picture does not move. */
const moreOpen = () => !!screen() && state.moreOf === keyOf(screen())
const moreButton = rest => (rest ? `<button class="more" data-more aria-expanded="${moreOpen()}" ${tip(moreOpen() ? 'Show less' : 'Show all of it', 'I')}>${moreOpen() ? 'Less' : 'More'}</button>` : '')
const moreWords = rest => (rest && moreOpen() ? `<div class="more-words">${esc(rest)}</div>` : '')
function toggleMore() {
  const s = screen()
  if (!s || !(lookOf(s).rest || state.lineCut)) return
  state.moreOf = moreOpen() ? '' : keyOf(s)
  placeChecks()
}

/* What to look at, in one line under the bar. The longest in the app holds the height, so moving on moves nothing. */
function renderAbout(a, s) {
  const words = x => lookOf(x).lines.join(' · ')
  const longest = a ? a.screens.reduce((most, x) => (words(x).length > most.length ? words(x) : most), '') : ''
  $('about').hidden = !longest || !s || state.sideChecks
  // Said by whoever pushed it, never the app or the reviewer, and it says so.
  setHtml($('aboutSize'), longest ? `<span class="from">${esc(fromWords(s))}</span>${esc(longest)}` : '')
  const rest = s ? lookOf(s).rest : ''
  const said = rest || (s ? words(s) : '')
  const draw = () => setHtml($('aboutNote'), s && words(s) ? `<span class="from">${esc(fromWords(s))}</span><span class="line" title="${esc(said)}">${esc(words(s))}</span>${moreButton(rest || state.lineCut ? said : '')}${moreWords(rest || state.lineCut ? said : '')}` : '')
  draw()
  // A narrow window can cut even a short line: then there is more to see too.
  const line = $('aboutNote').querySelector('.line')
  const cut = !!line && !rest && line.scrollWidth > line.clientWidth
  if (cut !== state.lineCut) {
    state.lineCut = cut
    draw()
  }
}

const historyKey = s => `${s.appSlug}/${s.id}/${s.feedback?.length ?? 0}`
async function loadHistory(s) {
  const key = historyKey(s)
  if (histories.has(key)) return
  histories.set(key, null)
  try {
    const res = await fetch(`/api/history?app=${encodeURIComponent(s.appSlug)}&id=${encodeURIComponent(s.id)}`, { cache: 'no-store' })
    const { records } = await res.json()
    histories.set(key, records ?? [])
  } catch {
    histories.set(key, [])
  }
  if (screen() && historyKey(screen()) === key) render()
}

function renderFoot(a, s) {
  const v = s ? verdictOf(s) : null
  const good = s && draftOf(s).good && v === 'approved'
  const off = !s ? ' disabled' : ''
  setHtml($('footActions'), `<button class="btn${good ? ' good-on' : ''}" data-act="good"${off} ${tip(good ? 'Looking good; press to take it back' : 'Looks good, and on to the next', 'G')}>${good ? ICONS.check : ''}Looks good</button><button class="btn primary" data-act="send"${v !== 'changes' ? ' disabled' : ''} ${tip('Send your marks and notes, and on to the next', '⌘↩')}>Send</button>`)
}

/* ---------- a change of review: unmissable, and it waits for a press ---------- */

const segmentUp = () => !$('segment').hidden
function renderSegment(a) {
  // Opening the wizard: where this starts, with one press to be in.
  if (state.arriving && a && !onDonePage()) {
    const place = placeOf(a)
    const waiting = state.apps.filter(x => !x.setAside).reduce((n, x) => n + openOf(x).length, 0)
    const reviews = state.apps.filter(offered).length
    $('segment').hidden = false
    $('segment').className = 'segment new-group'
    return setHtml($('segment'), `<div class="segment-in">
      <p class="finished">${waiting} screen${waiting === 1 ? '' : 's'} waiting, in ${reviews} review${reviews === 1 ? '' : 's'}.</p>
      <p class="starting">You are starting with:</p>
      <h1>${esc(placeWords(place))}</h1>
      <p class="what">${esc(nextWords(place, openOf(a).length, a.screens.length))}</p>
      <div class="actions"><button class="btn primary" data-start>Start<span class="kbd">↩</span></button><button class="btn" data-stop>Stop here<span class="kbd">S</span></button></div>
    </div>`)
  }
  const from = a && (state.end === a.slug || state.stepTo) ? a : null
  const target = !from || onDonePage() ? null : state.apps.find(x => x.slug === (state.stepTo ?? nextOffered(from.slug)?.slug))
  $('segment').hidden = !target
  if (!target) return setHtml($('segment'), '')
  const there = placeOf(target)
  const here = placeOf(from)
  const sameGroup = !!here.group && here.group === there.group
  const finished = state.end === from.slug
  const line = finished
    ? finishedWords(here, from.screens, x => x.status === 'sent' || (queued.has(keyOf(x)) && verdictOf(x) === 'changes'))
    : `Leaving: ${here.title}. ${openOf(from).length} of ${from.screens.length} still waiting. They stay.`
  const unsentOlder = finished ? from.screens.filter(x => leftBehindOn(x).length).length : 0
  $('segment').className = `segment${sameGroup ? '' : ' new-group'}`
  setHtml($('segment'), `<div class="segment-in">
    <p class="finished">${esc(line)}${unsentOlder ? ` ${unsentOlder} ${unsentOlder === 1 ? 'screen has' : 'screens have'} marks or notes on an older picture that did not go. They are under Earlier answers.` : ''}</p>
    <p class="starting">You are now starting a new review:</p>
    <span class="new-word">${sameGroup ? '' : 'A different group'}</span>
    <h1>${esc(placeWords(there))}</h1>
    <p class="what">${esc(nextWords(there, openOf(target).length, target.screens.length))}</p>
    <div class="actions">
      <button class="btn primary" data-start>Start<span class="kbd">↩</span></button>
      ${restOfGroup(from).length ? `<button class="btn" data-rest-aside>Set the rest of this group aside<span class="kbd">X</span></button>` : ''}
      <button class="btn" data-stop>Stop here<span class="kbd">S</span></button>
    </div>
  </div>`)
  return undefined
}
function startNext() {
  if (state.arriving) {
    state.arriving = false
    return render()
  }
  const a = app()
  const to = state.stepTo ?? (a ? nextOffered(a.slug)?.slug : null)
  if (to) pickApp(to)
  return undefined
}
/** The others in this group that X would set aside. Only when what is offered next is in this group: the overlay then says so. */
function restOfGroup(a) {
  const here = placeOf(a)
  const there = state.apps.find(x => x.slug === (state.stepTo ?? nextOffered(a.slug)?.slug))
  if (!here.group || !there || placeOf(there).group !== here.group) return []
  return groupsIn(state.apps).get(here.group).filter(m => m.app.slug !== a.slug && offered(m.app)).map(m => m.app.slug)
}
function setRestAside() {
  const a = app()
  const rest = a ? restOfGroup(a) : []
  if (rest.length) void setAside(rest, true)
}

/* ---------- stopping: at any time, and nothing is lost ---------- */

function stopHere() {
  closeTextEntry(true)
  leaveNotes()
  closeDrawer()
  closeMenu()
  for (const key of [...queued.keys()]) goOut(key)
  state.stopped = true
  state.arriving = false
  state.end = null
  state.stepTo = null
  hideToast()
  render()
}
function goOn() {
  const a = app()
  if (a && offered(a)) {
    state.stopped = false
    state.index = firstWaiting()
    return render()
  }
  const next = a ? nextOffered(a.slug) : state.apps.find(offered)
  if (next) return pickApp(next.slug)
  state.stopped = false
  state.showDone = true
  return render()
}
function stoppedHtml() {
  const waiting = state.apps.filter(x => !x.setAside).reduce((n, x) => n + openOf(x).length, 0)
  const apps = state.apps.filter(offered).length
  const aside = state.apps.filter(x => x.setAside)
  const unsent = state.apps.flatMap(x => waitingOf(x)).filter(s => saysAnswer(s) && !queued.has(keyOf(s)) && !kept.has(keyOf(s))).length
  const older = state.apps.flatMap(x => waitingOf(x)).filter(s => leftBehindOn(s).length).length
  const next = app() && offered(app()) ? app() : (app() ? nextOffered(app().slug) : null)
  return `<h2>You have stopped here</h2>
    <p>${queued.size ? 'Sending your last answers…' : kept.size ? `${kept.size} answer${kept.size === 1 ? ' has' : 's have'} not gone yet: the server is not answering. ${kept.size === 1 ? 'It is' : 'They are'} kept, and go${kept.size === 1 ? 'es' : ''} when it is back.` : 'Everything you answered has been sent.'}${sentHere.size ? ` You answered ${sentHere.size} screen${sentHere.size === 1 ? '' : 's'} this time.` : ''}</p>
    <p>${waiting ? `${waiting} screen${waiting === 1 ? '' : 's'} waiting, in ${apps} review${apps === 1 ? '' : 's'}.` : 'Nothing is waiting.'}${aside.length ? ` ${aside.length} set aside.` : ''}</p>
    ${unsent ? `<p>${unsent} screen${unsent === 1 ? ' has' : 's have'} marks or notes not sent yet. They are kept.</p>` : ''}
    ${older ? `<p>${older} screen${older === 1 ? ' has' : 's have'} marks or notes on an older picture, not sent. See Earlier answers.</p>` : ''}
    <div class="actions">${next ? `<button class="btn primary" data-go-on>Go on: ${esc(placeWords(placeOf(next)))}<span class="kbd">↩</span></button>` : ''}<button class="btn" data-list>Apps and screens</button></div>`
}

/* ---------- set aside: not answered, only not offered ---------- */

async function setAside(slugs, aside, { staying = false } = {}) {
  const before = state.apps.map(x => [x, x.setAside])
  for (const x of state.apps) {
    if (!slugs.includes(x.slug)) continue
    if (aside) x.setAside = { at: new Date().toISOString(), isNew: false }
    else delete x.setAside
  }
  const a = app()
  // What the overlay was offering has just been set aside.
  if (aside && state.stepTo && slugs.includes(state.stepTo) && a) state.stepTo = nextOffered(a.slug)?.slug ?? null
  if (aside && !staying && a?.setAside) {
    // What was on show has gone from what is offered: say where next, rather than slide on.
    const next = nextOffered(a.slug)
    if (next) state.stepTo = next.slug
    else state.showDone = true
  }
  render()
  closeMenu()
  try {
    const res = await fetch('/api/set-aside', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slugs, aside }) })
    if (!res.ok) throw new Error('the server needs a restart')
    lastQueue = ''
    await loadQueue()
    toast(aside ? `Set aside: ${slugs.length} ${slugs.length === 1 ? 'review' : 'reviews'}` : `Brought back: ${slugs.length} ${slugs.length === 1 ? 'review' : 'reviews'}`, aside ? 'Nothing was answered. It is under Set aside in the list.' : '')
  } catch (error) {
    for (const [x, was] of before) {
      if (was) x.setAside = was
      else delete x.setAside
    }
    state.stepTo = null
    render()
    toast('That could not be saved', error.message, { problem: true })
  }
}

function renderMenu() {
  const a = app()
  const left = a ? openOf(a).filter(s => !verdictOf(s)).length : 0
  const group = a ? placeOf(a).group : null
  setHtml($('menu'), `
    <button data-menu="list" role="menuitem"><span>Apps and screens</span><span class="kbd">L</span></button>
    <button data-menu="work" role="menuitem"><span>Ideas and queue</span><span class="kbd">W</span></button>
    <button data-menu="rest" role="menuitem"${left ? '' : ' disabled'}><span>Looks good for the rest${left ? ` (${left})` : ''}</span><span class="kbd">⇧⌘↩</span></button>
    <button data-menu="aside-one" role="menuitem"${a ? '' : ' disabled'}><span>Set ${group ? `this ${placeOf(a).noun.trim() || 'one'}` : 'this'} aside</span></button>
    ${group ? '<button data-menu="aside-group" role="menuitem"><span>Set this group aside</span></button>' : ''}
    <button data-menu="stop" role="menuitem"><span>Stop here</span><span class="kbd">S</span></button>
    <hr>
    <button data-menu="panels" role="menuitem"><span>${panels() ? 'Picture only' : 'Panel view'}</span><span class="kbd">Q</span></button>
    ${panels() ? `<button data-menu="strip" role="menuitem"><span>${document.body.classList.contains('no-strip') ? 'Show' : 'Hide'} the screens</span></button><button data-menu="details" role="menuitem"><span>${document.body.classList.contains('no-details') ? 'Show' : 'Hide'} the details</span></button>` : ''}
    <button data-menu="full" role="menuitem"><span>Full screen</span><span class="kbd">F</span></button>
    <hr>
    <button data-menu="keys" role="menuitem"><span>Keyboard shortcuts</span><span class="kbd">?</span></button>`)
}
const closeMenu = () => {
  $('menu').hidden = true
}
function toggleMenu() {
  if ($('menu').hidden) {
    renderMenu()
    $('menu').hidden = false
    $('menu').querySelector('button:not(:disabled)')?.focus()
  } else closeMenu()
}

function renderState(a, s) {
  const card = $('stateCard')
  let html = ''
  if (!state.loaded) html = '<div class="spinner"></div><h2>Loading screens</h2>'
  else if (!state.apps.length) html = firstRunHtml()
  else if (s && state.broken === s.after) html = `<h2>This picture did not load</h2><p>${esc(label(s))} cannot be passed without being seen. Write a note and press Send to say so, or move on.</p>`
  else if (state.stopped) html = stoppedHtml()
  else if (onDonePage()) {
    const count = state.apps.reduce((n, x) => n + x.screens.length, 0)
    const asideOpen = state.apps.filter(x => x.setAside && openOf(x).length)
    const held = asideOpen.reduce((n, x) => n + openOf(x).length, 0)
    const fresh = asideOpen.filter(x => x.setAside.isNew).length
    if (held) html = `<h2>Nothing more is offered</h2><p>${held} screen${held === 1 ? '' : 's'} in ${asideOpen.length} review${asideOpen.length === 1 ? '' : 's'} you set aside ${held === 1 ? 'has' : 'have'} not been answered.${fresh ? ` ${fresh} of them ${fresh === 1 ? 'has' : 'have'} a new round.` : ''}</p><div class="actions"><button class="btn" data-list>Apps and screens</button><button class="btn" data-look>Look at the screens again</button></div>`
    else html = `<h2>All done</h2><p>${count} screen${count === 1 ? '' : 's'} answered.</p><div class="actions"><button class="btn" data-look>Look at the screens again</button></div>`
  }
  card.hidden = !html
  setHtml(card, html)
  $('pair').hidden = !!html || !s
}

function render() {
  const a = app()
  if (state.end && (state.end !== a?.slug || openOf(a).length)) state.end = null
  if (state.end && !nextOffered(state.end)) {
    state.end = null
    state.showDone = true
  }
  // What the opening page was offering has been set aside, or answered elsewhere.
  if (state.arriving && a && !offered(a)) {
    const next = nextOffered(a.slug)
    state.arriving = !!next
    if (next) {
      state.appSlug = next.slug
      state.index = firstWaiting()
      return render()
    }
    state.showDone = true
  }
  const s = onDonePage() ? null : screen()
  renderSegment(a)
  // Nothing under the overlay can be pressed, and a button still holding the keyboard must not take the Enter that starts.
  const covered = segmentUp()
  $('scroller').inert = covered
  $('foot').inert = covered
  if (covered && document.activeElement?.closest?.('#bar') && !document.activeElement.closest('#menu')) document.activeElement.blur()
  renderStrip(a)
  renderState(a, s)
  renderAnswers(a, s)
  renderAbout(a, s)
  renderFoot(a, s)
  renderDrawer()
  document.body.classList.toggle('no-screen', !s)
  const overall = state.apps.filter(x => !x.setAside).reduce((n, x) => n + openOf(x).length, 0)
  const asideCount = state.apps.filter(x => x.setAside).length
  $('overall').textContent = state.loaded && state.apps.length ? `· ${overall} waiting overall${asideCount ? ` · ${asideCount} set aside` : ''}` : ''
  $('stopHere').hidden = !s
  document.body.classList.toggle('no-apps', state.loaded && !state.apps.length)
  $('notes').disabled = !s
  if (!a) {
    renderKind(null)
    setHtml($('crumbs'), '')
    $('position').textContent = ''
    $('back').disabled = $('next').disabled = true
    setHtml($('views'), '')
    return
  }
  renderKind(s)
  const total = a.screens.length
  const here = placeOf(a)
  setHtml($('crumbs'), here.group
    ? `<span class="crumb-app" title="${esc(a.name)}">${esc(placeWords(here))}</span><span class="sep-slash">/</span><b title="${esc(a.name)}">${esc(here.title)}</b>${s ? `<span class="sep-slash">/</span><span class="crumb-app">${esc(label(s))}</span>` : ''}`
    : `<span class="crumb-app">${esc(a.name)}</span>${s ? `<span class="sep-slash">/</span><b>${esc(label(s))}</b>` : ''}`)
  $('position').textContent = s ? `${placeOf(a).group ? `this ${placeOf(a).noun.trim() || 'one'} ` : ''}${state.index + 1} of ${total}` : ''
  $('back').disabled = !s || state.index === 0
  $('next').disabled = !s || state.index >= total - 1
  if (!s) {
    setHtml($('views'), '')
    return
  }
  // Not while the opening page is up: a reload there is still an opening.
  if (!state.arriving) history.replaceState(null, '', `#${a.slug}/${s.id}`)
  setHtml($('toolButtons'), TOOLS.map(t => `<button class="tool${state.tool === t.id ? ' on' : ''}" data-tool="${t.id}" ${tip(t.tip, t.key)}>${ICONS[t.id]}</button>`).join(''))
  setHtml($('colours'), COLOURS.map((c, i) => `<button class="tool swatch${state.colour === c.value ? ' on' : ''}" data-colour="${c.value}" style="--c:${c.value}" ${tip(c.label, String(i + 1))}><i></i></button>`).join(''))
  const views = s.before ? VIEWS : VIEWS.filter(v => v.id === 'after')
  if (!s.before) state.view = 'after'
  setHtml($('views'), views.length > 1 ? views.map(v => `<button class="btn${state.view === v.id ? ' on' : ''}" data-view="${v.id}" ${tip(`Show ${v.label.toLowerCase()}`, 'V')}>${v.label}</button>`).join('') : '')
  $('pair').className = `pair view-${state.view}`
  $('scroller').className = `scroller tool-${state.tool}`
  $('afterCaption').textContent = state.view === 'side' ? 'After (draw here)' : 'After'

  if (state.shownKey !== keyOf(s) + s.after) showPicture(s)
  const notes = draftOf(s).notes
  if ($('notes').value !== notes && document.activeElement !== $('notes')) {
    $('notes').value = notes
    growNotes()
  }
  showSentMarks(s)
  updateButtons()
  paint()
  preloadAround(a)
}

/* ---------- the picture: ready before it is asked for, swapped in one step ---------- */

const pictures = new Map()
/** A picture of a screen, loaded and decoded once. The latest few are kept. */
function pictureAt(url) {
  if (pictures.has(url)) {
    const held = pictures.get(url)
    pictures.delete(url)
    pictures.set(url, held)
    return held.promise
  }
  const img = new Image()
  img.alt = 'After'
  const held = { img, ready: false, promise: null }
  held.promise = new Promise((resolve, reject) => {
    img.onload = () => {
      const done = () => {
        held.ready = true
        resolve(img)
      }
      img.decode().then(done, done)
    }
    img.onerror = () => {
      pictures.delete(url)
      reject(new Error('could not load the picture'))
    }
  })
  held.promise.catch(() => undefined)
  img.src = url
  pictures.set(url, held)
  for (const [old, each] of pictures) {
    if (pictures.size <= HELD_PICTURES) break
    if (each.img !== $('afterImg')) pictures.delete(old)
  }
  return held.promise
}
const pictureOf = s => pictureAt(`/images/${s.after}`).catch(() => {
  throw new Error(`could not load the picture of ${label(s)}`)
})

/** The next few, and the one behind: Back is as quick as Next. */
function preloadAround(a) {
  const s = screen()
  if (!s) return
  const ahead = a.screens.filter((x, i) => i > state.index && x.status === 'waiting' && !verdictOf(x)).slice(0, AHEAD)
  for (const each of [...ahead, a.screens[state.index + 1], a.screens[state.index - 1]]) {
    if (each) void pictureAt(`/images/${each.after}`).catch(() => undefined)
  }
}

function showPicture(s) {
  state.shownKey = keyOf(s) + s.after
  // Closed on going anywhere else, so coming back does not find it open over the picture.
  state.moreOf = ''
  state.broken = ''
  closeTextEntry(false)
  // Whatever was being drawn belonged to the screen that has gone: it must not land on this one.
  draft = null
  pan = null
  const put = img => {
    const current = $('afterImg')
    if (current !== img) {
      img.id = 'afterImg'
      current.replaceWith(img)
    }
    state.size = { w: img.naturalWidth, h: img.naturalHeight }
    $('canvas').width = state.size.w
    $('canvas').height = state.size.h
    if (state.fitted) fit()
    else applyZoom()
    paint()
  }
  const url = `/images/${s.after}`
  const held = pictures.get(url)
  $('beforeImg').src = s.before ? `/images/${s.before}` : ''
  showChanges(s)
  // Ready: in this same step, with nothing in between. Not yet: the last picture stays until this one is there.
  if (held?.ready) return put(held.img)
  state.size = null
  const key = state.shownKey
  pictureAt(url).then(img => {
    if (state.shownKey === key) put(img)
  }).catch(() => {
    if (state.shownKey !== key) return
    // The last picture must not stand in for this one.
    state.broken = s.after
    render()
  })
}

/* Where the picture changed from its before: ticks on screen only, never in what is sent. Worked out after the swap, which stays instant. */
const changes = { key: '', boxes: null, known: new Map() }
function showChanges(s) {
  const key = s.before ? `${s.before}|${s.after}` : ''
  if (changes.key === key) return
  changes.key = key
  changes.boxes = changes.known.get(key) ?? null
  renderChangesButton()
  if (!key || changes.known.has(key)) return
  void Promise.all([pictureAt(`/images/${s.before}`), pictureAt(`/images/${s.after}`)]).then(([before, after]) => setTimeout(() => {
    const boxes = changesBetween(before, after)
    changes.known.set(key, boxes)
    if (changes.key !== key) return
    changes.boxes = boxes
    renderChangesButton()
    paint()
  })).catch(() => undefined)
}
function renderChangesButton() {
  const button = $('changesOn')
  button.hidden = !changes.boxes?.length
  button.classList.toggle('on', state.changesOn)
  button.setAttribute('aria-pressed', String(state.changesOn))
}
function toggleChanges() {
  if (!changes.boxes?.length) return
  state.changesOn = !state.changesOn
  renderChangesButton()
  paint()
}

/* What was sent stays on the picture when the screen is come back to: the marked copy from the inbox, under anything new. */
const sentMarks = { url: '', img: null }
function showSentMarks(s) {
  const standing = standingAnswer(histories.get(historyKey(s)), s.round)
  const url = standing?.verdict === 'changes' ? standing.annotatedUrl : ''
  if (sentMarks.url === url) return
  sentMarks.url = url
  sentMarks.img = null
  if (!url) return
  const img = new Image()
  img.onload = () => {
    if (sentMarks.url !== url) return
    sentMarks.img = img
    paint()
  }
  img.src = url
}

function updateButtons() {
  const a = app()
  const s = screen()
  if (!s) return
  const d = draftOf(s)
  $('undo').disabled = !d.undo.length
  $('redo').disabled = !d.redo.length
  $('clear').disabled = !d.marks.length
  renderFoot(a, s)
}

function paint() {
  const s = screen()
  const ctx = $('canvas').getContext('2d')
  if (!s || !state.size) return
  ctx.clearRect(0, 0, state.size.w, state.size.h)
  if (sentMarks.img) ctx.drawImage(sentMarks.img, 0, 0, state.size.w, state.size.h)
  if (state.changesOn && changes.boxes?.length) paintChanged(ctx, changes.boxes, state.size.w, state.size.h)
  const marks = draftOf(s).marks
  paintMarks(ctx, [...marks, ...(draft ? [draft] : []), ...(mic.hearing ?? [])])
}

/** What lists a screen's state, after a draft starts or stops counting. */
function refreshLists() {
  renderStrip(app())
  renderDrawer()
  renderAnswers(app(), screen())
}

/* ---------- zoom ---------- */

function applyZoom() {
  if (!state.size) return
  const w = Math.round(state.size.w * state.zoom)
  const h = Math.round(state.size.h * state.zoom)
  for (const frame of document.querySelectorAll('.frame')) {
    frame.style.width = `${w}px`
    frame.style.height = `${h}px`
  }
  $('zoomValue').hidden = state.fitted
  $('zoomValue').textContent = `${Math.round(state.zoom * 100)}%`
}
/**
 * What to check goes beside the picture when a fitted picture leaves room there. It never makes the picture smaller: the room
 * is worked out with the line under the bar gone, as it then is. With no room, it is that line.
 */
function placeChecks() {
  const s = screen()
  const look = s ? lookOf(s) : { lines: [], rest: '' }
  const items = look.lines
  const box = $('scroller')
  const foot = $('foot').offsetHeight
  const room = { width: box.clientWidth - 14, height: $('center').clientHeight - foot - 14 }
  const shown = state.size && state.view === 'after' && state.fitted ? fitZoom(room, { width: state.size.w, height: state.size.h }) * state.size.w : room.width
  const spare = room.width - shown - 16
  state.sideChecks = items.length > 0 && spare >= 220
  $('checks').hidden = !state.sideChecks
  if (state.sideChecks) {
    $('checks').style.width = `${Math.min(400, spare)}px`
    $('checks').style.maxHeight = `${room.height}px`
    setHtml($('checks'), `<h2><span>What to check</span><span class="from">${esc(fromWords(s))}</span></h2><ul>${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>${moreButton(look.rest)}${moreWords(look.rest)}`)
  }
  renderAbout(app(), s)
}

function fit() {
  if (!state.size) return
  placeChecks()
  const box = $('scroller')
  const caption = state.view === 'after' ? 0 : 24
  const room = { width: box.clientWidth - 14, height: box.clientHeight - 14 - caption }
  state.zoom = fitZoom(room, { width: state.size.w, height: state.size.h }, state.view === 'side' ? 2 : 1)
  state.fitted = true
  applyZoom()
}
function zoomBy(factor) {
  state.zoom = zoomedBy(state.zoom, factor)
  state.fitted = false
  applyZoom()
}

/* ---------- drawing ---------- */

/** Something new on a screen: an answer still on its way comes back to being worked on. */
function touched(s) {
  takeBack(s)
  draftOf(s).unsure = false
  state.end = null
}

function commit(mark) {
  const s = screen()
  const d = draftOf(s)
  touched(s)
  Object.assign(d, withMark(d, mark))
  d.good = false
  saveDraft(s)
  updateButtons()
  paint()
  refreshLists()
}

const at = event => {
  const r = $('canvas').getBoundingClientRect()
  return [((event.clientX - r.left) * state.size.w) / r.width, ((event.clientY - r.top) * state.size.h) / r.height]
}
let pan = null

$('canvas').addEventListener('pointerdown', event => {
  // Text opens on click, once the press is over, so nothing takes the focus away from the field afterwards.
  if (!state.size || event.button !== 0 || state.tool === 'text') return
  event.preventDefault()
  // That also stops the focus moving: a note box would go on taking the keys that follow, and B or G would land in it.
  if (document.activeElement?.matches?.('textarea, input, select')) document.activeElement.blur()
  try {
    $('canvas').setPointerCapture(event.pointerId)
  } catch {
    // The mark is drawn from the events that arrive.
  }
  const p = at(event)
  const w = strokeFor(state.size.w)
  if (state.tool === 'pan') pan = { x: event.clientX, y: event.clientY, left: $('scroller').scrollLeft, top: $('scroller').scrollTop }
  else if (state.tool === 'pen') draft = { tool: 'pen', points: [p], color: state.colour, w }
  else draft = { tool: state.tool, a: p, b: p, color: state.colour, w }
})
$('canvas').addEventListener('pointermove', event => {
  if (state.size) mic.pointer = at(event)
  if (pan) {
    $('scroller').scrollLeft = pan.left - (event.clientX - pan.x)
    $('scroller').scrollTop = pan.top - (event.clientY - pan.y)
    return
  }
  if (!draft) return
  const p = at(event)
  draft = draft.tool === 'pen' ? { ...draft, points: [...draft.points, p] } : { ...draft, b: p }
  paint()
})
const finish = () => {
  pan = null
  if (!draft) return
  const done = draft
  draft = null
  if (isReal(done)) commit(done)
  else paint()
}
$('canvas').addEventListener('click', event => {
  if (state.size && state.tool === 'text' && !textEntry) openTextEntry(event)
})
$('canvas').addEventListener('pointerleave', () => {
  mic.pointer = null
})
$('canvas').addEventListener('pointerup', finish)
$('canvas').addEventListener('pointercancel', finish)

let textEntry = null
function openTextEntry(event) {
  const frame = $('stage')
  const r = frame.getBoundingClientRect()
  const point = at(event)
  const input = document.createElement('input')
  input.className = 'text-entry'
  input.placeholder = 'Type, then Enter'
  input.style.left = `${event.clientX - r.left}px`
  input.style.top = `${event.clientY - r.top}px`
  input.style.color = state.colour
  frame.appendChild(input)
  textEntry = { input, point, colour: state.colour }
  input.focus()
  input.addEventListener('keydown', e => {
    e.stopPropagation()
    if (e.key === 'Enter') closeTextEntry(true)
    // Esc takes back an empty box. Words stay: they become a mark.
    if (e.key === 'Escape') closeTextEntry(true)
  })
  input.addEventListener('blur', () => closeTextEntry(true))
}
/**
 * Closes the words box; with keep, what was typed becomes a mark (so leaving quiet mode never loses it), and what is being
 * drawn too: the screen may be about to change, with the press still down.
 */
function closeTextEntry(keep) {
  if (keep) finish()
  if (!textEntry) return
  const { input, point, colour } = textEntry
  textEntry = null
  const text = input.value.trim()
  input.remove()
  if (keep && text && state.size) commit({ tool: 'text', at: point, text, color: colour, size: textFor(state.size.w) })
}

/* ---------- sending: at once to the eye, a few seconds later to the inbox ---------- */

/**
 * Sends one screen: the marks burned into a PNG plus the shapes as numbers, or an
 * approval with neither. Every path writes the same inbox entries.
 */
async function sendOne(s, verdict, { noComment = false } = {}) {
  const key = keyOf(s)
  const d = draftOf(s)
  // A picture that will not load must not hold back what is said about it: the marks go as numbers.
  const img = await pictureOf(s).catch(() => null)
  const size = img ? { w: img.naturalWidth, h: img.naturalHeight } : null
  const list = d.marks
  const words = d.notes
  const marks = verdict === 'approved' ? [] : list.filter(isReal)
  const out = verdict === 'approved' || !img ? null : burnCanvas(img, marks)
  const ctx = (out ?? document.createElement('canvas')).getContext('2d')
  const png = out ? out.toDataURL('image/png') : null
  const body = {
    appSlug: s.appSlug,
    id: s.id,
    after: s.after,
    round: s.round,
    verdict,
    notes: noComment ? 'No comment.' : verdict === 'approved' ? '' : words,
    shapes: marks.map(m => shapeOf(m, ctx)),
    imageSize: size,
    png,
  }
  if (noComment) body.noComment = true
  const res = await fetch('/api/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {
    throw Object.assign(new Error('The server is not answering.'), { offline: true })
  })
  const result = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(result.error || 'The server did not take it.')
  // Drawn or written while this was on its way: that has not gone, and stays.
  const now = drafts.get(key) ?? d
  if (now.marks !== list || now.notes !== words) {
    now.marks = now.marks.filter(m => !list.includes(m))
    if (now.notes === words) now.notes = ''
    now.pending = false
    now.undo = []
    now.redo = []
    saveDraft(s)
  } else {
    drafts.delete(key)
    store.set(key, null)
  }
  // The picture was replaced before this went: it says nothing about the new one, which still waits.
  if (result.olderPicture || result.record?.olderPicture) {
    toast(result.record ? `Your answer on ${label(s)} went in, marked as being about the older picture. It has a new one now.` : `Looks good not counted: ${label(s)} has a new picture to look at.`)
    return result.record ?? null
  }
  // Seen here at once: the server's next list may have been read before this went in. The list may be newer than `s`.
  const status = verdict === 'approved' ? 'approved' : 'sent'
  const sentAt = result.record?.sentAt ?? new Date().toISOString()
  for (const each of new Set([s, liveScreen(s)])) {
    if (!each) continue
    each.status = status
    each.sentAt = sentAt
    each.feedback = [...(each.feedback ?? []), 'here']
  }
  answeredHere.set(key, { status, sentAt })
  sentHere.add(key)
  return result.record
}

/** Answers on their way: `key` to what is to go, and when. Saved in the draft, so closing the window loses none. */
const queued = new Map()
let lastQueued = null
let sending = Promise.resolve()
/** The server did not answer. Still pending, and they go when it does. */
const kept = new Map()

function queueAnswer(s, verdict, { noComment = false, wait = UNDO_MS, resumed = false } = {}) {
  const key = keyOf(s)
  const d = draftOf(s)
  clearTimeout(queued.get(key)?.timer)
  kept.delete(key)
  d.unsure = false
  d.pending = true
  if (!resumed || !d.pendingAt) d.pendingAt = Date.now()
  saveDraft(s)
  const job = { s, verdict, noComment, resumed, timer: setTimeout(() => goOut(key), wait) }
  queued.set(key, job)
  lastQueued = job
  return job
}
function resendKept() {
  if (!kept.size) return
  for (const job of [...kept.values()]) queueAnswer(job.s, job.verdict, { noComment: job.noComment, wait: 0, resumed: true })
  if ($('toast').classList.contains('problem')) hideToast()
}
function goOut(key) {
  const job = queued.get(key)
  if (!job) return
  clearTimeout(job.timer)
  // Picked up from the saved draft: another tab may have sent it or taken it back in the meantime.
  if (job.resumed && !store.get(key)?.pending) {
    queued.delete(key)
    drafts.delete(key)
    refreshAfterSend(job.s)
    return
  }
  job.going = true
  sending = sending.then(async () => {
    try {
      await sendOne(job.s, job.verdict, { noComment: job.noComment })
      queued.delete(key)
    } catch (error) {
      queued.delete(key)
      if (error.offline) {
        kept.set(key, job)
        toast(`Not sent yet: ${label(job.s)}. ${error.message}`, 'It is kept, and goes when the server is back.', { problem: true })
        refreshAfterSend(job.s)
        return
      }
      const d = draftOf(job.s)
      d.pending = false
      saveDraft(job.s)
      toast(`Not sent: ${label(job.s)}. ${error.message}`, 'It is kept. Press Send to try again.', { problem: true })
    }
    refreshAfterSend(job.s)
  })
}
function refreshAfterSend(s) {
  if (state.stopped) return render()
  const here = screen()
  if (here && keyOf(here) === keyOf(s)) return render()
  renderStrip(app())
  renderDrawer()
  renderFoot(app(), here)
  return undefined
}
/** Not gone yet: it comes back to being a draft. True when there was one to take back. */
function takeBack(s) {
  const key = keyOf(s)
  const job = queued.get(key)
  const d = draftOf(s)
  kept.delete(key)
  if (d.pending) {
    d.pending = false
    saveDraft(s)
  }
  if (!job || job.going) return false
  clearTimeout(job.timer)
  queued.delete(key)
  return true
}
function undoAnswer() {
  const job = lastQueued
  if (!job || !queued.has(keyOf(job.s)) || job.going) return
  takeBack(job.s)
  // What went along with it, when it finished the app, stays with it.
  for (const each of job.swept ?? []) if (queued.get(keyOf(each.s)) === each && !each.going) takeBack(each.s)
  const d = draftOf(job.s)
  if (job.verdict === 'approved') d.good = false
  saveDraft(job.s)
  lastQueued = null
  hideToast()
  state.end = null
  state.showDone = false
  const a = state.apps.find(x => x.slug === job.s.appSlug)
  if (!a) return
  const at = a.screens.findIndex(x => x.id === job.s.id)
  if (state.appSlug !== a.slug) state.appSlug = a.slug
  go(at)
}
/** The window is going: send what can be sent as it closes. The rest is in its draft, and goes on the next look. */
addEventListener('pagehide', () => {
  for (const [key, job] of queued) {
    if (job.going || job.verdict !== 'approved') continue
    clearTimeout(job.timer)
    queued.delete(key)
    const body = { appSlug: job.s.appSlug, id: job.s.id, after: job.s.after, round: job.s.round, verdict: 'approved', notes: job.noComment ? 'No comment.' : '', shapes: [], imageSize: null, png: null, ...(job.noComment ? { noComment: true } : {}) }
    // The draft stays: nothing here can know this arrived. The next look clears it if it did, and sends it if it did not.
    void fetch('/api/send', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => undefined)
  }
})
/**
 * Answers left on their way when the window closed. Only on the very picture they were given on: anything else waits for a
 * press. Marks on a picture that has been replaced since go too, said to be about the older one, because Send was pressed.
 * One still inside its few seconds may be in another tab that can yet take it back, so it gets the rest of them.
 */
function resumeAnswers() {
  let count = 0
  const rest = saved => Math.max(0, (saved.pendingAt ?? 0) + UNDO_MS + 500 - Date.now())
  for (const a of state.apps) {
    for (const s of a.screens) {
      for (let r = s.round - 1; r >= 1; r--) {
        const key = `${s.appSlug}/${s.id}/${r}`
        const saved = store.get(key)
        if (!saved?.pending || queued.has(key)) continue
        if (saved.after && ((saved.marks ?? []).some(isReal) || (saved.notes ?? '').trim())) {
          queueAnswer({ ...s, round: r, after: saved.after, before: '', status: 'waiting', feedback: [] }, 'changes', { wait: rest(saved), resumed: true })
          count++
        } else store.set(key, null)
      }
      const key = keyOf(s)
      const saved = store.get(key)
      if (queued.has(key) || saved?.after !== s.after || (!saved.pending && !saved.good)) continue
      const verdict = verdictOf(s)
      if (!verdict) continue
      // It went as the window closed.
      if (verdict === 'approved' && s.status === 'approved') {
        drafts.delete(key)
        store.set(key, null)
        continue
      }
      queueAnswer(s, verdict, { wait: rest(saved), resumed: true })
      count++
    }
  }
  if (count) toast(`${count} answer${count === 1 ? '' : 's'} you gave earlier ${count === 1 ? 'is' : 'are'} going in.`)
}

/** After an answer: straight on. When nothing is left without one, the app is done. */
function moveOn(wasWaiting = false) {
  leaveNotes()
  const a = app()
  const where = afterSend(a.screens, state.index, { wasWaiting, hasDraft: saysAnswer })
  if (where.done) return finishApp()
  if (where.to !== undefined) return go(where.to)
  // On the last, with nothing left here: the next review is what is left to offer.
  if (where.rest) {
    if (!openOf(a).length && nextOffered(a.slug)) state.end = a.slug
    render()
  }
  return undefined
}

/** Whatever is marked and not sent has been answered as much as anything else here. It goes with the rest. */
function finishApp() {
  const a = app()
  // Undo still means the answer just given. What goes along with it comes back with it.
  const given = lastQueued
  const swept = []
  for (const s of waitingOf(a)) {
    if (saysAnswer(s) && !queued.has(keyOf(s))) swept.push(queueAnswer(s, verdictOf(s)))
  }
  if (given) {
    given.swept = swept
    lastQueued = given
  }
  if (nextOffered(a.slug)) state.end = a.slug
  else state.showDone = true
  render()
}

/** Send: marks and notes, off and on to the next. */
function sendCurrent() {
  const s = screen()
  if (!s || onDonePage()) return
  closeTextEntry(true)
  const v = verdictOf(s)
  if (v === 'approved') return void looksGood(true)
  if (v !== 'changes') return
  const wasWaiting = s.status === 'waiting'
  queueAnswer(s, 'changes')
  toast('Sent', label(s), { undo: true })
  moveOn(wasWaiting)
}

/** G and the Looks good button. */
async function looksGood(byKey = false) {
  const s = screen()
  if (!s || onDonePage()) return
  closeTextEntry(true)
  const d = draftOf(s)
  // Only what has been seen can be passed. The last picture stays up until this one comes, and must not answer for it.
  if (!state.size && !(d.good && verdictOf(s) === 'approved')) {
    toast(state.broken === s.after ? 'This picture did not load, so it cannot be passed.' : 'The picture has not come yet.')
    return
  }
  if (d.good && verdictOf(s) === 'approved') {
    // A key on the way past keeps the answer and goes on: nothing is undone unseen. Only the button takes it back.
    if (byKey) return moveOn(false)
    takeBack(s)
    d.good = false
    saveDraft(s)
    render()
    toast(`Looks good taken back: ${label(s)}`)
    return
  }
  const dropping = d.marks.some(isReal) || !!d.notes.trim()
  // Already said, by a press: there is nothing to add, only somewhere to go.
  if (!dropping && !verdictOf(s) && s.status === 'approved' && !standingAnswer(histories.get(historyKey(s)), s.round)?.noComment) return moveOn(false)
  // Changes sent are the person's real answer. One key must not swap them for an approval as they go past.
  const replacing = s.status === 'sent'
  if (dropping || replacing) {
    const yes = replacing
      ? await ask('Replace your changes with Looks good?', `You sent changes on this screen. They go under Earlier answers, and it counts as looking good.${dropping ? ' What you have drawn or written since is dropped.' : ''}`, 'Replace with Looks good')
      : await ask('Mark as looking good?', 'Your marks and notes on this screen are dropped.', 'Mark as looking good')
    if (!yes) return
  }
  if (dropping) {
    Object.assign(d, withMarks(d, []))
    d.notes = ''
    $('notes').value = ''
    growNotes()
  }
  const wasWaiting = s.status === 'waiting'
  d.good = true
  queueAnswer(s, 'approved')
  toast('Looks good', label(s), { undo: true })
  moveOn(wasWaiting)
}

/* ---------- looks good for the rest ---------- */

let submitting = false
function openSubmit() {
  const a = app()
  if (!a) return
  closeTextEntry(true)
  closeMenu()
  const t = tallyOf(a)
  if (!t.set.length) return
  const left = t.untouched.filter(s => leftBehindOn(s).length)
  const names = list => (list.length > 8 ? `${list.slice(0, 6).map(s => esc(label(s))).join(', ')} and ${list.length - 6} more` : list.map(s => esc(label(s))).join(', '))
  setHtml($('submitBody'), `<div class="summary">
    ${[['draft-changes', 'With marks or notes', t.changes], ['draft-good', 'Looks good', t.good], ['draft-good', 'No comment, counts as Looks good', t.untouched]].map(([mk, title, list]) => (list.length ? `<div class="srow"><span class="line"><i class="mk ${mk}"></i></span><span class="line">${title}</span><span class="line count">${list.length}</span></div><div class="names">${names(list)}</div>` : '')).join('')}
    ${left.length ? `<div class="names warn">${names(left)}: marks or notes on an older picture were not sent. See Earlier answers.</div>` : ''}
  </div>`)
  $('submitStatus').textContent = ''
  $('submitStatus').classList.remove('error')
  updateSubmitButton()
  hideToast()
  $('submitModal').hidden = false
  $('submitYes').focus()
}
function updateSubmitButton() {
  const n = setOf(app()).length
  $('submitYes').textContent = `Answer ${n} screen${n === 1 ? '' : 's'}`
  $('submitYes').disabled = submitting || !n
  $('submitNo').disabled = submitting
}
async function runSubmit() {
  const a = app()
  if (!a || submitting) return
  // One already in the air has said what it says: its draft is about to be emptied.
  const jobs = submitJobs(setOf(a), verdictOf).filter(job => !queued.get(keyOf(job.s))?.going)
  if (!jobs.length) return
  for (const job of jobs) takeBack(job.s)
  submitting = true
  updateSubmitButton()
  let done = 0
  try {
    await sending
    for (const job of jobs) {
      $('submitStatus').textContent = `Sending ${done + 1} of ${jobs.length}…`
      await sendOne(job.s, job.verdict, { noComment: job.noComment })
      done++
    }
    $('submitModal').hidden = true
    finishApp()
  } catch (error) {
    $('submitStatus').classList.add('error')
    $('submitStatus').textContent = `Stopped after ${done} of ${jobs.length}: ${error.message}. The rest are kept.`
    render()
  } finally {
    submitting = false
    updateSubmitButton()
  }
}
$('submitYes').onclick = () => void runSubmit()
$('submitNo').onclick = () => {
  if (!submitting) $('submitModal').hidden = true
}

/* ---------- small windows: confirm, help, picture viewer, toast, tooltips ---------- */

let answer = null
function ask(title, text, yes, no = 'Keep my marks') {
  $('confirmNo').textContent = no
  $('confirmTitle').textContent = title
  $('confirmText').textContent = text
  $('confirmYes').textContent = yes
  $('confirmModal').hidden = false
  $('confirmYes').focus()
  return new Promise(resolve => {
    answer = value => {
      answer = null
      $('confirmModal').hidden = true
      resolve(value)
    }
  })
}
$('confirmYes').onclick = () => answer?.(true)
$('confirmNo').onclick = () => answer?.(false)

setHtml($('keys'), KEYS.map(([title, rows]) => `<section><h3>${title}</h3>${rows.map(([keys, what]) => `<div class="row"><span>${keys.map(k => (k === '–' ? '<span>–</span>' : `<span class="kbd">${esc(k)}</span>`)).join('')}</span><span>${esc(what)}</span></div>`).join('')}</section>`).join(''))
const showHelp = open => {
  closeMenu()
  $('helpModal').hidden = !open
}

function openViewer(src, title) {
  $('viewerImg').src = src
  $('viewerTitle').textContent = title
  $('viewer').hidden = false
}

let toastTimer = null
function hideToast() {
  clearTimeout(toastTimer)
  $('toast').hidden = true
  $('toast').classList.remove('fading')
}
function toast(text, sub = '', { undo = false, problem = false } = {}) {
  setHtml($('toast'), `<span>${esc(text)}</span>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}${undo ? '<button class="link" data-undo>Undo</button>' : ''}`)
  $('toast').classList.remove('fading')
  $('toast').classList.toggle('problem', problem)
  $('toast').hidden = false
  clearTimeout(toastTimer)
  if (problem) return
  toastTimer = setTimeout(() => {
    $('toast').classList.add('fading')
    toastTimer = setTimeout(hideToast, 200)
  }, undo ? UNDO_MS - 200 : 3000)
}
$('toast').onclick = event => {
  if (event.target.closest('[data-undo]')) undoAnswer()
  else if ($('toast').classList.contains('problem')) hideToast()
}

let tipTimer = null
let tipFor = null
document.addEventListener('mouseover', event => {
  const el = event.target.closest?.('[data-tip]')
  if (el === tipFor) return
  tipFor = el
  clearTimeout(tipTimer)
  $('tip').hidden = true
  if (!el) return
  tipTimer = setTimeout(() => {
    const r = el.getBoundingClientRect()
    setHtml($('tip'), `<span>${esc(el.dataset.tip)}</span>${el.dataset.key ? `<span class="kbd">${esc(el.dataset.key)}</span>` : ''}`)
    const t = $('tip')
    t.hidden = false
    const w = t.offsetWidth
    const below = r.bottom + 6 + t.offsetHeight < innerHeight
    t.style.left = `${Math.max(6, Math.min(innerWidth - w - 6, r.left + r.width / 2 - w / 2))}px`
    t.style.top = `${below ? r.bottom + 6 : r.top - t.offsetHeight - 6}px`
  }, 380)
})
document.addEventListener('mousedown', event => {
  clearTimeout(tipTimer)
  $('tip').hidden = true
  if (!event.target.closest?.('.menu-wrap')) closeMenu()
  if (!event.target.closest?.('#drawer, #listOpen')) closeDrawer()
  if (!event.target.closest?.('#inspector, #said')) document.body.classList.remove('answers-open')
})

/* Two tabs share one set of drafts: what the other wrote is read again here, or saving here would write over it. */
addEventListener('storage', event => {
  if (!event.key?.startsWith('review:') || event.key.startsWith('review:ui:')) return
  drafts.delete(event.key.slice('review:'.length))
  if (state.loaded) render()
})

/* ---------- views ---------- */

function togglePanels() {
  document.body.classList.toggle('panels')
  document.body.classList.remove('answers-open')
  closeMenu()
  render()
  if (state.fitted) fit()
}
function togglePanel(name, cls) {
  const hidden = document.body.classList.toggle(cls)
  prefs.set(name, hidden ? 'hidden' : 'shown')
  closeMenu()
  if (state.fitted) fit()
}
function toggleFull() {
  closeMenu()
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
  else void document.documentElement.requestFullscreen?.().catch(() => undefined)
}

/* ---------- controls ---------- */

/**
 * Sent with the keys from the notes box, the box still has the keyboard: it would go on showing the words just sent (the
 * page leaves a box alone while it is being typed in), and the next G would be a letter in it rather than Looks good.
 */
function leaveNotes() {
  if (document.activeElement === $('notes')) $('notes').blur()
}
/** The box grows up over the picture as words come, so nothing else moves. */
function growNotes() {
  const box = $('notes')
  box.style.height = '30px'
  if (box.value) box.style.height = `${Math.min(180, box.scrollHeight + 2)}px`
}

function go(index) {
  const a = app()
  if (!a) return
  closeTextEntry(true)
  leaveNotes()
  closeDrawer()
  document.body.classList.remove('answers-open')
  state.showDone = false
  state.stopped = false
  state.arriving = false
  state.end = null
  state.stepTo = null
  state.index = Math.max(0, Math.min(a.screens.length - 1, index))
  state.fitted = true
  if ($('scroller').scrollTop || $('scroller').scrollLeft) $('scroller').scrollTo(0, 0)
  render()
  if (!$('zoomValue').hidden) $('zoomValue').hidden = true
}
function pickApp(slug) {
  closeTextEntry(true)
  closeDrawer()
  state.appSlug = slug
  state.index = firstWaiting()
  state.showDone = false
  state.stopped = false
  state.arriving = false
  state.end = null
  state.stepTo = null
  state.fitted = true
  render()
  if (state.fitted) fit()
}
function stepApp(by) {
  const order = [...ordered().filter(offered), ...ordered().filter(a => !offered(a))]
  const at = order.findIndex(a => a.slug === state.appSlug)
  const next = order[at + by]
  if (!next) return
  closeTextEntry(true)
  leaveNotes()
  state.stepTo = next.slug
  render()
}
function setTool(tool) {
  state.tool = tool
  prefs.set('tool', tool)
  render()
}
function setColour(value) {
  state.colour = value
  prefs.set('colour', value)
  render()
}
function undo() {
  const s = screen()
  const d = s && draftOf(s)
  if (!d?.undo.length) return
  touched(s)
  Object.assign(d, undone(d))
  saveDraft(s)
  updateButtons()
  paint()
  refreshLists()
}
function redo() {
  const s = screen()
  const d = s && draftOf(s)
  if (!d?.redo.length) return
  touched(s)
  Object.assign(d, redone(d))
  saveDraft(s)
  updateButtons()
  paint()
  refreshLists()
}
function cycleView() {
  const s = screen()
  if (!s?.before) return
  const ids = VIEWS.map(v => v.id)
  state.view = ids[(ids.indexOf(state.view) + 1) % ids.length]
  render()
  if (state.fitted) fit()
}

for (const [id, icon] of Object.entries({ listOpen: 'list', back: 'prev', next: 'next', menuOpen: 'more', undo: 'undo', redo: 'redo', clear: 'clear', changesOn: 'changes', helpClose: 'close', viewerClose: 'close' })) $(id).innerHTML = ICONS[icon]

$('listOpen').onclick = openDrawer
$('back').onclick = () => go(state.index - 1)
$('next').onclick = () => go(state.index + 1)
$('menuOpen').onclick = toggleMenu
$('menu').onclick = event => {
  const what = event.target.closest('[data-menu]')?.dataset.menu
  if (what === 'list') openDrawer()
  else if (what === 'work') location.href = '/work.html'
  else if (what === 'rest') openSubmit()
  else if (what === 'stop') stopHere()
  else if (what === 'aside-one') void setAside([state.appSlug], true)
  else if (what === 'aside-group') void setAside(groupsIn(state.apps).get(placeOf(app()).group).map(m => m.app.slug), true)
  else if (what === 'panels') togglePanels()
  else if (what === 'strip') togglePanel('strip', 'no-strip')
  else if (what === 'details') togglePanel('details', 'no-details')
  else if (what === 'full') toggleFull()
  else if (what === 'keys') showHelp(true)
}
$('helpClose').onclick = () => showHelp(false)
$('helpModal').onclick = event => event.target === $('helpModal') && showHelp(false)
$('viewerClose').onclick = () => {
  $('viewer').hidden = true
}
$('said').onclick = () => document.body.classList.toggle('answers-open')
const chooseRow = event => {
  const aside = event.target.closest('[data-aside]')
  if (aside) return void setAside(aside.dataset.aside.split(' '), aside.dataset.to === '1', { staying: true })
  const fold = event.target.closest('[data-fold]')
  if (fold) {
    toggleFold(fold.dataset.fold)
    return $('drawerList').querySelector(`[data-fold="${CSS.escape(fold.dataset.fold)}"]`)?.focus()
  }
  const open = event.target.closest('[data-go-app]')
  if (open) {
    const slug = open.dataset.goApp
    const changed = slug !== state.appSlug
    pickApp(slug)
    if (open.dataset.page !== undefined) go(Number(open.dataset.page))
    // Chosen from the list: a brief word is enough. The reviewer knows where they asked to go.
    if (changed) toast(`Now: ${placeWords(placeOf(app()))}`, placeOf(app()).group ? placeOf(app()).title : '')
    return undefined
  }
  const at = event.target.closest('[data-i]')
  if (at) go(Number(at.dataset.i))
  return undefined
}
$('drawerList').onclick = chooseRow
$('screenList').onclick = chooseRow
$('drawerList').addEventListener('keydown', event => {
  if (event.key === 'x' || event.key === 'X') {
    event.preventDefault()
    event.stopPropagation()
    return document.activeElement?.closest?.('.row-line')?.querySelector('.row-aside')?.click()
  }
  // Right opens, Left closes, or goes up to what holds it.
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    const row = document.activeElement?.closest?.('.row-btn')
    event.preventDefault()
    event.stopPropagation()
    const key = row?.dataset.fold
    if (key && foldOpen(key) !== (event.key === 'ArrowRight')) {
      toggleFold(key)
      return $('drawerList').querySelector(`[data-fold="${CSS.escape(key)}"]`)?.focus()
    }
    if (event.key === 'ArrowLeft') $('drawerList').querySelector(`[data-fold="${CSS.escape(row?.dataset.parent ?? '')}"]`)?.focus()
    return undefined
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  event.preventDefault()
  event.stopPropagation()
  const rows = [...$('drawerList').querySelectorAll('.row-btn')]
  const at = rows.indexOf(document.activeElement)
  rows[Math.max(0, Math.min(rows.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus()
})
$('center').addEventListener('click', event => {
  if (event.target.closest('[data-more]')) toggleMore()
})
/* The first minute: your own app, or one sentence to your agent, or a sample. */
function firstRunHtml() {
  return `<form class="first" data-first>
    <h2>Two ways to start.</h2>
    <div class="first-or">1. Your app's address, on this computer or online</div>
    <div class="first-row"><input id="firstAddress" placeholder="http://localhost:3000" aria-label="Your app's address" autocomplete="off"><button class="btn primary" id="firstShow">Show it</button></div>
    <p class="first-said" id="firstSaid" hidden></p>
    <div class="first-or">2. In your agent, in your project: it finds the app and opens it here</div>
    <div class="first-row"><code id="firstAsk">/markback</code><button type="button" class="btn" data-first-copy>Copy</button></div>
    <p class="first-said">No app yet? Say what you want after it: <b>/markback a recipe box for my family</b>. In a terminal, <b>markback</b> in the project's folder does the same.</p>
    <div class="first-or">Just looking</div>
    <div class="first-row"><button type="button" class="btn" data-first-sample>Try the sample</button></div>
  </form>`
}
async function firstRun(path, body) {
  const said = $('firstSaid')
  said.hidden = false
  said.textContent = path === '/api/show' ? 'Taking a picture…' : ''
  $('firstShow').disabled = true
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const got = await res.json()
    if (!res.ok) throw new Error(got.error)
    location.hash = got.appSlug
    await loadQueue()
  } catch (error) {
    said.textContent = error.message
    $('firstShow').disabled = false
  }
}
$('stateCard').addEventListener('submit', event => {
  event.preventDefault()
  void firstRun('/api/show', { url: $('firstAddress').value || $('firstAddress').placeholder })
})
$('stateCard').addEventListener('click', event => {
  if (event.target.closest('[data-first-sample]')) void firstRun('/api/sample', {})
  if (event.target.closest('[data-first-copy]')) {
    void navigator.clipboard?.writeText($('firstAsk').textContent)
    event.target.textContent = 'Copied'
  }
})
$('stateCard').onclick = event => {
  if (event.target.closest('[data-look]')) go(0)
  if (event.target.closest('[data-go-on]')) goOn()
  if (event.target.closest('[data-list]')) openDrawer()
}
$('segment').onclick = event => {
  if (event.target.closest('[data-start]')) startNext()
  else if (event.target.closest('[data-rest-aside]')) setRestAside()
  else if (event.target.closest('[data-stop]')) stopHere()
}
$('stopHere').onclick = () => stopHere()
$('inspector').onclick = event => {
  const pic = event.target.closest('[data-pic]')
  if (pic) openViewer(pic.dataset.pic, `${label(screen())}: ${pic.dataset.title}`)
}
$('toolButtons').onclick = event => {
  const b = event.target.closest('[data-tool]')
  if (b) setTool(b.dataset.tool)
}
$('colours').onclick = event => {
  const b = event.target.closest('[data-colour]')
  if (b) setColour(b.dataset.colour)
}
$('views').onclick = event => {
  const b = event.target.closest('[data-view]')
  if (!b) return
  state.view = b.dataset.view
  render()
  if (state.fitted) fit()
}
$('footActions').onclick = event => {
  const b = event.target.closest('[data-act]')
  if (!b || b.disabled) return
  if (b.dataset.act === 'send') sendCurrent()
  else void looksGood()
}
$('undo').onclick = undo
$('redo').onclick = redo
$('changesOn').onclick = toggleChanges
$('micBtn').onclick = () => pressMic()
$('clear').onclick = () => {
  const s = screen()
  const d = draftOf(s)
  if (!d.marks.length) return
  touched(s)
  Object.assign(d, withMarks(d, []))
  saveDraft(s)
  updateButtons()
  paint()
  refreshLists()
}
$('zoomValue').onclick = fit
$('notes').addEventListener('input', () => {
  const s = screen()
  growNotes()
  if (!s) return
  const d = draftOf(s)
  const before = verdictOf(s)
  touched(s)
  d.notes = $('notes').value
  if (d.notes.trim()) d.good = false
  saveDraft(s)
  updateButtons()
  if (before !== verdictOf(s)) refreshLists()
})
$('scroller').addEventListener('wheel', event => {
  if (!event.ctrlKey && !event.metaKey) return
  event.preventDefault()
  zoomBy(event.deltaY < 0 ? ZOOM_WHEEL_STEP : 1 / ZOOM_WHEEL_STEP)
}, { passive: false })
new ResizeObserver(() => state.fitted && fit()).observe($('scroller'))

document.addEventListener('keydown', event => {
  const typing = event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement
  const mod = event.metaKey || event.ctrlKey
  const key = event.key
  // Windows first: they take the keys while open.
  if (!$('confirmModal').hidden) {
    if (key === 'Escape') answer?.(false)
    return
  }
  if (!$('submitModal').hidden) {
    if (key === 'Escape' && !submitting) $('submitModal').hidden = true
    else if (key === 'Enter' && !event.repeat && !mod && !(event.target instanceof HTMLTextAreaElement) && event.target.tagName !== 'BUTTON') {
      event.preventDefault()
      void runSubmit()
    }
    return
  }
  if (!$('viewer').hidden) {
    if (key === 'Escape') $('viewer').hidden = true
    return
  }
  if (!$('helpModal').hidden) {
    if (key === 'Escape' || key === '?') showHelp(false)
    return
  }
  // A change of review waits for a press. Nothing else gets past it: not G, not a held G, not a quick one.
  if (segmentUp()) {
    if (event.repeat) return event.preventDefault()
    if (key === 'Escape') {
      if (!$('menu').hidden) return closeMenu()
      if (drawerOpen()) return closeDrawer()
      state.end = null
      state.stepTo = null
      state.arriving = false
      return render()
    }
    // Only a plain Enter: a second ⌘Enter after a send is not reading this.
    if (key === 'Enter' && mod) return event.preventDefault()
    if (key === 'Enter' && event.target.tagName !== 'BUTTON') {
      event.preventDefault()
      return startNext()
    }
    if ((key === 'x' || key === 'X') && !state.arriving) return setRestAside()
    if (key === 's' || key === 'S') return stopHere()
    if (key === 'u' || key === 'U') return undoAnswer()
    if (key === 'l' || key === 'L') return openDrawer()
    if (key === '?') return showHelp(true)
    return undefined
  }
  // A key held down repeats. Looks good moves on, so one held G would answer screen after screen.
  if (event.repeat && (key === 'g' || key === 'G' || key === 'Enter')) return event.preventDefault()
  if (mod && key === 'Enter') {
    event.preventDefault()
    return event.shiftKey ? openSubmit() : sendCurrent()
  }
  if (key === 'Escape') {
    // One thing at a time, the nearest first. Words stay.
    if (!$('menu').hidden) return closeMenu()
    if (drawerOpen()) return closeDrawer()
    if (document.body.classList.contains('answers-open')) return document.body.classList.remove('answers-open')
    if (moreOpen()) return toggleMore()
    if (draft) {
      draft = null
      return paint()
    }
    if (typing) return event.target.blur()
    return undefined
  }
  if (typing) return
  if (mod && key.toLowerCase() === 'z') {
    event.preventDefault()
    return event.shiftKey ? redo() : undo()
  }
  if (mod || event.altKey) return
  if (drawerOpen() && key !== 'l' && key !== 'L' && key !== '\\') return
  if (key === 'Enter' && state.stopped && event.target.tagName !== 'BUTTON') return goOn()
  if ((key === 's' || key === 'S') && screen() && !onDonePage()) return stopHere()
  if (key === 'ArrowLeft') go(state.index - 1)
  else if (key === 'ArrowRight') go(state.index + 1)
  else if (key === '[') stepApp(-1)
  else if (key === ']') stepApp(1)
  else if (key === '?') showHelp(true)
  else if (key === 'l' || key === 'L' || key === '\\') openDrawer()
  else if (key === 'q' || key === 'Q') togglePanels()
  else if (key === 'w' || key === 'W') location.href = '/work.html'
  else if (key === 'f' || key === 'F') toggleFull()
  else if (key === '+' || key === '=') zoomBy(ZOOM_STEP)
  else if (key === '-' || key === '_' || key === '−') zoomBy(1 / ZOOM_STEP)
  else if (key === '0') fit()
  else if (key === 'u' || key === 'U') undoAnswer()
  else if (!screen() || onDonePage()) return
  else if (key === 'g' || key === 'G') void looksGood(true)
  else if (key === 'n' || key === 'N') {
    event.preventDefault()
    $('notes').focus()
  } else if (key === 'v' || key === 'V') cycleView()
  else if ((key === 'c' || key === 'C') && !event.repeat) toggleChanges()
  else if (key === 'd' || key === 'D') pressMic()
  else if ((key === 'i' || key === 'I') && !event.repeat) toggleMore()
  else if (/^[1-4]$/.test(key)) setColour(COLOURS[Number(key) - 1].value)
  else {
    const tool = { b: 'box', a: 'arrow', p: 'pen', t: 'text', m: 'pan' }[key.toLowerCase()]
    if (tool) setTool(tool)
  }
})

render()
await loadQueue().catch(() => {
  state.loaded = true
  document.body.classList.remove('loading')
  render()
})
setInterval(() => void loadQueue().catch(() => undefined), 3000)
