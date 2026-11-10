/**
 * Which store and port Markback uses. Some agents run commands in a sandbox that drops environment variables and cannot write
 * outside the project, so a project can name both in a small file, .markback, found by walking up from the current folder:
 *
 *   { "home": ".markback-store", "port": 5760 }
 *
 * The store is the first of: --home <folder>, REVIEW_HOME, the .markback file, ~/.review-wizard. A .markback can only name a
 * folder inside the folder that holds it: a file that came with a project must not send Markback's writes anywhere else. A
 * file that is not right is ignored, and that is said in one line.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export const PROJECT_FILE = '.markback'
export const defaultHome = () => join(homedir(), '.review-wizard')
const SHAPE = 'It should look like {"home": ".markback-store", "port": 5760}.'

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

/** The nearest project file at or above `from`, and the folder that holds it. */
export function findProjectFile(from = process.cwd()) {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    const path = fileIn(dir)
    if (kindOf(path) === 'file') return { path, root: dir }
    if (dirname(dir) === dir) return null
  }
}

/** The real path of a folder that may not exist yet: its nearest existing parent with links followed, and the rest put back. */
function realPath(path) {
  const rest = []
  let head = path
  while (!existsSync(head) && dirname(head) !== head) {
    rest.unshift(basename(head))
    head = dirname(head)
  }
  return join(realpathSync(head), ...rest)
}

/** The store a project file may name: a folder inside `root`, never root itself, and not one a link leads out of. */
export function storeInside(root, home) {
  if (typeof home !== 'string' || !home.trim()) return { problem: '"home" must name a folder' }
  if (isAbsolute(home) || home.startsWith('~')) return { problem: '"home" must be a folder inside the project, written relative to it' }
  const path = resolve(root, home)
  const within = (base, p) => p.startsWith(base.endsWith(sep) ? base : base + sep)
  if (!within(root, path) || !within(realPath(root), realPath(path))) return { problem: `"home" must stay inside ${root}` }
  return { path }
}

/** What a found project file says: { home, port }, either of them, or { problem } in a few words. */
export function readProjectFile(found) {
  let data
  try {
    data = JSON.parse(readFileSync(found.path, 'utf8'))
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
    if (!Number.isInteger(data.port) || data.port < 1 || data.port > 65535) return { problem: '"port" must be a whole number from 1 to 65535' }
    out.port = data.port
  }
  return out
}

/** The --home flag, before the command or after it. */
export function homeFlag(argv = process.argv.slice(2)) {
  const at = argv.indexOf('--home')
  const value = at >= 0 ? argv[at + 1] : undefined
  return value && !value.startsWith('--') ? value : ''
}

/**
 * The store to use and why: { home, from: flag|env|file|default, own, port, file, say }. `own` is where what Markback runs is
 * kept (plugins, the small browser): never a folder a project file chose, since that file may have come with someone's project.
 * `say` is what to tell the person: where the store is when a file chose it, and a file that was ignored.
 */
export function whereStore({ argv = process.argv.slice(2), env = process.env, cwd = process.cwd() } = {}) {
  const found = findProjectFile(cwd)
  const read = found ? { ...found, ...readProjectFile(found) } : null
  const file = read && !read.problem ? read : null
  const say = read?.problem ? [`Ignoring ${read.path}: ${read.problem}. ${SHAPE}`] : []
  const flag = homeFlag(argv)
  let home
  let from
  if (flag) [home, from] = [resolve(cwd, flag.replace(/^~(?=\/|$)/, homedir())), 'flag']
  else if (env.REVIEW_HOME) [home, from] = [env.REVIEW_HOME, 'env']
  else if (file?.home) [home, from] = [file.home, 'file']
  else [home, from] = [defaultHome(), 'default']
  if (from === 'file') say.push(`Store: ${home} (from ${file.path})`)
  else if (file?.home && resolve(home) !== file.home) say.push(`Store: ${home} (from ${from === 'flag' ? '--home' : 'REVIEW_HOME'}, not the one ${file.path} names)`)
  return { home, from, own: from === 'file' ? defaultHome() : home, port: file?.port ?? null, file, say }
}

/** Writes the project file in `dir`, keeping a port it already names. Gives where it went and the store it names. */
export function writeProjectFile(dir, { home, port }) {
  const store = storeInside(resolve(dir), home)
  if (store.problem) throw new Error(`The store in ${PROJECT_FILE} ${store.problem.replace(/^"home" /, '')}. For a store elsewhere, use --home or REVIEW_HOME.`)
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('--port must be a whole number from 1 to 65535.')
  const path = fileIn(resolve(dir))
  const kept = kindOf(path) === 'file' ? readProjectFile({ path, root: resolve(dir) }).port : undefined
  const data = { home: relative(resolve(dir), store.path).split(sep).join('/'), ...((port ?? kept) ? { port: port ?? kept } : {}) }
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`)
  return { path, home: store.path }
}

/**
 * A .gitignore between the repository and the store names the store, or a folder it is in, as it is. This runs on every
 * command and asks git nothing: git can take seconds to start inside a sandbox. Any other pattern is left for git to judge.
 */
function plainlyIgnored(root, store) {
  for (let dir = dirname(store); ; dir = dirname(dir)) {
    const rel = relative(dir, store).split(sep)
    let lines = []
    try {
      lines = readFileSync(join(dir, '.gitignore'), 'utf8').split('\n')
    } catch {
      // No .gitignore here.
    }
    for (const line of lines) {
      const pattern = line.trim().replace(/^\//, '').replace(/\/(\*\*)?$/, '')
      if (pattern && !/^[#!]/.test(pattern) && rel.some((_, n) => rel.slice(0, n + 1).join('/') === pattern)) return true
    }
    if (dir === root || dirname(dir) === dir) return false
  }
}

/** One line when the store is inside a git repository and git does not ignore it: screens and marks are not for committing. */
export function ignoreHint(home) {
  const store = resolve(home)
  let root = dirname(store)
  while (!existsSync(join(root, '.git'))) {
    if (dirname(root) === root) return ''
    root = dirname(root)
  }
  const rel = relative(root, store).split(sep).join('/')
  if (plainlyIgnored(root, store)) return ''
  try {
    execFileSync('git', ['-C', root, 'check-ignore', '-q', '--', `${rel}/`], { stdio: 'ignore', timeout: 5000 })
    return ''
  } catch (error) {
    // 1 is git saying it is not ignored. No git, or a git that cannot run here, says nothing.
    return error.status === 1 ? `The store is inside a git repository. Add ${rel}/ to .gitignore, so screens and marks are not committed.` : ''
  }
}
