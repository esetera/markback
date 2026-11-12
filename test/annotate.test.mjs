import './own-home.mjs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { COLOURS, fitZoom, isReal, redone, shapeOf, startHistory, undone, withMark, withMarks, zoomedBy } from '../public/annotate.js'

test('the shapes stay what the inbox has always held', () => {
  assert.deepEqual(COLOURS.map(c => c.id), ['red', 'amber', 'blue', 'black'])
  assert.deepEqual(shapeOf({ tool: 'box', a: [10, 10], b: [110, 60], color: '#d42a20', w: 3 }), { type: 'box', colour: 'red', box: { x: 10, y: 10, w: 100, h: 50 } })
  assert.equal(isReal({ tool: 'box', a: [0, 0], b: [2, 2], color: 'r', w: 3 }), false)
})

test('undo, redo and zoom', () => {
  const box = { tool: 'box', a: [0, 0], b: [40, 40], color: 'r', w: 3 }
  let d = withMark(startHistory(), box)
  d = withMarks(d, [])
  assert.equal(undone(d).marks.length, 1)
  assert.equal(redone(undone(d)).marks.length, 0)
  assert.equal(zoomedBy(5.5, 1.25), 6)
  assert.equal(fitZoom({ width: 1000, height: 1000 }, { width: 2000, height: 1000 }), 0.5)
})
