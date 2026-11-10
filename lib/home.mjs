/**
 * Which store and port Markback uses. Some agents run commands in a sandbox that drops environment variables and cannot write
 * outside the project, so a project can name both in a small file, .markback, found by looking up from the current folder:
 *
 *   { "home": ".markback-store", "port": 5760 }
 *
 * The store is the first of: --home <folder>, REVIEW_HOME, the .markback file, ~/.review-wizard. A .markback came with a
 * project, so it is not trusted the way a setting is: it can only name a folder inside the folder that holds it, the store it
 * names may hold no links, and a file that is not right, or that someone else could have put there, is skipped and said so.
 */

import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export const PROJECT_FILE = '.markback'
export const DEFAULT_PORT = 5741
export const defaultHome = () => join(homedir(), '.review-wizard')
const SHAPE = 'It should look like {"home": ".markback-store", "port": 5760}.'
/** A project file is a line or two. Anything far bigger is not one, and is not read on every command. */
const MOST_BYTES = 4096
/** The ports a project file is given when none is said: near the usual one, and never it. 5793 is left for other tools. */
const PROJECT_PORTS = Array.from({ length: 40 }, (_, n) => 5760 + n).filter(port => port !== 5793)
export const LINK_OUT = 'the store holds a link that leads outside it'

const kindOf = path => {
  try {
    const stat = statSync(path)
    return stat.isFile() ? 'file' : stat.isDirectory() ? 'folder' : ''
  } catch {
    return ''
  }
}

/** Where a project's file is: .markback, or .markback/config.json when Markback was installed into a .markback folder with npm. */
const fileIn = dir => (kindOf(join(dir, PROJECT_FILE)) === 'folder' ? join(dir, PROJECT_FILE, 'config.json') : join(dir, PROJECT_FILE))

const within = (base, path) => path === base || path.startsWith(base.endsWith(sep) ? base : base + sep)
const realOr = path => {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/**
 * The folders a project file may be in, nearest first. Inside a git repository: up to its top. Otherwise: up to the home
 * folder, not it. Never a shared folder: /tmp, or one anyone can write to, where someone else could leave a file for every
 * project below it.
 */
function placesToLook(from, home = homedir()) {
  const start = resolve(from)
  const top = (() => {
    for (let dir = start; ; dir = dirname(dir)) {
      if (existsSync(join(dir, '.git'))) return dir
      if (dirname(dir) === dir) return null
    }
  })()
  const realHome = realOr(home)
  const out = []
  for (let dir = start; ; dir = dirname(dir)) {
    const real = realOr(dir)
    // The home folder and above it are everyone's projects at once. A folder outside home is looked at alone.
    if (within(real, realHome)) break
    out.push(dir)
    if (dir === top || (!top && !within(realHome, real)) || dirname(dir) === dir) break
  }
  return out
}

const shared = dir => {
  const real = realOr(dir)
  if (['/tmp', '/private/tmp', '/var/tmp', '/private/var/tmp'].includes(real)) return true
  try {
    return (statSync(real).mode & 0o002) !== 0
  } catch {
    return false
  }
}

/** The nearest project file, and the folder that holds it, with what was skipped on the way and why. */
export function findProjectFile(from = process.cwd(), { home = homedir(), uid = process.getuid?.() } = {}) {
  const skipped = []
  for (const dir of placesToLook(from, home)) {
    const path = fileIn(dir)
    if (kindOf(path) !== 'file') continue
    if (shared(dir)) {
      skipped.push(`Skipping ${path}: anyone can write in ${dir}.`)
      continue
    }
    if (uid !== undefined && statSync(path).uid !== uid) {
      skipped.push(`Skipping ${path}: it belongs to someone else.`)
      continue
    }
    return { path, root: dir, skipped }
  }
  return skipped.length ? { path: null, skipped } : null
}

/**
 * The real path of a folder that may not exist yet: its nearest existing parent with links followed, and the rest put back.
 * A link that leads nowhere is a problem, not a folder to make.
 */
function realPath(path) {
  const rest = []
  let head = path
  for (;;) {
    let stat = null
    try {
      stat = lstatSync(head)
    } catch {
      // Not there: look at its parent.
    }
    if (stat) {
      if (stat.isSymbolicLink() && !existsSync(head)) return { problem: `${head} is a link that leads nowhere` }
      return { path: join(realpathSync(head), ...rest) }
    }
    if (dirname(head) === head) return { path }
    rest.unshift(basename(head))
    head = dirname(head)
  }
}

/** The store a project file may name: a folder inside `root`, never root itself, and not one a link leads out of. */
export function storeInside(root, home) {
  if (typeof home !== 'string' || !home.trim()) return { problem: '"home" must name a folder' }
  if (isAbsolute(home) || home.startsWith('~')) return { problem: '"home" must be a folder inside the project, written relative to it' }
  const path = resolve(root, home)
  const inside = (base, p) => p !== base && within(base, p)
  if (!inside(root, path)) return { problem: `"home" must stay inside ${root}` }
  const real = realPath(path)
  if (real.problem) return { problem: `"home" ${real.problem}` }
  if (!inside(realOr(root), real.path)) return { problem: `"home" must stay inside ${root}` }
  return { path }
}

/**
 * The first link anywhere in a store, or ''. A store a project file named may hold none: one committed in a project could send
 * a write anywhere. Markback never makes a link, so this asks only lstat, a folder at a time, and is quick even for a big store.
 * The store's browser folder is not looked inside: Markback only makes fresh folders there, which no link can redirect, and a
 * browser fetched into one can hold links of its own.
 */
export function linkIn(home) {
  const walk = dir => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return ''
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isSymbolicLink()) return path
      if (entry.isDirectory() && !(dir === home && entry.name === 'browser')) {
        const found = walk(path)
        if (found) return found
      }
    }
    return ''
  }
  try {
    if (lstatSync(home).isSymbolicLink()) return home
  } catch {
    return ''
  }
  return walk(home)
}

/** What a found project file says: { home, port }, either of them, or { problem } in a few words. */
export function readProjectFile(found) {
  let text
  try {
    if (statSync(found.path).size > MOST_BYTES) return { problem: `it is larger than ${MOST_BYTES / 1024} KB` }
    text = readFileSync(found.path, 'utf8')
  } catch {
    return { problem: 'it cannot be read' }
  }
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return { problem: 'it is not JSON' }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { problem: 'it is not a JSON object' }
  const unknown = Object.keys(data).filter(key => !['home', 'port'].includes(key))
  if (unknown.length) return { problem: `Markback does not know ${unknown.map(key => `"${key}"`).join(', ')}` }
  if (!('home' in data) && !('port' in data)) return { problem: 'it names no home and no port' }
  const out = {}
  if ('home' in data) {
    const store = storeInside(found.root, data.home)
    if (store.problem) return store
    out.home = store.path
  }
  if ('port' in data) {
    if (!isPort(data.port)) return { problem: '"port" must be a whole number from 1 to 65535' }
    out.port = data.port
  }
  return out
}

export const isPort = port => Number.isInteger(port) && port >= 1 && port <= 65535

/** The --home flag, before the command or after it, as `--home <folder>` or `--home=<folder>`. '' when there is none. */
export function homeFlag(argv = process.argv.slice(2)) {
  const joined = argv.find(arg => arg.startsWith('--home='))
  if (joined) return joined.slice('--home='.length)
  const at = argv.indexOf('--home')
  const value = at >= 0 ? argv[at + 1] : undefined
  return value && !value.startsWith('--') ? value : ''
}

const expandHome = path => path.replace(/^~(?=[\\/]|$)/, homedir())

/**
 * The store to use and why: { home, from: flag|env|file|default, project, own, port, file, say, problem }.
 *   project  true for any store but the person's own Markback folder, however it was chosen: it may have come with a project,
 *            so what it holds is the project's words, and nothing in it is run (see trust.mjs, wake.mjs, capture-browser.mjs).
 *   own      the person's own Markback folder: where plugins, wake commands and the secret are kept.
 *   port     the file's port, only for the file's own store.
 *   say      what to tell the person: where the store is when a file chose it, and a file that was skipped.
 *   problem  why a project store cannot be used: a link in it.
 */
export function whereStore({ argv = process.argv.slice(2), env = process.env, cwd = process.cwd() } = {}) {
  const found = findProjectFile(cwd)
  const say = [...(found?.skipped ?? [])]
  const read = found?.path ? { ...found, ...readProjectFile(found) } : null
  const file = read && !read.problem ? read : null
  if (read?.problem) say.push(`Ignoring ${read.path}: ${read.problem}. ${SHAPE}`)
  const flag = homeFlag(argv)
  let home
  let from
  if (flag) [home, from] = [resolve(cwd, expandHome(flag)), 'flag']
  else if (env.REVIEW_HOME) [home, from] = [env.REVIEW_HOME, 'env']
  else if (file?.home) [home, from] = [file.home, 'file']
  else [home, from] = [defaultHome(), 'default']
  if (from === 'file') say.push(`Store: ${home} (from ${file.path})`)
  else if (file?.home && resolve(home) !== file.home) say.push(`Store: ${home} (from ${from === 'flag' ? '--home' : 'REVIEW_HOME'}, not the one ${file.path} names)`)
  // A file that names only a port speaks for the usual store.
  const port = file && (from === 'file' || (from === 'default' && !file.home)) ? file.port ?? null : null
  const project = realStore(home) !== realStore(defaultHome())
  const link = project ? linkIn(home) : ''
  return { home, from, project, own: defaultHome(), port, file, say, problem: link ? `${LINK_OUT} (${link}). Remove the link, or choose another store with --home.` : '' }
}

/** A store's real path, made or not yet made: what stamps and wake commands are bound to. */
export const realStore = home => realPath(resolve(home)).path ?? resolve(home)

/** A short name for a folder, for file names: not secret. */
export const folderKey = path => createHash('sha256').update(path).digest('hex').slice(0, 16)

/** A port for a new project file: one of a few near the usual one that nothing holds now. */
export async function projectPort(free) {
  for (const port of PROJECT_PORTS) if (await free(port)) return port
  return PROJECT_PORTS[0]
}

/**
 * Writes the project file in `dir`. The port is the one given, or the one the file already names (whatever else is in it), or
 * one picked that is not the usual port: two stores on one port would each hide the other's screens.
 */
export async function writeProjectFile(dir, { home, port, free }) {
  const root = resolve(dir)
  const store = storeInside(root, home)
  if (store.problem) throw new Error(`The store in ${PROJECT_FILE} ${store.problem.replace(/^"home" /, '')}. For a store elsewhere, use --home or REVIEW_HOME.`)
  if (port !== undefined && !isPort(port)) throw new Error('--port must be a whole number from 1 to 65535.')
  const link = linkIn(store.path)
  if (link) throw new Error(`Not writing ${PROJECT_FILE}: ${LINK_OUT} (${link}).`)
  const path = fileIn(root)
  let kept
  try {
    const old = JSON.parse(readFileSync(path, 'utf8'))
    if (isPort(old?.port)) kept = old.port
  } catch {
    // No file yet, or one that says nothing usable.
  }
  const chosen = port ?? kept ?? (await projectPort(free))
  writeFileSync(path, `${JSON.stringify({ home: relative(root, store.path).split(sep).join('/'), port: chosen }, null, 2)}\n`)
  return { path, home: store.path, port: chosen }
}

/**
 * A .gitignore between the repository's top and the store names the store, or a folder it is in, as it is. Git is never asked:
 * it can take seconds to start in a sandbox, and on a Mac without its tools, calling it opens an install window.
 */
function plainlyIgnored(top, store) {
  const named = (file, base) => {
    let lines = []
    try {
      lines = readFileSync(file, 'utf8').split('\n')
    } catch {
      return false
    }
    const rel = relative(base, store).split(sep)
    return lines.some(line => {
      const pattern = line.trim().replace(/^\//, '').replace(/\/(\*\*)?$/, '')
      return pattern && !/^[#!]/.test(pattern) && rel.some((_, n) => rel.slice(0, n + 1).join('/') === pattern || (n === 0 && !pattern.includes('/') && rel.includes(pattern)))
    })
  }
  if (named(join(top, '.git', 'info', 'exclude'), top)) return true
  for (let dir = dirname(store); ; dir = dirname(dir)) {
    if (named(join(dir, '.gitignore'), dir)) return true
    if (dir === top || dirname(dir) === dir) return false
  }
}

/** One line when the store is inside a git repository and no .gitignore plainly leaves it out. '' otherwise. */
export function ignoreHint(home) {
  const store = resolve(home)
  let top = dirname(store)
  while (!existsSync(join(top, '.git'))) {
    if (dirname(top) === top) return ''
    top = dirname(top)
  }
  if (plainlyIgnored(top, store)) return ''
  return `The store is inside a git repository. Add ${relative(top, store).split(sep).join('/')}/ to .gitignore, so screens and marks are not committed.`
}

/** The hint once per store, on its first push: remembered in the store, so it is not said on every command. */
export function ignoreHintOnce(home) {
  const said = join(home, 'gitignore-said')
  if (existsSync(said)) return ''
  const hint = ignoreHint(home)
  if (hint) {
    mkdirSync(home, { recursive: true })
    writeFileSync(said, `${new Date().toISOString()}\n`)
  }
  return hint
}

/** A path as a shell reads it: plain when it can be, else in single quotes. */
export const shellWord = text => (/^[\w@%+=:,./-]+$/.test(text) ? text : `'${String(text).replace(/'/g, `'\\''`)}'`)
