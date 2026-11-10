import { execFile } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { WHERE } from './store.mjs'

const run = promisify(execFile)
const releases = 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions.json'
const maxBytes = 200 * 1024 * 1024
/** What an agent is told when the small browser is not there yet: ask first, and how to go on after a yes. */
export const NEEDS_YES = 'Taking pictures inside this sandbox needs a small Chrome from Google, about 100 MB, fetched once and kept on this computer. Ask the person first. On a yes, run the same command again with --fetch-browser.'

/**
 * Whether git tracks anything under this folder, read from the repository's index without running git: 'yes', 'no', or
 * 'unknown'. A store Markback made is never committed. One that came with a clone is in the index. The index is searched for
 * the folder's path as plain bytes, which can only err towards 'yes'. An index git compresses (version 4) is 'unknown'.
 */
export function trackedByGit(folder) {
  const store = resolve(folder)
  let top = dirname(store)
  while (!existsSync(join(top, '.git'))) {
    if (dirname(top) === top) return 'no'
    top = dirname(top)
  }
  let gitDir = join(top, '.git')
  try {
    // A worktree or a submodule has a .git file that names where its repository is.
    const named = /^gitdir: (.+)$/m.exec(readFileSync(gitDir, 'utf8'))
    if (named) gitDir = resolve(top, named[1].trim())
  } catch {
    // A folder, as usual.
  }
  let index
  try {
    index = readFileSync(join(gitDir, 'index'))
  } catch (error) {
    return error.code === 'ENOENT' ? 'no' : 'unknown'
  }
  if (index.toString('latin1', 0, 4) !== 'DIRC' || ![2, 3].includes(index.readUInt32BE(4))) return 'unknown'
  return index.includes(Buffer.from(`${relative(top, store).split(sep).join('/')}/`)) ? 'yes' : 'no'
}

/** Said when a browser is found in a project's store that this command did not fetch. */
export const storeBrowserYes = folder => `The small browser in ${folder} is inside the project, and Markback cannot tell that it put it there: a project could bring its own program. Ask the person first. On a yes, run the same command again with --use-store-browser.`

export function needsLocalBrowser(url) {
  return process.platform === 'darwin' && process.env.CODEX_SANDBOX === 'seatbelt' &&
    (url.protocol === 'file:' || (['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
}

/** The standalone shell fits inside Codex's existing Seatbelt sandbox without launching Chrome's helpers. */
export async function localBrowser() {
  const platform = process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64'
  const folder = `chrome-headless-shell-${platform}`
  // In the store, which is where a sandbox can write: a project's own store when its .markback chose one. Found there again
  // on later runs, with nothing else said.
  const cache = join(WHERE.browser, 'browser')
  const installed = join(cache, folder)
  const executable = join(installed, 'chrome-headless-shell')
  let fetchedNow = false
  if (!existsSync(executable)) {
    // Asked before the person is: a yes to a download that then cannot be kept would be a yes for nothing.
    try {
      mkdirSync(cache, { recursive: true })
      const probe = join(cache, `.write-${process.pid}`)
      writeFileSync(probe, '')
      rmSync(probe)
    } catch (error) {
      if (!['EACCES', 'EPERM', 'EROFS'].includes(error.code)) throw error
      throw new Error(`The small browser would be kept in ${cache}, and this sandbox cannot write there. Name a store in the project first: review project --store .markback-store`)
    }
    // A download is the person's to allow. Nothing is fetched until they have said yes, and the agent has said so with the flag.
    if (process.env.MARKBACK_FETCH_BROWSER !== 'yes') throw new Error(NEEDS_YES)
    const staging = mkdtempSync(join(cache, '.download-'))
    try {
      const metadata = await fetch(releases, { redirect: 'error', signal: AbortSignal.timeout(12000) })
      if (!metadata.ok) throw new Error(`Chrome release lookup returned ${metadata.status}.`)
      const version = (await metadata.json()).channels?.Stable?.version
      if (!/^\d+\.\d+\.\d+\.\d+$/.test(version)) throw new Error('The Chrome release lookup returned no stable version.')
      const url = `https://storage.googleapis.com/chrome-for-testing-public/${version}/${platform}/${folder}.zip`
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(90000) })
      if (!response.ok || !response.body) throw new Error(`Chrome download returned ${response.status}.`)
      const archive = join(staging, 'chrome.zip')
      let bytes = 0
      const limit = new Transform({ transform(chunk, encoding, done) {
        bytes += chunk.length
        if (bytes > maxBytes) done(new Error('The Chrome download was larger than expected.'))
        else done(null, chunk)
      } })
      await pipeline(Readable.fromWeb(response.body), limit, createWriteStream(archive))
      await run('/usr/bin/unzip', ['-q', archive, '-d', staging], { timeout: 30000 })
      if (!existsSync(join(staging, folder, 'chrome-headless-shell'))) throw new Error('The Chrome download did not contain its executable.')
      try {
        renameSync(join(staging, folder), installed)
        fetchedNow = true
      } catch (error) {
        // Another review can finish installing the same browser while this one downloads it.
        if (!['EEXIST', 'ENOTEMPTY'].includes(error.code) || !existsSync(executable)) throw error
      }
    } catch (error) {
      throw new Error(`Could not set up the local screenshot browser: ${error.message}`, { cause: error })
    } finally {
      rmSync(staging, { recursive: true, force: true })
    }
  }
  // A store a project's .markback named may have come with the project, and a program in it is never run unasked: only the one
  // this command fetched, or one the person said yes to, in a store git does not track (a planted one is committed).
  if (WHERE.from === 'file' && !fetchedNow) {
    if (process.env.MARKBACK_USE_STORE_BROWSER !== 'yes') throw new Error(storeBrowserYes(installed))
    const tracked = trackedByGit(WHERE.home)
    if (tracked !== 'no') throw new Error(tracked === 'yes' ? `Not running the browser in ${installed}: git tracks files in ${WHERE.home}, so they came with the project. Push your own screenshots with review push.` : `Not running the browser in ${installed}: Markback cannot tell whether git tracks ${WHERE.home}. Push your own screenshots with review push.`)
    console.error(`Running the browser in ${installed}, a program inside the project, as the person said yes to.`)
  }
  // Keep this single-process browser for local screens. Chromium bypasses the proxy for loopback.
  return { executable, flags: ['--single-process', '--no-zygote', '--proxy-server=http://127.0.0.1:9'], realTime: true }
}
