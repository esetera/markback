import { execFile } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { WHERE } from './store.mjs'

const run = promisify(execFile)
const releases = 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions.json'
const maxBytes = 200 * 1024 * 1024
/** What an agent is told when the small browser is not there yet: ask first, and how to go on after a yes. */
export const NEEDS_YES = 'Taking pictures inside this sandbox needs a small Chrome from Google, about 100 MB, fetched once and kept on this computer. Ask the person first. On a yes, run the same command again with --fetch-browser.'

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
  // Keep this single-process browser for local screens. Chromium bypasses the proxy for loopback.
  return { executable, flags: ['--single-process', '--no-zygote', '--proxy-server=http://127.0.0.1:9'], realTime: true }
}
