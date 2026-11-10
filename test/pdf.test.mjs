import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { MOST_PAGES, pagesOf } from '../lib/pdf.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const CLI = join(here, '..', 'review.mjs')
const work = mkdtempSync(join(tmpdir(), 'review-pdf-'))
after(() => rmSync(work, { recursive: true, force: true }))

/** A real PDF of blank pages, written by hand so a test needs no PDF files and no install. */
function writePdf(path, pages) {
  const kids = Array.from({ length: pages }, (_, n) => `${n + 3} 0 R`).join(' ')
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`, ...Array.from({ length: pages }, () => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] >>')]
  let text = '%PDF-1.4\n'
  const at = objects.map((body, n) => {
    const offset = text.length
    text += `${n + 1} 0 obj\n${body}\nendobj\n`
    return offset
  })
  const xref = text.length
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${at.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  writeFileSync(path, text)
}

/** A stand-in for pdftoppm: it takes the same words and writes a picture for each page asked for, up to the pages it "has". */
function standIn(has) {
  const tool = join(work, `pdftoppm-${has}`)
  writeFileSync(tool, `#!/usr/bin/env node
import { writePicture } from ${JSON.stringify(pathToFileURL(join(here, 'helpers.mjs')).href)}
const words = process.argv.slice(2)
const from = Number(words[words.indexOf('-f') + 1]), to = Math.min(Number(words[words.indexOf('-l') + 1]), ${has})
const wide = String(${has}).length
for (let n = from; n <= to; n++) writePicture(words.at(-1) + '-' + String(n).padStart(wide, '0') + '.png', 60, 40)
`)
  chmodSync(tool, 0o755)
  // A script without .mjs in its name runs as a module only when a package.json beside it says so.
  writeFileSync(join(work, 'package.json'), '{"type":"module"}')
  return tool
}

const review = (home, words, env = {}) => spawnSync('node', [CLI, ...words], { env: { ...process.env, REVIEW_HOME: home, REVIEW_PDFTOPPM: '', REVIEW_PDFINFO: join(work, 'no-pdfinfo'), ...env }, encoding: 'utf8' })
const screens = home => execFileSync('node', [CLI, 'list'], { env: { ...process.env, REVIEW_HOME: home }, encoding: 'utf8' })

test('the pages someone asks for', () => {
  assert.deepEqual(pagesOf(undefined), { from: 1, to: MOST_PAGES, chosen: false })
  assert.deepEqual(pagesOf('3'), { from: 3, to: 3, chosen: true })
  assert.deepEqual(pagesOf('2-5'), { from: 2, to: 5, chosen: true })
  for (const wrong of ['0', '5-2', 'all', '1,2', '-3']) assert.throws(() => pagesOf(wrong), /--pages takes/)
})

test('a PDF becomes a screen for each page, in order, with what to look at said once', () => {
  const home = mkdtempSync(join(work, 'home-'))
  const pdf = join(work, 'Spring brochure.pdf')
  writePdf(pdf, 12)
  const ran = review(home, ['pdf', pdf, '--check', 'Is the heading right?'], { REVIEW_PDFTOPPM: standIn(12) })
  assert.equal(ran.status, 0, ran.stderr)
  assert.match(ran.stdout, /Queued Spring brochure, pages 1 to 12 of 12\. Open .*#spring-brochure/)
  const listed = screens(home).split('\n').filter(line => line.includes('Page'))
  assert.deepEqual(listed.map(line => line.match(/Page \d+/)[0]), Array.from({ length: 12 }, (_, n) => `Page ${n + 1}`), 'page 10 comes after page 9, not after page 1')
  const queued = JSON.parse(execFileSync('node', ['-e', `import(${JSON.stringify(pathToFileURL(join(here, '..', 'lib', 'store.mjs')).href)}).then(s => console.log(JSON.stringify(s.listScreens('spring-brochure'))))`], { env: { ...process.env, REVIEW_HOME: home }, encoding: 'utf8' }))
  assert.deepEqual(queued.map(s => s.check ?? []), [['Is the heading right?'], ...Array.from({ length: 11 }, () => [])])
  assert.deepEqual(readdirSync(join(home, 'shots')), [], 'the working pictures are cleared away once they are copied')
  assert.ok(queued.every(s => s.round === 1 && !s.before), 'a first showing has no before picture')
  // Shown again after a change: round 2 of each page, with the page as it was as its before picture.
  assert.equal(review(home, ['pdf', pdf], { REVIEW_PDFTOPPM: standIn(12) }).status, 0)
  const again = JSON.parse(execFileSync('node', ['-e', `import(${JSON.stringify(pathToFileURL(join(here, '..', 'lib', 'store.mjs')).href)}).then(s => console.log(JSON.stringify(s.listScreens('spring-brochure'))))`], { env: { ...process.env, REVIEW_HOME: home }, encoding: 'utf8' }))
  assert.ok(again.every(s => s.round === 2 && /-before-/.test(s.before)), 'each page has its before')
  assert.deepEqual(again.map(s => s.screen), queued.map(s => s.screen), 'and keeps its place')
})

test('a long PDF stops at the most it shows unasked, and says how to ask for more', () => {
  const home = mkdtempSync(join(work, 'home-'))
  const pdf = join(work, 'book.pdf')
  writePdf(pdf, 2)
  const tool = standIn(212)
  const first = review(home, ['pdf', pdf], { REVIEW_PDFTOPPM: tool })
  assert.match(first.stdout, new RegExp(`Queued book, pages 1 to ${MOST_PAGES}\\. Open`))
  assert.match(first.stdout, new RegExp(`--pages ${MOST_PAGES + 1}-${MOST_PAGES * 2}`))
  const chosen = review(home, ['pdf', pdf, '--pages', '40-41', '--app', 'The book'], { REVIEW_PDFTOPPM: tool })
  assert.match(chosen.stdout, /Queued The book, pages 40 to 41\. Open/)
  assert.doesNotMatch(chosen.stdout, /more pages/)
})

test('a PDF of exactly the most it shows has no more pages to ask for', () => {
  const home = mkdtempSync(join(work, 'home-'))
  const pdf = join(work, 'thirty.pdf')
  writePdf(pdf, 2)
  const ran = review(home, ['pdf', pdf], { REVIEW_PDFTOPPM: standIn(MOST_PAGES) })
  assert.match(ran.stdout, new RegExp(`Queued thirty, pages 1 to ${MOST_PAGES} of ${MOST_PAGES}\\. Open`))
  assert.doesNotMatch(ran.stdout, /more pages/)
})

test('pages keep their order however they are asked for, and pages the PDF has lost leave the review page', () => {
  const home = mkdtempSync(join(work, 'home-'))
  const pdf = join(work, 'report.pdf')
  writePdf(pdf, 2)
  const pagesListed = () => screens(home).split('\n').filter(line => line.includes('Page')).map(line => line.match(/Page \d+/)[0])
  // The file can come after the flags.
  assert.equal(review(home, ['pdf', '--pages', '3', pdf], { REVIEW_PDFTOPPM: standIn(5) }).status, 0)
  assert.equal(review(home, ['pdf', pdf], { REVIEW_PDFTOPPM: standIn(5) }).status, 0)
  assert.deepEqual(pagesListed(), ['Page 1', 'Page 2', 'Page 3', 'Page 4', 'Page 5'])
  // Two pages cut from the document: shown again, only three are left to review.
  assert.equal(review(home, ['pdf', pdf], { REVIEW_PDFTOPPM: standIn(3) }).status, 0)
  assert.deepEqual(pagesListed(), ['Page 1', 'Page 2', 'Page 3'])
})

test('what goes wrong is said plainly', () => {
  const home = mkdtempSync(join(work, 'home-'))
  const pdf = join(work, 'short.pdf')
  writePdf(pdf, 2)
  assert.match(review(home, ['pdf']).stderr, /Say which PDF/)
  assert.match(review(home, ['pdf', join(work, 'none.pdf')]).stderr, /No PDF at/)
  assert.match(review(home, ['pdf', pdf, '--pages', 'two']).stderr, /--pages takes/)
  assert.match(review(home, ['pdf', pdf, '--pages', '1-99999999999999999999']).stderr, /--pages takes/)
  assert.match(review(home, ['pdf', pdf, '--pages', '9'], { REVIEW_PDFTOPPM: standIn(2) }).stderr, /No page 9 in short\.pdf/)
  const none = review(home, ['pdf', pdf], { REVIEW_PDFTOPPM: join(work, 'not-installed') })
  assert.equal(none.status, 1)
  assert.match(none.stderr, /needs pdftoppm/)
})

test('on a Mac, its own PDF engine draws the pages with nothing installed', { skip: process.platform !== 'darwin' }, () => {
  const home = mkdtempSync(join(work, 'home-'))
  const pdf = join(work, 'mac.pdf')
  writePdf(pdf, 3)
  const ran = review(home, ['pdf', pdf, '--pages', '2-3'])
  assert.equal(ran.status, 0, ran.stderr)
  assert.match(ran.stdout, /Queued mac, pages 2 to 3 of 3\. Open/)
  const past = review(home, ['pdf', pdf, '--pages', '7'])
  assert.match(past.stderr, /mac\.pdf has 3 pages\./)
  const notOne = join(work, 'notes.pdf')
  writeFileSync(notOne, 'not a PDF at all')
  assert.match(review(home, ['pdf', notOne]).stderr, /notes\.pdf could not be read as a PDF\./)
})

test('with pdfinfo beside pdftoppm the count is known, so pages lost from a long PDF leave too', () => {
  const home = mkdtempSync(join(work, 'home-'))
  const pdf = join(work, 'long.pdf')
  writePdf(pdf, 2)
  const info = pages => {
    const tool = join(work, `pdfinfo-${pages}`)
    writeFileSync(tool, `#!/bin/sh\necho "Title:          long"\necho "Pages:          ${pages}"\n`)
    chmodSync(tool, 0o755)
    return tool
  }
  const pagesListed = () => screens(home).split('\n').filter(line => line.includes('Page')).length
  const first = review(home, ['pdf', pdf, '--pages', '31-40'], { REVIEW_PDFTOPPM: standIn(40), REVIEW_PDFINFO: info(40) })
  assert.match(first.stdout, /Queued long, pages 31 to 40 of 40\. Open/)
  assert.equal(pagesListed(), 10)
  const cut = review(home, ['pdf', pdf, '--pages', '31-40'], { REVIEW_PDFTOPPM: standIn(35), REVIEW_PDFINFO: info(35) })
  assert.match(cut.stdout, /Queued long, pages 31 to 35 of 35\. Open/)
  assert.equal(pagesListed(), 5)
})

test('taking a screen off never reaches outside the app', async () => {
  const { removeScreen } = await import('../lib/store.mjs')
  assert.throws(() => removeScreen('report', '../../victim'), /No screen/)
  assert.throws(() => removeScreen('../report', 'page-1'), /No screen/)
})
