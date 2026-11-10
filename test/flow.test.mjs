import assert from 'node:assert/strict'
import { test } from 'node:test'
import { afterSend, answerWords, askedCount, askedOf, askWords, barName, countWords, finishedWords, groupsIn, leftBehind, lookOf, nameParts, nextApp, nextWords, orderedApps, placeIn, placeOn, placeWords, standingAnswer, submitJobs } from '../public/flow.js'

const screen = (id, status = 'waiting') => ({ id, status })
const none = () => false

test('Submit all answers every screen: nothing stays waiting', () => {
  const set = [screen('marked'), screen('good'), screen('nothing')]
  const verdicts = { marked: 'changes', good: 'approved', nothing: null }
  assert.deepEqual(submitJobs(set, s => verdicts[s.id]).map(j => [j.s.id, j.verdict, j.noComment]), [
    ['marked', 'changes', false],
    ['good', 'approved', false],
    ['nothing', 'approved', true],
  ])
})

test('the answer that stands is the newest of this round, and an older round has none on a new picture', () => {
  const records = [{ round: 2, verdict: 'approved' }, { round: 2, verdict: 'changes' }, { round: 1, verdict: 'changes' }]
  assert.equal(standingAnswer(records, 2), records[0])
  assert.equal(standingAnswer(records, 3), null)
  assert.equal(standingAnswer(undefined, 1), null)
})

test('an answer in a few words', () => {
  assert.equal(answerWords({ verdict: 'approved' }), 'Looks good')
  assert.equal(answerWords({ verdict: 'approved', noComment: true }), 'Looks good, no comment')
  assert.equal(answerWords({ verdict: 'changes', marks: 0 }), 'Changes')
  assert.equal(answerWords({ verdict: 'changes', marks: 1 }), 'Changes, 1 mark')
  assert.equal(answerWords({ verdict: 'changes', marks: 3 }), 'Changes, 3 marks')
})

test('what was left unsent in an older round is found, newest first, and only what says something', () => {
  const real = m => m.real
  const kept = { 1: { marks: [{ real: true }], notes: '' }, 2: { marks: [{ real: false }], notes: 'Words' }, 3: { marks: [], notes: '  ', good: true } }
  assert.deepEqual(leftBehind(5, r => kept[r] ?? null, real), [{ round: 2, marks: 0, notes: 'Words' }, { round: 1, marks: 1, notes: '' }])
  assert.deepEqual(leftBehind(1, () => { throw new Error('not asked') }, real), [])
})

const after = (statuses, index, wasWaiting, { drafts = [] } = {}) =>
  afterSend(statuses.map((status, i) => screen(String(i), status)), index, { wasWaiting, hasDraft: s => drafts.includes(Number(s.id)) })

test('an answer goes to the next waiting screen, then from the top', () => {
  assert.deepEqual(after(['sent', 'waiting', 'waiting'], 0, true), { to: 1 })
  assert.deepEqual(after(['waiting', 'approved', 'sent'], 2, true), { to: 0 })
})

test('it passes over what has been answered and not yet gone', () => {
  assert.deepEqual(after(['waiting', 'waiting', 'waiting', 'sent'], 3, true, { drafts: [0] }), { to: 1 })
})

test('only an answer that leaves nothing without one finishes the app', () => {
  assert.deepEqual(after(['approved', 'sent', 'approved'], 2, true), { done: true })
  assert.deepEqual(after(['waiting', 'waiting', 'sent'], 2, true, { drafts: [0, 1] }), { done: true }, 'marked and not sent goes with it')
  assert.deepEqual(after(['waiting', 'sent', 'waiting'], 1, false, { drafts: [0, 2] }), { done: true })
})

test('answered again with all answered, it is the next screen, and rests on the last', () => {
  assert.deepEqual(after(['sent', 'approved', 'approved', 'sent'], 0, false), { to: 1 })
  assert.deepEqual(after(['approved', 'approved', 'approved'], 1, false), { to: 2 })
  assert.deepEqual(after(['approved', 'sent'], 1, false), { rest: true })
})

test('what was finished, in a line', () => {
  const screens = [screen('a', 'sent'), screen('b', 'approved'), screen('c', 'sent')]
  assert.equal(finishedWords({ title: 'Brochure' }, screens, s => s.status === 'sent'), 'Finished: Brochure. 3 answered, 2 with changes.')
  assert.equal(finishedWords({ title: 'Brochure' }, [screen('a', 'approved')], s => s.status === 'sent'), 'Finished: Brochure. 1 answered.')
})

const named = (...names) => names.map(name => ({ name, slug: name.toLowerCase().replace(/[^a-z]+/g, '-') }))

test('a name with a shared front makes a group, only with more than one, and the store name stays as it is', () => {
  assert.deepEqual(nameParts('Alpha-style: Notes: on method'), { group: 'Alpha-style', title: 'Notes: on method' })
  assert.deepEqual(nameParts('Brochure'), { group: null, title: 'Brochure' })
  const apps = named('X-style: Beta', 'Lone: only', 'X-style: Alpha', 'Plain')
  assert.deepEqual([...groupsIn(apps).keys()], ['X-style'])
  assert.deepEqual(groupsIn(apps).get('X-style').map(m => m.title), ['Alpha', 'Beta'], 'a lasting order')
  assert.deepEqual(placeIn(apps[0], apps), { group: 'X-style', title: 'Beta', n: 2, of: 2, noun: '', pages: 'screens' })
  assert.equal(placeIn(apps[1], apps).group, null, 'alone, it is not a group')
  assert.equal(placeIn(apps[1], apps).title, 'Lone: only')
  assert.equal(placeWords(placeIn(apps[0], apps)), 'X-style, 2 of 2')
  assert.equal(placeWords(placeIn(apps[3], apps)), 'Plain')
  assert.deepEqual(orderedApps(apps).map(a => a.name), ['X-style: Alpha', 'X-style: Beta', 'Lone: only', 'Plain'], 'kept together')
})

test('what is next, in screens left', () => {
  const place = { group: 'X-style', title: 'Beta', pages: 'screens' }
  assert.equal(nextWords(place, 8, 8), 'Beta, 8 screens')
  assert.equal(nextWords(place, 3, 8), 'Beta, 3 of 8 screens left')
  assert.equal(nextWords({ group: null, title: 'Plain', pages: 'screens' }, 3, 3), '3 screens')
  assert.equal(countWords(21, 63), '21 left in this review · 63 in all')
  assert.equal(countWords(21, 63, { short: true }), '21 left · 63 in all')
  assert.equal(countWords(5, 5), '5 left')
  assert.equal(barName('Proposal: First mark in 60 seconds'), 'First mark in 60 seconds')
  assert.equal(barName('Built: Point and speak'), 'Point and speak')
  assert.equal(barName('Shop front office'), 'Shop front office')
  assert.equal(barName('Proposal:'), 'Proposal:')
})

test('what to check: as pushed, or the note, one a sentence', () => {
  assert.deepEqual(lookOf({ check: ['A', 'B'] }), { lines: ['A', 'B'], rest: '' })
  assert.deepEqual(lookOf({ check: ['A', 'B'], note: 'Why. Yes.' }), { lines: ['A', 'B'], rest: 'Why. Yes.\nA\nB' })
  assert.deepEqual(lookOf({ check: ['A', 'B', 'C', 'D'] }).lines, ['A', 'B', 'C'], 'three at most')
  assert.equal(lookOf({ check: ['A', 'B', 'C', 'D'] }).rest, 'A\nB\nC\nD', 'the fourth is a press away')
  assert.deepEqual(lookOf({ note: 'One whole thing. Another! Version 2.1 stays whole.' }), { lines: ['One whole thing.'], rest: 'One whole thing. Another! Version 2.1 stays whole.' })
  assert.deepEqual(lookOf({ note: 'One thing.' }), { lines: ['One thing.'], rest: '' })
  assert.deepEqual(lookOf({ note: '' }), { lines: [], rest: '' })
  assert.deepEqual(lookOf({}), { lines: [], rest: '' })
})

test('the next app is the next with something waiting, then from the top, and never this one', () => {
  const apps = [{ slug: 'a', n: 1 }, { slug: 'b', n: 0 }, { slug: 'c', n: 2 }, { slug: 'd', n: 0 }]
  const waiting = a => a.n > 0
  assert.equal(nextApp(apps, 'a', waiting).slug, 'c')
  assert.equal(nextApp(apps, 'c', waiting).slug, 'a')
  assert.equal(nextApp([{ slug: 'a', n: 1 }], 'a', waiting), null)
})

test('an earlier mark in a few words: what was written or said, the words under it, or what it was', () => {
  assert.equal(askWords({ type: 'text', text: 'Make this bigger' }), '“Make this bigger”')
  assert.equal(askWords({ type: 'box', words: 'Book a plot' }), 'Box round “Book a plot”')
  assert.equal(askWords({ type: 'arrow', words: 'Saturday' }), 'Arrow at “Saturday”')
  assert.equal(askWords({ type: 'pin', text: 'one two three four five six seven eight nine ten' }), 'Said: “one two three four five six seven eight…”')
  assert.equal(askWords({ type: 'notes', text: 'Bigger' }), 'Notes: “Bigger”')
  assert.equal(askWords({ type: 'box' }), 'A box here')
  assert.equal(askWords({ type: 'freehand' }), 'A line drawn here')
})

test('an earlier mark is fitted to a picture of another size, and notes have no place', () => {
  assert.deepEqual(placeOn({ box: { x: 10, y: 20, w: 30, h: 40 }, size: { w: 100, h: 100 } }, { w: 200, h: 50 }), { x: 20, y: 10, w: 60, h: 20 })
  assert.deepEqual(placeOn({ box: { x: 1, y: 2, w: 3, h: 4 } }, { w: 9, h: 9 }), { x: 1, y: 2, w: 3, h: 4 }, 'with no size, as drawn')
  assert.equal(placeOn({ type: 'notes', text: 'x' }, { w: 9, h: 9 }), null)
})

test('earlier marks: open ones to tick, and a fixed one where the picture changed again may have come back', () => {
  const size = { w: 100, h: 100 }
  const screen = { asked: [
    { n: 1, state: 'open', box: { x: 0, y: 0, w: 10, h: 10 } },
    { n: 2, state: 'fixed', box: { x: 50, y: 50, w: 10, h: 10 } },
    { n: 3, state: 'fixed', box: { x: 80, y: 80, w: 10, h: 10 } },
  ] }
  const quiet = askedOf(screen, null, size)
  assert.deepEqual([quiet.open, quiet.back, quiet.held].map(list => list.map(a => a.n)), [[1], [], [2, 3]])
  const changed = askedOf(screen, [{ x: 55, y: 55, w: 20, h: 2 }], size)
  assert.deepEqual([changed.rows, changed.held].map(list => list.map(a => a.n)), [[1, 2], [3]])
  assert.deepEqual(askedOf({}, null, size).rows, [])
  assert.deepEqual(askedCount(changed, {}), { words: '1 to check, 1 came back?', done: false })
  assert.deepEqual(askedCount(changed, { 1: 'fixed' }), { words: '1 came back?', done: false })
  assert.deepEqual(askedCount(changed, { 1: 'fixed', 2: 'fixed' }), { words: '2 checked', done: true })
  assert.deepEqual(askedCount(quiet, {}), { words: '1 to check', done: false })
  assert.deepEqual(askedCount(askedOf({}), {}), { words: '', done: true })
})
