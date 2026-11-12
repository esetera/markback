import './own-home.mjs'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { writePicture } from './helpers.mjs'

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'review.mjs')
// The person's own store, in this test file's own home folder (see own-home.mjs): what it holds is theirs.
const home = join(process.env.HOME, '.review-wizard')
mkdirSync(home, { recursive: true })
process.env.REVIEW_HOME = home
const { receive, push } = await import('../lib/store.mjs')
after(() => rmSync(home, { recursive: true, force: true }))
const env = { ...process.env, REVIEW_HOME: home }
const review = (...args) => execFileSync('node', [CLI, ...args], { env, encoding: 'utf8' })

/** A plugin folder written on the spot. */
function plugin(name, meta, files) {
  const dir = join(home, 'sources', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify(meta))
  for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text)
  return dir
}

const hello = plugin('hello', { name: 'hello', version: '1.0.0', description: 'Says hello', commands: { greet: 'greet.mjs' }, exports: { count: 'count.mjs' } }, {
  'greet.mjs': "export default ({ args, flags, home }) => console.log(`hello ${args.join(' ')}${flags.loud ? '!' : ''} from ${home ? 'markback' : '?'}`)",
  'count.mjs': "export default (answers, { app }) => `${app}: ${answers.length} answers, ${answers.filter(a => a.verdict === 'changes').length} with changes`",
})

test('adding says plugins run code here and what it adds, and adds nothing without a yes', () => {
  const run = spawnSync('node', [CLI, 'plugin', 'add', hello], { env, encoding: 'utf8', input: '' })
  assert.equal(run.status, 2)
  assert.match(run.stdout, /Plugins run code on your computer\. Add only ones you trust\./)
  assert.match(run.stdout, /hello 1\.0\.0 adds: command review hello greet, export count\. No network\./)
  assert.match(run.stdout, /Nothing added/)
  assert.equal(existsSync(join(home, 'plugins', 'hello')), false)
})

test('with a yes it is added, listed, and its command runs', () => {
  assert.match(review('plugin', 'add', hello, '--yes'), /Added hello\./)
  assert.match(review('plugin', 'list'), /hello 1\.0\.0: Says hello\n {2}command review hello greet, export count\. No network\./)
  assert.equal(review('hello', 'greet', 'there').trim(), 'hello there from markback')
  assert.equal(review('hello', 'greet', 'you', 'two', '--loud').trim(), 'hello you two! from markback', 'the words after the command; flags as flags')
})

test('an export turns an app\'s latest answers into text, to the screen or a file', () => {
  const picture = join(home, 'p.png')
  writePicture(picture, 8, 5)
  push({ app: 'Shop', screen: 'One', after: picture })
  push({ app: 'Shop', screen: 'Two', after: picture })
  receive({ appSlug: 'shop', id: 'one', png: null, shapes: [], notes: 'Move it', verdict: 'changes', imageSize: { w: 8, h: 5 } })
  receive({ appSlug: 'shop', id: 'two', png: null, shapes: [], notes: '', verdict: 'approved', imageSize: { w: 8, h: 5 } })
  assert.equal(review('export', '--app', 'Shop', '--as', 'count').trim(), 'Shop: 2 answers, 1 with changes')
  const out = join(home, 'count.txt')
  review('export', '--app', 'Shop', '--as', 'count', '--out', out)
  assert.equal(readFileSync(out, 'utf8'), 'Shop: 2 answers, 1 with changes')
  assert.match(spawnSync('node', [CLI, 'export', '--app', 'Shop', '--as', 'nothing'], { env, encoding: 'utf8' }).stderr, /No plugin adds an export called nothing/)
})

test('a repository with several plugins adds each; remove takes one away', () => {
  const repo = join(home, 'sources', 'many')
  mkdirSync(repo, { recursive: true })
  for (const name of ['one-a', 'one-b']) {
    mkdirSync(join(repo, name))
    writeFileSync(join(repo, name, 'plugin.json'), JSON.stringify({ name, exports: { [name]: 'x.mjs' } }))
    writeFileSync(join(repo, name, 'x.mjs'), 'export default () => "x"')
  }
  assert.match(review('plugin', 'add', repo, '--yes'), /Added one-a, one-b\./)
  assert.match(review('plugin', 'remove', 'one-a'), /Removed one-a\./)
  assert.doesNotMatch(review('plugin', 'list'), /one-a/)
  assert.match(review('plugin', 'list'), /one-b/)
})

test('a plugin that takes one of Markback\'s names, reaches outside its folder, adds nothing or is not JSON is refused', () => {
  const cases = [
    [plugin('taken', { name: 'push', commands: { x: 'x.mjs' } }, { 'x.mjs': '' }), /one of Markback's own commands/],
    [plugin('outside', { name: 'outside', commands: { x: '../hello/greet.mjs' } }, {}), /outside the plugin's folder/],
    [plugin('empty', { name: 'empty' }, {}), /adds nothing/],
    [plugin('missing', { name: 'missing', exports: { y: 'y.mjs' } }, {}), /is named in plugin\.json but is not there/],
  ]
  const linked = plugin('linked', { name: 'linked', commands: { x: 'x.mjs' } }, {})
  symlinkSync(join(hello, 'greet.mjs'), join(linked, 'x.mjs'))
  cases.push([linked, /outside the plugin's folder/])
  const broken = join(home, 'sources', 'broken')
  mkdirSync(broken)
  writeFileSync(join(broken, 'plugin.json'), '{ not json')
  cases.push([broken, /reads as JSON/])
  for (const [dir, why] of cases) {
    const run = spawnSync('node', [CLI, 'plugin', 'add', dir, '--yes'], { env, encoding: 'utf8' })
    assert.notEqual(run.status, 0)
    assert.match(run.stderr, why)
  }
})

test('an address that is neither a folder nor git is not run as anything', () => {
  const run = spawnSync('node', [CLI, 'plugin', 'add', 'x; touch pwned', '--yes'], { env, encoding: 'utf8', cwd: home })
  assert.notEqual(run.status, 0)
  assert.match(run.stderr, /neither a folder here nor a git address/)
  assert.equal(existsSync(join(home, 'pwned')), false)
})

test('adding over a plugin says it replaces it; one export name, one plugin; remove with no name says so; nothing fetched is left behind', () => {
  assert.match(review('plugin', 'add', hello, '--yes'), /It replaces the hello 1\.0\.0 you have\./)
  const clash = plugin('clash', { name: 'clash', exports: { count: 'c.mjs' } }, { 'c.mjs': 'export default () => ""' })
  assert.match(spawnSync('node', [CLI, 'plugin', 'add', clash, '--yes'], { env, encoding: 'utf8' }).stderr, /hello already adds an export called count/)
  assert.match(spawnSync('node', [CLI, 'plugin', 'remove'], { env, encoding: 'utf8' }).stderr, /Say which/)
  const pair = join(home, 'sources', 'pair')
  for (const name of ['pair-a', 'pair-b']) {
    mkdirSync(join(pair, name), { recursive: true })
    writeFileSync(join(pair, name, 'plugin.json'), JSON.stringify({ name, exports: { same: 'x.mjs' } }))
    writeFileSync(join(pair, name, 'x.mjs'), 'export default () => ""')
  }
  assert.match(spawnSync('node', [CLI, 'plugin', 'add', pair, '--yes'], { env, encoding: 'utf8' }).stderr, /already adds an export called same/)
})

test('a link in a plugin that leads outside its folder is not copied in', () => {
  const dir = plugin('leaky', { name: 'leaky', exports: { leaky: 'x.mjs' } }, { 'x.mjs': 'export default () => ""' })
  symlinkSync(home, join(dir, 'everything'))
  review('plugin', 'add', dir, '--yes')
  assert.equal(existsSync(join(home, 'plugins', 'leaky', 'x.mjs')), true)
  assert.equal(existsSync(join(home, 'plugins', 'leaky', 'everything')), false)
})
