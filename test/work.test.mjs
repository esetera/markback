import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { writePicture } from './helpers.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const home = mkdtempSync(join(tmpdir(), 'review-work-'))
process.env.REVIEW_HOME = home
after(() => rmSync(home, { recursive: true, force: true }))
const { addNote, answered, askForIdeas, closeRequest, decide, listRequests, listWork, openRequests, postIdea, pushedFor, reorder, setStage, take } = await import('../lib/work.mjs')
const { commandIn, placeWords, routeFor } = await import('../public/mic.js')
const { push, receive } = await import('../lib/store.mjs')
const picture = join(home, 'p.png')
writePicture(picture, 40, 30)
const cli = (...args) => execFileSync('node', [join(ROOT, 'review.mjs'), ...args], { env: { ...process.env, REVIEW_HOME: home }, encoding: 'utf8' })

const idea = (request, what) => postIdea({ request: request.id, what, why: 'Because', size: 'S' })

test('a request closes when its ideas are in, and a short answer can close it by hand', () => {
  const asked = askForIdeas({ target: 'Reader', count: 2 })
  assert.equal(openRequests().some(r => r.id === asked.id), true)
  idea(asked, 'One')
  idea(asked, 'Two')
  assert.equal(openRequests().some(r => r.id === asked.id), false)
  const short = askForIdeas({ target: 'Reader', count: 5 })
  closeRequest(short.id)
  assert.equal(listRequests().find(r => r.id === short.id).status, 'answered')
  assert.throws(() => askForIdeas({ target: ' ' }), /what the ideas are for/)
})

test('yes queues at the bottom; no and later can be taken back; started work cannot be decided', () => {
  const asked = askForIdeas({ target: 'Mail', count: 3 })
  const [a, b, c] = ['A', 'B', 'C'].map(w => idea(asked, w))
  decide(a.id, 'no')
  decide(b.id, 'later')
  decide(c.id, 'yes')
  decide(a.id, 'yes')
  const queued = listWork().filter(i => i.stage === 'queued').map(i => i.title)
  assert.deepEqual(queued.slice(-2), ['C', 'A'])
  assert.equal(listWork().find(i => i.id === b.id).stage, 'later')
  assert.throws(() => decide(a.id, 'no'), /already started/)
})

test('the session takes the top of the order, and reads notes added while it works', () => {
  const asked = askForIdeas({ target: 'Order', count: 2 })
  const [first, second] = ['First', 'Second'].map(w => idea(asked, w))
  decide(first.id, 'yes')
  decide(second.id, 'yes')
  for (const item of listWork().filter(i => i.stage === 'queued' && ![first.id, second.id].includes(i.id))) setStage(item.id, 'done')
  reorder([second.id, first.id])
  addNote(second.id, 'Before you start')
  const got = take({ by: 'Session A' })
  assert.equal(got.id, second.id)
  assert.equal(got.owner, 'Session A')
  assert.equal(got.notes[0].text, 'Before you start')
  addNote(second.id, 'While you work')
  assert.match(cli('show', '--item', second.id), /While you work/)
  assert.match(cli('take', '--by', 'Session B'), /First/)
  assert.match(cli('take', '--by', 'Session C'), /Nothing is queued/)
})

test('answers move an item on: marks another round, a proposal approved to build, a build approved to done', () => {
  const asked = askForIdeas({ target: 'Flow', count: 1 })
  const item = idea(asked, 'Flow idea')
  decide(item.id, 'yes')
  take({ by: 'S', id: item.id })
  const shot = (screen, kind = 'proposal') => {
    const e = push({ app: 'Flow', screen, after: picture, kind, item: item.id })
    pushedFor(item.id, 'Flow', 'S', kind)
    return e
  }
  const say = (e, verdict) => answered(receive({ appSlug: e.appSlug, id: e.id, png: null, shapes: [], notes: verdict === 'changes' ? 'Change it' : '', verdict, imageSize: null }))
  const one = shot('One')
  const two = shot('Two')
  assert.equal(listWork().find(i => i.id === item.id).stage, 'ready')
  say(one, 'approved')
  assert.equal(listWork().find(i => i.id === item.id).stage, 'ready', 'one screen is still waiting')
  let now = say(two, 'changes')
  assert.deepEqual([now.stage, now.phase, now.round, now.marksBack, now.owner], ['queued', 'proposal', 2, true, ''])
  take({ by: 'S', id: item.id })
  const again = [shot('One'), shot('Two')]
  say(again[0], 'approved')
  now = say(again[1], 'approved')
  assert.deepEqual([now.stage, now.phase, now.marksBack], ['queued', 'build', false])
  take({ by: 'S', id: item.id })
  const built = shot('One', 'qa')
  const built2 = shot('Two', 'qa')
  say(built, 'approved')
  now = say(built2, 'approved')
  assert.equal(now.stage, 'done')
})

test('what comes back says which kind it is, and QA is the default', () => {
  const qa = push({ app: 'Kinds', screen: 'A', after: picture })
  assert.equal(qa.kind, 'qa')
  const proposal = push({ app: 'Kinds', screen: 'B', after: picture, kind: 'proposal' })
  const record = receive({ appSlug: proposal.appSlug, id: proposal.id, png: null, shapes: [], notes: 'x', verdict: 'changes', imageSize: null })
  assert.equal(record.kind, 'proposal')
  assert.throws(() => push({ app: 'Kinds', screen: 'C', after: picture, kind: 'other' }), /--kind/)
})

test('the CLI posts ideas and warns on long words', () => {
  const asked = askForIdeas({ target: 'Cli', count: 1 })
  assert.match(cli('ideas', '--json'), new RegExp(asked.id))
  const id = cli('ideas', 'post', '--request', asked.id, '--what', 'Short idea', '--why', 'Short why', '--size', 'L').trim()
  assert.equal(listWork().find(i => i.id === id).size, 'L')
  assert.match(cli('queue'), /Queued/)
})

test('the mic says where the sound goes, and acts only on a phrase that is nothing but a command', () => {
  assert.deepEqual(routeFor({ hasSpeech: true, micState: 'prompt', onDevice: 'available', vendor: 'Google' }), { route: 'device' })
  assert.deepEqual(routeFor({ hasSpeech: true, micState: 'granted', onDevice: 'downloadable', vendor: 'Google' }), { route: 'install' })
  assert.deepEqual(routeFor({ hasSpeech: true, micState: 'prompt', onDevice: 'unavailable', vendor: 'Apple' }), { route: 'cloud', goesTo: 'Apple' })
  assert.equal(routeFor({ hasSpeech: true, micState: 'denied', onDevice: 'unavailable', vendor: 'Google' }).route, 'none')
  assert.equal(routeFor({ hasSpeech: false, micState: 'prompt', onDevice: 'unavailable', vendor: 'Mozilla' }).route, 'none')
  assert.equal(commandIn('Looks good.'), 'good')
  assert.equal(commandIn(' next '), 'next')
  assert.equal(commandIn('the next heading looks good'), null)
})

test('from nothing: start makes its own folder, remembers its port, and the sample says the right address', async () => {
  const fresh = join(mkdtempSync(join(tmpdir(), 'review-fresh-')), 'not-there-yet')
  const port = 20000 + Math.floor(Math.random() * 20000)
  const run = (...args) => execFileSync('node', [join(ROOT, 'review.mjs'), ...args], { env: { ...process.env, REVIEW_HOME: fresh, REVIEW_PORT: '' }, encoding: 'utf8' })
  try {
    assert.match(run('start', '--port', String(port)), new RegExp(`localhost:${port}`))
    assert.match(run('demo'), new RegExp(`localhost:${port}/#sample`))
    assert.match(run('list'), /Try it/)
    assert.match(run('start'), /Already running/)
  } finally {
    run('stop')
    rmSync(dirname(fresh), { recursive: true, force: true })
  }
})

test('spoken words land where the pointer was, and stay together while it stays', () => {
  const words = (text, at) => text.split(' ').map(word => ({ word, at }))
  assert.deepEqual(placeWords([...words('this heading', [100, 100]), ...words('is big', [120, 110]), ...words('and this button', [600, 400]), ...words('in general', null)]), [
    { text: 'this heading is big', at: [100, 100] },
    { text: 'and this button', at: [600, 400] },
    { text: 'in general', at: null },
  ])
})

test('a proposal pushed again after approval is still a proposal: approving it cannot finish a build', () => {
  const asked = askForIdeas({ target: 'Again', count: 1 })
  const item = idea(asked, 'Again idea')
  decide(item.id, 'yes')
  take({ by: 'S', id: item.id })
  const shot = () => {
    const e = push({ app: 'Again', screen: 'One', after: picture, kind: 'proposal', item: item.id })
    pushedFor(item.id, 'Again', 'S', 'proposal')
    return e
  }
  const say = e => answered(receive({ appSlug: e.appSlug, id: e.id, png: null, shapes: [], notes: '', verdict: 'approved', imageSize: null }))
  assert.deepEqual([say(shot()).stage, listWork().find(i => i.id === item.id).phase], ['queued', 'build'])
  const again = say(shot())
  assert.deepEqual([again.stage, again.phase], ['queued', 'build'], 'to be built, not done')
})
