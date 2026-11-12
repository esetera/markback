import { burnCanvas, changesBetween, COLOURS, fitZoom, isReal, paintChanged, paintMarks, redone, shapeOf, strokeFor, textFor, undone, withMark, withMarks, ZOOM_STEP, ZOOM_WHEEL_STEP, zoomedBy } from './annotate.js'
import { createListener, findRoute, installPack } from './mic.js'
import { qrSvg } from './qr.js'
import { agentsWords, heardWords, ideaProgress, SETUP_LINE, signOf, signShows, unheardCount, unheardWords } from './listen.js'
import { afterSend, answerWords, askedCount, askedOf, askLetter, askWords, barName, countWords, finishedWords, groupsIn, leftBehind, lookOf, nameParts, nextApp, orderedApps, placeIn, placeOn, placeWords, standingAnswer, submitJobs } from './flow.js'

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
  speak: svg('<rect x="3.5" y="1.5" width="4" height="6.5" rx="2"/><path d="M1.8 6.5a3.7 3.7 0 0 0 7.4 0M5.5 10.2v2.3"/><path d="M9.5 8.5l5 2-2.1.9-.9 2.1z" fill="currentColor" stroke-width="1"/>'),
  words: svg('<path d="M4.5 10 8 2.5l3.5 7.5M5.7 7.5h4.6"/><path d="M2.5 13.5h11" stroke-width="2.2"/>'),
  pan: svg('<path d="M8 1.5v13M1.5 8h13M8 1.5 6.2 3.3M8 1.5l1.8 1.8M8 14.5l-1.8-1.8M8 14.5l1.8-1.8M1.5 8l1.8-1.8M1.5 8l1.8 1.8M14.5 8l-1.8-1.8M14.5 8l-1.8 1.8"/>'),
  undo: svg('<path d="M5.5 3 2.5 6l3 3"/><path d="M2.5 6H10a3.5 3.5 0 0 1 0 7H6"/>'),
  redo: svg('<path d="M10.5 3l3 3-3 3"/><path d="M13.5 6H6a3.5 3.5 0 0 0 0 7h4"/>'),
  clear: svg('<path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 9h6.6l.7-9M6.7 7v4.5M9.3 7v4.5"/>'),
  mic: svg('<rect x="6" y="1.5" width="4" height="8" rx="2"/><path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5M5.5 14.5h5"/>'),
  // A lit bulb: filled, with rays.
  idea: svg('<path d="M6 12.5h4M6.5 14.5h3" /><path d="M8 3.2a3.8 3.8 0 0 0-2.2 6.9c.4.3.6.7.6 1.1v.3h3.2v-.3c0-.4.2-.8.6-1.1A3.8 3.8 0 0 0 8 3.2z" fill="var(--bulb)" /><path d="M8 .6v1.1M2.6 2.7l.8.8M13.4 2.7l-.8.8M.9 7.4h1.1M14 7.4h1.1" />'),
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
  // An agent that listens: a point with waves. Struck through when none does.
  listen: svg('<circle cx="8" cy="8" r="1.1" fill="currentColor"/><path d="M5.4 5.4a3.7 3.7 0 0 0 0 5.2M10.6 5.4a3.7 3.7 0 0 1 0 5.2M3.4 3.4a6.5 6.5 0 0 0 0 9.2M12.6 3.4a6.5 6.5 0 0 1 0 9.2"/>'),
  deaf: svg('<circle cx="8" cy="8" r="1.1" fill="currentColor"/><path d="M5.4 5.4a3.7 3.7 0 0 0 0 5.2M10.6 5.4a3.7 3.7 0 0 1 0 5.2M3.4 3.4a6.5 6.5 0 0 0 0 9.2M12.6 3.4a6.5 6.5 0 0 1 0 9.2" opacity="0.45"/><path d="M2.5 13.5l11-11"/>'),
  more: svg('<circle cx="3.5" cy="8" r="0.6"/><circle cx="8" cy="8" r="0.6"/><circle cx="12.5" cy="8" r="0.6"/>'),
  phone: svg('<rect x="4.5" y="1.5" width="7" height="13" rx="1.3"/><path d="M7.2 12.2h1.6"/>'),
}
const TOOLS = [
  { id: 'box', tip: 'Box round what is wrong', key: 'B' },
  { id: 'arrow', tip: 'Point with an arrow', key: 'A' },
  { id: 'pen', tip: 'Draw freehand', key: 'P' },
  { id: 'text', tip: 'Write on the picture', key: 'T' },
  { id: 'words', tip: 'Select the words themselves', key: 'E' },
  { id: 'speak', tip: 'Speak at a spot: click, then say it', key: 'D' },
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
    [['K'], 'What you asked for last time: show or hide'],
    [['R'], 'The film of this screen: each round and its marks, in order'],
    [['Q'], 'Panel view'],
    [['F'], 'Full screen'],
    [['Esc'], 'Close or cancel. Words stay'],
    [['?'], 'This list'],
  ]],
  ['Drawing', [
    [['B'], 'Box'], [['A'], 'Arrow'], [['P'], 'Pen'], [['T'], 'Text'], [['M'], 'Move the picture'],
    [['E'], 'Select the words themselves, where the picture has a word list'],
    [['1', '–', '4'], 'Red, amber, blue, black'],
    [['⌘', 'Z'], 'Undo'], [['⇧', '⌘', 'Z'], 'Redo'],
    [['+', '−'], 'Zoom in, zoom out'], [['0'], 'Fit the screen. On a tall one: the whole of it'], [['⌘', 'scroll'], 'Zoom'],
  ]],
  ['Answering', [
    [['A', '–', 'F'], 'On a choice: choose that option'],
    [['N'], 'Write notes on this screen'],
    [['D'], 'Speak at a spot: click on the picture, then say it. On a choice of four or more, D chooses D: use the speak button'],
    [['⇧', 'D'], 'Speak your notes into the notes box'],
    [['G'], 'Looks good, then on to the next'],
    [['⌘', '↩'], 'Send, then on to the next'],
    [['U'], 'Undo the last answer, while it says so'],
    [['⇧', '⌘', '↩'], 'Looks good for all the rest'],
    [['O'], 'All screens of this review, and where each stands'],
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
  // The person asked to see the whole of a tall picture, not its width.
  whole: false,
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
  // On a phone: the marking tools are out, and a finger on the picture draws. Otherwise a finger moves the picture.
  marking: false,
  // Opened on a phone through Tailscale: what runs things on the computer, or only it can do, is not offered.
  remote: false,
  // Screens whose list of earlier marks was closed, and the one lit on the picture.
  askedShut: new Set(),
  askLit: null,
  // Who listens and what waits unheard, as the server last said. Unset with a server from before it said so.
  listening: null,
  starting: !location.hash.slice(1) && !new URLSearchParams(location.search).has('review'),
  buildTargets: [],
  ideaRequests: [],
}
/**
 * A phone, or a window as narrow as one: a name and a count above, the picture, and three large buttons under it. The marking
 * tools fold away until Mark is pressed.
 */
// A phone held sideways is wider than that, but short, and touched: it is a phone too.
const narrow = matchMedia('(max-width: 640px), (max-height: 500px) and (pointer: coarse)')
const onPhone = () => narrow.matches
/** A phone has no N key to press, so the notes box does not offer one. */
const phoneLook = () => {
  document.body.classList.toggle('phone', onPhone())
  $('notes').placeholder = onPhone() ? 'Notes' : 'Notes (N)'
}
phoneLook()
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
const screen = () => state.starting ? null : app()?.screens[state.index] ?? null
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
  // What was said of the earlier marks counts only on the picture it was said on: their numbers belong to it.
  const said = (sure && saved?.said) || {}
  // Which option of a choice was chosen: a letter, kept with the picture it was chosen on.
  const d = { after: s.after, choice: (sure && saved?.choice) || null, marks, notes, said, back: (sure && saved?.back) || [], checked: (sure && saved?.checked) || [], good: sure && !!saved?.good, pending: sure && !!saved?.pending, pendingAt: (sure && saved?.pendingAt) || 0, unsure: !sure && (marks.some(isReal) || !!notes.trim()), undo: [], redo: [] }
  drafts.set(key, d)
  return d
}
/** What was left unsent on this screen in an older round. */
const leftBehindOn = s => leftBehind(s.round, r => store.get(`${s.appSlug}/${s.id}/${r}`), isReal)
const saveDraft = s => {
  const d = draftOf(s)
  store.set(keyOf(s), d.marks.length || d.notes.trim() || d.good || d.choice || Object.keys(d.said).length || d.back?.length ? { marks: d.marks, notes: d.notes, said: d.said, back: d.back, checked: d.checked, good: d.good, choice: d.choice, pending: d.pending, pendingAt: d.pendingAt, after: d.unsure ? undefined : s.after } : null)
}
/** What this screen's draft would send: 'changes', 'approved', or null when nothing is on it yet. */
function verdictOf(s) {
  const d = draftOf(s)
  // Still stands, or came back, asks for a change as a mark does.
  if (marksOrNotes(d) || stands(d)) return 'changes'
  // A tick never answers a screen. On a picture already answered with changes this round, it is an update to them.
  if (fixedTicks(d) && s.status === 'sent') return 'changes'
  // A choice made, and nothing asked of it: the chosen option as it is.
  if (s.choice && d.choice) return 'approved'
  return d.good ? 'approved' : null
}
const marksOrNotes = d => d.marks.some(isReal) || !!d.notes.trim()
/** Only Fixed ticks on it: no marks, no notes, nothing said to stand. They ride along with an answer, and never go by themselves. */
const fixedTicks = d => !marksOrNotes(d) && !stands(d) && Object.keys(d.said).length > 0
/** What goes without a press of Send: the same, but Fixed ticks alone stay in the draft and the screen waits. */
/** A lineup with nothing chosen. A choice is never made for the person: it goes only when they send it themselves. */
const needsChoice = s => !!s.choice && !draftOf(s).choice
const goesOf = s => (needsChoice(s) || (fixedTicks(draftOf(s)) && !draftOf(s).good) ? null : verdictOf(s))
/** Every earlier mark still asked for is ticked fixed, and no "came back?" waits for an answer. */
function allChecked(s) {
  const said = saidOf(s)
  const asked = askedNow(s)
  return asked.open.length + asked.back.length > 0 && asked.open.every(a => said[a.n] === 'fixed') && asked.back.every(a => said[a.n] === 'fixed')
}
/** Marks sent on this picture this round since the last Looks good pressed: what replacing the changes drops. */
function marksSentNow(s) {
  const records = (histories.get(historyKey(s)) ?? []).filter(r => r.round === s.round && !r.olderPicture)
  const upTo = records.findIndex(r => r.verdict === 'approved' && !r.noComment)
  return (upTo < 0 ? records : records.slice(0, upTo)).filter(r => r.verdict === 'changes').reduce((n, r) => n + (r.marks || 0), 0)
}
/** The "came back?" marks the person has said nothing of. Never decided for them. */
const unansweredBack = s => askedNow(s).back.filter(a => !saidOf(s)[a.n])
/** An earlier mark said to still stand is something to send, as a mark is, and so is a word said before and taken back (null). */
const stands = d => Object.values(d.said).some(word => word === 'stands' || word === null)
/** Something is on it to go by itself. Marks that cannot be trusted to this picture wait to be looked at, and so do Fixed ticks alone. */
const saysAnswer = s => !!goesOf(s) && !draftOf(s).unsure
const waitingOf = a => (a ? a.screens.filter(s => s.status === 'waiting') : [])
/** What the page will offer next by itself: something to answer, and not set aside. */
const offered = a => openOf(a).length > 0 && !a.setAside
const ordered = () => orderedApps(state.apps)
const nextOffered = slug => nextApp(ordered(), slug, offered)
const placeOf = a => placeIn(a, state.apps)
const sentHere = new Set()
/** Waiting, and not answered here on its way to the server. */
const openOf = a => waitingOf(a).filter(s => !queued.has(keyOf(s)))
const setOf = a => (a ? a.screens.filter(s => !needsChoice(s) && (s.status === 'waiting' || goesOf(s))) : [])
/** Lineups still waiting for a choice: Looks good for the rest leaves them, and says so. */
const unchosenOf = a => (a ? a.screens.filter(s => s.status === 'waiting' && needsChoice(s) && !queued.has(keyOf(s))) : [])
function tallyOf(a) {
  const set = setOf(a)
  const changes = set.filter(s => goesOf(s) === 'changes')
  const good = set.filter(s => goesOf(s) === 'approved')
  const untouched = set.filter(s => !goesOf(s))
  return { set, changes, good, untouched, reviewed: changes.length + good.length }
}
const label = s => `${s.screen}${s.mode ? ` (${s.mode})` : ''}`
/** The screen in the bar: its name first to be kept, and light or dark quiet after it. */
const screenCrumb = s => `<b title="${esc(label(s))}">${esc(s.screen)}</b>${s.mode ? `<span class="crumb-mode">${esc(s.mode)}</span>` : ''}`
/** Waiting in every review still offered. */
const waitingInAll = () => state.apps.filter(x => !x.setAside).reduce((n, x) => n + openOf(x).length, 0)
/** Whose words the note is. Anything already queued came from a session too. */
const fromWords = s => `From ${s?.from || 'Claude'}`
/** A screen as the latest list has it. */
const liveScreen = s => state.apps.find(a => a.slug === s.appSlug)?.screens.find(x => x.id === s.id) ?? null

/* ---------- loading the queue ---------- */

async function loadQueue() {
  const res = await fetch('/api/queue', { cache: 'no-store' })
  const { apps, reader, listening, buildTargets, ideaRequests, phone: phoneNow, remote } = await res.json()
  state.remote = remote === true
  state.buildTargets = buildTargets ?? []
  state.ideaRequests = ideaRequests ?? []
  syncBuildForms()
  // Whether this computer can read words off a picture. It does not change while the server runs.
  state.reader = reader === true
  setListening(listening)
  const text = JSON.stringify(apps)
  state.loaded = true
  document.body.classList.remove('loading')
  resendKept()
  setPhone(phoneNow)
  if (text === lastQueue) {
    renderDrawer()
    return sayLooks()
  }
  const wasLoaded = lastQueue !== ''
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
  // What has come in since the last look: a new screen, or a new picture of one. Not on the first load, and not what is set aside.
  const had = new Map(state.apps.flatMap(a => a.screens.map(s => [`${a.slug}/${s.id}`, s.after])))
  const fresh = wasLoaded ? apps.filter(a => !a.setAside).flatMap(a => a.screens.filter(s => s.status === 'waiting' && had.get(`${a.slug}/${s.id}`) !== s.after).map(s => ({ app: a.name, screen: s.screen }))) : []
  // Readings of marks that came since the last look: what the agent understood, said back before it builds.
  const readBefore = new Map(state.apps.flatMap(a => a.screens.map(s => [`${a.slug}/${s.id}`, s.inferred?.posted ?? ''])))
  const readNow = wasLoaded ? apps.flatMap(a => a.screens.filter(s => s.inferred?.posted && s.inferred.posted !== readBefore.get(`${a.slug}/${s.id}`))) : []
  state.apps = apps
  const first = !app()
  if (first) {
    resumeAnswers()
    const [hashApp, hashScreen] = decodeURIComponent(location.hash.slice(1)).split('/')
    const wanted = apps.find(a => a.slug === hashApp)
    // Opened plain, it starts at the next thing to review, and says so. A link opens what it names.
    // Set aside stays set aside: a reload on it is not a reason to be back on it.
    state.arriving = !state.starting && (!hashApp || !!wanted?.setAside) && apps.some(offered)
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
  // The first look after a reload: words saved where no box can open again are shown, not kept out of sight.
  if (first) showSavedElsewhere()
  if (notice) toast(notice)
  if (fresh.length) announce(fresh, !notice)
  // On show, the lines are there to see. Anywhere else, a line says so, with a press to go and look.
  for (const x of readNow) looks.set(`${x.appSlug}/${x.id}`, x)
  sayLooks(!!notice || fresh.length > 0)
}

/** Readings that came on screens not on show, waiting to be said: held while another line is up, never dropped. */
const looks = new Map()
function sayLooks(busy = false) {
  for (const [key, x] of looks) if (screen()?.appSlug === x.appSlug && screen()?.id === x.id) looks.delete(key)
  if (!looks.size || busy || state.arriving || !$('toast').hidden) return
  const [first, ...rest] = looks.values()
  looks.clear()
  toast(`${String(first.inferred.from || 'Claude').slice(0, 40)} said what it read on ${label(first)}`, rest.length ? `And on ${rest.length} more` : 'A line beside each mark: yes, or say what you meant', { look: `${first.appSlug}/${first.id}` })
}

/* ---------- is an agent listening: a steady sign in the bar, and a notice that stays when approved work has nobody to hear it ---------- */

/** The notice under the sign. `made` is what an answer just made; `quiet` is the short line when an agent will hear it. */
const heard = { open: false, made: null, quiet: '', timer: 0 }
let lastListening = ''
function setListening(next) {
  const text = JSON.stringify(next ?? null)
  if (text === lastListening) return
  lastListening = text
  state.listening = next ?? null
  // What it warned about is heard now, or has been taken: the warning has nothing left to say.
  if (heard.open && heard.made && next && !unheardCount(next)) {
    if (next.agents.length) return quietLine(heardWords(next.agents))
    heard.open = false
  }
  return renderHeard()
}
function closeHeard() {
  clearTimeout(heard.timer)
  Object.assign(heard, { open: false, made: null, quiet: '' })
  renderHeard()
}
function quietLine(words) {
  clearTimeout(heard.timer)
  Object.assign(heard, { open: true, made: null, quiet: words })
  heard.timer = setTimeout(closeHeard, 4000)
  renderHeard()
}
/** An answer made work for an agent. Heard: one quiet line. Not heard: said at once, and it stays until closed or heard. */
function saidMade(made) {
  const l = state.listening
  if (!l?.unheard) return
  if (made.heard && l.agents.length) return quietLine(heardWords(l.agents))
  clearTimeout(heard.timer)
  Object.assign(heard, { open: true, made: made.what, quiet: '' })
  renderHeard()
}
const copyRow = line => `<div class="copy-line"><code>${esc(line)}</code><button class="btn" data-copy="${esc(line)}">Copy</button></div>`
const desktopWake = () => {
  const registrations = state.listening?.desktop
  return registrations && Object.hasOwn(registrations, state.appSlug) ? registrations[state.appSlug] : null
}
const reviewSign = () => {
  const desktop = desktopWake()
  if (!desktop?.on) return signOf(state.listening)
  const tip = 'Codex Desktop checks this review for new marks.'
  return desktop.pending ? { state: 'waking', words: 'Waiting for Codex…', tip } : { state: 'on', words: '', tip }
}
function heardHtml() {
  const l = state.listening
  if (heard.quiet) return `<p class="quiet">${esc(heard.quiet)}</p>`
  const close = `<button class="tool" data-heard-close aria-label="Close">${ICONS.close}</button>`
  const desktop = desktopWake()
  if (desktop?.on) return `<div class="heard-head"><p>${desktop.pending ? 'Your marks are in.' : 'Codex Desktop wake is on.'}</p>${close}</div><p class="sub">Codex picks up marks on its next check.</p>`
  const setup = `<p class="sub">Your agent can start by itself next time. Ask it once:</p>${copyRow(SETUP_LINE)}`
  if (!unheardCount(l)) {
    const who = agentsWords(l.agents)
    return `<div class="heard-head"><p>${esc(who ? `${who}.` : 'No agent is listening.')}</p>${close}</div><p class="sub">${who ? 'It takes what you approve or send.' : projectWake()?.on ? `Nothing waits for an agent now. When work waits, ${esc(projectWake().by)} is started.` : 'Nothing waits for an agent now.'}</p>${!who && !projectWake() ? setup : ''}`
  }
  const w = unheardWords(l, heard.made)
  return `<div class="heard-head"><p>${esc(w.head)}</p>${close}</div><p class="sub">${esc(w.sub)}</p>${w.log ? `<p class="sub">It last said:</p><pre>${esc(w.log)}</pre>` : ''}${w.line ? copyRow(w.line) : ''}${w.setup ? setup : ''}`
}
/** The tab says how many screens wait, with a mark in front when work waits and no agent hears it. */
const titleNow = () => `${reviewSign().state === 'warn' ? '! ' : ''}${waitingInAll() ? `(${waitingInAll()}) ` : ''}Markback`
function renderHeard() {
  const sign = reviewSign()
  const el = $('heardSign')
  // Said only when work waits that no agent will hear. While one listens, nothing is in the way.
  el.hidden = !signShows(sign)
  el.className = `tool heard-sign is-${sign.state}`
  el.dataset.tip = sign.tip
  el.setAttribute('aria-label', sign.tip)
  setHtml(el, `${ICONS[sign.state === 'on' || sign.state === 'waking' ? 'listen' : 'deaf']}${sign.words ? `<span>${esc(sign.words)}</span>` : ''}`)
  const card = $('heard')
  // A card opened from the sign closes with it. The quiet line, and the notice for what was just sent, may stay.
  card.hidden = !heard.open || sign.state === 'none' || (!signShows(sign) && !heard.quiet && !heard.made)
  if (!card.hidden) {
    card.className = `heard${!heard.quiet && sign.state === 'warn' ? ' warn' : ''}`
    setHtml(card, heardHtml())
  }
  keepApart()
  if (state.loaded) document.title = titleNow()
}
$('heardSign').onclick = () => {
  if (heard.open) return closeHeard()
  clearTimeout(heard.timer)
  Object.assign(heard, { open: true, made: null, quiet: '' })
  return renderHeard()
}
$('heard').onclick = async event => {
  if (event.target.closest('[data-heard-close]')) return closeHeard()
  const copy = event.target.closest('[data-copy]')
  if (!copy) return undefined
  let done = false
  try {
    await navigator.clipboard.writeText(copy.dataset.copy)
    done = true
  } catch {
    // The clipboard can be refused. The line is selected instead, ready to copy with the keys.
    getSelection().selectAllChildren(copy.previousElementSibling)
  }
  copy.textContent = done ? 'Copied' : 'Selected: copy it'
  return undefined
}
/** The wake of the project this review belongs to. Each project has its own, or none. */
const projectWake = () => state.listening?.wakes?.find(w => w.apps?.includes(state.appSlug)) ?? null
async function toggleWake() {
  closeMenu()
  const desktop = desktopWake()
  const wake = desktop ?? projectWake()
  if (!wake) return
  try {
    const res = await fetch('/api/wake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on: !wake.on, ...(desktop ? { app: state.appSlug } : { key: wake.key }) }) })
    const got = await res.json()
    if (!res.ok) throw new Error(got.error || 'the server did not take it')
    setListening(got.listening)
    toast(wake.on ? 'Your agent is not woken now' : desktop ? 'Codex Desktop will check for marks' : `${wake.by} is woken when work waits`, wake.on ? 'Work waits until an agent listens' : '')
  } catch (error) {
    toast('That could not be saved', error.message, { problem: true })
  }
}

/* ---------- something new to review: said in the tab's title always, and by a sound and a notice unless turned off ---------- */

const noticesOn = () => prefs.get('notices') !== 'off'
const canNotify = () => typeof Notification === 'function'
/** What has come, in a few words. */
function freshWords(fresh) {
  const names = [...new Set(fresh.map(f => f.app))]
  const many = `${fresh.length} new screen${fresh.length === 1 ? '' : 's'}`
  return names.length === 1 ? (fresh.length === 1 ? `New: ${fresh[0].screen} of ${names[0]}` : `${many} of ${names[0]}`) : `${many} in ${names.length} reviews`
}
let sounds = null
/** Two soft notes. A browser may refuse sound before the first press on the page: then there is none, and nothing breaks. */
function chime() {
  try {
    sounds ??= new (window.AudioContext ?? window.webkitAudioContext)()
    if (sounds.state === 'suspended') void sounds.resume()
    const start = sounds.currentTime
    for (const [n, pitch] of [660, 880].entries()) {
      const tone = sounds.createOscillator()
      const loud = sounds.createGain()
      tone.frequency.value = pitch
      loud.gain.setValueAtTime(0.0001, start + n * 0.16)
      loud.gain.exponentialRampToValueAtTime(0.12, start + n * 0.16 + 0.02)
      loud.gain.exponentialRampToValueAtTime(0.0001, start + n * 0.16 + 0.3)
      tone.connect(loud).connect(sounds.destination)
      tone.start(start + n * 0.16)
      tone.stop(start + n * 0.16 + 0.32)
    }
  } catch {
    // No sound here. The title and the page still say it.
  }
}
function announce(fresh, mayToast) {
  const words = freshWords(fresh)
  // Looking at the page: a line on it is enough.
  if (document.hasFocus()) {
    const ready = state.starting && fresh.length === 1 && state.apps.find(app => app.name === fresh[0].app)
    return mayToast && !state.arriving && toast(words, '', ready ? { go: ready.slug } : {})
  }
  if (!noticesOn()) return undefined
  chime()
  if (!canNotify() || Notification.permission !== 'granted') return undefined
  try {
    const notice = new Notification('Markback', { body: words, tag: 'markback-new' })
    notice.onclick = () => {
      window.focus()
      notice.close()
    }
  } catch {
    // Some browsers allow notices only from a worker. The sound and the title stand in.
  }
  return undefined
}
/** The menu's switch. Turning it on is the press a browser needs before it will ask leave to show notices. */
async function toggleNotices() {
  closeMenu()
  // A browser asks leave once. Sent away without an answer, the switch is a plain on and off from then on.
  const asking = canNotify() && Notification.permission === 'default' && prefs.get('notices-asked') !== 'yes'
  if (noticesOn() && !asking) {
    prefs.set('notices', 'off')
    return toast('Sound and notices for new screens are off', 'The tab still shows how many wait')
  }
  prefs.set('notices', 'on')
  if (asking) prefs.set('notices-asked', 'yes')
  const leave = asking ? await Notification.requestPermission().catch(() => 'denied') : canNotify() ? Notification.permission : 'denied'
  chime()
  return toast('You will hear when new screens come', leave === 'granted' ? 'And see a notice when this page is behind another' : 'This browser shows no notices for this page: the sound and the tab say it')
}
function noticesLabel() {
  if (canNotify() && Notification.permission === 'default' && noticesOn() && prefs.get('notices-asked') !== 'yes') return 'Notices for new screens…'
  return `Sound and notices for new screens: ${noticesOn() ? 'on' : 'off'}`
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
  const ideas = state.ideaRequests.length ? `<div class="drawer-group"><span>Idea requests</span><a href="/work.html#queue">Queue</a></div>${state.ideaRequests.slice(-3).reverse().map(request => `<a class="drawer-idea" href="/work.html?request=${encodeURIComponent(request.id)}#ideas"><strong>${esc(request.target)}</strong><span>${esc(ideaProgress(request, state.listening))}</span></a>`).join('')}` : ''
  setHtml($('drawerList'), `${ideas}${open ? `<div class="drawer-group"><span>To review</span><span>Waiting · Done</span></div>${open}` : ''}${aside ? `<div class="drawer-group"><span>Set aside</span></div>${aside}` : ''}${answered ? `<div class="drawer-group"><span>All answered</span></div>${answered}` : ''}`)
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

/* ---------- all the screens of this review at once: where each stands, a press to go to one, and one press for the rest ---------- */

const sheetOpen = () => !$('sheetModal').hidden
function renderSheet() {
  const a = app()
  if (!sheetOpen() || !a) return
  const left = openOf(a).filter(s => !goesOf(s)).length
  $('sheetTitle').textContent = `${a.name}: ${a.screens.length} screen${a.screens.length === 1 ? '' : 's'}`
  setHtml($('sheetGrid'), a.screens.map((s, i) => {
    const st = statusOf(s)
    return `<button class="sheet-item${i === state.index && !state.showDone ? ' current' : ''}" data-i="${i}" title="${esc(label(s))}"><span class="thumb"><img src="/images/${esc(s.after)}" alt="" loading="lazy" decoding="async"></span><span class="what"><b>${i + 1}. ${esc(label(s))}</b></span><span class="st"><i class="mk ${st.mk}"></i>${esc(st.text)}</span></button>`
  }).join(''))
  $('sheetRest').textContent = left ? `Looks good for the rest (${left})` : 'Nothing left to answer'
  $('sheetRest').disabled = !left
}
function openSheet() {
  if (!app()) return
  if (sheetOpen()) return closeSheet()
  closeTextEntry(true)
  closeMenu()
  closeDrawer()
  $('sheetModal').hidden = false
  // Nothing behind it can take the focus or a key while it is up: Enter on a button there would answer a screen unseen.
  for (const el of document.querySelectorAll('.bar, #workspace')) el.inert = true
  renderSheet()
  const here = $('sheetGrid').querySelector('.sheet-item.current') ?? $('sheetGrid').querySelector('.sheet-item')
  here?.focus()
  here?.scrollIntoView({ block: 'center' })
}
function closeSheet() {
  $('sheetModal').hidden = true
  for (const el of document.querySelectorAll('.bar, #workspace')) el.inert = false
}

/* ---------- the film of one screen: each round's picture, then its marks, on to the newest, over the whole page ---------- */

/** How long a step stays, when a test says so. The film's own times come with it, in seconds. */
const FILM_MS = Number(new URLSearchParams(location.search).get('film')) || 0
/** `at` is the step on show. `picked` is true when a round was chosen and not reached by playing or stepping. */
/** `loading` is the ask on its way, from the press until the film comes. `back` has the focus to go back to when it closes. */
const film = { data: null, of: null, names: [], at: 0, playing: false, timer: null, picked: true, loading: null, back: null }
const filmOpen = () => !$('film').hidden
/** The step on show: the picture comes in over the last one, the strip says which round, and the button says what it does. */
function showFilm() {
  const { data, names } = film
  const step = data.steps[film.at]
  const top = $('filmImg')
  const under = $('filmUnder')
  if (top.getAttribute('src') !== step.url) {
    // The last picture stays under the new one while it comes in, so nothing flashes between them.
    under.hidden = !top.getAttribute('src') || matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!under.hidden) under.src = top.src
    top.classList.remove('fresh')
    top.src = step.url
    // Read once, so the browser starts the fade again from the beginning.
    void top.offsetWidth
    top.classList.add('fresh')
  }
  top.alt = `${names[step.at]}${step.marked ? ', as marked' : ''}`
  for (const [i, el] of [...$('filmStrip').children].entries()) {
    el.classList.toggle('current', i === step.at)
    if (i === step.at) el.setAttribute('aria-current', 'true')
    else el.removeAttribute('aria-current')
  }
  $('filmStrip').children[step.at]?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  $('filmPlay').textContent = film.playing ? 'Pause' : 'Play'
}
/** Waits as long as the step on show stays, then goes to the next. It stops by itself on the last. */
function runFilm() {
  clearTimeout(film.timer)
  if (!film.playing) return
  film.timer = setTimeout(() => {
    if (film.at >= film.data.steps.length - 1) film.playing = false
    else film.at++
    showFilm()
    runFilm()
  }, FILM_MS || film.data.steps[film.at].seconds * 1000)
}
function pauseFilm() {
  clearTimeout(film.timer)
  film.playing = false
}
function playFilm() {
  if (!filmOpen()) return
  if (film.playing) {
    pauseFilm()
    return showFilm()
  }
  const { steps } = film.data
  // At the end, it plays again from the first picture. A round chosen in the strip plays from its own picture, before the marks.
  if (film.at >= steps.length - 1) film.at = 0
  else if (film.picked) film.at = steps.findIndex(step => step.at === steps[film.at].at)
  film.picked = false
  film.playing = true
  showFilm()
  runFilm()
}
/** One step back or on: a picture, then the same picture as marked, then the next round's picture. */
function stepFilm(by) {
  pauseFilm()
  film.picked = false
  film.at = Math.max(0, Math.min(film.data.steps.length - 1, film.at + by))
  showFilm()
}
/** A round from the strip, as it was left: marked, when it was marked. */
function pickFilmRound(round) {
  pauseFilm()
  film.picked = true
  film.at = film.data.steps.findLastIndex(step => step.at === round)
  showFilm()
}
/** The page behind the film, shut or open again: nothing there takes the focus, a key or a press while it is shut. */
function shutBehindFilm(shut) {
  for (const el of document.querySelectorAll('.bar, #workspace')) el.inert = shut
}
/** The focus goes back where it was before the film: a press in the menu goes back to the menu's button. */
function focusBeforeFilm() {
  const back = film.back
  film.back = null
  if (back && back !== document.body && back.isConnected && back.checkVisibility() && !back.closest('[inert]')) back.focus({ preventScroll: true })
  // Nowhere to go back to: the focus leaves the shut film, so no key lands on a button nobody sees.
  else if (document.activeElement?.closest('#film')) document.activeElement.blur()
}
async function openFilm() {
  const s = screen()
  if (filmOpen()) return closeFilm()
  if (wordsFirst()) return
  if (!s || film.loading) return
  const was = document.activeElement
  film.back = was?.closest('#menu') ? $('menuOpen') : was
  closeTextEntry(true)
  closeMenu()
  closeDrawer()
  endPin()
  // Shut from the press on, not from when the film comes: G pressed while it loads would answer the screen behind unseen.
  shutBehindFilm(true)
  const asked = {}
  film.loading = asked
  let data = null
  try {
    const res = await fetch(`/api/film?app=${encodeURIComponent(s.appSlug)}&id=${encodeURIComponent(s.id)}`, { cache: 'no-store' })
    data = res.ok ? (await res.json()).film : null
  } catch {
    data = null
  }
  // Esc while it loaded, or another screen by now: the film is dropped. It would open over a screen it is not the film of.
  const now = screen()
  const wanted = film.loading === asked && now?.appSlug === s.appSlug && now?.id === s.id
  if (film.loading === asked) film.loading = null
  if (!wanted || !data?.steps?.length) {
    shutBehindFilm(false)
    focusBeforeFilm()
    return wanted ? toast('No film of this screen', 'Its pictures are not in the store.', { problem: true }) : undefined
  }
  const last = data.rounds.length - 1
  Object.assign(film, { data, of: { appSlug: s.appSlug, id: s.id }, names: data.rounds.map((r, i) => (data.finished && i === last ? 'Finished' : `Round ${r.round}`)), playing: false, picked: true })
  const name = `${data.screen}${data.mode ? ` (${data.mode})` : ''}`
  const seconds = Math.round(data.seconds)
  $('filmTitle').textContent = `${name}: from first mark to ${data.finished ? 'finished' : 'now'}`
  $('filmTitle').title = $('filmTitle').textContent
  // A sketch is a drawing, and ffmpeg makes films of pictures: it plays here, and the page says so in place of the button.
  const why = data.save?.why ?? ''
  $('filmLength').textContent = `${data.rounds.length} round${data.rounds.length === 1 ? '' : 's'} · ${seconds} second${seconds === 1 ? '' : 's'}${data.missing > 0 ? ` · ${data.missing} older ${data.missing === 1 ? 'picture is' : 'pictures are'} gone` : ''}${why ? ' · Plays here only: a film of a sketch cannot be saved as a file' : ''}`
  $('filmLength').title = why || $('filmLength').textContent
  // Saving runs ffmpeg on the computer: a phone plays the film, and saves nothing.
  $('filmSave').hidden = !!why || state.remote
  // A long story is saved as its newest rounds. The button says so before it is pressed, and the note after.
  $('filmSave').dataset.tip = `Save the film as a video file${data.save?.leftOut ? `. ${data.save.leftOut}` : ''}`
  // What was said in a round is words, and not in its picture: it is on the round's name, for a pointer that rests there.
  const said = r => (r.answer ? `: ${answerWords(r.answer)}${r.answer.notes && !r.answer.noComment ? `. ${r.answer.notes}` : ''}` : '')
  $('filmStrip').innerHTML = data.rounds.map((r, i) => `<button class="film-round" data-round="${i}" title="${esc(`${film.names[i]}${said(r)}`)}"><span class="thumb"><img src="${esc(r.url)}" alt="" decoding="async"></span><span>${esc(film.names[i])}</span></button>`).join('')
  // Every picture is asked for now, so each is there when its step comes.
  for (const step of data.steps) new Image().src = step.url
  $('filmImg').removeAttribute('src')
  $('filmUnder').hidden = true
  $('film').hidden = false
  document.body.classList.add('film-open')
  // It opens on the first round as it was left: the first marks.
  film.at = data.steps.findLastIndex(step => step.at === 0)
  showFilm()
  $('filmPlay').focus()
  return undefined
}
/** Esc while the film loads: it does not open, and the page is as it was. */
function cancelFilm() {
  film.loading = null
  shutBehindFilm(false)
  focusBeforeFilm()
}
function closeFilm() {
  pauseFilm()
  $('film').hidden = true
  document.body.classList.remove('film-open')
  shutBehindFilm(false)
  focusBeforeFilm()
}
/** The film as a video file. The server makes it with ffmpeg, when this computer has it, and says so plainly when it has not. */
async function saveFilm() {
  const s = film.of
  if (!s || $('filmSave').disabled) return
  $('filmSave').disabled = true
  try {
    const res = await fetch(`/api/film/file?app=${encodeURIComponent(s.appSlug)}&id=${encodeURIComponent(s.id)}`, { cache: 'no-store' })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'The server did not make it.')
    const link = document.createElement('a')
    link.href = URL.createObjectURL(await res.blob())
    link.download = `${s.appSlug}-${s.id}-film.mp4`
    link.click()
    setTimeout(() => URL.revokeObjectURL(link.href), 10000)
    // A long story is saved as its newest rounds: the note says the older ones are not in the file.
    toast('Film saved', `${link.download}${film.data.save?.leftOut ? `. ${film.data.save.leftOut}` : ''}`)
  } catch (error) {
    toast('The film was not saved', error.message, { problem: true })
  } finally {
    $('filmSave').disabled = false
  }
}
$('filmPlay').onclick = playFilm
$('filmSave').onclick = () => void saveFilm()
$('filmClose').onclick = closeFilm
$('filmStrip').onclick = event => {
  const round = event.target.closest('[data-round]')
  if (round) pickFilmRound(Number(round.dataset.round))
}
$('filmImg').addEventListener('animationend', () => {
  $('filmUnder').hidden = true
})
/* Some browsers press a button when Space comes up, whatever was done when it went down. */
document.addEventListener('keyup', event => {
  if (filmOpen() && event.key === ' ') event.preventDefault()
})

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
  // A reading came, or was answered: what was said is the same, so only that is asked for again.
  else if ((readingsAt.get(historyKey(s)) ?? '') !== (s.inferred?.changed ?? '')) void loadHistory(s, true)
  // Sent with the set with nothing said: its words are the wizard's, not the reviewer's.
  const said = r => (r.notes && !r.noComment ? `<div class="prose">${esc(r.notes)}</div>` : '')
  setHtml($('yourAnswer'), standing ? `<h3>Your answer</h3><div class="round"><div class="rh"><i class="mk ${standing.verdict === 'approved' ? 'approved' : 'sent'}"></i>${esc(answerWords(standing))}<time>${esc(when(standing.sentAt))}</time></div>${said(standing)}${standing.annotatedUrl ? '<div class="prose small">Drawn on the picture.</div>' : ''}</div>` : '')
  const older = (records ?? []).filter(r => r !== standing)
  const left = leftBehindOn(s)
  const leftHtml = left.map(r => `<div class="round"><div class="rh"><i class="mk draft-changes"></i>Round ${r.round} · Not sent${r.marks ? `, ${r.marks} mark${r.marks === 1 ? '' : 's'}` : ''}${r.ticks ? `, ${r.ticks} earlier mark${r.ticks === 1 ? '' : 's'} ticked` : ''}</div>${r.notes.trim() ? `<div class="prose">${esc(r.notes)}</div>` : ''}<div class="prose small">Left unsent, and the screen has changed since.</div></div>`).join('')
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

/* A Proposal is a new idea to shape, not something built to check: a lit bulb in the bar says so. QA needs no mark. */
function renderKind(s) {
  const proposal = s?.kind === 'proposal'
  // A small mark in the bar: the overlay and the queue say Proposal in full. QA is the usual case and needs no mark.
  $('kindTag').hidden = !proposal
  $('kindTag').className = 'kind proposal'
  setHtml($('kindTag'), ICONS.idea)
  $('kindTag').dataset.tip = 'Proposal: a new idea to shape'
  $('kindTag').setAttribute('aria-label', 'Proposal')
}

/* ---------- speaking ---------- */

const mic = { route: null, listener: null }

/* ---------- speaking at a spot: a pin where you click, and what you say beside it ---------- */

/** How long a silence ends a pin: after some words, and with none at all. */
const PIN_PAUSE_MS = Number(new URLSearchParams(location.search).get('pause')) || 2500
const PIN_EMPTY_MS = PIN_PAUSE_MS * 3
/** The pin that listens now, if any: { at, n, color, text, timer, startedMic }. Its words are a mark only once it ends. */
const pin = { active: null }
/** The listener writes into a text box. A pin has one of its own, off the page, so the same listener serves both. */
const pinBox = document.createElement('textarea')
pinBox.addEventListener('input', () => {
  const p = pin.active
  if (!p) return
  p.text = pinBox.value.trim()
  restPin()
  paint()
})
const isPin = m => m.tool === 'pin'
function restPin() {
  const p = pin.active
  if (!p) return
  clearTimeout(p.timer)
  p.timer = setTimeout(() => endPin(), p.text ? PIN_PAUSE_MS : PIN_EMPTY_MS)
}
function showGlow() {
  const glow = $('pinGlow')
  const p = pin.active
  glow.hidden = !p || !state.size
  if (glow.hidden) return
  glow.style.left = `${(p.at[0] / state.size.w) * 100}%`
  glow.style.top = `${(p.at[1] / state.size.h) * 100}%`
  glow.style.setProperty('--pin', p.color)
  // As wide as the pin is on the screen now, whatever the zoom.
  glow.style.setProperty('--r', `${Math.round(textFor(markWidth()) * 0.8 * state.zoom) + 4}px`)
}
/** Ends the pin that listens. With words it becomes a mark; with none it leaves nothing. */
function endPin({ keepMic = false } = {}) {
  const p = pin.active
  if (!p) return
  clearTimeout(p.timer)
  pin.active = null
  pinBox.value = ''
  showGlow()
  // A phrase still being heard stays with this pin as far as it got. The rest of it must not land in the next box.
  mic.listener?.skip()
  if (p.startedMic && !keepMic && mic.listener?.on) mic.listener.stop()
  // On a choice, "this one" said at a spot chooses the option there, and is no mark.
  const s = screen()
  if (s?.choice && THIS_ONE.test(p.text)) {
    paint()
    return choose(optionNear(s, p.at[0])?.key ?? null)
  }
  // A mark with a place and its words. The far corner only says it is a real mark to the shared drawing code.
  // The size it was seen at goes with it, so the marked picture shows it as the screen did.
  if (p.text) commit({ tool: 'pin', a: p.at, b: [p.at[0] + 24, p.at[1] + 24], color: p.color, text: p.text, n: p.n, size: state.size ? textFor(markWidth()) : undefined })
  else paint()
}
/** Lets the listening pin go without a mark: the screen it was on has gone. */
function dropPin() {
  const p = pin.active
  if (!p) return
  clearTimeout(p.timer)
  pin.active = null
  pinBox.value = ''
  showGlow()
  mic.listener?.skip()
  if (p.startedMic && mic.listener?.on) mic.listener.stop()
}
/** A press with the speak tool: the pin that listened ends there, and a new one listens here. */
async function startPin(at) {
  const kept = pin.active?.startedMic
  endPin({ keepMic: true })
  const s = screen()
  if (!s || !state.size) return
  const wasOn = !!mic.listener?.on
  if (!wasOn && !(await startMic())) return
  // A question may have been asked first. If the screen has gone meanwhile, nothing is left listening for a pin that is not there.
  if (!screen() || keyOf(screen()) !== keyOf(s) || !state.size) {
    if (!wasOn && mic.listener?.on) mic.listener.stop()
    return
  }
  const used = draftOf(screen()).marks.filter(isPin).map(m => m.n)
  pin.active = { at, n: Math.max(0, ...used) + 1, color: state.colour, text: '', timer: null, startedMic: kept || !wasOn }
  pinBox.value = ''
  restPin()
  showGlow()
  paint()
}
/** The words of a pin in lines that fit a width. */
function linesOf(ctx, text, room) {
  const lines = []
  for (let word of text.split(/\s+/).filter(Boolean)) {
    // A word longer than the room is broken, so nothing runs off the picture.
    while (ctx.measureText(word).width > room && word.length > 1) {
      let fits = word.length - 1
      while (fits > 1 && ctx.measureText(word.slice(0, fits)).width > room) fits--
      lines.push(word.slice(0, fits))
      word = word.slice(fits)
    }
    const next = lines.length ? `${lines[lines.length - 1]} ${word}` : word
    if (lines.length && ctx.measureText(next).width <= room) lines[lines.length - 1] = next
    else lines.push(word)
  }
  return lines
}
/**
 * Pins on the picture: a round mark with a microphone and its number, and what was said in a box beside it, to the right
 * where there is room and to the left where there is not. The pin that listens shows a line saying how to stop.
 */
function paintPins(ctx, pins, wide, listening = null) {
  const picture = { w: ctx.canvas.width, h: ctx.canvas.height }
  for (const m of pins) {
    const size = m.size ?? textFor(wide)
    const r = size * 0.8
    const line = Math.max(2, Math.round(size / 9))
    const [x, y] = m.a ?? m.at
    const live = m === listening
    // The box of words.
    ctx.font = `600 ${size}px -apple-system, system-ui, sans-serif`
    const pad = size * 0.5
    const gap = r * 1.5
    const most = Math.min(size * 19, picture.w * 0.5)
    const right = picture.w - (x + gap) - size * 0.5
    const onRight = right >= Math.min(most, size * 9)
    // Never wider than the picture, however little room the side it is on has.
    const room = Math.min(picture.w - line * 2 - pad * 2, Math.max(size * 6, Math.min(most, onRight ? right : x - gap - size * 0.5) - pad * 2))
    const lines = linesOf(ctx, m.text, room)
    ctx.font = `500 ${size * 0.72}px -apple-system, system-ui, sans-serif`
    const hints = live ? linesOf(ctx, onPhone() ? 'Listening · a tap or a pause stops' : 'Listening · click, Esc or a pause stops', room) : []
    const hintWide = Math.max(0, ...hints.map(l => ctx.measureText(l).width))
    ctx.font = `600 ${size}px -apple-system, system-ui, sans-serif`
    const wideBox = Math.min(picture.w - line * 2, Math.max(...lines.map(l => ctx.measureText(l).width), hintWide, size * 2) + pad * 2)
    const tall = Math.max(1, lines.length) * size * 1.3 + hints.length * size * 1.05 + pad * 1.4
    if (lines.length || live) {
      const left = Math.max(line, Math.min(picture.w - wideBox - line, onRight ? x + gap : x - gap - wideBox))
      const top = Math.max(line, Math.min(picture.h - tall - line, y - r))
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(left, top, wideBox, tall)
      ctx.strokeStyle = m.color
      ctx.lineWidth = line
      ctx.strokeRect(left, top, wideBox, tall)
      ctx.textBaseline = 'top'
      ctx.fillStyle = '#1c1c1e'
      lines.forEach((text, n) => ctx.fillText(text, left + pad, top + pad * 0.7 + n * size * 1.3))
      ctx.font = `500 ${size * 0.72}px -apple-system, system-ui, sans-serif`
      ctx.fillStyle = '#6b6b70'
      hints.forEach((text, n) => ctx.fillText(text, left + pad, top + pad * 0.7 + Math.max(1, lines.length) * size * 1.3 + n * size * 1.05))
    }
    // The pin: a disc in the mark's colour with a white microphone.
    ctx.fillStyle = m.color
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#ffffff'
    ctx.fillStyle = '#ffffff'
    ctx.lineWidth = Math.max(1.5, r * 0.13)
    ctx.lineCap = 'round'
    ctx.beginPath()
    // An older browser has no rounded rectangle: a plain one says microphone well enough.
    if (ctx.roundRect) ctx.roundRect(x - r * 0.17, y - r * 0.48, r * 0.34, r * 0.6, r * 0.17)
    else ctx.rect(x - r * 0.17, y - r * 0.48, r * 0.34, r * 0.6)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(x, y + r * 0.02, r * 0.32, 0.15 * Math.PI, 0.85 * Math.PI)
    ctx.moveTo(x, y + r * 0.34)
    ctx.lineTo(x, y + r * 0.52)
    ctx.stroke()
    // Its number, on a small white disc at its shoulder.
    const br = r * 0.44
    const bx = x + r * 0.78
    const by = y - r * 0.78
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(bx, by, br, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = m.color
    ctx.lineWidth = Math.max(1, line * 0.7)
    ctx.stroke()
    ctx.fillStyle = m.color
    ctx.font = `700 ${br * 1.25}px -apple-system, system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(m.n), bx, by + br * 0.06)
    ctx.textAlign = 'start'
  }
  ctx.textBaseline = 'alphabetic'
}
/** What goes to the agent for a pin: where it is and what was said there. */
function pinShape(m, wide) {
  const colour = COLOURS.find(c => c.value === m.color)
  const r = Math.round((m.size ?? textFor(wide)) * 0.8)
  return { type: 'pin', colour: colour ? colour.id : m.color, box: { x: Math.round(m.a[0] - r), y: Math.round(m.a[1] - r), w: r * 2, h: r * 2 }, at: { x: Math.round(m.a[0]), y: Math.round(m.a[1]) }, text: m.text, n: m.n }
}
function renderMic() {
  const button = $('micBtn')
  const route = mic.route
  button.hidden = !route
  const on = !!mic.listener?.on
  // The large button on a phone. Its words change in place, so a finger held on it stays on the same button.
  $('talkBtn').classList.toggle('listening', on)
  $('talkBtn').textContent = on ? 'Listening…' : 'Hold to talk'
  // No way to listen here: the phone keeps two large buttons, and the notes box stays out to type in.
  $('talkBtn').hidden = !route || route.route === 'none'
  document.body.classList.toggle('no-talk', $('talkBtn').hidden)
  if (!route) return
  button.classList.toggle('listening', on)
  button.classList.toggle('with-words', route.route === 'cloud' || on)
  button.setAttribute('aria-pressed', String(on))
  const cloud = route.route === 'cloud'
  const words = on ? 'Listening' : cloud ? `${route.goesTo} cloud` : ''
  button.innerHTML = `${ICONS.mic}${words ? `<span>${words}</span>` : ''}`
  button.dataset.tip = on ? 'Stop listening' : route.route === 'none' ? route.why : cloud ? `Speak your notes: the sound goes to ${route.goesTo}` : route.route === 'install' ? 'Speak your notes: fetches a language pack once' : 'Speak your notes: stays on this computer'
}
/** The foot mic: on and off. With no pin listening, what is said goes to the notes box. */
async function pressMic() {
  if (mic.listener?.on) {
    endPin({ keepMic: true })
    return mic.listener.stop()
  }
  return startMic()
}
/** Turns listening on, asking what it must ask first. True when it is on. */
async function startMic() {
  const route = mic.route
  if (!route) {
    toast('The microphone is not ready yet', 'Try again in a moment')
    return false
  }
  if (route.route === 'none') {
    toast(route.why)
    return false
  }
  if (mic.listener?.on) return true
  if (route.route === 'install') {
    if (!(await ask('Fetch a language pack?', 'About 60 MB, once, from Google. After that, speech stays on this computer.', 'Fetch it', 'Not now'))) return false
    toast('Fetching the language pack…')
    try {
      await installPack(route.lang)
    } catch (error) {
      toast('The language pack did not come', error.message, { problem: true })
      return false
    }
    mic.route = { ...route, route: 'device' }
    renderMic()
  }
  if (mic.route.route === 'cloud' && prefs.get('mic-cloud') !== 'on') {
    if (!(await ask(`Send your voice to ${route.goesTo}?`, `This browser sends the sound to ${route.goesTo} to turn it into words. Nothing else on this page goes with it.`, 'Turn it on', 'Keep it off'))) return false
    prefs.set('mic-cloud', 'on')
  }
  mic.listener ??= createListener({
    // The pin that listens takes the words. With none, they are notes.
    box: () => (pin.active ? pinBox : $('notes')),
    local: mic.route.route === 'device',
    lang: route.lang,
    onCommand: command => {
      endPin()
      if (command === 'good') void looksGood(true)
      else if (command === 'next') go(state.index + 1)
      else if (command === 'back') go(state.index - 1)
      else if (command === 'send') sendCurrent()
    },
    onState: on => {
      // Listening stopped from anywhere: the pin that was listening ends with it.
      if (!on) endPin({ keepMic: true })
      renderMic()
    },
    onProblem: words => toast(words, '', { problem: true }),
  })
  mic.listener.start()
  return true
}
void findRoute().then(route => {
  // A browser lets a page use the microphone only at a secure address: localhost, or the HTTPS name Tailscale serves.
  mic.route = window.isSecureContext ? route : null
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
  const live = $('aboutLive')
  const href = s?.liveUrl
  live.hidden = !/^https?:\/\//i.test(href ?? '')
  if (live.hidden) live.removeAttribute('href')
  else live.href = href
  const showNote = !!s && !!longest && !state.sideChecks
  $('aboutNote').hidden = !showNote
  $('about').hidden = !showNote && live.hidden
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
/** When the readings on each history were last asked for. Asked for again, the old one stays in view until the new one comes. */
const readingsAt = new Map()
async function loadHistory(s, again = false) {
  const key = historyKey(s)
  if (histories.has(key) && !again) return
  if (!again) histories.set(key, null)
  readingsAt.set(key, s.inferred?.changed ?? '')
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
  // Every earlier mark ticked fixed, and nothing else on it: Looks good is the answer, so it is lit.
  // Not where changes were sent on this picture: there Looks good would drop them.
  const lit = s && !v && s.status !== 'sent' && allChecked(s)
  const off = !s ? ' disabled' : ''
  // A choice made goes by Send too: choosing is the answer.
  const sends = v === 'changes' || (!!s?.choice && v === 'approved')
  setHtml($('footActions'), `<button class="btn${good ? ' good-on' : lit ? ' good-lit' : ''}" data-act="good"${off} ${tip(good ? 'Looking good; press to take it back' : 'Looks good, and on to the next', 'G')}>${good ? ICONS.check : ''}Looks good</button><button class="btn primary" data-act="send"${sends ? '' : ' disabled'} ${tip(s?.choice ? 'Send your choice, marks and notes, and on to the next' : 'Send your marks and notes, and on to the next', '⌘↩')}>Send</button>`)
}

/* ---------- a change of review: unmissable, and it waits for a press ---------- */

const segmentUp = () => !$('segment').hidden
function renderSegment(a) {
  // Opening the wizard: where this starts, with one press to be in.
  if (state.arriving && a && !onDonePage()) {
    const place = placeOf(a)
    $('segment').hidden = false
    $('segment').className = 'segment new-group'
    return setHtml($('segment'), `<div class="segment-in">
      <p class="starting">You are starting with:</p>
      <h1>${esc(placeWords(place))}</h1>
      <p class="what">${esc(`${place.group ? `${place.title}: ` : ''}${countWords(openOf(a).length, waitingInAll())}`)}</p>
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
    <p class="what">${esc(`${there.group ? `${there.title}: ` : ''}${countWords(openOf(target).length, waitingInAll())}`)}</p>
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
  const left = a ? openOf(a).filter(s => !goesOf(s)).length : 0
  const group = a ? placeOf(a).group : null
  setHtml($('menu'), `
    <button data-menu="sheet" role="menuitem"${a ? '' : ' disabled'}><span>All screens of this review</span><span class="kbd">O</span></button>
    <button data-menu="film" role="menuitem"${screen() && !onDonePage() ? '' : ' disabled'}><span>The film of this screen</span><span class="kbd">R</span></button>
    <button data-menu="list" role="menuitem"><span>Apps and screens</span><span class="kbd">L</span></button>
    ${state.remote ? '' : `<button data-menu="new" role="menuitem"><span>New project</span></button>
    <button data-menu="work" role="menuitem" aria-description="Beta features"><span>Ideas and queue <span class="beta-badge" aria-hidden="true">Beta</span></span><span class="kbd">W</span></button>`}
    <button data-menu="rest" role="menuitem"${left ? '' : ' disabled'}><span>Looks good for the rest${left ? ` (${left})` : ''}</span><span class="kbd">⇧⌘↩</span></button>
    <button data-menu="aside-one" role="menuitem"${a ? '' : ' disabled'}><span>Set ${group ? `this ${placeOf(a).noun.trim() || 'one'}` : 'this'} aside</span></button>
    ${group ? '<button data-menu="aside-group" role="menuitem"><span>Set this group aside</span></button>' : ''}
    <button data-menu="stop" role="menuitem"><span>Stop here</span><span class="kbd">S</span></button>
    <hr>
    <button data-menu="panels" role="menuitem"><span>${panels() ? 'Picture only' : 'Panel view'}</span><span class="kbd">Q</span></button>
    ${panels() ? `<button data-menu="strip" role="menuitem"><span>${document.body.classList.contains('no-strip') ? 'Show' : 'Hide'} the screens</span></button><button data-menu="details" role="menuitem"><span>${document.body.classList.contains('no-details') ? 'Show' : 'Hide'} the details</span></button>` : ''}
    <button data-menu="full" role="menuitem"><span>Full screen</span><span class="kbd">F</span></button>
    <button data-menu="notices" role="menuitem"><span>${noticesLabel()}</span></button>
    ${state.remote ? '' : desktopWake() ? `<button data-menu="wake" role="menuitem"><span>Wake Codex Desktop for this review: ${desktopWake().on ? 'on' : 'off'}</span></button>` : projectWake() ? `<button data-menu="wake" role="menuitem"><span>Wake my agent when work waits: ${projectWake().on ? 'on' : 'off'}</span></button><div class="menu-note">It runs <code>${esc(projectWake().run)}</code> in ${esc(projectWake().in)}</div>` : ''}
    ${state.remote ? '' : `<button data-menu="phone" role="menuitem"><span>Review from your phone${phone.status.on ? ': on' : ''}</span></button>
    <hr>
    <button data-menu="keys" role="menuitem"><span>Keyboard shortcuts</span><span class="kbd">?</span></button>`}`)
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
  else if (state.starting || !state.apps.length) html = firstRunHtml()
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
  syncBuildForms()
  $('pair').hidden = !!html || !s
  if ($('pair').hidden) keepAlone()
}
/**
 * No picture on show (the review cleared, and nothing else left): an open box with words would go out of sight with it. It is
 * kept, says why, and stands on the empty page with the keyboard still in it.
 */
function keepAlone() {
  for (const card of [...$('readings').children]) {
    const input = card.querySelector('[data-correct]')
    if (!input || !(card.classList.contains('kept') || card.dataset.reading === correcting)) continue
    if (!card.classList.contains('kept') && !input.value.trim()) continue
    const had = card.contains(document.activeElement)
    if (!card.classList.contains('kept')) keepWords(card, screen())
    if (card.dataset.reading === correcting) correcting = ''
    $('keptAlone').append(card)
    for (const p of ['left', 'top', 'marginTop', 'marginLeft', 'maxWidth']) card.style[p] = ''
    if (had) input.focus()
  }
}
/* The words of the open box, kept in this browser as they are typed: a reload, or a tab closed by mistake, does not lose them. */
let restoring = null
const savedBoxWords = () => {
  try {
    return JSON.parse(prefs.get('box') || 'null')
  } catch {
    return null
  }
}
function keepBoxWords(input) {
  const card = input.closest('.reading')
  const s = card?._screen
  if (!s) return
  prefs.set('box', input.value.trim() ? JSON.stringify({ appSlug: s.appSlug, id: s.id, after: s.after, round: s.round, screen: s.screen ?? '', mode: s.mode ?? '', key: card.dataset.reading ?? card.dataset.kept, words: input.value }) : '')
}
/** A kept box made again, for words whose line is not on show: after an Undo, or a reload. */
function keptFrom({ key, words, screen: was, why = '', sent = '', left = '', top = '' }) {
  const el = document.createElement('div')
  el.className = 'reading'
  el.dataset.reading = key
  el.innerHTML = '<input data-correct maxlength="300" aria-label="Your words">'
  Object.assign(el, { _screen: was })
  Object.assign(el.style, { left, top })
  $('readings').append(el)
  el.querySelector('[data-correct]').value = words
  keepWords(el, screen() ?? was)
  if (why) el.querySelector('.rt b').textContent = why
  if (sent) el._sent = sent
  // With no picture to stand beside, it stands on its own where it can be seen.
  if ($('pair').hidden || !left) keepAlone()
  shutOthers()
  placeReadings()
  return el
}
/**
 * Words saved before a reload whose box cannot open again where it was: the picture was pushed again since, or the review is
 * gone. They come back as a kept box that says so, never kept out of sight. Looked at once, on the first look.
 */
function showSavedElsewhere() {
  const held = savedBoxWords()
  if (!held?.words?.trim() || boxCards().length) return
  const a = state.apps.find(x => x.slug === held.appSlug)
  const now = a?.screens.find(x => x.id === held.id)
  if (now && now.after === held.after && now.status !== 'approved') return
  const was = { appSlug: held.appSlug, id: held.id, after: held.after, round: held.round ?? '', screen: held.screen || held.id, mode: held.mode ?? '' }
  const el = keptFrom({ key: held.key, words: held.words, screen: was, why: !now ? 'This review is not here now.' : now.after !== held.after ? 'A new picture came.' : 'This screen was answered Looks good since.', sent: `Sent, about the earlier picture${held.round ? ` (round ${held.round})` : ''}.` })
  el.querySelector('[data-correct]').focus()
}
const forgetBoxWords = () => prefs.set('box', '')
// Leaving with words in a box that have not gone: the browser asks first.
addEventListener('beforeunload', event => {
  if (!boxCards().some(c => c.querySelector('[data-correct]')?.value.trim())) return
  event.preventDefault()
  event.returnValue = ''
})

function render() {
  const a = state.starting ? null : app()
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
  const s = state.starting || onDonePage() ? null : screen()
  if (state.starting) $('segment').hidden = true
  else renderSegment(a)
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
  renderSheet()
  document.body.classList.toggle('no-screen', !s)
  // Nothing to draw on until a picture is up: the overlay hides the tools and the views with it.
  document.body.classList.toggle('covered', covered)
  // One count, and only where a picture is: the overlay says it in full.
  $('overall').textContent = s && a ? (onPhone() ? `${state.index + 1} of ${a.screens.length}` : countWords(openOf(a).length, waitingInAll(), { short: true })) : ''
  // The tab says how many wait, for someone working in another one.
  document.title = titleNow()
  $('overall').title = s && a ? `Screen ${state.index + 1} of ${a.screens.length}. ${countWords(openOf(a).length, waitingInAll())}.` : ''
  $('stopHere').hidden = !s
  document.body.classList.toggle('no-apps', state.loaded && !state.apps.length)
  $('notes').disabled = !s
  if (!s) renderLineup(null)
  if (!a) {
    renderAsked(null)
    renderKind(null)
    setHtml($('crumbs'), '')
    $('back').disabled = $('next').disabled = true
    setHtml($('views'), '')
    return
  }
  renderKind(s)
  const total = a.screens.length
  const here = placeOf(a)
  // A group called Proposal or Built only says again what the label says: the name alone is enough.
  const kindGroup = /^(proposal|built|qa)$/i.test(here.group ?? '')
  // On a phone there is room for the name only. The count beside it says which screen.
  setHtml($('crumbs'), onPhone()
    ? `<span class="crumb-app" title="${esc(a.name)}">${esc(here.group ? here.title : barName(a.name))}</span>`
    : here.group
    ? `${kindGroup ? '' : `<span class="crumb-app" title="${esc(a.name)}">${esc(placeWords(here))}</span><span class="sep-slash">/</span>`}<span class="crumb-app" title="${esc(a.name)}">${esc(here.title)}</span>${s ? `<span class="sep-slash">/</span>${screenCrumb(s)}` : ''}`
    : `<span class="crumb-app" title="${esc(a.name)}">${esc(barName(a.name))}</span>${s ? `<span class="sep-slash">/</span>${screenCrumb(s)}` : ''}`)
  $('back').disabled = !s || state.index === 0
  $('next').disabled = !s || state.index >= total - 1
  if (!s) {
    setHtml($('views'), '')
    renderAsked(null)
    return
  }
  // Not while the opening page is up: a reload there is still an opening.
  if (!state.arriving) history.replaceState(null, '', `#${a.slug}/${s.id}`)
  // The words tool where it can work, unlit with why while it cannot yet. Hidden where it never can: then a box stands in.
  const wordsTip = wordsNow() ? '' : wordsWhy(s)
  const shownTool = toolNow()
  setHtml($('toolButtons'), TOOLS.filter(t => t.id !== 'words' || wordsTip !== null).map(t => `<button class="tool${shownTool === t.id ? ' on' : ''}${t.id === 'words' && wordsTip ? ' unlit' : ''}" data-tool="${t.id}" ${tip(t.id === 'words' && wordsTip ? wordsTip : t.tip, t.key)}>${ICONS[t.id]}</button>`).join(''))
  setHtml($('colours'), COLOURS.map((c, i) => `<button class="tool swatch${state.colour === c.value ? ' on' : ''}" data-colour="${c.value}" style="--c:${c.value}" ${tip(c.label, String(i + 1))}><i></i></button>`).join(''))
  const views = s.before ? VIEWS : VIEWS.filter(v => v.id === 'after')
  if (!s.before) state.view = 'after'
  setHtml($('views'), views.length > 1 ? views.map(v => `<button class="btn${state.view === v.id ? ' on' : ''}" data-view="${v.id}" ${tip(`Show ${v.label.toLowerCase()}`, 'V')}>${v.label}</button>`).join('') : '')
  $('pair').className = `pair view-${state.view}`
  $('scroller').className = `scroller tool-${toolNow()}`
  $('afterCaption').textContent = state.view === 'side' ? 'After (draw here)' : 'After'
  renderLineup(s)

  if (state.shownKey !== keyOf(s) + s.after) showPicture(s)
  const notes = draftOf(s).notes
  if ($('notes').value !== notes && document.activeElement !== $('notes')) {
    $('notes').value = notes
    growNotes()
  }
  showSentMarks(s)
  renderAsked(s)
  renderReadings(s)
  updateButtons()
  paint()
  preloadAround(a)
}

/* ---------- a choice: the options side by side, a button over each, the question as the heading ---------- */

/** Said at a spot on a lineup, these choose the option there. */
const THIS_ONE = /^(?:i (?:choose|pick|want) )?(?:this|that)(?: one)?[.!]*$/i
const keysWords = s => {
  const keys = s.choice.options.map(o => o.key)
  return `${keys.slice(0, -1).join(', ')} or ${keys.at(-1)}`
}
/** The option at a place across the lineup. In a gap, the nearest. */
function optionNear(s, x) {
  const options = s?.choice?.options ?? []
  if (!options.length || !Number.isFinite(x)) return null
  return options.find(o => x >= o.box.x && x <= o.box.x + o.box.w) ?? options.reduce((near, o) => (Math.abs(o.box.x + o.box.w / 2 - x) < Math.abs(near.box.x + near.box.w / 2 - x) ? o : near))
}
/** One choice at a time. Choosing the same again keeps it; null takes it back. Marks and notes stay with the screen. */
function choose(key) {
  const s = screen()
  if (!s?.choice || onDonePage()) return
  const d = draftOf(s)
  const next = s.choice.options.some(o => o.key === key) ? key : null
  if (d.choice === next) return
  touched(s)
  d.choice = next
  // A Looks good given before is about no choice, or another one.
  d.good = false
  saveDraft(s)
  render()
  refreshLists()
}
const lineupRoom = () => {
  const s = screen()
  return s?.choice && state.view === 'after' ? $('lineupHead').offsetHeight + $('lineupRow').offsetHeight + 12 : 0
}
function renderLineup(s) {
  const on = !!s?.choice
  document.body.classList.toggle('lineup', on)
  $('lineupHead').hidden = $('lineupRow').hidden = !on
  if (!on) return
  const chosen = draftOf(s).choice
  const named = s.choice.options.find(o => o.key === chosen)
  // The heading names the decision. The line under it says how to choose, or what was chosen and what can follow.
  setHtml($('lineupHead'), `<div class="lineup-words"><h1 id="lineupQuestion">${esc(s.choice.question)}</h1><p class="lineup-status" role="status">${named ? `You chose ${esc(named.key)}${named.label ? `, ${esc(named.label)}` : ''}. Send it, or mark it up first.` : `Click a choice or press ${esc(keysWords(s))}.`}</p></div>${named ? `<button class="btn" data-unchoose ${tip('Take the choice back')}>Change choice</button>` : ''}`)
  setHtml($('lineupRow'), s.choice.options.map(o => {
    const is = o.key === chosen
    const name = `${is ? 'Chosen' : 'Choose'} ${o.key}${o.label ? `: ${o.label}` : ''}`
    return `<button class="choose${is ? ' on' : ''}" data-choose="${esc(o.key)}" aria-pressed="${is}" aria-label="${esc(name)}" title="${esc(name)}">${is ? ICONS.check : ''}<span class="choose-key"><span class="choose-word">${is ? 'Chosen' : 'Choose'} </span>${esc(o.key)}</span><kbd aria-hidden="true">${esc(o.key)}</kbd>${o.label ? `<span class="choose-label">${esc(o.label)}</span>` : ''}</button>`
  }).join(''))
  placeLineup()
}
/** Each button centred over its option, at whatever zoom: placed as a share of the picture's width. */
function placeLineup() {
  const s = screen()
  if (!s?.choice || !state.size) return
  const wide = Math.round(state.size.w * state.zoom)
  $('lineupRow').style.width = $('lineupHead').style.width = `${wide}px`
  for (const b of $('lineupRow').querySelectorAll('[data-choose]')) {
    const o = s.choice.options.find(x => x.key === b.dataset.choose)
    if (!o) continue
    b.style.left = `${((o.box.x + o.box.w / 2) / state.size.w) * 100}%`
    // As wide as its words, never past its option: with no room for them, only the letter, the rest in its tooltip.
    const room = Math.max(28, Math.round(o.box.w * state.zoom) - 6)
    b.style.minWidth = `${Math.min(168, room)}px`
    b.classList.remove('tight', 'tighter')
    if (b.offsetWidth > room) b.classList.add('tight')
    if (b.offsetWidth > room) b.classList.add('tighter')
    const words = b.querySelector('.choose-label')
    if (words) {
      words.style.maxWidth = `${room}px`
      // Measured shown: a hidden one has no width.
      words.hidden = false
      words.hidden = words.scrollWidth > room
    }
  }
}
/** The chosen option, outlined on screen only: the marked picture sent back shows the marks, and the answer says which. */
function paintChosen(ctx, s) {
  const o = s.choice?.options.find(x => x.key === draftOf(s).choice)
  if (!o) return
  const w = Math.max(4, Math.round(3 / state.zoom))
  ctx.save()
  ctx.strokeStyle = COLOURS.find(c => c.id === 'blue').value
  ctx.lineWidth = w
  ctx.strokeRect(o.box.x + w / 2, o.box.y + w / 2, o.box.w - w, o.box.h - w)
  ctx.restore()
}
$('lineupRow').onclick = event => {
  const b = event.target.closest('[data-choose]')
  if (b) choose(b.dataset.choose)
}
$('lineupHead').onclick = event => {
  if (!event.target.closest('[data-unchoose]')) return
  choose(null)
  $('lineupRow').querySelector('[data-choose]')?.focus()
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
  const ahead = a.screens.filter((x, i) => i > state.index && x.status === 'waiting' && !goesOf(x)).slice(0, AHEAD)
  for (const each of [...ahead, a.screens[state.index + 1], a.screens[state.index - 1]]) {
    if (each) void pictureAt(`/images/${each.after}`).catch(() => undefined)
  }
  // Held marks on every screen of the review are compared now, so one swept unseen still says it came back.
  for (const each of a.screens) if (each.status === 'waiting' && askedOf(each).held.length) compareHeld(each)
}

function showPicture(s) {
  // Asking for the whole of a tall picture is about that picture, not the next one.
  if (state.shownKey !== keyOf(s) + s.after) state.whole = false
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
    // Whether an earlier mark's place can be trusted depends on this picture's size, known only now.
    renderAsked(s)
    $('canvas').width = state.size.w
    $('canvas').height = state.size.h
    if (state.fitted) fit()
    else applyZoom()
    // A tall picture scrolls: a new one starts at its top, not where the last was left.
    $('scroller').scrollTop = 0
    paint()
    renderReadings(s)
  }
  loadWords(s.words)
  readWordsOf(s)
  const url = `/images/${s.after}`
  const held = pictures.get(url)
  $('beforeImg').src = s.before ? `/images/${s.before}` : ''
  showChanges(s)
  compareHeld(s)
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

/* ---------- the words in a picture: a list saved with it, so the words themselves can be marked ---------- */

const wordLists = new Map()
/**
 * Lists read off bare pictures by the server, as each picture's name has them: { state: 'reading' | 'done' | 'none' | 'failed'
 * | 'not-readable', words }. Each picture is asked about once, when it is first on show, and never all at once.
 */
const readLists = new Map()
/** The name of the list for a screen: given with the push, or read off its picture. '' while there is none. */
const listOf = s => s?.words || readLists.get(s?.after)?.words || ''
/** The list for the picture on show, in the picture's own pixels, or null: none came with it, or it has not arrived yet. */
const wordsNow = () => {
  const s = screen()
  const held = listOf(s) && wordLists.get(listOf(s))
  if (!held?.words || !state.size) return null
  // A list made at another scale, a sharper screenshot say, is fitted to the picture. Worked out once for each size.
  const k = held.wide ? state.size.w / held.wide : 1
  if (held.fitted?.k !== k) held.fitted = { k, words: k === 1 ? held.words : held.words.map(w => ({ ...w, x: w.x * k, y: w.y * k, w: w.w * k, h: w.h * k })) }
  return held.fitted.words
}
/**
 * Why the words tool cannot mark words on this screen yet, as its tip, or null when it never can: the picture has no list and
 * this computer has nothing to read one with. Then the tool is not shown at all.
 */
function wordsWhy(s) {
  if (!s || (!listOf(s) && !state.reader)) return null
  const held = wordLists.get(listOf(s))
  if (held?.empty) return 'No words were found in this picture: this draws a box'
  if (held?.gone) return 'This picture has no word list: this draws a box'
  if (listOf(s)) return 'Loading the words in this picture. Until then this draws a box'
  const read = readLists.get(s.after)
  if (!read || read.state === 'reading') return 'Reading the words in this picture. Until then this draws a box'
  return 'This picture has no word list: this draws a box'
}
/** The tool in use here: the words tool, where it is not shown, draws boxes, and comes back on a screen where it is. */
const toolNow = () => (state.tool === 'words' && wordsWhy(screen()) === null && !wordsNow() ? 'box' : state.tool)
function loadWords(name) {
  if (!name || wordLists.has(name)) return
  wordLists.set(name, null)
  fetch(`/images/${name}`).then(res => (res.ok ? res.json() : null)).then(list => {
    const words = Array.isArray(list?.words) ? list.words.filter(w => typeof w?.t === 'string' && [w.x, w.y, w.w, w.h].every(Number.isFinite)) : []
    wordLists.set(name, words.length ? { words, wide: Number(list.size?.w) || 0 } : list ? { empty: true } : { gone: true })
    if (listOf(screen()) === name) render()
  }).catch(() => {
    // No list after all: the tool draws a box, as it does for any picture without one.
    wordLists.set(name, { gone: true })
    if (listOf(screen()) === name) render()
  })
}
/**
 * A picture pushed with no list: the server reads its words, here on this computer. It answers at once, so asking never holds a
 * connection the pictures and answers need. While it is reading, the page asks again a moment later, for as long as that
 * picture is on show. A picture moved past is not asked about again, and the server lets it go.
 */
let readTimer = null
function readWordsOf(s) {
  clearTimeout(readTimer)
  const known = readLists.get(s.after)
  if (s.words || !state.reader || (known && known.state !== 'reading')) return
  if (!known) readLists.set(s.after, { state: 'reading' })
  const again = () => {
    readTimer = setTimeout(() => {
      if (screen()?.after === s.after) readWordsOf(screen())
    }, 900)
  }
  fetch('/api/read-words', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ after: s.after }) })
    .then(res => res.json())
    .then(out => {
      if (out.reading) return again()
      readLists.set(s.after, out.words ? { state: 'done', words: out.words } : { state: out.why || 'failed' })
      loadWords(out.words)
      if (screen()?.after === s.after) render()
    })
    // The server away for now: asked again while the picture is on show.
    .catch(again)
}
/** The word a point is on, or the nearest one. Words are in reading order, so two of them name everything between. */
function wordAt(words, [x, y], { near = false } = {}) {
  let best = -1
  let least = Infinity
  for (const [i, w] of words.entries()) {
    const dx = Math.max(w.x - x, 0, x - (w.x + w.w))
    const dy = Math.max(w.y - y, 0, y - (w.y + w.h))
    // A step down the page counts for more than one along a line, so a point between lines picks the line it is nearer.
    const far = dx + dy * 3
    // A press starts on a word or close beside one. A press on a bare part of the picture is not a mark.
    if (near && (dx > w.h * 1.2 || dy > w.h * 0.8)) continue
    if (far < least) {
      least = far
      best = i
    }
  }
  return best
}
/** Two boxes on one line: they share more than half the height of the shorter. */
const onLine = (a, b) => Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > Math.min(a.h, b.h) / 2
/** Words in lines, top to bottom, each line left to right: a word is on the line its middle is in. */
function inLines(list) {
  const lines = []
  for (const w of [...list].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2))) {
    const line = lines[lines.length - 1]
    if (line && w.y + w.h / 2 <= line.bottom) {
      line.words.push(w)
      line.bottom = Math.max(line.bottom, w.y + w.h * 0.75)
    } else lines.push({ words: [w], bottom: w.y + w.h })
  }
  return lines.map(line => line.words.sort((a, b) => a.x - b.x))
}
/**
 * The words a drag from one word to another means, in the order they read. A list read off a picture can have its order wrong
 * on a dense table or an odd layout, so where the picture itself says what is meant, the picture decides: along one line, the
 * words on that line between the two ends; down one column or card, line by line inside it. Only a drag from one column to
 * another goes by the list's order.
 */
function wordsBetween(words, from, to) {
  const a = words[from]
  const b = words[to]
  const middleIn = (w, left, right) => w.x + w.w / 2 >= left && w.x + w.w / 2 <= right
  if (onLine(a, b)) {
    const left = Math.min(a.x, b.x)
    const right = Math.max(a.x + a.w, b.x + b.w)
    return words.filter(w => onLine(w, a) && middleIn(w, left, right)).sort((p, q) => p.x - q.x)
  }
  const [first, last] = a.y < b.y ? [a, b] : [b, a]
  // The words in the rows the drag runs over, cut into blocks where nothing is written down the whole of them.
  const rows = words.filter(w => w.y + w.h / 2 >= first.y && w.y + w.h / 2 <= last.y + last.h)
  const tall = [...rows.map(w => w.h)].sort((p, q) => p - q)[rows.length >> 1]
  const blocks = []
  for (const w of [...rows].sort((p, q) => p.x - q.x)) {
    const block = blocks[blocks.length - 1]
    if (block && w.x - block.right < tall * 1.5) {
      block.words.push(w)
      block.right = Math.max(block.right, w.x + w.w)
    } else blocks.push({ words: [w], right: w.x + w.w })
  }
  const block = blocks.find(one => one.words.includes(first))
  if (!block || !block.words.includes(last)) return words.slice(Math.min(from, to), Math.max(from, to) + 1)
  const lines = inLines(block.words)
  const top = lines.findIndex(line => line.includes(first))
  const foot = lines.findIndex(line => line.includes(last))
  return lines.slice(top, foot + 1).flatMap((line, n) => line.filter(w => (n > 0 || w.x + w.w / 2 >= first.x) && (top + n < foot || w.x + w.w / 2 <= last.x + last.w)))
}
/** The words from one to another as a mark: what they say, a box round each line of them, and the box round them all. */
function wordsMark(words, from, to, color) {
  const picked = wordsBetween(words, from, to)
  const rects = []
  for (const w of picked) {
    const last = rects[rects.length - 1]
    const sameLine = last && w.y < last[1] + last[3] * 0.6 && w.y + w.h > last[1] + last[3] * 0.4 && w.x >= last[0]
    if (sameLine) {
      const top = Math.min(last[1], w.y)
      last[3] = Math.max(last[1] + last[3], w.y + w.h) - top
      last[1] = top
      last[2] = w.x + w.w - last[0]
    } else rects.push([w.x, w.y, w.w, w.h])
  }
  const x = Math.min(...rects.map(r => r[0]))
  const y = Math.min(...rects.map(r => r[1]))
  return { tool: 'words', a: [x, y], b: [Math.max(...rects.map(r => r[0] + r[2])), Math.max(...rects.map(r => r[1] + r[3]))], color, text: picked.map(w => w.t).join(' '), rects, from, to }
}
/** Selected words on the picture: tinted, with a line under them. The shared drawing code knows nothing of them. */
function paintWords(ctx, marks) {
  for (const m of marks) {
    ctx.fillStyle = m.color
    for (const [x, y, w, h] of m.rects) {
      ctx.globalAlpha = 0.22
      ctx.fillRect(x, y, w, h)
      ctx.globalAlpha = 1
      ctx.fillRect(x, y + h, w, Math.max(2, Math.round(h / 12)))
    }
  }
  ctx.globalAlpha = 1
}
const isWords = m => m.tool === 'words'
/** What goes to the agent for selected words: what they say and where they are. */
function wordsShape(m) {
  const colour = COLOURS.find(c => c.value === m.color)
  return { type: 'words', colour: colour ? colour.id : m.color, box: { x: Math.round(m.a[0]), y: Math.round(m.a[1]), w: Math.round(m.b[0] - m.a[0]), h: Math.round(m.b[1] - m.a[1]) }, text: m.text }
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
    // A mark fixed before, where the picture changed again, may have come back: the list can grow by it.
    const s = screen()
    if (s && askedOf(s).held.length) compareHeld(s)
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

/* ---------- marks become checks: what was asked for last time, at its place, to tick fixed or say it still stands ---------- */

const ASKED_WIDE = 300
/** Narrower than this beside the list, the picture keeps the width and the list goes under it. */
const ASKED_MIN_PICTURE = 560
/** What was sent from here this round, until the server's list of answers has it too. */
const saidSent = new Map()
/**
 * Words said of the earlier marks in answers already sent this round, as the server keeps them: they stand until changed. A
 * Looks good pressed on the screen ticks them all, but only while nothing new is on it: changes after it take that back.
 */
function standingSaid(s) {
  const records = (histories.get(historyKey(s)) ?? []).filter(r => r.round === s.round && !r.olderPicture)
  const words = records.find(r => !(r.verdict === 'approved' && !r.noComment))?.said ?? {}
  return { ...words, ...(saidSent.get(keyOf(s)) ?? {}) }
}
/** What was said of each earlier mark: here first, then in the answers already sent this round. */
function saidOf(s) {
  const d = draftOf(s)
  const standing = standingAnswer(histories.get(historyKey(s)), s.round)
  // Passed with Looks good, here or already sent, and nothing new on it: every one is fixed.
  const passed = (d.good || (standing?.verdict === 'approved' && !standing.noComment)) && !marksOrNotes(d) && !Object.keys(d.said).length
  const all = passed ? Object.fromEntries(askedOf(s).open.map(a => [a.n, 'fixed'])) : standingSaid(s)
  // A word taken back here is null: it hides the one said before.
  return Object.fromEntries(Object.entries({ ...all, ...d.said }).filter(([, word]) => word))
}
/**
 * The picture a held mark is compared with: the one it was last seen fixed on, or else the before, or else the last round's.
 * A screen swept unseen never moves it on, so a mark that came back then is still found in a later round.
 */
const compareOf = (s, a) => (a.checkedAfter && a.checkedAfter !== s.after ? a.checkedAfter : s.before || s.lastAfter || '')
/** Where the picture changed from what each held mark is compared with, once that is worked out. */
const changedFor = s => a => {
  const pic = compareOf(s, a)
  return pic ? changes.known.get(`${pic}|${s.after}`) ?? null : null
}
/** A screen's earlier marks, with the held ones flagged that may have come back. */
const askedNow = s => askedOf(s, changedFor(s), state.size)
/** The list stands beside the picture, in the After view, until it is closed. */
const askedShown = s => !!s && state.view === 'after' && (!state.askedShut.has(keyOf(s)) || !askedBeside()) && askedNow(s).rows.length > 0
const askedBeside = () => $('scroller').clientWidth - 14 - (ASKED_WIDE + 16) >= ASKED_MIN_PICTURE
const askedRoom = () => (askedShown(screen()) && askedBeside() ? ASKED_WIDE + 16 : 0)
/** Beside the picture, or under it in a narrow window: set as soon as the list shows, before the picture has come. */
function placeAsked(below = !askedBeside()) {
  $('pair').classList.toggle('asked-below', below)
  $('asked').style.width = `${below ? Math.max(0, Math.min(ASKED_WIDE * 2, $('scroller').clientWidth - 30)) : ASKED_WIDE}px`
}

/** Held marks flagged as came back? on each screen, as the page found them: they go with every answer for that screen. */
const flaggedHere = new Map()
/**
 * Compares a screen's held marks with the pictures they were last seen fixed on, for any screen, in view or not. What it finds is
 * written into that screen's draft at once, so however the screen goes, its answer says which came back and was not answered.
 */
function compareHeld(s) {
  const held = askedOf(s).held
  const pics = [...new Set(held.map(a => compareOf(s, a)).filter(Boolean))]
  if (!pics.length) return
  // Drawn again only when something was worked out just now, or what is flagged changed: this runs on every look.
  const done = (fresh = false) => {
    if (!flagBack(s) && !fresh) return
    const here = screen()
    if (here && keyOf(here) === keyOf(s)) {
      renderAsked(here)
      if (state.fitted) fit()
      paint()
    }
  }
  const todo = pics.filter(pic => !changes.known.has(`${pic}|${s.after}`))
  if (!todo.length && sizes.has(s.after)) return done()
  void pictureAt(`/images/${s.after}`).then(now => {
    sizes.set(s.after, { w: now.naturalWidth, h: now.naturalHeight })
    return Promise.all(todo.map(pic => pictureAt(`/images/${pic}`).then(then => changes.known.set(`${pic}|${s.after}`, changesBetween(then, now)))))
  }).then(() => setTimeout(() => done(true))).catch(() => undefined)
}
/** Picture sizes seen, so a screen not in view can be compared too. */
const sizes = new Map()
/** Writes what the comparison found into the screen's draft: the held marks flagged, and those seen unchanged. True when it changed. */
function flagBack(s) {
  const size = sizes.get(s.after) ?? (screen() && keyOf(screen()) === keyOf(s) ? state.size : null)
  const asked = askedOf(s, changedFor(s), size)
  const compared = asked.held.filter(a => changedFor(s)(a))
  const back = asked.back.map(a => a.n)
  flaggedHere.set(keyOf(s), back)
  const d = draftOf(s)
  const checked = compared.map(a => a.n)
  if (String(d.back ?? []) === String(back) && String(d.checked ?? []) === String(checked)) return false
  d.back = back
  d.checked = checked
  saveDraft(s)
  return true
}
/**
 * The part of any answer about the earlier marks, for any screen, from its entry and its draft. Every way an answer goes uses
 * this: Send, Looks good, the sweep, Looks good for the rest, a retry, a draft picked up in another tab. A flagged mark the
 * person said nothing of is never decided for them.
 */
function askedPart(s, d, { noComment = false } = {}) {
  const back = [...new Set([...(d?.back ?? []), ...(flaggedHere.get(keyOf(s)) ?? [])])]
  return { said: noComment ? {} : (d?.said ?? {}), back, checked: noComment ? [] : (d?.checked ?? []).filter(n => !back.includes(n)) }
}

function renderAsked(s) {
  const asked = s ? askedNow(s) : null
  const said = s ? saidOf(s) : {}
  const count = asked ? askedCount(asked, said) : { words: '', done: true }
  const chip = $('askedChip')
  // A narrow window has no room in the bar: the count is on the list's own header, under the picture.
  const narrow = !askedBeside()
  chip.hidden = !count.words || narrow
  chip.textContent = count.words
  chip.classList.toggle('done', count.done)
  chip.setAttribute('aria-expanded', String(askedShown(s)))
  const held = asked?.held.length ?? 0
  $('askedHeld').hidden = !held || narrow
  $('askedHeld').textContent = held ? `${held} held` : ''
  const box = $('asked')
  box.hidden = !askedShown(s)
  $('sideCol').hidden = box.hidden && $('checks').hidden
  if (box.hidden) return
  placeAsked()
  const row = a => {
    const back = asked.back.includes(a)
    const word = said[a.n] ?? ''
    // Drawn on a picture of another shape, its place cannot be trusted: listed, and not drawn.
    const moved = !!a.box && !!state.size && !placeOn(a, state.size)
    const when = `${back ? `You said fixed in round ${a.fixedIn}` : a.cameBack ? `Came back, from round ${a.round}` : `Round ${a.round}`}${moved ? ' · place may have moved' : ''}`
    return `<li class="ask${word ? ` said-${word}` : ''}${back ? ' back' : ''}" data-ask="${a.n}">`
      + `<button class="ask-n" data-ask-go="${a.n}" ${tip(moved ? 'The picture changed shape: its place may have moved' : a.box ? 'Show where it is' : 'Notes have no place on the picture')}>${askLetter(a.n)}</button>`
      + `<div class="ask-body"><span class="ask-words">${back ? '<b>Came back?</b> ' : ''}${esc(askWords(a))}</span><span class="ask-when">${esc(when)}</span>`
      + `<span class="ask-acts"><button class="btn ask-say${word === 'fixed' ? ' on' : ''}" data-ask-say="fixed" aria-pressed="${word === 'fixed'}">${ICONS.check}${back ? 'Still fixed' : 'Fixed'}</button>`
      + `<button class="btn ask-say${word === 'stands' ? ' on' : ''}" data-ask-say="stands" aria-pressed="${word === 'stands'}">${back ? 'Came back' : 'Still stands'}</button></span></div></li>`
  }
  // What to do next, in a line: a "came back?" first, since it is never decided for the person.
  const open = unansweredBack(s).length
  const left = asked.open.filter(a => !said[a.n]).length
  const some = asked.rows.some(a => said[a.n])
  // With changes already sent on this picture, Looks good would drop them: there the way on is Send.
  const sent = s.status === 'sent'
  const hint = open ? `${open} came back? Say Still fixed or Came back.` : !verdictOf(s) && allChecked(s) && !sent ? 'All checked. Press Looks good.' : some && left && sent ? `${left} still to check. ${left === 1 ? 'Tick it or say it still stands' : 'Tick them or say which still stand'}, then press Send.` : !verdictOf(s) && some && left ? `${left} still to check. ${left === 1 ? 'Tick it, say it still stands' : 'Tick them, say which still stand'}, or press Looks good to say all are fixed.` : ''
  const head = narrow ? `<span class="asked-count${count.done ? ' done' : ''}">${esc(count.words)}</span>` : `<button class="tool" data-asked-shut ${tip('Hide this list', 'K')}>${ICONS.close}</button>`
  setHtml(box, `<h2><span>You asked for these last time</span>${head}</h2>${hint ? `<p class="ask-hint">${esc(hint)}</p>` : ''}<ol>${asked.rows.map(row).join('')}</ol>${held ? `<p class="ask-held">${held} more you ticked fixed before. Each is flagged here if the picture changes there again.</p>` : ''}`)
  keepApart()
}

/** The listening notice drops over the right of the page, where the list stands: the list moves down while both show. */
function keepApart() {
  const col = $('sideCol')
  col.style.marginTop = ''
  const card = $('heard')
  if (card.hidden || col.hidden || $('pair').classList.contains('asked-below')) return
  const over = card.getBoundingClientRect().bottom + 8 - col.getBoundingClientRect().top
  const across = card.getBoundingClientRect().left < col.getBoundingClientRect().right
  if (over > 0 && across) col.style.marginTop = `${Math.ceil(over)}px`
}

/** Fixed or still stands. Pressed again, it is taken back. */
function sayAsked(n, word) {
  const s = screen()
  if (!s || onDonePage()) return
  const d = draftOf(s)
  touched(s)
  const said = { ...d.said }
  // Taken back: null hides a word said in an answer already sent; one said only here simply goes.
  if (saidOf(s)[n] === word) {
    if (standingSaid(s)[n]) said[n] = null
    else delete said[n]
  } else said[n] = word
  d.said = said
  d.good = false
  saveDraft(s)
  render()
  refreshLists()
}

function toggleAsked() {
  const s = screen()
  if (!s || !askedNow(s).rows.length) return
  const key = keyOf(s)
  // From Before or side by side, K is to see them: on to After, with the list open.
  if (state.view !== 'after') {
    state.view = 'after'
    state.askedShut.delete(key)
  } else if (state.askedShut.has(key)) state.askedShut.delete(key)
  else state.askedShut.add(key)
  render()
  // A zoom chosen by hand stays: only the column comes or goes.
  if (state.fitted) fit()
  else placeChecks()
}

/** Its place, brought into view and lit for a moment. */
let litTimer = null
function goToAsk(n) {
  const s = screen()
  const a = s?.asked?.find(x => x.n === n)
  const place = a && placeOn(a, state.size)
  if (!place) return
  const canvas = $('canvas').getBoundingClientRect()
  const view = $('scroller').getBoundingClientRect()
  const scale = canvas.width / state.size.w
  $('scroller').scrollBy({ left: canvas.left + place.x * scale - view.left - view.width / 3, top: canvas.top + place.y * scale - view.top - view.height / 3 })
  state.askLit = n
  paint()
  clearTimeout(litTimer)
  litTimer = setTimeout(() => {
    state.askLit = null
    paint()
  }, 1600)
}

/** Each earlier mark at its place, on screen only: a dashed outline and its number, never in what is sent. */
function paintAsked(ctx, s) {
  const asked = askedNow(s)
  if (!asked.rows.length) return
  const said = saidOf(s)
  const wide = markWidth()
  const line = Math.max(2, Math.round(strokeFor(wide) * 0.75))
  const size = Math.round(textFor(wide) * 0.7)
  ctx.save()
  ctx.font = `700 ${size}px -apple-system, system-ui, sans-serif`
  ctx.textBaseline = 'middle'
  for (const a of asked.rows) {
    const p = placeOn(a, state.size)
    if (!p) continue
    const back = asked.back.includes(a)
    const word = said[a.n]
    const colour = word === 'fixed' ? '#1d7a3a' : word === 'stands' ? '#d42a20' : '#f5b301'
    const width = state.askLit === a.n ? line * 2 : line
    ctx.setLineDash(back && !word ? [] : [line * 3, line * 2])
    for (const [stroke, w] of [['rgba(255, 255, 255, 0.9)', width + 2], [colour, width]]) {
      ctx.strokeStyle = stroke
      ctx.lineWidth = w
      ctx.strokeRect(p.x, p.y, p.w, p.h)
    }
    ctx.setLineDash([])
    // Lettered, not numbered: the agent's readings on the same picture are numbered by the marks they read.
    const name = askLetter(a.n)
    const tag = word === 'fixed' ? `✓ ${name}` : word === 'stands' ? `${name} ${back ? 'came back' : 'stands'}` : back ? `${name} Came back?` : name
    const tw = ctx.measureText(tag).width + size * 0.8
    const th = Math.round(size * 1.5)
    // Above the outline, or inside its top when there is no room above; never off the picture.
    const tx = Math.max(0, Math.min(p.x, state.size.w - tw))
    const ty = p.y - th >= 0 ? p.y - th : Math.max(0, p.y)
    ctx.fillStyle = colour
    ctx.fillRect(tx, ty, tw, th)
    ctx.fillStyle = word ? '#ffffff' : '#1b1d21'
    ctx.fillText(tag, tx + size * 0.4, ty + th / 2)
  }
  ctx.restore()
}
/* ---------- what the agent read each mark to mean: one line beside each sent mark, and a yes or a few words back ---------- */

/** The reading whose words box is open, as `answer|n`. Only one at a time. */
let correcting = ''
/** A field the person types in. While one has the keyboard, no key of the page's own works: only Esc, and cmd-Enter to send. */
const isTextField = el => !!el && (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || el.isContentEditable || (el instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file'].includes(el.type)))
/** The answers that stand for this round, newest first: a Looks good stands alone, so nothing before it counts. */
function standingAnswers(records, round) {
  const out = []
  for (const r of records ?? []) {
    if (r.round !== round || r.olderPicture) continue
    if (r.verdict !== 'changes') break
    out.push(r)
  }
  return out
}
const shortFrom = r => String(r.from || 'Claude').slice(0, 40)
function readingHtml(r, size) {
  const key = r.key
  // Beside the mark on its right, or its left. A mark across most of the picture has room on neither: the line goes under it.
  const roomRight = size.w - (r.box.x + r.box.w)
  const side = roomRight >= size.w * 0.25 ? 'right' : r.box.x >= size.w * 0.25 ? 'left' : 'under'
  const x = ((side === 'right' ? r.box.x + r.box.w : Math.max(0, r.box.x)) / size.w) * 100
  const y = (Math.max(0, side === 'under' ? r.box.y + r.box.h : r.box.y) / size.h) * 100
  const yes = !!r.reply?.yes
  const corrected = !yes && !!r.reply?.text
  const from = esc(shortFrom(r))
  const body = correcting === key
    ? `<span class="rt">${esc(r.text)}</span><input data-correct value="${esc(r.reply?.text ?? '')}" placeholder="What you meant, then Enter" maxlength="300" aria-label="What you meant by mark ${esc(r.label)}"><button data-send>Send</button><button class="link" data-cancel>Cancel</button><span class="rx" role="status"></span>`
    : yes ? `<span class="rt">${esc(r.text)}</span><span class="rs">${ICONS.check}Yes</span><button class="link" data-no>Change</button>`
      : corrected ? `<span class="rt">${esc(r.text)}</span><span class="rc">${esc(r.reply.text)}</span><button class="link" data-no>Change</button>`
        : `<span class="rt"><span class="rf">${from} read:</span>${esc(r.text)}</span><button data-yes>Yes, that</button><button data-no>No</button>`
  return `<div class="reading${side === 'right' ? '' : ` ${side}`}${yes || corrected ? ' answered' : ''}${corrected ? ' corrected' : ''}${correcting === key ? ' open' : ''}" data-reading="${esc(key)}" style="left:${x.toFixed(3)}%;top:${y.toFixed(3)}%" title="What ${from} read mark ${esc(r.label)} to mean"><span class="rn">${esc(r.label)}</span>${body}</div>`
}
/** The card before this one, leaving out boxes kept from before: they hold their place, and moving them would lose the keyboard. */
const cardBefore = el => {
  let at = el.previousElementSibling
  while (at?.classList.contains('kept')) at = at.previousElementSibling
  return at
}
function renderReadings(s) {
  const size = state.size
  const held = savedBoxWords()
  if (!correcting && !restoring && held && held.appSlug === s.appSlug && held.id === s.id && held.after === s.after) {
    correcting = held.key
    restoring = held
  }
  // Only on the answers standing for this picture, and only once the picture is there to place them on.
  const answers = size && state.shownKey === keyOf(s) + s.after ? standingAnswers(histories.get(historyKey(s)), s.round) : []
  // Two answers on one picture both have a mark 1: the older one's say so.
  const readings = answers.flatMap((a, i) => (a.readings ?? []).map(r => ({ ...r, key: `${a.answer}|${r.n}`, label: i ? `earlier ${r.n}` : String(r.n) }))).sort((x, y) => x.box.y - y.box.y)
  // A kept box whose line is on show again, on the same picture, becomes that line's box: one box, never two with the same words.
  const back = [...$('readings').children, ...$('keptAlone').children].find(c => c.classList.contains('kept') && c._screen?.appSlug === s.appSlug && c._screen?.id === s.id && c._screen?.after === s.after && readings.some(r => r.key === c.dataset.kept) && (!correcting || correcting === c.dataset.kept))
  if (back) {
    correcting = back.dataset.kept
    restoring = { key: correcting, words: back.querySelector('[data-correct]').value }
    back.remove()
  }
  if (!readings.some(r => r.key === correcting)) correcting = ''
  if (restoring && restoring.key !== correcting) restoring = null
  // Come to look: the line that said they had come has done its work.
  if (readings.length && $('toast').querySelector(`[data-look-at="${CSS.escape(`${s.appSlug}/${s.id}`)}"]`)) hideToast()
  // Card by card, so a card whose words box is open is never rebuilt: what is typed in it, and the keyboard, stay put.
  const layer = $('readings')
  const old = new Map([...layer.children].filter(el => el.dataset.reading).map(el => [el.dataset.reading, el]))
  let moved = false
  let prev = null
  for (const r of readings) {
    const html = readingHtml(r, size)
    let el = old.get(r.key)
    old.delete(r.key)
    const open = el?.querySelector('[data-correct]')
    if (el && open && r.key === correcting) {
      // Said again by the agent while the box is open: only its words change beside the box.
      const said = el.querySelector('.rt')
      if (said && said.textContent !== r.text) {
        said.textContent = r.text
        moved = true
      }
    } else if (el?._html !== html) {
      const made = document.createElement('template')
      made.innerHTML = html
      const fresh = made.content.firstElementChild
      fresh._html = html
      if (el) el.replaceWith(fresh)
      else if (prev) prev.after(fresh)
      else layer.prepend(fresh)
      el = fresh
      moved = true
      // Opened just now: the words go straight in, and words from before a reload or an Undo are back in it.
      if (r.key === correcting) {
        const input = fresh.querySelector('[data-correct]')
        if (restoring?.key === r.key) input.value = restoring.words
        input?.focus()
      }
    }
    Object.assign(el, { _box: r.box, _size: size, _screen: s, _after: s.after })
    // Out of order: put back, unless it holds the keyboard, which moving would take away.
    if (cardBefore(el) !== prev && !el.contains(document.activeElement)) {
      if (prev) prev.after(el)
      else layer.prepend(el)
      moved = true
    }
    prev = el
  }
  for (const el of old.values()) {
    // A box the person is writing in is theirs: whatever changed under it, it stays, with their words, until they say.
    const input = el.querySelector('[data-correct]')
    if (input && (input === document.activeElement || input.value.trim() !== input.defaultValue.trim())) keepWords(el, s)
    else el.remove()
    moved = true
  }
  shutOthers()
  // More lines than before: the list, if that is how they show, opens to show them.
  if (layer.children.length > shownLines) listOpen = true
  shownLines = layer.children.length
  if (moved) placeReadings()
}
/** While a box is open, the other lines cannot be pressed: one box at a time, and no Yes given by a stray key. */
function shutOthers() {
  const open = openCard()
  for (const card of $('readings').children) card.inert = !!open && card !== open
}
/** A box whose line has gone from under it: it keeps the words and the keyboard, says what happened, and waits for the person. */
function keepWords(el, s) {
  const input = el.querySelector('[data-correct]')
  const was = el._screen
  const cleared = was && !state.apps.some(a => a.slug === was.appSlug)
  const elsewhere = was && (!s || was.appSlug !== s.appSlug || was.id !== s.id)
  const why = cleared ? 'This review was cleared.' : elsewhere ? 'This is another screen now.' : was && was.after !== s.after ? 'A new picture came.' : s?.status === 'approved' ? 'This screen was answered Looks good since.' : 'That line is not shown now.'
  // Said once they are saved: where the words went, since it is not what is on show.
  el._sent = was ? `Sent, about ${elsewhere || cleared ? label(was) : 'the earlier picture'} (round ${was.round}).` : 'Sent.'
  el.classList.add('kept')
  el.dataset.kept = el.dataset.reading
  delete el.dataset.reading
  el._html = null
  // Everything round the box goes; the box itself is not touched, so the keyboard stays in it.
  for (const child of [...el.children]) if (child !== input) child.remove()
  input.insertAdjacentHTML('beforebegin', `<span class="rt"><b>${esc(why)}</b> Your words are kept: Enter still sends them, Esc drops them.</span>`)
  input.insertAdjacentHTML('afterend', '<button data-send>Send</button><button data-copy>Copy</button><button class="link" data-discard>Discard</button><span class="rx" role="status"></span>')
  el.classList.remove('open')
}
/**
 * Lines go beside their marks, inside the part of the picture that can be seen, and never on each other. A line whose mark is
 * out of view is not pulled in: a small marker says how many are above or below, and a press goes there. When the lines cannot
 * all stand apart, or the window is narrow, they are a list under the picture instead, one row each.
 */
function placeReadings() {
  const layer = $('readings')
  const cards = [...layer.children]
  const more = $('readingsMore')
  const stage = $('stage').getBoundingClientRect()
  const view = $('scroller').getBoundingClientRect()
  const room = { left: Math.max(stage.left, view.left) + 4, right: Math.min(stage.right, view.right, innerWidth) - 4, top: Math.max(stage.top, view.top) + 4, bottom: Math.min(stage.bottom, view.bottom) - 4 }
  const unlist = () => {
    layer.classList.remove('list', 'folded')
    for (const p of ['left', 'width', 'top', 'maxHeight']) layer.style[p] = ''
    $('readingsBar').hidden = true
  }
  if (!cards.length || room.right - room.left < 40 || room.bottom - room.top < 20) {
    unlist()
    setHtml(more, '')
    return
  }
  const markAt = card => {
    const b = card._box
    const k = card._size
    if (!b || !k) return null
    return { left: stage.left + (b.x / k.w) * stage.width, right: stage.left + ((b.x + b.w) / k.w) * stage.width, top: stage.top + (b.y / k.h) * stage.height, bottom: stage.top + ((b.y + b.h) / k.h) * stage.height }
  }
  const beside = () => {
    unlist()
    const placed = []
    const away = { above: [], below: [], aside: [] }
    const hits = r => placed.find(p => r.left < p.right && r.right > p.left && r.top < p.bottom && r.bottom > p.top)
    const shift = (card, by) => {
      card.style.marginTop = `${(parseFloat(card.style.marginTop) || 0) + by}px`
      return card.getBoundingClientRect()
    }
    for (const card of cards) {
      card.hidden = false
      card.style.marginTop = ''
      card.style.marginLeft = ''
      card.style.maxWidth = `${Math.max(160, Math.min(340, room.right - room.left))}px`
      const mark = markAt(card)
      const held = card.classList.contains('kept') || card.contains(document.activeElement)
      if (mark && !held && (mark.bottom < room.top || mark.top > room.bottom || mark.right < room.left || mark.left > room.right)) {
        card.hidden = true
        away[mark.bottom < room.top ? 'above' : mark.top > room.bottom ? 'below' : 'aside'].push(card)
        continue
      }
      let r = card.getBoundingClientRect()
      const dx = r.left < room.left ? room.left - r.left : r.right > room.right ? room.right - r.right : 0
      if (dx) {
        card.style.marginLeft = `${dx}px`
        r = card.getBoundingClientRect()
      }
      for (let p = hits(r); p; p = hits(r)) r = shift(card, p.bottom - r.top + 4)
      if (r.bottom > room.bottom) {
        card.style.marginTop = ''
        r = card.getBoundingClientRect()
        for (let p = hits(r); p; p = hits(r)) r = shift(card, p.top - r.bottom - 4)
      }
      if (r.top < room.top - 1 || r.bottom > room.bottom + 1 || hits(r)) return null
      placed.push(r)
    }
    return away
  }
  // A narrow window has no room beside the marks.
  const away = room.right - room.left >= 560 ? beside() : null
  if (away) {
    // Over the part of the window the picture is seen in.
    const center = $('center').getBoundingClientRect()
    more.style.top = `${view.top - center.top}px`
    more.style.height = `${view.height}px`
    setHtml(more, Object.entries(away).filter(([, xs]) => xs.length).map(([where, xs]) => `<button class="more-lines ${where}" data-more-lines="${where}">${xs.length} more ${xs.length === 1 ? 'line' : 'lines'} ${where === 'aside' ? 'to the side' : where}</button>`).join(''))
    more._away = away
    return
  }
  // The list: a bar under the picture says how many, and opens them as a sheet over it. The bar takes its own room, so the
  // picture is fitted above it and nothing of it is hidden while the list is folded.
  setHtml(more, '')
  for (const card of cards) {
    card.hidden = false
    for (const p of ['marginTop', 'marginLeft', 'maxWidth']) card.style[p] = ''
  }
  // An open box is never folded away: its words would be out of sight.
  const open = listOpen || !!openCard()
  const bar = $('readingsBar')
  const answered = cards.filter(c => c.classList.contains('answered')).length
  setHtml(bar, `<span>${cards.length} reading${cards.length === 1 ? '' : 's'}${answered ? `, ${answered} answered` : ''}</span><button class="btn" data-fold-readings aria-expanded="${open}">${open ? 'Hide' : 'Show'}</button>`)
  bar.hidden = false
  layer.classList.add('list')
  layer.classList.toggle('folded', !open)
  if (!open) return
  const center = $('center').getBoundingClientRect()
  const top = bar.getBoundingClientRect().top
  layer.style.left = `${center.left + 8}px`
  layer.style.width = `${center.width - 16}px`
  layer.style.maxHeight = `${Math.round(center.height * 0.45)}px`
  layer.style.top = `${Math.round(top - 4 - Math.min(layer.scrollHeight, center.height * 0.45))}px`
}
/** The list of lines, in a narrow window: open, or folded into its bar. It folds by itself when the person starts to draw. */
let listOpen = true
let shownLines = 0
$('readingsBar').addEventListener('click', event => {
  if (!event.target.closest('[data-fold-readings]') || openCard()) return
  listOpen = !listOpen
  placeReadings()
})
$('canvas').addEventListener('pointerdown', () => {
  if (!listOpen || openCard() || !$('readings').classList.contains('list')) return
  listOpen = false
  placeReadings()
})
let placing = 0
$('scroller').addEventListener('scroll', () => {
  cancelAnimationFrame(placing)
  placing = requestAnimationFrame(placeReadings)
}, { passive: true })
addEventListener('resize', () => {
  cancelAnimationFrame(placing)
  placing = requestAnimationFrame(placeReadings)
})
/** Where a mark is, lit on the picture while its line is pointed at or has the keyboard. */
function lightMark(card) {
  const spot = $('readingSpot')
  const b = card?._box
  const k = card?._size
  spot.hidden = !b || !k || card.classList.contains('kept')
  if (spot.hidden) return
  Object.assign(spot.style, { left: `${(b.x / k.w) * 100}%`, top: `${(b.y / k.h) * 100}%`, width: `${(b.w / k.w) * 100}%`, height: `${(b.h / k.h) * 100}%` })
}
$('readings').addEventListener('pointerover', event => lightMark(event.target.closest('.reading')))
$('readings').addEventListener('pointerleave', () => lightMark(document.activeElement?.closest?.('.reading')))
$('readings').addEventListener('focusin', event => lightMark(event.target.closest('.reading')))
$('readings').addEventListener('focusout', () => lightMark(null))
$('readingsMore').addEventListener('click', event => {
  const where = event.target.closest('[data-more-lines]')?.dataset.moreLines
  const card = where && $('readingsMore')._away?.[where]?.[0]
  if (!card?._box) return
  // The first of them to the middle of the window.
  const stage = $('stage').getBoundingClientRect()
  const view = $('scroller').getBoundingClientRect()
  const x = stage.left + ((card._box.x + card._box.w / 2) / card._size.w) * stage.width
  const y = stage.top + ((card._box.y + card._box.h / 2) / card._size.h) * stage.height
  $('scroller').scrollBy({ left: x - (view.left + view.width / 2), top: y - (view.top + view.height / 2) })
})
/**
 * Yes, or a few words back. A Yes shows at once, and goes back and says so if the server does not take it. Words stay in their
 * box until the server has them: if they do not go, the box says so, keeps them, and Enter tries again.
 */
async function sayBack(s, key, said, card = null) {
  const [answer, n] = [key.slice(0, key.lastIndexOf('|')), Number(key.slice(key.lastIndexOf('|') + 1))]
  const reading = histories.get(historyKey(s))?.find(r => r.answer === answer)?.readings?.find(r => r.n === n)
  const before = reading?.reply ?? null
  if (card) {
    if (card.classList.contains('sending')) return
    card.classList.add('sending')
    card.querySelector('.rx').textContent = 'Sending…'
  } else {
    if (reading) reading.reply = { yes: true }
    if (screen()) renderReadings(screen())
  }
  try {
    const res = await fetch('/api/reading', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ appSlug: s.appSlug, id: s.id, answer, n, ...said }) })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'The server did not take it.')
  } catch (error) {
    const why = error.message === 'Failed to fetch' ? 'The server is not answering.' : error.message
    if (card) {
      card.classList.remove('sending')
      card.querySelector('.rx').textContent = `Not sent: ${why} Your words are here; Enter tries again.`
      return
    }
    if (reading) reading.reply = before
    if (screen()) renderReadings(screen())
    return void toast('Your yes did not go', `${why} Press it again when it is back.`, { problem: true })
  }
  if (!card) return
  if (reading) reading.reply = { text: said.text }
  forgetBoxWords()
  if (card.classList.contains('kept')) {
    dropKept(card)
    return void toast(card._sent ?? 'Sent.')
  }
  card.classList.remove('sending')
  if (correcting === key) correcting = ''
  if (screen()) renderReadings(screen())
}
/** The person let a kept box go: by Discard or Esc. */
function dropKept(el) {
  if (el.contains(document.activeElement)) document.activeElement.blur()
  el.remove()
  shutOthers()
  placeReadings()
}
/** The box that is open now, the usual one or one kept from before, if it can be seen. */
const boxCards = () => [...$('readings').children, ...$('keptAlone').children].filter(c => c.classList.contains('kept') || (correcting && c.dataset.reading === correcting))
const openCard = () => boxCards().find(c => c.getClientRects().length) ?? null
/** A box open, or the notice for one closed under the person: the page's own keys are off while it is. */
const correctionOpen = () => !!openCard() || !$('keptTrap').hidden
function sendFrom(card) {
  const input = card.querySelector('[data-correct]')
  const words = input?.value.trim()
  if (!words) return void input?.focus()
  if (card.classList.contains('kept')) return void sayBack(card._screen, card.dataset.kept, { text: words }, card)
  const s = screen()
  if (s) void sayBack(s, card.dataset.reading, { text: words }, card)
}
/** Words dropped by Cancel or Esc, for the Undo that brings them back: the box they were in, and where it stood. */
let dropped = null
function cancelBox(card) {
  const words = card.querySelector('[data-correct]')?.value.trim() ?? ''
  dropped = words ? { words, key: card.dataset.reading ?? card.dataset.kept, kept: card.classList.contains('kept'), screen: card._screen, sent: card._sent, why: card.querySelector('.rt b')?.textContent ?? '', left: card.style.left, top: card.style.top } : null
  forgetBoxWords()
  if (card.classList.contains('kept')) dropKept(card)
  else {
    correcting = ''
    if (screen()) renderReadings(screen())
  }
  // An empty box goes quietly. Words never go by one press with no way back.
  if (dropped) toast('Words dropped', '', { undoWords: true })
}
/** Undo: the words come back in an open box, the line's own when it is still on show, a kept one when it is not. */
function undoDropped() {
  const was = dropped
  dropped = null
  hideToast()
  if (!was || openCard()) return
  const s = screen()
  const onShow = !was.kept && s && was.screen && s.appSlug === was.screen.appSlug && s.id === was.screen.id && $('readings').querySelector(`[data-reading="${CSS.escape(was.key)}"]`)
  if (onShow) {
    correcting = was.key
    restoring = { key: was.key, words: was.words }
    renderReadings(s)
  } else keptFrom({ key: was.key, words: was.words, screen: was.screen, why: was.why, sent: was.sent, left: was.left, top: was.top }).querySelector('[data-correct]').focus()
  // Back in a box, so saved again: a reload does not lose them a second time.
  const input = openCard()?.querySelector('[data-correct]')
  if (input) keepBoxWords(input)
}
const onBoxClick = event => {
  const card = event.target.closest('.reading')
  if (!card) return
  if (event.target.closest('[data-send]')) return sendFrom(card)
  if (event.target.closest('[data-cancel], [data-discard]')) return cancelBox(card)
  if (card.classList.contains('kept')) {
    const words = card.querySelector('[data-correct]')?.value ?? ''
    if (event.target.closest('[data-copy]')) void navigator.clipboard?.writeText(words).then(() => toast('Your words are copied'), () => toast('This browser would not copy them', 'Select them in the box and copy them yourself'))
    return
  }
  const s = screen()
  if (!s || !card.dataset.reading) return
  if (event.target.closest('[data-yes]')) void sayBack(s, card.dataset.reading, { yes: true })
  else if (event.target.closest('[data-no]') && !openCard()) {
    correcting = card.dataset.reading
    renderReadings(s)
  }
}
$('readings').addEventListener('click', onBoxClick)
$('keptAlone').addEventListener('click', onBoxClick)
const onBoxKey = event => {
  const card = event.target.closest('.reading')
  if (!card || card !== openCard()) return
  // The keys are for the box: G, N or cmd-Enter here must not answer the screen.
  event.stopPropagation()
  boxHeld = !['Enter', 'Escape', 'Tab'].includes(event.key)
  // Letters still being put together by an input method are not a key of their own: Enter there ends the word, not the box.
  if (event.isComposing || event.keyCode === 229) return
  // A letter or a space typed on Send or Cancel is more of the words, not a press: it goes into the box.
  const input = card.querySelector('[data-correct]')
  if (input && event.target.matches('button') && event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault()
    input.focus()
    input.setRangeText(event.key, input.value.length, input.value.length, 'end')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    boxHeld = true
    return
  }
  if (event.key === 'Tab') {
    // Round the box, its Send and its Cancel, and nowhere else while it is open.
    event.preventDefault()
    const stops = [...card.querySelectorAll('input, button:not([disabled])')]
    stops[(stops.indexOf(document.activeElement) + (event.shiftKey ? -1 : 1) + stops.length) % stops.length]?.focus()
    boxHeld = true
    return
  }
  if (event.key === 'Escape') return cancelBox(card)
  if (event.key === 'Enter' && event.target.matches('[data-correct]')) {
    event.preventDefault()
    sendFrom(card)
  }
}
$('readings').addEventListener('keydown', onBoxKey)
$('keptAlone').addEventListener('keydown', onBoxKey)
// What is typed in a box is kept in this browser as it is typed, so a reload brings the box back open with it.
const onBoxInput = event => {
  if (event.target.matches('[data-correct]')) keepBoxWords(event.target)
}
$('readings').addEventListener('input', onBoxInput)
$('keptAlone').addEventListener('input', onBoxInput)

/*
 * The keyboard was in a words box, and the box was taken away by something the page could not help (the picture covered, say).
 * Then a notice takes the keyboard and holds it: what is typed goes nowhere, until a press or Esc. No clock decides it.
 */
let boxHeld = false
let lastBoxWords = ''
$('readings').addEventListener('focusin', event => {
  if (event.target.matches('[data-correct]')) boxHeld = true
})
$('readings').addEventListener('input', event => {
  if (event.target.matches('[data-correct]')) lastBoxWords = event.target.value
})
document.addEventListener('focusin', event => {
  if (!event.target.closest?.('#readings')) boxHeld = false
})
document.addEventListener('pointerdown', event => {
  boxHeld = false
  if (!$('keptTrap').hidden && !event.target.closest('#keptTrap')) closeTrap()
}, true)
/**
 * While a box is open, wherever the keyboard is, the page's own keys are off: a key on a button outside the box does not press
 * it, Tab goes back into the box, and words typed in another field stay words. Only Esc goes on as usual. True when it took it.
 */
function boxHoldsKeys(event) {
  const card = openCard()
  if (!card || card.contains(event.target)) return false
  // Esc in another window closes that window. Anywhere else it brings the keyboard back to the box: a second Esc cancels there.
  if (event.key === 'Escape' && otherWindowUp()) return false
  if (event.key === 'Escape') {
    event.preventDefault()
    closeMenu()
    closeDrawer()
    card.querySelector('[data-correct]')?.focus()
    return true
  }
  if (event.key === 'Tab') {
    event.preventDefault()
    card.querySelector('[data-correct]')?.focus()
    return true
  }
  if (isTextField(event.target) && !((event.metaKey || event.ctrlKey) && event.key === 'Enter')) return true
  event.preventDefault()
  return true
}
// A button is pressed by Space as the key comes up: that is held too.
document.addEventListener('keyup', event => {
  const card = openCard()
  if (card && !card.contains(event.target) && !isTextField(event.target) && [' ', 'Enter'].includes(event.key)) event.preventDefault()
}, true)
/** True when it took the key: the box had the keyboard, and lost it without the person moving it. */
function trapLostBox(event) {
  if (!$('keptTrap').hidden) {
    if (event.key === 'Escape') closeTrap()
    event.preventDefault()
    return true
  }
  if (!boxHeld || isTextField(document.activeElement)) return false
  boxHeld = false
  setHtml($('keptTrap'), `<b>The box you were writing in was closed.</b><span>${lastBoxWords.trim() ? `Your words: “${esc(lastBoxWords.trim())}”. ` : ''}What you type now goes nowhere. Press Esc or click to go on.</span>${lastBoxWords.trim() ? '<button class="link" data-trap-copy>Copy</button>' : ''}`)
  $('keptTrap').hidden = false
  $('keptTrap').focus()
  event.preventDefault()
  return true
}
function closeTrap() {
  $('keptTrap').hidden = true
  if (document.activeElement === $('keptTrap')) $('keptTrap').blur()
}
$('keptTrap').addEventListener('click', event => {
  if (event.target.closest('[data-trap-copy]')) void navigator.clipboard?.writeText(lastBoxWords.trim()).catch(() => undefined)
})

function updateButtons() {
  const a = app()
  const s = screen()
  if (!s) return
  const d = draftOf(s)
  $('undo').disabled = !d.undo.length
  $('redo').disabled = !d.redo.length
  $('clear').disabled = !d.marks.length
  // What Send will say of the earlier marks can change with any mark or note: the list always shows it.
  renderAsked(s)
  renderFoot(a, s)
}

function paint() {
  const s = screen()
  const ctx = $('canvas').getContext('2d')
  if (!s || !state.size) return
  ctx.clearRect(0, 0, state.size.w, state.size.h)
  if (sentMarks.img) ctx.drawImage(sentMarks.img, 0, 0, state.size.w, state.size.h)
  if (state.changesOn && changes.boxes?.length) paintChanged(ctx, changes.boxes, state.size.w, state.size.h)
  paintAsked(ctx, s)
  paintChosen(ctx, s)
  const all = [...draftOf(s).marks, ...(draft ? [draft] : [])]
  paintWords(ctx, all.filter(isWords))
  paintMarks(ctx, all.filter(m => !isWords(m) && !isPin(m)))
  paintPins(ctx, [...all.filter(isPin), ...(pin.active ? [pin.active] : [])], markWidth(), pin.active)
  showGlow()
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
  placeLineup()
  placeReadings()
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
  // With the earlier marks beside the picture, what to check stands above them, in the same column.
  const asking = askedShown(s)
  // A narrow window: the picture keeps the width, and the list goes under it, never past the edge.
  const below = asking && !askedBeside()
  const room = { width: box.clientWidth - 14 - askedRoom(), height: $('center').clientHeight - foot - 14 }
  const shown = state.size && state.view === 'after' && state.fitted ? fittedZoom(room) * state.size.w : room.width
  const spare = room.width - shown - 16
  state.sideChecks = !onPhone() && items.length > 0 && ((asking && !below) || spare >= 220)
  $('checks').hidden = !state.sideChecks
  placeAsked(below)
  $('sideCol').style.maxHeight = below ? '' : `${room.height}px`
  $('sideCol').hidden = $('checks').hidden && !asking
  if (state.sideChecks) {
    $('checks').style.width = `${asking && !below ? ASKED_WIDE : Math.min(400, spare)}px`
    $('checks').style.maxHeight = asking && !below ? '' : `${room.height}px`
    setHtml($('checks'), `<h2><span>What to check</span><span class="from">${esc(fromWords(s))}</span></h2><ul>${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>${moreButton(look.rest)}${moreWords(look.rest)}`)
  }
  renderAbout(app(), s)
}

/** How wide a tall picture is shown when the whole of it would be too small to read, and what counts as too small. */
const PAGE_WIDE = 760
const TOO_NARROW = 600
const SHRUNK = 0.75
/** The room a picture has, and how many share it. */
const roomNow = () => {
  const box = $('scroller')
  return { room: { width: box.clientWidth - 14 - askedRoom(), height: box.clientHeight - 14 - (state.view === 'after' ? 0 : 24) - lineupRoom() }, across: state.view === 'side' ? 2 : 1 }
}
/**
 * The zoom a picture is fitted at. Most are shown whole. A tall one that has to be shrunk to a narrow strip, a page of a PDF
 * in a small window or a whole long web page, has words too small to read: it is shown a page wide instead, never past its
 * own size, and scrolls. `state.whole` shows all of it.
 */
function fittedZoom(room, across = 1) {
  const { w, h } = state.size
  const all = fitZoom(room, { width: w, height: h }, across)
  // A lineup is always whole, however small that makes it: every option in view is the point of it.
  if (screen()?.choice) return Math.min(all, room.width / w, room.height / h)
  // Shrunk only a little, it stays whole: a picture that nearly fits should not scroll by a few lines.
  if (state.whole || all >= SHRUNK || all * w >= TOO_NARROW) return all
  const each = (room.width - (across - 1) * 16) / across
  return Math.max(all, Math.min(1, Math.min(each, PAGE_WIDE) / w))
}
const isTall = () => {
  if (!state.size) return false
  const { room, across } = roomNow()
  const whole = state.whole
  state.whole = false
  const tall = fittedZoom(room, across) !== fitZoom(room, { width: state.size.w, height: state.size.h }, across)
  state.whole = whole
  return tall
}
/**
 * The width marks are sized for. A picture shown small, a tall page say, would get lines and words too thin to read: its marks
 * are sized as for a picture that is a good width on the screen when fitted. Zooming in to draw changes nothing.
 */
function markWidth() {
  const { room, across } = roomNow()
  return Math.max(state.size.w, Math.round(1000 / fittedZoom(room, across)))
}
function fit() {
  if (!state.size) return
  placeChecks()
  const { room, across } = roomNow()
  state.zoom = fittedZoom(room, across)
  state.fitted = true
  applyZoom()
}
/** The fit key. On a tall picture already fitted, it turns between filling the width and showing the whole of it. */
function fitAgain() {
  if (state.fitted && isTall()) state.whole = !state.whole
  fit()
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
/** Where the press began, to tell a click from a drag. */
let pressed = null
/** The finger or mouse that is drawing now. A second finger put down meanwhile is not a second mark. */
let drawingWith = null
/** On a phone a finger on the picture moves it, until Mark brings the tools out. */
// A mouse or a pen draws as it always does, in a narrow window too: only a finger needs Mark first.
const mayDraw = event => !onPhone() || state.marking || event.pointerType !== 'touch'

$('canvas').addEventListener('pointerdown', event => {
  // Text opens on click, once the press is over, so nothing takes the focus away from the field afterwards.
  if (!state.size || event.button !== 0 || state.tool === 'text' || !mayDraw(event)) return
  if (!event.isPrimary) return
  drawingWith = event.pointerId
  event.preventDefault()
  // That also stops the focus moving: a note box would go on taking the keys that follow, and B or G would land in it.
  if (document.activeElement?.matches?.('textarea, input, select')) document.activeElement.blur()
  try {
    $('canvas').setPointerCapture(event.pointerId)
  } catch {
    // The mark is drawn from the events that arrive.
  }
  const p = at(event)
  if (state.tool === 'speak') {
    drawingWith = null
    return void startPin(p)
  }
  pressed = { x: event.clientX, y: event.clientY, at: p }
  const w = strokeFor(markWidth())
  const words = toolNow() === 'words' ? wordsNow() : null
  if (words) {
    const on = wordAt(words, p, { near: true })
    if (on >= 0) draft = { ...wordsMark(words, on, on, state.colour), start: on }
    return paint()
  }
  if (state.tool === 'pan') pan = { x: event.clientX, y: event.clientY, left: $('scroller').scrollLeft, top: $('scroller').scrollTop }
  else if (state.tool === 'pen') draft = { tool: 'pen', points: [p], color: state.colour, w }
  // No word list for this picture: the words tool draws a box round them instead.
  else draft = { tool: state.tool === 'words' ? 'box' : state.tool, a: p, b: p, color: state.colour, w }
})
$('canvas').addEventListener('pointermove', event => {
  if (event.pointerId !== drawingWith) return
  if (pan) {
    $('scroller').scrollLeft = pan.left - (event.clientX - pan.x)
    $('scroller').scrollTop = pan.top - (event.clientY - pan.y)
    return
  }
  if (!draft) return
  const p = at(event)
  const words = isWords(draft) ? wordsNow() : null
  if (isWords(draft)) draft = words ? { ...wordsMark(words, draft.start, wordAt(words, p), draft.color), start: draft.start } : draft
  else draft = draft.tool === 'pen' ? { ...draft, points: [...draft.points, p] } : { ...draft, b: p }
  paint()
})
const finish = event => {
  // On a choice, a click that drew nothing chooses the option under it. A drag is a mark, never a choice.
  const click = pressed && event?.type === 'pointerup' && Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) < 6 ? pressed.at : null
  pressed = null
  if (click && screen()?.choice) {
    pan = null
    draft = null
    drawingWith = null
    paint()
    return choose(optionNear(screen(), click[0])?.key ?? null)
  }
  pan = null
  drawingWith = null
  if (!draft) return
  const done = draft
  draft = null
  // The same words in the same colour, marked again, are one mark.
  const again = isWords(done) && screen() && draftOf(screen()).marks.some(m => isWords(m) && m.from === done.from && m.to === done.to && m.color === done.color)
  if (isReal(done) && !again) commit(done)
  else paint()
}
$('canvas').addEventListener('click', event => {
  const finger = { pointerType: touchLast ? 'touch' : 'mouse' }
  // On a phone, before Mark, a finger only moves the picture: a tap on a lineup's option still chooses it.
  if (state.size && screen()?.choice && !mayDraw(finger)) return choose(optionNear(screen(), at(event)[0])?.key ?? null)
  if (state.size && state.tool === 'text' && !textEntry && mayDraw(finger)) openTextEntry(event)
})
$('canvas').addEventListener('pointerup', event => event.pointerId === drawingWith && finish(event))
// The system took the touch away, for a gesture of its own: half a mark is not a mark.
$('canvas').addEventListener('pointercancel', event => {
  if (event.pointerId !== drawingWith) return
  draft = null
  finish()
  paint()
})

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
  // The pin that listens belongs to the screen it is on: kept there with its words, or let go when the screen has already gone.
  if (keep) endPin()
  else dropPin()
  if (keep) finish()
  if (!textEntry) return
  const { input, point, colour } = textEntry
  textEntry = null
  const text = input.value.trim()
  input.remove()
  if (keep && text && state.size) commit({ tool: 'text', at: point, text, color: colour, size: textFor(markWidth()) })
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
  const said = d.said
  const chosen = d.choice ?? null
  const marks = verdict === 'approved' ? [] : list.filter(isReal)
  const out = verdict === 'approved' || !img ? null : burnCanvas(img, marks.filter(m => !isWords(m) && !isPin(m)))
  const ctx = (out ?? document.createElement('canvas')).getContext('2d')
  // The width the marks were sized for when drawn. A pin's size is worked out as it is painted, so it is fixed here.
  const wide = size && state.size && size.w === state.size.w ? markWidth() : (size?.w ?? 0)
  if (out) paintWords(ctx, marks.filter(isWords))
  if (out) paintPins(ctx, marks.filter(isPin), wide)
  const png = out ? out.toDataURL('image/png') : null
  const body = {
    appSlug: s.appSlug,
    id: s.id,
    after: s.after,
    round: s.round,
    verdict,
    notes: noComment ? 'No comment.' : verdict === 'approved' ? '' : words,
    shapes: marks.map(m => (isWords(m) ? wordsShape(m) : isPin(m) ? pinShape(m, wide) : shapeOf(m, ctx))),
    imageSize: size,
    png,
    ...(s.choice ? { choice: chosen } : {}),
    // The ticks ride along with the answer, and the held marks flagged on it go too. Sent with the rest, unseen, it ticks nothing.
    ...askedPart(s, { ...d, said }, { noComment }),
  }
  if (noComment) body.noComment = true
  const res = await fetch('/api/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {
    throw Object.assign(new Error('The server is not answering.'), { offline: true })
  })
  const result = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(result.error || 'The server did not take it.')
  // Drawn or written while this was on its way: that has not gone, and stays.
  const now = drafts.get(key) ?? d
  if (now.marks !== list || now.notes !== words || now.said !== said || (now.choice ?? null) !== chosen) {
    now.marks = now.marks.filter(m => !list.includes(m))
    if (now.notes === words) now.notes = ''
    if (now.said === said) now.said = {}
    now.pending = false
    now.undo = []
    now.redo = []
    saveDraft(s)
  } else {
    drafts.delete(key)
    store.set(key, null)
  }
  // What was said stands until changed: shown again at once, before the server's list of answers has it.
  if (verdict === 'approved') saidSent.delete(key)
  else saidSent.set(key, { ...standingSaid(s), ...said })
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
  // The answer made work for an agent: say at once whether one will hear it.
  if (result.listening) setListening(result.listening)
  if (result.made) saidMade(result.made)
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
    const body = { appSlug: job.s.appSlug, id: job.s.id, after: job.s.after, round: job.s.round, verdict: 'approved', notes: job.noComment ? 'No comment.' : '', shapes: [], imageSize: null, png: null, ...(job.s.choice ? { choice: draftOf(job.s).choice ?? null } : {}), ...askedPart(job.s, draftOf(job.s), { noComment: job.noComment }), ...(job.noComment ? { noComment: true } : {}) }
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
  // Sent with no choice is a plain "none of these", and says so.
  toast(s.choice ? (draftOf(s).choice ? `Chose ${draftOf(s).choice}, with changes` : 'Sent without a choice: none of these') : 'Sent', label(s), { undo: true })
  moveOn(wasWaiting)
}

/** G and the Looks good button. */
async function looksGood(byKey = false) {
  const s = screen()
  if (!s || onDonePage()) return
  closeTextEntry(true)
  const d = draftOf(s)
  // A Looks good on a lineup says nothing until one is chosen: which one would it be? One answered already is passed by.
  if (s.choice && !d.choice && s.status !== 'approved') {
    toast('Choose one first', `Press ${keysWords(s)}, or click an option.`)
    return
  }
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
  const dropping = d.marks.some(isReal) || !!d.notes.trim() || stands(d)
  // Already said, by a press: there is nothing to add, only somewhere to go.
  if (!dropping && !verdictOf(s) && s.status === 'approved' && !standingAnswer(histories.get(historyKey(s)), s.round)?.noComment) return moveOn(false)
  // A "came back?" is never decided for the person: asked first, and sent as not answered if they go on.
  const open = unansweredBack(s).length
  if (open && !(await ask(`${open} came back? not answered`, `${open === 1 ? 'A mark you ticked fixed before has' : `${open} marks you ticked fixed before have`} changed again. Say Still fixed or Came back, or send it as not answered.`, 'Send as not answered', 'Go back and say'))) return
  // Changes sent are the person's real answer. One key must not swap them for an approval as they go past.
  const replacing = s.status === 'sent'
  if (dropping || replacing) {
    const sent = marksSentNow(s)
    const yes = replacing
      ? await ask('Replace your changes with Looks good?', `You sent changes on this screen. This drops the ${sent} mark${sent === 1 ? '' : 's'} you sent on this picture: they go under Earlier answers, and it counts as looking good.${dropping ? ' What you have drawn or written since is dropped too.' : ''}`, 'Replace with Looks good')
      : await ask('Mark as looking good?', stands(d) ? 'Your marks and notes on this screen are dropped, and every earlier mark counts as fixed.' : 'Your marks and notes on this screen are dropped.', 'Mark as looking good')
    if (!yes) return
  }
  if (dropping) {
    Object.assign(d, withMarks(d, []))
    d.notes = ''
    d.said = {}
    $('notes').value = ''
    growNotes()
  }
  const wasWaiting = s.status === 'waiting'
  d.good = true
  queueAnswer(s, 'approved')
  toast(s.choice ? `Chose ${d.choice}` : 'Looks good', label(s), { undo: true })
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
  const unchosen = unchosenOf(a)
  if (!t.set.length && !unchosen.length) return
  const left = t.untouched.filter(s => leftBehindOn(s).length)
  // Ticks alone are not an answer: these go as not looked at, and the person is told before they go.
  const ticked = t.untouched.filter(s => fixedTicks(draftOf(s)))
  const names = list => (list.length > 8 ? `${list.slice(0, 6).map(s => esc(label(s))).join(', ')} and ${list.length - 6} more` : list.map(s => esc(label(s))).join(', '))
  setHtml($('submitBody'), `<div class="summary">
    ${[['draft-changes', 'With marks or notes', t.changes], ['draft-good', 'Looks good', t.good], ['draft-good', 'No comment, counts as Looks good', t.untouched]].map(([mk, title, list]) => (list.length ? `<div class="srow"><span class="line"><i class="mk ${mk}"></i></span><span class="line">${title}</span><span class="line count">${list.length}</span></div><div class="names">${names(list)}</div>` : '')).join('')}
    ${left.length ? `<div class="names warn">${names(left)}: marks or notes on an older picture were not sent. See Earlier answers.</div>` : ''}
    ${unchosen.length ? `<div class="names warn">Choose one first: ${names(unchosen)}. ${unchosen.length === 1 ? 'It waits' : 'They wait'} for your choice.</div>` : ''}
    ${ticked.length ? `<div class="names warn">Your ticks on these are not sent: ${names(ticked)}. Go back and press Looks good or Send on each to send them.</div>` : ''}
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
  const jobs = submitJobs(setOf(a), goesOf).filter(job => !queued.get(keyOf(job.s))?.going)
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
$('sheetGrid').onclick = event => {
  const at = event.target.closest('[data-i]')
  if (!at) return
  closeSheet()
  go(Number(at.dataset.i))
}
$('sheetRest').onclick = () => {
  closeSheet()
  openSubmit()
}
$('sheetClose').onclick = closeSheet
$('sheetModal').onclick = event => event.target === $('sheetModal') && closeSheet()
$('overall').onclick = openSheet
$('askedChip').onclick = toggleAsked
$('asked').onclick = event => {
  const row = event.target.closest('[data-ask]')
  if (event.target.closest('[data-asked-shut]')) return toggleAsked()
  if (!row) return
  const n = Number(row.dataset.ask)
  const say = event.target.closest('[data-ask-say]')
  if (say) {
    sayAsked(n, say.dataset.askSay)
    // The list was built again: the keyboard stays on the same button of the same row.
    return $('asked').querySelector(`[data-ask="${n}"] [data-ask-say="${say.dataset.askSay}"]`)?.focus()
  }
  if (event.target.closest('[data-ask-go]')) goToAsk(n)
}
// Pointing at one lights its place on the picture.
$('asked').onmouseover = event => {
  const n = Number(event.target.closest('[data-ask]')?.dataset.ask) || null
  if (state.askLit === n) return
  state.askLit = n
  paint()
}
$('asked').onmouseleave = () => {
  state.askLit = null
  paint()
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
function toast(text, sub = '', { undo = false, problem = false, look = '', go = '', undoWords = false } = {}) {
  setHtml($('toast'), `<span>${esc(text)}</span>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}${undo ? '<button class="link" data-undo>Undo</button>' : ''}${undoWords ? '<button class="link" data-undo-words>Undo</button>' : ''}${look ? `<button class="link" data-look-at="${esc(look)}">Look</button>` : ''}${go ? `<button class="link" data-toast-go="${esc(go)}">Go there</button>` : ''}`)
  $('toast').classList.remove('fading')
  $('toast').classList.toggle('problem', problem)
  $('toast').hidden = false
  clearTimeout(toastTimer)
  if (problem) return
  toastTimer = setTimeout(() => {
    $('toast').classList.add('fading')
    toastTimer = setTimeout(hideToast, 200)
  }, undo ? UNDO_MS - 200 : look || go || undoWords ? 8000 : 3000)
}
$('toast').onclick = event => {
  const look = event.target.closest('[data-look-at]')?.dataset.lookAt
  const there = event.target.closest('[data-toast-go]')?.dataset.toastGo
  if (event.target.closest('[data-undo]')) undoAnswer()
  else if (event.target.closest('[data-undo-words]')) undoDropped()
  else if (look || there) {
    // A window up holds the page: it must not change under it. The notice stays until its time is up.
    if (windowUp()) return
    hideToast()
    const [slug, id] = (look ?? there).split('/')
    if ((state.starting || slug !== state.appSlug) && state.apps.some(a => a.slug === slug)) pickApp(slug)
    const at = id ? app()?.screens.findIndex(s => s.id === id) ?? -1 : -1
    if (at >= 0) go(at)
  } else if ($('toast').classList.contains('problem')) hideToast()
}

let tipTimer = null
let tipFor = null
let touchLast = false
document.addEventListener('pointerdown', event => {
  touchLast = event.pointerType === 'touch'
}, true)
document.addEventListener('mouseover', event => {
  // A finger does not hover: a tip would come up after the tap and stay.
  if (touchLast) return
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
  // On a phone the box is out of the way until there are words in it, or the tools are out.
  $('foot').classList.toggle('has-notes', !!box.value)
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
  state.starting = false
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
  if (tool !== 'speak') endPin()
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

for (const [id, icon] of Object.entries({ listOpen: 'list', back: 'prev', next: 'next', menuOpen: 'more', undo: 'undo', redo: 'redo', clear: 'clear', changesOn: 'changes', helpClose: 'close', newClose: 'close', sheetClose: 'close', viewerClose: 'close', filmClose: 'close', phoneClose: 'close' })) $(id).innerHTML = ICONS[icon]

$('listOpen').onclick = openDrawer
$('back').onclick = () => go(state.index - 1)
$('next').onclick = () => go(state.index + 1)
$('menuOpen').onclick = toggleMenu
$('menu').onclick = event => {
  const what = event.target.closest('[data-menu]')?.dataset.menu
  if (what === 'list') openDrawer()
  else if (what === 'new') openNewProject()
  else if (what === 'work') !wordsFirst() && (location.href = '/work.html')
  else if (what === 'rest') openSubmit()
  else if (what === 'stop') stopHere()
  else if (what === 'aside-one') void setAside([state.appSlug], true)
  else if (what === 'aside-group') void setAside(groupsIn(state.apps).get(placeOf(app()).group).map(m => m.app.slug), true)
  else if (what === 'panels') togglePanels()
  else if (what === 'strip') togglePanel('strip', 'no-strip')
  else if (what === 'details') togglePanel('details', 'no-details')
  else if (what === 'full') toggleFull()
  else if (what === 'notices') void toggleNotices()
  else if (what === 'phone') openPhone()
  else if (what === 'wake') void toggleWake()
  else if (what === 'sheet') openSheet()
  else if (what === 'film') void openFilm()
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
/* The start page and the menu share the same choices. */
function firstRunHtml({ sample = true } = {}) {
  const id = name => sample ? ` id="first${name}"` : ''
  const example = sample && new URLSearchParams(location.search).get('example') === 'todo' ? 'Make a todo app' : ''
  return `<div class="first">
    ${sample ? '<p class="first-kicker">MARKBACK / NEW PROJECT</p><h2>What would you like to build?</h2>' : ''}
    <form class="first-build" data-build>
      <label class="first-label" for="${sample ? 'firstBrief' : 'newBrief'}">${sample ? 'Describe your idea' : 'What would you like to build?'}</label>
      <textarea id="${sample ? 'firstBrief' : 'newBrief'}" data-build-brief rows="3" maxlength="4000" required placeholder="A todo manager that helps me focus on today’s tasks.">${example}</textarea>
      <div class="first-build-actions">
        <label class="first-destination" data-build-destination hidden>Send through <select data-build-target></select></label>
        <button class="btn primary" data-build-send disabled>Send to agent</button>
      </div>
      <p class="first-said" data-build-connection>Connect your agent to Markback to send your idea here.</p>
      <p class="first-said" data-build-said role="status" hidden></p>
      <a class="first-queue" href="/work.html" data-build-queue hidden>View the queue</a>
    </form>
    <form class="first-existing" data-first>
      <div class="first-or">Already have an app?</div>
      <div class="first-row"><input${id('Address')} data-first-address placeholder="http://localhost:3000" aria-label="Your app's address" autocomplete="off"><button class="btn"${id('Show')} data-first-show>Show it</button></div>
      <p class="first-said"${id('Said')} data-first-said hidden></p>
      <details class="first-connect" data-first-connect>
        <summary>Connect from your coding agent</summary>
        <p class="first-said">Run <b>/markback a recipe box for my family</b> in your agent to start a project, then ask it to turn on wake.</p>
        <div class="first-row"><code${id('Ask')} data-first-ask>/markback</code><button type="button" class="btn" data-first-copy>Copy</button></div>
      </details>
      ${sample ? '<div class="first-start-links"><button type="button" class="link" data-first-sample>Try the sample</button><button type="button" class="link" data-list>Open existing reviews</button></div>' : ''}
    </form>
  </div>`
}

function syncBuildForms() {
  for (const form of document.querySelectorAll('[data-build]')) {
    const target = form.querySelector('[data-build-target]')
    const previous = target.value
    const options = state.buildTargets
    setHtml(target, options.map(option => `<option value="${esc(option.slug)}">${esc(option.name)}</option>`).join(''))
    const chosen = options.find(option => option.slug === previous) ?? options.find(option => option.slug === state.appSlug) ?? options[0]
    if (chosen) target.value = chosen.slug
    form.querySelector('[data-build-destination]').hidden = options.length < 2
    form.querySelector('[data-build-connection]').textContent = chosen
      ? `Connected through ${chosen.name}. Your agent will send back the first screen here.`
      : 'Turn on Markback wake in your coding agent to send a request from here.'
    form.querySelector('[data-build-send]').disabled = !chosen || form.dataset.sending === 'yes'
    form.parentElement.querySelector('[data-first-connect]').hidden = !!chosen
    const reviews = form.parentElement.querySelector('[data-list]')
    if (reviews) reviews.hidden = !state.apps.length
  }
}

async function sendBuild(form) {
  if (form.dataset.sending === 'yes') return
  const brief = form.querySelector('[data-build-brief]')
  const target = form.querySelector('[data-build-target]').value
  const said = form.querySelector('[data-build-said]')
  const queue = form.querySelector('[data-build-queue]')
  const words = brief.value.trim()
  if (!target || !words) return
  const key = JSON.stringify([target, words])
  if (form.dataset.requestKey !== key) {
    form.dataset.requestKey = key
    form.dataset.requestId = crypto.randomUUID()
  }
  form.dataset.sending = 'yes'
  brief.readOnly = true
  said.hidden = false
  said.textContent = 'Sending your request…'
  queue.hidden = true
  syncBuildForms()
  try {
    const res = await fetch('/api/work/build', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target, brief: words, requestId: form.dataset.requestId }),
    })
    const got = await res.json()
    if (!res.ok) throw new Error(got.error)
    brief.value = ''
    delete form.dataset.requestKey
    said.textContent = 'Sent to your agent. The first screen will appear in Markback when it’s ready.'
    queue.hidden = false
    if (!form.isConnected || form.closest('#newModal')?.hidden) toast('Build request sent to your agent')
  } catch (error) {
    said.textContent = error.message || 'Couldn’t send your request. Try again.'
  } finally {
    delete form.dataset.sending
    brief.readOnly = false
    syncBuildForms()
  }
}
async function firstRun(form, path, body) {
  const said = form.querySelector('[data-first-said]')
  const show = form.querySelector('[data-first-show]')
  // A picture can take most of a minute. The window may be closed by then, and the person busy on another screen.
  const watching = form.closest('#newModal') ? newWindow : null
  const late = () => (watching ? !watching.open : !form.isConnected)
  said.hidden = false
  if (watching && path === '/api/show') newCapture = body.url
  said.textContent = path !== '/api/show' ? '' : watching ? capturingWords() : 'Taking a picture…'
  show.disabled = true
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const got = await res.json()
    if (!res.ok) throw new Error(got.error)
    // The server says when the address was a project already: the window is called New project, so say it was not new.
    const again = got.existed ? `That address is already the project ${got.name}. This made round ${got.round} of it.` : ''
    if (late()) {
      // Too late to move the page: it may be on another screen, with words half written. Only say so, with a way there.
      await loadQueue()
      const input = form.querySelector('[data-first-address]')
      if (watching && !newProjectOpen() && input?.value === body.url) setHtml($('newBody'), '')
      return void toast(again || `New: ${got.name ?? got.appSlug}`, '', { go: got.appSlug })
    }
    if (watching) {
      setHtml($('newBody'), '')
      closeNewProject()
    }
    await loadQueue()
    if (state.apps.some(a => a.slug === got.appSlug)) {
      pickApp(got.appSlug)
      if (state.apps.length > 1) toast(again || `Now: ${placeWords(placeOf(app()))}`)
    }
  } catch (error) {
    if (late()) return void toast('No new project was made', error.message, { problem: true })
    said.textContent = error.message
    show.disabled = false
  } finally {
    if (watching) {
      newCapture = ''
      // A window opened again while it ran kept Show it off. The notice says how it ended; the window can start the next.
      if (late() && newProjectOpen()) {
        said.hidden = true
        show.disabled = false
      }
    }
  }
}
for (const holder of [$('stateCard'), $('newModal')]) {
  holder.addEventListener('submit', event => {
    event.preventDefault()
    // A box still holds words: no new project starts, by Enter or by a press, until they are sent or cancelled.
    if (wordsFirst()) return
    if (event.target.matches('[data-build]')) return void sendBuild(event.target)
    const input = event.target.querySelector('[data-first-address]')
    if (input) void firstRun(event.target, '/api/show', { url: input.value || input.placeholder })
  })
  holder.addEventListener('click', event => {
    const form = event.target.closest('[data-first]')
    if (event.target.closest('[data-first-sample]')) void firstRun(form, '/api/sample', {})
    if (event.target.closest('[data-first-copy]')) {
      void navigator.clipboard?.writeText(form.querySelector('[data-first-ask]').textContent)
      event.target.textContent = 'Copied'
    }
  })
}
/* New project, from the menu: the first screen's two ways in, over the page, with the projects there left as they are. */
const newProjectOpen = () => !$('newModal').hidden
/** A window over the page: while one is up, nothing behind it may change. */
const otherWindowUp = () => newProjectOpen() || sheetOpen() || filmOpen() || phoneOpen() || ['helpModal', 'confirmModal', 'submitModal', 'viewer'].some(id => !$(id).hidden)
const windowUp = () => correctionOpen() || otherWindowUp()
/** A box is open: what would open over it waits until its words are sent or cancelled, and says so. */
function wordsFirst() {
  if (!correctionOpen()) return false
  closeMenu()
  toast('Send or cancel your words first', 'They are in the open box')
  openCard()?.querySelector('[data-correct]')?.focus()
  return true
}
// One for each time the window is open: an answer that comes after it closed knows it is late.
let newWindow = { open: false }
// The address of a picture the window started that is still being taken. One at a time: a second press would make two rounds.
let newCapture = ''
const capturingWords = () => `Taking a picture of ${newCapture}… Closing this does not stop it: the new project is said when it is ready.`
function openNewProject() {
  if (wordsFirst()) return
  closeMenu()
  // With no project yet, the first screen is already this form.
  if (state.starting || !state.apps.length) return $('firstBrief')?.focus()
  closeTextEntry(true)
  closeDrawer()
  newWindow = { open: true }
  // A typed address stays from last time until a project is made from it. A picture still being taken goes on by itself.
  if (!$('newBody').querySelector('[data-first]')) setHtml($('newBody'), firstRunHtml({ sample: false }))
  const said = $('newBody').querySelector('[data-first-said]')
  said.hidden = !newCapture
  if (newCapture) said.textContent = capturingWords()
  $('newBody').querySelector('[data-first-show]').disabled = !!newCapture
  $('newModal').hidden = false
  for (const el of document.querySelectorAll('.bar, #workspace')) el.inert = true
  syncBuildForms()
  return $('newBody').querySelector(state.buildTargets.length ? '[data-build-brief]' : '[data-first-address]').focus()
}
function closeNewProject() {
  if (!newProjectOpen()) return
  newWindow.open = false
  $('newModal').hidden = true
  for (const el of document.querySelectorAll('.bar, #workspace')) el.inert = false
  $('menuOpen').focus()
}
$('newClose').onclick = () => closeNewProject()
// Only a press that starts and ends outside closes it: a drag out of the address box, or into it, is not a close.
// A click that starts and ends in different places goes to what holds both, the backdrop, so the release is checked too.
let pressedOutside = false
let releasedOutside = false
$('newModal').addEventListener('pointerdown', event => {
  pressedOutside = event.target === $('newModal')
})
$('newModal').addEventListener('pointerup', event => {
  releasedOutside = event.target === $('newModal')
})
$('newModal').addEventListener('click', event => event.target === $('newModal') && pressedOutside && releasedOutside && closeNewProject())
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

/* ---------- on a phone: Mark brings the tools out, and Hold to talk fills the notes ---------- */

function setMarking(on) {
  if (!on) closeTextEntry(true)
  state.marking = on
  document.body.classList.toggle('marking-on', on)
  $('markBtn').classList.toggle('on', on)
  $('markBtn').setAttribute('aria-pressed', String(on))
  if (state.fitted) fit()
}
$('markBtn').onclick = () => setMarking(!state.marking)
narrow.addEventListener('change', () => {
  phoneLook()
  render()
  if (state.fitted) fit()
})

/** Listening lasts as long as the finger is down. What is said goes to the notes. */
let holding = false
function letGo() {
  if (!holding) return
  holding = false
  removeEventListener('pointerup', letGo)
  removeEventListener('pointercancel', letGo)
  if (mic.listener?.on) mic.listener.stop()
}
$('talkBtn').addEventListener('pointerdown', async event => {
  if (event.button !== 0 || holding) return
  event.preventDefault()
  holding = true
  // Heard on the window, not the button: the finger may slide off it before it lifts.
  addEventListener('pointerup', letGo)
  addEventListener('pointercancel', letGo)
  endPin()
  if (!mic.route) return
  // A question may come first, about where the sound goes. If the finger has lifted by the answer, nothing listens.
  const stillHeld = () => holding
  if ((await startMic()) && !stillHeld() && mic.listener?.on) mic.listener.stop()
})
// A long press must not bring up the system's own menu over the button.
$('talkBtn').addEventListener('contextmenu', event => event.preventDefault())
// From a keyboard there is nothing to hold: a press turns it on, and the next turns it off.
$('talkBtn').addEventListener('click', event => {
  if (event.detail === 0) void pressMic()
})

/* ---------- review from a phone: off until it is turned on here, and it says what it opens ---------- */

const phone = { status: { on: false, minutes: 30 }, problem: '', busy: false }
function setPhone(status) {
  if (!status || JSON.stringify(status) === JSON.stringify(phone.status)) return
  phone.status = status
  renderPhone()
}
const phoneOpen = () => !$('phoneModal').hidden
function renderPhone() {
  const st = phone.status
  $('phoneOn').hidden = !st.on
  $('phoneOn').innerHTML = `${ICONS.phone}<span>Open to your phone</span>`
  $('phoneOn').dataset.tip = st.stuck ? 'Still open in Tailscale: press to see why' : st.on ? `Open to your phone until ${when(st.until)}. Press to see the code, or to turn it off` : ''
  if (!phoneOpen()) return
  const promise = `<p><b>Only your own devices can reach this</b>, signed in to Tailscale as you. Nothing is open to the internet.</p>`
  if (st.stuck) {
    // Shown as open until Tailscale has really stopped serving it, with the one command that does it by hand.
    setHtml($('phoneBody'), `<div class="phone-words"><p><b>Still open in Tailscale.</b> The page no longer answers there, but Tailscale still serves the address.</p><p class="phone-problem" role="alert">${esc(st.problem)}</p></div>`)
    setHtml($('phoneActions'), `<button class="btn" data-phone="close">Close</button><button class="btn primary" data-phone="off"${phone.busy ? ' disabled' : ''}>Try again</button>`)
  } else if (st.on) {
    const code = qrSvg(st.url)
    // An address too long for the code is shown large, to type.
    setHtml($('phoneBody'), `${code ? `<div class="phone-code">${code}</div>` : ''}<div class="phone-words"><p><b>On until ${esc(when(st.until))}.</b> Scan the code with your phone's camera. The first time, it can take half a minute to open.</p>${promise}<p class="phone-address${code ? '' : ' large'}"><a href="${esc(st.url)}">${esc(st.url)}</a></p></div>`)
    setHtml($('phoneActions'), `<button class="btn" data-phone="close">Close</button><button class="btn primary" data-phone="off"${phone.busy ? ' disabled' : ''}>Turn it off</button>`)
  } else {
    setHtml($('phoneBody'), `<div class="phone-words"><p>Mark the screens from your phone, over Tailscale, your own private network. It needs Tailscale on this computer and on your phone, signed in as the same person.</p>${promise}<p>It turns itself off after ${st.minutes ?? 30} minutes, and when Markback stops.</p>${phone.problem ? `<p class="phone-problem" role="alert">${esc(phone.problem)}</p>` : ''}</div>`)
    setHtml($('phoneActions'), `<button class="btn" data-phone="close">Not now</button><button class="btn primary" data-phone="on"${phone.busy ? ' disabled' : ''}>${phone.busy ? 'Turning it on…' : 'Turn it on'}</button>`)
  }
}
function openPhone() {
  closeMenu()
  phone.problem = ''
  $('phoneModal').hidden = false
  renderPhone()
  $('phoneActions').querySelector('button:last-child')?.focus()
}
const closePhone = () => {
  $('phoneModal').hidden = true
}
async function switchPhone(on) {
  phone.busy = true
  phone.problem = ''
  renderPhone()
  try {
    const res = await fetch('/api/phone', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on }) })
    const got = await res.json()
    if (!res.ok) throw new Error(got.error ?? 'It could not be changed.')
    phone.status = got
  } catch (error) {
    phone.problem = error.message
  }
  phone.busy = false
  renderPhone()
  $('phoneActions').querySelector('button:last-child')?.focus()
}
$('phoneActions').onclick = event => {
  const what = event.target.closest('[data-phone]')?.dataset.phone
  if (what === 'close') closePhone()
  else if (what) void switchPhone(what === 'on')
}
$('phoneClose').onclick = closePhone
$('phoneOn').onclick = openPhone
$('phoneModal').onclick = event => event.target === $('phoneModal') && closePhone()
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
$('zoomValue').onclick = fitAgain
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
  paint()
  if (before !== verdictOf(s)) refreshLists()
})
$('scroller').addEventListener('wheel', event => {
  if (!event.ctrlKey && !event.metaKey) return
  event.preventDefault()
  zoomBy(event.deltaY < 0 ? ZOOM_WHEEL_STEP : 1 / ZOOM_WHEEL_STEP)
}, { passive: false })
new ResizeObserver(() => state.fitted && fit()).observe($('scroller'))

document.addEventListener('keydown', event => {
  if (trapLostBox(event)) return
  if (boxHoldsKeys(event)) return
  const typing = isTextField(event.target)
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
  if (phoneOpen()) {
    if (key === 'Escape') closePhone()
    return
  }
  if (newProjectOpen()) {
    if (key === 'Escape') closeNewProject()
    return
  }
  if (!$('helpModal').hidden) {
    if (key === 'Escape' || key === '?') showHelp(false)
    return
  }
  if (sheetOpen()) {
    if (key === 'Escape' || ((key === 'o' || key === 'O') && !mod)) closeSheet()
    return
  }
  // While the film loads, no key reaches the screen behind it either. Esc gives up waiting.
  if (film.loading) {
    if (!mod) event.preventDefault()
    if (key === 'Escape') cancelFilm()
    return
  }
  // The film takes every key while it is up: none reaches the screen behind it.
  if (filmOpen()) {
    if (key === 'Escape' || ((key === 'r' || key === 'R') && !mod)) closeFilm()
    else if (key === 'ArrowLeft' || key === 'ArrowRight') {
      event.preventDefault()
      stepFilm(key === 'ArrowLeft' ? -1 : 1)
    } else if (key === ' ' && !event.repeat) {
      // Space plays and pauses wherever the focus is: it is never a press of the round or the button that has it.
      event.preventDefault()
      playFilm()
    }
    return
  }
  // Typing: the keys are the words. Only Esc, and cmd-Enter to send, are the page's.
  if (typing && key !== 'Escape' && !(mod && key === 'Enter')) return
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
    if (pin.active) return endPin()
    if (draft) {
      draft = null
      return paint()
    }
    if (typing) return event.target.blur()
    return undefined
  }
  if (mod && key.toLowerCase() === 'z') {
    event.preventDefault()
    return event.shiftKey ? redo() : undo()
  }
  if (mod || event.altKey) return
  if (drawerOpen() && key !== 'l' && key !== 'L' && key !== '\\') return
  if (key === 'Enter' && state.stopped && event.target.tagName !== 'BUTTON') return goOn()
  // On a lineup, its letters choose: they come before the tools and the other keys that share them.
  const lineup = !onDonePage() && $('menu').hidden ? screen()?.choice : null
  if (lineup && !event.repeat && lineup.options.some(o => o.key === key.toUpperCase())) return choose(key.toUpperCase())
  if ((key === 's' || key === 'S') && screen() && !onDonePage()) return stopHere()
  if (key === 'ArrowLeft') go(state.index - 1)
  else if (key === 'ArrowRight') go(state.index + 1)
  else if (key === '[') stepApp(-1)
  else if (key === ']') stepApp(1)
  else if (key === '?') showHelp(true)
  else if (key === 'l' || key === 'L' || key === '\\') openDrawer()
  else if (key === 'o' || key === 'O') openSheet()
  else if (key === 'q' || key === 'Q') togglePanels()
  else if (key === 'w' || key === 'W') location.href = '/work.html'
  else if (key === 'f' || key === 'F') toggleFull()
  else if (key === '+' || key === '=') zoomBy(ZOOM_STEP)
  else if (key === '-' || key === '_' || key === '−') zoomBy(1 / ZOOM_STEP)
  else if (key === '0') fitAgain()
  else if (key === 'u' || key === 'U') undoAnswer()
  else if (!screen() || onDonePage()) return
  else if (key === 'g' || key === 'G') void looksGood(true)
  else if (key === 'n' || key === 'N') {
    event.preventDefault()
    $('notes').focus()
  } else if (key === 'v' || key === 'V') cycleView()
  else if ((key === 'c' || key === 'C') && !event.repeat) toggleChanges()
  else if ((key === 'd' || key === 'D') && event.shiftKey) pressMic()
  else if ((key === 'i' || key === 'I') && !event.repeat) toggleMore()
  else if ((key === 'k' || key === 'K') && !event.repeat) toggleAsked()
  else if ((key === 'r' || key === 'R') && !event.repeat) void openFilm()
  else if (/^[1-4]$/.test(key)) setColour(COLOURS[Number(key) - 1].value)
  else {
    const tool = { b: 'box', a: 'arrow', p: 'pen', t: 'text', m: 'pan', e: 'words', d: 'speak' }[key.toLowerCase()]
    // Where the words tool is not shown, E does nothing: there is no list, and no way to make one here.
    if (tool && !(tool === 'words' && wordsWhy(screen()) === null)) setTool(tool)
  }
})

render()
await loadQueue().catch(() => {
  state.loaded = true
  document.body.classList.remove('loading')
  render()
})
setInterval(() => void loadQueue().catch(() => undefined), 3000)
