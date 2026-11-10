import { execFile } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { HOME } from './store.mjs'

const run = promisify(execFile)
const releases = 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions.json'
const maxBytes = 200 * 1024 * 1024

export function needsLocalBrowser(url) {
  return process.platform === 'darwin' && process.env.CODEX_SANDBOX === 'seatbelt' &&
    (url.protocol === 'file:' || (['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
}

/** The standalone shell fits inside Codex's existing Seatbelt sandbox without launching Chrome's helpers. */
export async function localBrowser() {
  const platform = process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64'
  const folder = `chrome-headless-shell-${platform}`
  const cache = join(HOME, 'browser')
  const installed = join(cache, folder)
  const executable = join(installed, 'chrome-headless-shell')
  if (!existsSync(executable)) {
    mkdirSync(cache, { recursive: true })
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
