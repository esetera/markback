import { execFile } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { HOME, OWN_HOME, PROJECT_STORE } from './store.mjs'

const run = promisify(execFile)
const releases = 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions.json'
const maxBytes = 200 * 1024 * 1024
/** What an agent is told when the small browser is not there yet: ask first, and how to go on after a yes. */
export const NEEDS_YES = 'Taking pictures inside this sandbox needs a small Chrome from Google, about 100 MB, fetched once and kept on this computer. Ask the person first. On a yes, run the same command again with --fetch-browser.'
/**
 * The same, where it cannot be kept: the person's own Markback folder cannot be written from this sandbox, and a browser kept
 * in a project's store could be one the project brought.
 */
export const NEEDS_YES_EACH_TIME = 'Taking pictures inside this sandbox needs a small Chrome from Google, about 100 MB. It cannot be kept here, so it is fetched again for each command and thrown away after. Ask the person first. On a yes, run the same command again with --fetch-browser. Or push your own screenshot with review push.'

export function needsLocalBrowser(url) {
  return process.platform === 'darwin' && process.env.CODEX_SANDBOX === 'seatbelt' &&
    (url.protocol === 'file:' || (['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
}

const canWrite = folder => {
  try {
    mkdirSync(folder, { recursive: true })
    const probe = join(folder, `.write-${process.pid}`)
    writeFileSync(probe, '')
    rmSync(probe)
    return true
  } catch (error) {
    if (!['EACCES', 'EPERM', 'EROFS'].includes(error.code)) throw error
    return false
  }
}

/** Fetches the browser into `cache`, as `folder`. Nothing is fetched without the person's yes, said with --fetch-browser. */
async function fetchBrowser(cache, platform, folder, words) {
  if (process.env.MARKBACK_FETCH_BROWSER !== 'yes') throw new Error(words)
  const installed = join(cache, folder)
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
    } catch (error) {
      // Another review can finish installing the same browser while this one downloads it.
      if (!['EEXIST', 'ENOTEMPTY'].includes(error.code) || !existsSync(join(installed, 'chrome-headless-shell'))) throw error
    }
  } catch (error) {
    throw new Error(`Could not set up the local screenshot browser: ${error.message}`, { cause: error })
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
  return installed
}

/**
 * The standalone shell fits inside Codex's existing Seatbelt sandbox without launching Chrome's helpers.
 *
 * It is kept in the person's own Markback folder, and run from there. Never from a project's store: a program found there may
 * have come with the project, and nothing can prove it is the one Markback fetched (Chrome for Testing's Mac builds carry only
 * an ad-hoc signature, with no maker's name to check). Where the person's own folder cannot be written (Codex's sandbox), it
 * is fetched for this one command into a fresh folder in the store, run from there, and thrown away when the command ends.
 */
export async function localBrowser() {
  const platform = process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64'
  const folder = `chrome-headless-shell-${platform}`
  const flags = ['--single-process', '--no-zygote', '--proxy-server=http://127.0.0.1:9']
  const own = join(OWN_HOME, 'browser')
  // Checked before the person is asked: a yes to a download that then cannot be kept or run would be a yes for nothing.
  if (canWrite(own)) {
    const executable = join(own, folder, 'chrome-headless-shell')
    if (!existsSync(executable)) await fetchBrowser(own, platform, folder, NEEDS_YES)
    // Keep this single-process browser for local screens. Chromium bypasses the proxy for loopback.
    return { executable, flags, realTime: true }
  }
  const where = PROJECT_STORE ? join(HOME, 'browser') : own
  if (!PROJECT_STORE || !canWrite(where)) throw new Error(`The small browser would be kept in ${own}, and this sandbox cannot write there. Push your own screenshot with review push.`)
  const once = mkdtempSync(join(where, '.once-'))
  // Thrown away when this command ends, however it ends: the next command fetches its own.
  process.once('exit', () => rmSync(once, { recursive: true, force: true }))
  const installed = await fetchBrowser(once, platform, folder, NEEDS_YES_EACH_TIME)
  return { executable: join(installed, 'chrome-headless-shell'), flags, realTime: true }
}
