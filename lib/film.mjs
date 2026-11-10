/**
 * The film of one screen: its story from the first picture to the last. Each round's picture, then that picture as the person
 * marked it, then the next round's picture, and so on to the newest. It is made from files the store already keeps, and keeps
 * nothing of its own: every push leaves its picture under a new name, and every answer with marks leaves the marked picture.
 *
 *   <home>/images/<app>/<screen>-after-<time>.png   one for each push of the screen: the times give the order of the rounds
 *   <home>/inbox/<app>/<screen>-<time>.{png,json}   the marked picture, and which picture it was drawn on (afterImage)
 *
 * The queue holds only the newest round, so an older picture is known by its name and its time. What cannot be shown: marks that
 * were drawn and never sent (they stay in the browser), and notes, which are words and not in a picture.
 */

import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { IMAGES, listScreens, readInbox, screenId, slug } from './store.mjs'
import { pictureSize } from './words.mjs'

const run = promisify(execFile)

/** How long each step stays, in seconds: a round's picture, the same picture as marked, and the last step of all. */
export const STEP_SECONDS = { picture: 1, marked: 1.5, last: 2 }
/** The widest a saved film is. A wider picture is made smaller to fit. */
const WIDEST = 1920

const plain = text => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * One screen's film, or null when no such screen is queued. `rounds` has one entry for each round that still has its picture,
 * oldest first. `steps` is what plays: every round's picture, then each marked copy of it, in the order they were sent.
 */
export function filmOf(app, id) {
  const appSlug = slug(app)
  const entry = listScreens(appSlug).find(s => s.id === id)
  if (!entry) return null
  // A push names its picture <screen>-after-<time>: the times put this screen's pictures in the order they came.
  const named = new RegExp(`^${plain(entry.id)}-after-(\\d+)\\.[a-z0-9]+$`, 'i')
  const dir = join(IMAGES, appSlug)
  const timeOf = file => Number(named.exec(file)[1])
  let files = (existsSync(dir) ? readdirSync(dir) : []).filter(file => named.test(file)).sort((a, b) => timeOf(a) - timeOf(b))
  const now = files.indexOf(basename(entry.after))
  if (now >= 0) files = files.slice(0, now + 1)
  // Clearing a review starts its rounds again at 1 and leaves the old pictures: only the newest rounds are this review's.
  files = files.slice(-entry.round)
  const answers = readInbox(appSlug).filter(r => r.screenId === entry.id)
  const rounds = files.map((file, i) => {
    // An answer says which picture it was given on. A round number does not: it starts again after a clear.
    const said = answers.filter(r => basename(r.afterImage ?? '') === file)
    const last = said.at(-1)
    return {
      round: entry.round - (files.length - 1 - i),
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
    missing: entry.round - rounds.length,
    rounds,
    steps,
    seconds: steps.reduce((sum, step) => sum + step.seconds, 0),
  }
}

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
 * without it, the film still plays in the review page. Every step is fitted into the size of the last picture, on white.
 */
export async function saveFilm(film, out) {
  if (!film?.steps.length) throw new Error('This screen has no pictures to make a film from.')
  const size = pictureSize(film.steps.at(-1).file) ?? { w: 1600, h: 1000 }
  const k = Math.min(1, WIDEST / size.w)
  // Even sides: the usual video cannot have odd ones.
  const even = n => Math.max(2, Math.round(n * k) - (Math.round(n * k) % 2))
  const [w, h] = [even(size.w), even(size.h)]
  const inputs = film.steps.flatMap(step => ['-loop', '1', '-t', String(step.seconds), '-i', step.file])
  const fitted = film.steps.map((_, i) => `[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1,fps=25[v${i}]`)
  const joined = `${film.steps.map((_, i) => `[v${i}]`).join('')}concat=n=${film.steps.length}:v=1:a=0,format=yuv420p[film]`
  try {
    await run(process.env.REVIEW_FFMPEG || 'ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', [...fitted, joined].join(';'), '-map', '[film]', '-movflags', '+faststart', out], { timeout: 180000 })
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Saving a film needs ffmpeg on this computer. The film still plays in the review page.')
    const why = String(error.stderr ?? '').trim().split('\n').at(-1) || error.message
    throw new Error(`ffmpeg could not make the film: ${why}`)
  }
  return { out, steps: film.steps.length, rounds: film.rounds.length, seconds: film.seconds, size: { w, h } }
}
