import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drawAnnotation } from '../annotations'
import type { Annotation } from '../annotations'
import { arrow, blur, ellipse, erase, highlight, image, line, magnifier, num, pen, rect, spotlight, text } from './fixtures'

/**
 * A canvas 2D context that absorbs everything.
 *
 * These tests don't check pixels — there is no renderer in node to check them
 * against. They check the one thing the module split could plausibly have
 * broken: that every annotation type still reaches its own draw function and
 * runs to completion. A mis-wired dispatch, a `break` that became a `return`
 * in the wrong place, or a helper left behind in the wrong module all surface
 * here as a throw.
 */
function stubContext(calls: string[]): CanvasRenderingContext2D {
  const target: Record<string, unknown> = {
    canvas: { width: 800, height: 600 },
  }
  return new Proxy(target, {
    get(t, prop: string) {
      if (prop in t) return t[prop]
      if (prop === 'measureText') return (s: string) => ({ width: s.length * 8 })
      if (prop === 'getTransform') return () => ({ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 })
      if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })
      if (prop === 'createPattern' || prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        return () => ({ addColorStop() {} })
      }
      return (...args: unknown[]) => {
        calls.push(`${prop}(${args.length})`)
        return undefined
      }
    },
    set(t, prop: string, value) {
      t[prop] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D
}

/** Minimal `document` so the cases that render through an offscreen canvas
 *  (text's silhouette shadow, the erase mask's effect pass) have one. */
const fakeDocument = {
  createElement: (tag: string) => {
    if (tag !== 'canvas') return {}
    const el: Record<string, unknown> = { width: 0, height: 0 }
    el.getContext = () => stubContext([])
    el.toDataURL = () => 'data:image/png;base64,'
    return el
  },
}

let hadDocument = false
beforeAll(() => {
  hadDocument = 'document' in globalThis
  if (!hadDocument) (globalThis as Record<string, unknown>).document = fakeDocument
})
afterAll(() => {
  if (!hadDocument) delete (globalThis as Record<string, unknown>).document
})

const ALL: [string, Annotation][] = [
  ['arrow', arrow({ id: 'a' })],
  ['arrow (elbow, double-ended)', arrow({ id: 'a', style: 'elbow', doubleEnded: true, bendRatio: 0.3 })],
  ['arrow (glow)', arrow({ id: 'a', shadowStyle: 'glow' })],
  ['line', line({ id: 'l' })],
  ['line (dashed)', line({ id: 'l', dash: 'dashed' })],
  ['pen', pen({ id: 'p', points: [{ x: 0, y: 0 }, { x: 5, y: 8 }, { x: 12, y: 3 }] })],
  ['pen (rotated)', pen({ id: 'p', points: [{ x: 0, y: 0 }, { x: 5, y: 8 }], rotation: 40 })],
  ['rect', rect({ id: 'r' })],
  ['rect (rounded, filled, shadowed)', rect({ id: 'r', radius: 8, fill: 'solid', shadowStyle: 'drop' })],
  ['rect (semi, rotated)', rect({ id: 'r', fill: 'semi', rotation: 30 })],
  ['ellipse', ellipse({ id: 'e' })],
  ['ellipse (filled)', ellipse({ id: 'e', fill: 'solid' })],
  ['text (plain)', text({ id: 't' })],
  ['text (box)', text({ id: 't', shape: 'box' })],
  ['text (bubble)', text({ id: 't', shape: 'bubble', tailAnchor: 'e2' })],
  ['text (white fill)', text({ id: 't', shape: 'box', bgFill: 'white' })],
  ['text (stroke fill, centered, multiline)', text({ id: 't', shape: 'box', bgFill: 'stroke', align: 'center', text: 'ab\ncde' })],
  ['number (circle)', num({ id: 'n' })],
  ['number (square)', num({ id: 'n', shape: 'square' })],
  ['highlight', highlight({ id: 'h' })],
  ['blur (no image)', blur({ id: 'b' })],
  ['blur (legacy preset)', blur({ id: 'b', strength: 'high' })],
  ['spotlight (square)', spotlight({ id: 's' })],
  ['spotlight (circle)', spotlight({ id: 's', shape: 'circle', dim: 0.8 })],
  ['erase (undecoded mask)', erase({ id: 'x' })],
  ['erase (fill effect)', erase({ id: 'x', effect: 'fill', fillColor: '#00FF00' })],
  ['image (undecoded)', image({ id: 'i' })],
  ['image (bordered)', image({ id: 'i', border: true })],
  ['magnifier (no image)', magnifier({ id: 'm' })],
  ['magnifier (circle)', magnifier({ id: 'm', shape: 'circle' })],
  ['rect (outline)', rect({ id: 'r', shadowStyle: 'outline', shadowSize: 50 })],
  ['arrow (outline)', arrow({ id: 'a', shadowStyle: 'outline', shadowSize: 50 })],
  ['text (box, outline)', text({ id: 't', shape: 'box', shadowStyle: 'outline', shadowSize: 50 })],
  ['image (outline)', image({ id: 'i', shadowStyle: 'outline', shadowSize: 50 })],
]

describe('drawAnnotation dispatch', () => {
  for (const [label, ann] of ALL) {
    it(`draws ${label} without throwing`, () => {
      const calls: string[] = []
      expect(() => drawAnnotation(stubContext(calls), ann)).not.toThrow()
    })
  }

  it('balances save/restore even when the type is degenerate', () => {
    // An unmatched save() would compound across redraws and push the whole
    // scene off-canvas — see drawAnnotation's own comment.
    const calls: string[] = []
    drawAnnotation(stubContext(calls), rect({ id: 'r', w: 0, h: 0 }))
    expect(calls.filter((c) => c.startsWith('save')).length)
      .toBe(calls.filter((c) => c.startsWith('restore')).length)
  })

  it('paints an outline as a layer under the shape, then the shape itself', () => {
    const calls: string[] = []
    drawAnnotation(stubContext(calls), rect({ id: 'r', shadowStyle: 'outline', shadowSize: 50 }))
    const layer = calls.findIndex((c) => c.startsWith('drawImage'))
    expect(layer).toBeGreaterThanOrEqual(0)
    expect(calls.findIndex((c, i) => i > layer && c.startsWith('stroke'))).toBeGreaterThan(layer)
  })

  it('reaches the type-specific renderer rather than returning early', () => {
    const calls: string[] = []
    drawAnnotation(stubContext(calls), num({ id: 'n' }))
    expect(calls.some((c) => c.startsWith('fillText'))).toBe(true)
  })
})
