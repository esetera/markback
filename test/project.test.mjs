import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

const home = mkdtempSync(join(tmpdir(), 'review-project-'))
process.env.REVIEW_HOME = home
const { findApp, linksIn, portOf } = await import('../lib/project.mjs')
after(() => rmSync(home, { recursive: true, force: true }))
const folder = (name, files) => {
  const dir = join(home, name)
  mkdirSync(dir, { recursive: true })
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  return dir
}

test('the port a script says, or its tool usual one', () => {
  assert.equal(portOf('vite'), 5173)
  assert.equal(portOf('vite preview'), 4173)
  assert.equal(portOf('next dev'), 3000)
  assert.equal(portOf('astro dev'), 4321)
  assert.equal(portOf('node server.js --port 4600'), 4600)
  assert.equal(portOf('PORT=4601 node server.js'), 4601)
  assert.equal(portOf('python3 -m http.server'), 8000)
  assert.equal(portOf('node server.js'), null)
})

test('a project with a script that is not running: how to start it, and nothing is run', async () => {
  const found = await findApp(folder('recipes', { 'package.json': JSON.stringify({ scripts: { build: 'x', dev: 'node server.js --port 4611' } }) }))
  assert.deepEqual(found, { name: 'recipes', run: { command: 'npm run dev', script: 'dev', port: 4611 } })
})

test('a project whose app is already running is found at its own port', async () => {
  const server = createServer((req, res) => res.end('<a href="/x">X</a>')).listen(4612)
  await new Promise(r => server.once('listening', r))
  try {
    const found = await findApp(folder('running', { 'package.json': JSON.stringify({ scripts: { start: 'node s.js --port 4612' } }) }))
    assert.equal(found.running, 'http://localhost:4612/')
  } finally {
    server.close()
  }
})

test('a folder with only a page opens the page; an empty folder has no app yet', async () => {
  const page = await findApp(folder('static', { 'public/index.html': '<h1>Hi</h1>' }))
  assert.match(page.file, /^file:\/\/.*\/static\/public\/index\.html$/)
  assert.deepEqual(await findApp(folder('empty', {})), { name: 'empty' })
})

test('the main screens are the app own links: same place, each once, no anchors or mail, named by their words', () => {
  const html = `<nav><a href="/">Home</a><a href="/recipes">Recipes</a><a href="/recipes#top">Top</a><a href="mailto:a@b.c">Mail</a>
    <a href="https://elsewhere.example/">Away</a><a href="/new"><span>New</span> recipe</a><a href="/recipes">Again</a><a href="/about"></a></nav>`
  assert.deepEqual(linksIn(html, 'http://localhost:5173/'), [
    { url: 'http://localhost:5173/recipes', name: 'Recipes' },
    { url: 'http://localhost:5173/new', name: 'New recipe' },
    { url: 'http://localhost:5173/about', name: 'about' },
  ])
})
