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
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { promisify } from 'node:util'
import { HOME, IMAGES, QUEUE, listScreens, readInbox, screenId, slug } from './store.mjs'
import { pictureSize } from './words.mjs'

const run = promisify(execFile)

/** How long each step stays, in seconds: a round's picture, the same picture as marked, and the last step of all. */
export const STEP_SECONDS = { picture: 1, marked: 1.5, last: 2 }
/** The biggest a saved film is. A bigger picture is made smaller to fit. */
const BIGGEST = { w: 1920, h: 1920 }
/** The most steps a saved film holds. Each is a picture ffmpeg holds open, so a long story is saved as its newest rounds. */
export const MOST_STEPS = 40

/**
 * When a folder was made, in milliseconds, or null where the file system does not say. A file system with no such time
 * gives 0, or the time the folder last changed in its place: a time that moves with every push says nothing about the start.
 */
export function madeAt(dir, stat = statSync) {
  try {
    const { birthtimeMs, ctimeMs } = stat(dir)
    return birthtimeMs > 0 && Math.floor(birthtimeMs) !== Math.floor(ctimeMs) ? Math.floor(birthtimeMs) : null
  } catch {
    return null
  }
}

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
  // Pushed before the list was kept, in part or all: the rounds between two known ones are the pictures kept for this screen
  // between them, and only when their number is just right. When it is not, those rounds are gone: an older file is never
  // borrowed. The review began when its queue folder was made, since a clear takes the folder away: older files are another's.
  const listed = (Array.isArray(entry.pictures) ? entry.pictures : []).map(p => p?.round).filter(Number.isInteger)
  if (!listed.length || Math.min(...listed) > 1) {
    const named = new RegExp(`^${entry.id.replace(/[^a-z0-9]/gi, '\\$&')}-after-(\\d+)\\.[a-z0-9]+$`, 'i')
    const timeOf = file => Number(named.exec(file)?.[1] ?? NaN)
    const newest = timeOf(basename(entry.after))
    const began = madeAt(join(QUEUE, appSlug))
    // Without the start, nothing says which older files are this review's: none is taken, and those rounds are gone.
    const kept = began === null ? [] : (existsSync(dir) ? readdirSync(dir) : []).filter(file => named.test(file) && timeOf(file) <= newest && timeOf(file) >= began).sort((a, b) => timeOf(a) - timeOf(b))
    let before = { round: 0, at: -1 }
    for (const [at, file] of kept.entries()) {
      if (!roundOf.has(file)) continue
      const between = kept.slice(before.at + 1, at)
      if (between.length === roundOf.get(file) - before.round - 1) between.forEach((older, i) => roundOf.set(older, before.round + 1 + i))
      before = { round: roundOf.get(file), at }
    }
  }
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
      try {
        await ffmpeg(['-y', '-loglevel', 'error', '-i', step.file, '-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1`, '-frames:v', '1', join(work, `${i}.png`)], 60000, out)
      } catch (error) {
        // A picture ffmpeg cannot read, cut short say: the film stops cleanly and says which one, so it can be pushed again. Any
        // other trouble, a full disk say, is not the picture's fault and says what it is.
        if (error.plain || !unreadable(step.file, error.stderr)) throw error
        throw new Error(`The picture of round ${film.rounds[step.at].round}${step.marked ? ' as marked' : ''} could not be read, so the film was not saved. It still plays in the review page.`)
      }
    }
    // Then the fitted pictures in order, each for its time. A list keeps its last time only when the last picture is named twice.
    const list = `${part.steps.map((step, i) => `file '${i}.png'\nduration ${step.seconds}\n`).join('')}file '${part.steps.length - 1}.png'\n`
    writeFileSync(join(work, 'steps.txt'), list)
    // Ten pictures a second is plenty for still pictures, and a quarter of the work of the usual 25.
    await ffmpeg(['-y', '-loglevel', 'error', '-f', 'concat', '-i', join(work, 'steps.txt'), '-vf', 'fps=10,format=yuv420p', '-t', String(part.seconds), '-preset', 'veryfast', '-tune', 'stillimage', '-threads', '4', '-movflags', '+faststart', out], 180000, out)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
  return { out, steps: part.steps.length, rounds: part.rounds, leftOut: part.leftOut, seconds: part.seconds, size: { w, h } }
}

/** How long one ffmpeg step may take. A test makes it short. */
const stepLimit = ms => Number(process.env.REVIEW_FILM_TIMEOUT) || ms

/** True when a picture cannot be read: it is gone, empty or not a picture by its first bytes, or ffmpeg said it could not read it. */
function unreadable(file, said = '') {
  try {
    if (!statSync(file).size || !pictureSize(file)) return true
  } catch {
    return true
  }
  return /Error opening input|Decoding error|Invalid data found when processing input/i.test(String(said))
}

/**
 * ffmpeg's last line, fit to show: the folders Markback knows are put in plain words, and a line that still holds anything like
 * a path is not shown at all. Empty when nothing is left to show.
 */
function plainWhy(said, out) {
  let line = (String(said ?? '').trim().split('\n').at(-1) ?? '').replace(/^(\[[^\]]*\]\s*)+/, '')
  const real = path => {
    try {
      return realpathSync(path)
    } catch {
      return path
    }
  }
  const places = [[HOME, 'the store'], [dirname(out), "the film's folder"], [tmpdir(), 'a temp folder'], [homedir(), 'the home folder']]
    .flatMap(([path, word]) => [[path, word], [real(path), word]])
    .filter(([path]) => path && path.length > 1)
    .sort((a, b) => b[0].length - a[0].length)
  for (const [path, word] of places) line = line.split(path).join(word)
  if (/[\\/][^\s\\/]|['"][^'"]*[\\/][^'"]*['"]/.test(line)) return ''
  return line.trim()
}

/**
 * Runs ffmpeg, and says in one plain line what went wrong when it does not work: never its command line or a path, which would
 * show the store's folder. When the time is up it is killed outright, as an ffmpeg that does not stop when asked would hold the
 * server's one film at a time for ever. `plain` marks a line meant for the person as it is; `stderr` keeps what ffmpeg said.
 */
async function ffmpeg(words, ms, out) {
  try {
    await run(process.env.REVIEW_FFMPEG || 'ffmpeg', words, { timeout: stepLimit(ms), killSignal: 'SIGKILL' })
  } catch (error) {
    const say = line => Object.assign(new Error(line), { plain: true })
    if (error.code === 'ENOENT') throw say('Saving a film needs ffmpeg on this computer. The film still plays in the review page.')
    if (error.code === 'EACCES') throw say('ffmpeg is on this computer but cannot be run. The film still plays in the review page.')
    if (error.killed) throw say('Making the film took too long. Try a film of fewer rounds.')
    const why = plainWhy(error.stderr, out)
    throw Object.assign(new Error(why ? `ffmpeg could not make the film: ${why}` : 'ffmpeg could not make the film.'), { stderr: String(error.stderr ?? '') })
  }
}
