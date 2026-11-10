/**
 * The film of one screen: its story from the first picture to the last. Each round's picture, then that picture as the person
 * marked it, then the next round's picture, and so on to the newest. It is made from files the store already keeps, and keeps
 * nothing of its own: every push leaves its picture under a new name, and every answer with marks leaves the marked picture.
 *
 *   <home>/images/<app>/<screen>-after-<time>.<ext>   one for each push of the screen
 *   <home>/queue/<app>/<screen>.json   lists this review's pictures with their rounds, and its answers
 *   <home>/inbox/<app>/<screen>-<time>.{png,json}   the marked picture, and which picture it was drawn on (afterImage)
 *
 * What cannot be shown: marks that were drawn and never sent (they stay in the browser), and notes, which are words and not in
 * a picture.
 */

import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { promisify } from 'node:util'
import { IMAGES, listScreens, readInbox, screenId, slug } from './store.mjs'
import { pictureSize } from './words.mjs'

const run = promisify(execFile)

/** How long each step stays, in seconds: a round's picture, the same picture as marked, and the last step of all. */
export const STEP_SECONDS = { picture: 1, marked: 1.5, last: 2 }
/** The biggest a saved film is. A bigger picture is made smaller to fit. */
const BIGGEST = { w: 1920, h: 1920 }
/** The most steps a saved film holds. Each is a picture ffmpeg holds open, so a long story is saved as its newest rounds. */
export const MOST_STEPS = 40

/**
 * One screen's film, or null when no such screen is queued. `rounds` has one entry for each round that still has its picture,
 * oldest first. `steps` is what plays: every round's picture, then each marked copy of it, in the order they were sent.
 */
export function filmOf(app, id) {
  const appSlug = slug(app)
  const entry = listScreens(appSlug).find(s => s.id === id)
  if (!entry) return null
  const dir = join(IMAGES, appSlug)
  // Only this review's answers. The queue lists them, and a clear starts that list again: an answer from before it is not here.
  const ours = new Set((entry.feedback ?? []).map(file => basename(file)))
  const answers = readInbox(appSlug).filter(r => r.screenId === entry.id && ours.has(basename(r.file)))
  // Each picture of this review with its true round, from what was stored, never from where it stands in the folder. The push
  // keeps the list. A screen pushed before it kept one has its answers, which say the picture and the round they were given on.
  const roundOf = new Map()
  for (const r of answers) if (r.afterImage && Number.isInteger(r.round)) roundOf.set(basename(r.afterImage), r.round)
  for (const p of Array.isArray(entry.pictures) ? entry.pictures : []) if (p?.after && Number.isInteger(p.round)) roundOf.set(basename(p.after), p.round)
  roundOf.set(basename(entry.after), entry.round)
  const pictures = [...roundOf].filter(([file]) => existsSync(join(dir, file))).sort((a, b) => a[1] - b[1])
  const rounds = pictures.map(([file, round]) => {
    const said = answers.filter(r => basename(r.afterImage ?? '') === file)
    const last = said.at(-1)
    return {
      round,
      picture: join(dir, file),
      // Notes alone make a marked copy with nothing drawn on it: that is the same picture again, so it is no step.
      marked: said.filter(r => r.annotatedImage && r.shapes?.length && existsSync(r.annotatedImage)).map(r => r.annotatedImage),
      answer: last ? { verdict: last.verdict, notes: last.notes ?? '', marks: Array.isArray(last.shapes) ? last.shapes.length : 0, noComment: last.noComment === true } : null,
    }
  })
  const steps = rounds.flatMap((r, at) => [{ at, file: r.picture, marked: false, seconds: STEP_SECONDS.picture }, ...r.marked.map(file => ({ at, file, marked: true, seconds: STEP_SECONDS.marked }))])
  if (steps.length) steps.at(-1).seconds = STEP_SECONDS.last
  return {
    app: entry.app,
    appSlug,
    id: entry.id,
    screen: entry.screen,
    mode: entry.mode,
    // The newest round was said to look good: the film ends on the finished screen.
    finished: entry.status === 'approved',
    // Rounds whose picture is no longer in the folder. They cannot be shown.
    missing: Math.max(0, entry.round - rounds.length),
    rounds,
    steps,
    seconds: steps.reduce((sum, step) => sum + step.seconds, 0),
  }
}

/**
 * What a saved film holds: the newest rounds whose steps fit in MOST_STEPS, and how many older rounds are left out of it. The
 * page plays them all. `why` says why it cannot be saved at all, or is empty.
 */
export function savedPart(film) {
  let from = film.rounds.length
  let count = 0
  while (from > 0) {
    const more = 1 + film.rounds[from - 1].marked.length
    // The newest round goes in however many marks it has: a film is never empty.
    if (count && count + more > MOST_STEPS) break
    count += more
    from--
  }
  const steps = film.steps.filter(step => step.at >= from)
  // ffmpeg reads pictures, not drawings: a sketch is an SVG, and making it a picture would need more than Markback has.
  const why = steps.some(step => extname(step.file).toLowerCase() === '.svg') ? 'A film of a sketch cannot be saved as a file. It still plays in the review page.' : ''
  return { steps, rounds: film.rounds.length - from, leftOut: from, seconds: steps.reduce((sum, step) => sum + step.seconds, 0), why }
}

/** The plain line that says a saved film left its oldest rounds out. Empty when it holds them all. */
export const leftOutLine = part => (part.leftOut ? `The oldest ${part.leftOut} round${part.leftOut === 1 ? ' is' : 's are'} left out of the file: it holds the newest ${part.rounds}. The review page plays them all.` : '')

/** The screen someone named on the command line: its id, or a line that says what to say instead. */
export function filmScreen(app, screen, mode = '') {
  const screens = listScreens(slug(app))
  if (!screens.length) throw new Error(`No review called ${app}. See what is queued with: review list`)
  const id = screenId(screen, mode)
  if (screens.some(s => s.id === id)) return id
  // Light and dark are separate screens, each with a film of its own.
  const named = screens.filter(s => !mode && slug(s.screen) === slug(screen))
  if (named.length === 1) return named[0].id
  if (named.length > 1) throw new Error(`${screen} has ${named.length} modes. Say which: --mode ${named.map(s => s.mode).join(' or --mode ')}`)
  throw new Error(`No screen called ${screen}${mode ? ` (${mode})` : ''} in ${app}. It has: ${screens.map(s => `${s.screen}${s.mode ? ` (${s.mode})` : ''}`).join(', ')}`)
}

/**
 * Writes the film as a video file, with ffmpeg when this computer has it. Markback does not need ffmpeg and never installs it:
 * without it, the film still plays in the review page. Every step is fitted into the size of the last picture, on white, and
 * that size is kept within BIGGEST.
 */
export async function saveFilm(film, out) {
  if (!film?.steps.length) throw new Error('This screen has no pictures to make a film from.')
  const part = savedPart(film)
  if (part.why) throw new Error(part.why)
  const size = pictureSize(part.steps.at(-1).file) ?? { w: 1600, h: 1000 }
  const k = Math.min(1, BIGGEST.w / size.w, BIGGEST.h / size.h)
  // Even sides: the usual video cannot have odd ones.
  const even = n => Math.max(2, Math.round(n * k) - (Math.round(n * k) % 2))
  const [w, h] = [even(size.w), even(size.h)]
  const work = mkdtempSync(join(tmpdir(), 'markback-film-'))
  try {
    // Each step is fitted alone first. Read all at once, every big picture is held whole at the same time: 150 rounds took 4 GB.
    for (const [i, step] of part.steps.entries()) {
      await ffmpeg(['-y', '-loglevel', 'error', '-i', step.file, '-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1`, '-frames:v', '1', join(work, `${i}.png`)], 60000)
    }
    // Then the fitted pictures in order, each for its time. A list keeps its last time only when the last picture is named twice.
    const list = `${part.steps.map((step, i) => `file '${i}.png'\nduration ${step.seconds}\n`).join('')}file '${part.steps.length - 1}.png'\n`
    writeFileSync(join(work, 'steps.txt'), list)
    // Ten pictures a second is plenty for still pictures, and a quarter of the work of the usual 25.
    await ffmpeg(['-y', '-loglevel', 'error', '-f', 'concat', '-i', join(work, 'steps.txt'), '-vf', 'fps=10,format=yuv420p', '-t', String(part.seconds), '-preset', 'veryfast', '-tune', 'stillimage', '-threads', '4', '-movflags', '+faststart', out], 180000)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
  return { out, steps: part.steps.length, rounds: part.rounds, leftOut: part.leftOut, seconds: part.seconds, size: { w, h } }
}

/** Runs ffmpeg, and says in one line what went wrong when it does not work. */
async function ffmpeg(words, timeout) {
  try {
    await run(process.env.REVIEW_FFMPEG || 'ffmpeg', words, { timeout })
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Saving a film needs ffmpeg on this computer. The film still plays in the review page.')
    const why = String(error.stderr ?? '').trim().split('\n').at(-1) || error.message
    throw new Error(`ffmpeg could not make the film: ${why}`)
  }
}
