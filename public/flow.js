/**
 * The wizard's decisions, with no page in them: what comes next after Looks good, what Submit all sends, and which answer
 * stands on a screen. Plain functions, so a test can run them without a browser.
 */

import { glanceOf } from './annotate.js'

/**
 * Where an answer goes, Looks good or Send: the next waiting screen with nothing on it, then from the top. With none of those
 * left, a screen that was waiting finishes the app (`done`): whatever is marked and not sent goes with it, so no last step is
 * needed. Answered again with all answered, it is simply the next screen, and it rests on the last.
 */
export function afterSend(screens, index, { wasWaiting, hasDraft }) {
  const open = i => i !== index && screens[i].status === 'waiting' && !hasDraft(screens[i])
  for (let i = index + 1; i < screens.length; i++) if (open(i)) return { to: i }
  for (let i = 0; i < index; i++) if (open(i)) return { to: i }
  if (wasWaiting || screens.some((s, i) => i !== index && s.status === 'waiting')) return { done: true }
  return index + 1 < screens.length ? { to: index + 1 } : { rest: true }
}

const CHECKS_SHOWN = 3

/**
 * What to look at: at a glance, with nothing to read first. The checks that were pushed, at most three, or the first sentence
 * of the note, a few words each. `rest` is all that was said, for a press, and empty when the lines already say it.
 */
export function lookOf(screen) {
  const pushed = Array.isArray(screen?.check) ? screen.check.map(line => String(line).trim()).filter(Boolean) : []
  const note = String(screen?.note ?? '').trim()
  if (pushed.length) {
    const lines = pushed.slice(0, CHECKS_SHOWN).map(line => glanceOf(line).line)
    const cut = pushed.length > CHECKS_SHOWN || pushed.some(line => glanceOf(line).more)
    return { lines, rest: note || cut ? [note, ...pushed].filter(Boolean).join('\n') : '' }
  }
  if (!note) return { lines: [], rest: '' }
  const { line, more } = glanceOf(note)
  return { lines: [line], rest: more ? note : '' }
}

/** "X-style: title" or "X: title" names a member of group X. */
export function nameParts(name) {
  const m = /^(.+?):\s+(.+)$/.exec(name)
  return m ? { group: m[1], title: m[2] } : { group: null, title: name }
}

/** Groups with more than one member, by name, each in a lasting order, so "2 of 5" stays 2. */
export function groupsIn(apps) {
  const groups = new Map()
  for (const a of apps) {
    const { group, title } = nameParts(a.name)
    if (!group) continue
    if (!groups.has(group)) groups.set(group, [])
    groups.get(group).push({ app: a, title })
  }
  for (const [group, members] of groups) {
    if (members.length < 2) groups.delete(group)
    else members.sort((x, y) => x.title.localeCompare(y.title))
  }
  return groups
}

/** Where an app sits: its group, its number there and its short name. Nothing of this changes what the store calls it. */
export function placeIn(app, apps) {
  const { group, title } = nameParts(app.name)
  const members = group ? groupsIn(apps).get(group) : null
  if (!members) return { group: null, title: app.name, n: 1, of: 1, noun: '', pages: 'screens' }
  return { group, title, n: members.findIndex(m => m.app.slug === app.slug) + 1, of: members.length, noun: '', pages: 'screens' }
}

/** The apps with each group's members together, in their order. */
export function orderedApps(apps) {
  const groups = groupsIn(apps)
  const seen = new Set()
  const out = []
  for (const a of apps) {
    if (seen.has(a.slug)) continue
    const members = groups.get(nameParts(a.name).group)?.map(m => m.app) ?? [a]
    for (const each of members) {
      seen.add(each.slug)
      out.push(each)
    }
  }
  return out
}

/** Where to go when an app is done: the next in that order with something to offer, then from the top. */
export function nextApp(ordered, slug, offered) {
  const at = ordered.findIndex(a => a.slug === slug)
  return [...ordered.slice(at + 1), ...ordered.slice(0, Math.max(at, 0))].find(a => a.slug !== slug && offered(a)) ?? null
}

/** "Alpha, 2 of 5", or the name alone outside a group. */
export const placeWords = place => (place.group ? `${place.group}, ${place.noun}${place.n} of ${place.of}` : place.title)

/** What has just been finished. */
export function finishedWords(place, screens, hasChanges) {
  const changes = screens.filter(hasChanges).length
  return `Finished: ${place.title}. ${screens.length} answered${changes ? `, ${changes} with changes` : ''}.`
}

/** What is next, in screens left. */
export function nextWords(place, open, total) {
  const pages = total === 1 ? place.pages.slice(0, -1) : place.pages
  return `${place.group ? `${place.title}, ` : ''}${open === total ? `${total} ${pages}` : `${open} of ${total} ${pages} left`}`
}

/** The one count: what is left here, then in all. Short for the bar. Said once when the two are the same. */
export function countWords(left, all, { short = false } = {}) {
  if (left === all) return `${all} left`
  return short ? `${left} left · ${all} in all` : `${left} left in this review · ${all} in all`
}

/** An app's name in the bar: without a "Proposal:" or "Built:" in front, which the label beside it already says. */
export const barName = name => String(name).replace(/^\s*(proposal|built|qa)\s*:\s*/i, '') || String(name)

/**
 * What Submit all sends: every screen in the set, with what its draft says. A screen with nothing on it goes as Looks good
 * with no comment, so the press leaves nothing waiting and the entry closes.
 */
export function submitJobs(set, verdictOf) {
  return set.map(s => {
    const verdict = verdictOf(s)
    return verdict ? { s, verdict, noComment: false } : { s, verdict: 'approved', noComment: true }
  })
}

/** The answer that stands on a screen this round, from its records, newest first. Null when none has been sent. */
export function standingAnswer(records, round) {
  return records?.find(r => r.round === round && !r.olderPicture) ?? null
}

/** An answer in a few words. */
export function answerWords(record) {
  if (record.verdict === 'approved') return record.noComment ? 'Looks good, no comment' : 'Looks good'
  return `Changes${record.marks ? `, ${record.marks} mark${record.marks === 1 ? '' : 's'}` : ''}`
}

/**
 * Marks or notes left on a screen in an older round and never sent: the screen has been pushed again since, so they cannot
 * go on it. `read` gives the draft kept for a round, or null. Newest first.
 */
export function leftBehind(round, read, isReal) {
  const out = []
  for (let r = round - 1; r >= 1; r--) {
    const draft = read(r)
    const marks = (draft?.marks ?? []).filter(isReal).length
    const notes = draft?.notes ?? ''
    // Earlier marks ticked and never sent are lost to the new round too: they are counted, so none goes unsaid.
    const ticks = Object.values(draft?.said ?? {}).filter(word => word === 'fixed' || word === 'stands').length
    if (marks || notes.trim() || ticks) out.push({ round: r, marks, notes, ticks })
  }
  return out
}

/* ---------- marks become checks: what was asked for last time, at its place on the new picture ---------- */

const ASK_WORDS = 8
const cutWords = text => {
  const words = String(text).trim().split(/\s+/)
  return words.length > ASK_WORDS ? `${words.slice(0, ASK_WORDS).join(' ')}…` : words.join(' ')
}
const ASK_NAMES = { box: ['Box round', 'A box here'], arrow: ['Arrow at', 'An arrow here'], freehand: ['Drawn over', 'A line drawn here'], words: ['', 'Words chosen here'], text: ['', 'Words written here'], pin: ['Said:', 'Said here'], notes: ['Notes:', 'Notes'] }

/** An earlier mark in a few words: what was written or said there, or the words under it, or else only what it was. */
export function askWords(ask) {
  const [lead, bare] = ASK_NAMES[ask.type] ?? ['Mark at', 'A mark here']
  const said = ask.text || ask.words
  if (!said) return bare
  // Written or chosen words say it all. A box or an arrow is round the words under it, and a pin or notes say who said it.
  return lead ? `${lead} “${cutWords(said)}”` : `“${cutWords(said)}”`
}

/**
 * An earlier mark's place on the picture now, or null. Notes have none. On a picture of the same width that only grew or shrank
 * in height, a page that got longer say, the place stays in pixels from the top. One shrunk or grown as a whole is scaled.
 * Any other change of shape means the place cannot be trusted: null, and the page says its place may have moved.
 */
export function placeOn(ask, size) {
  const box = ask?.box
  if (!box || !size) return null
  const from = ask.size?.w && ask.size?.h ? ask.size : size
  if (from.w === size.w) return box.y < size.h ? { ...box, h: Math.min(box.h, size.h - box.y) } : null
  const sx = size.w / from.w
  const sy = size.h / from.h
  if (Math.abs(sx - sy) > 0.02 * Math.max(sx, sy)) return null
  return { x: box.x * sx, y: box.y * sx, w: box.w * sx, h: box.h * sx }
}

const overlaps = (a, b) => !!a && !!b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/**
 * A screen's earlier marks, as the page shows them. `open`: asked for and not yet ticked fixed in an answer. `back`: ticked
 * fixed before, and the picture changed there again, so it may have come back. `held`: the other fixed ones, kept quietly.
 * `changed` is where the picture differs from its before, in the picture's pixels.
 */
export function askedOf(screen, changed = null, size = null) {
  const all = Array.isArray(screen?.asked) ? screen.asked : []
  const open = all.filter(a => a.state !== 'fixed')
  const fixed = all.filter(a => a.state === 'fixed')
  const back = fixed.filter(a => (changed ?? []).some(box => overlaps(placeOn(a, size), box)))
  return { open, back, held: fixed.filter(a => !back.includes(a)), rows: [...open, ...back] }
}

/** The bar's few words for them: what is left to tick, or that all are. Empty with nothing to show. */
export function askedCount({ open, back }, said) {
  const left = list => list.filter(a => !said[a.n]).length
  const parts = [left(open) ? `${left(open)} to check` : '', left(back) ? `${left(back)} came back?` : ''].filter(Boolean)
  if (parts.length) return { words: parts.join(', '), done: false }
  return open.length + back.length ? { words: `${open.length + back.length} checked`, done: true } : { words: '', done: true }
}
