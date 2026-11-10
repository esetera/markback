// Loaded before every test file (see package.json): the person's own Markback folder lives under the home folder, and holds
// the secret, plugins and wake commands. Each test file gets a home folder of its own, so no test ever reads or writes the
// real one, and every command a test runs gets it too.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'review-test-home-'))
process.env.HOME = home
process.env.USERPROFILE = home
process.once('exit', () => rmSync(home, { recursive: true, force: true }))
