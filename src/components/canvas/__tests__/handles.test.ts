import { describe, expect, it } from 'vitest'
import {
  HANDLE_HIT, applyHandleResize, boxHandlePositions, findHandleHit, handleCursorStyle,
} from '../handles'
import { clamp, computeContentBounds, snapAngle, unionBounds } from '../geometry'
import { arrow, num, rect, text } from '../../../lib/__tests__/fixtures'

describe('boxHandlePositions', () => {
  it('places eight handles around the padded box, in screen space', () => {
    // scale 2, origin (10, 20), 3px of selection padding.
    const h = boxHandlePositions({ x: 0, y: 0, w: 50, h: 25 }, 10, 20, 2, 3)
    expect(h.map((p) => p.id)).toEqual(['tl', 'tc', 'tr', 'ml', 'mr', 'bl', 'bc', 'br'])
    const by = Object.fromEntries(h.map((p) => [p.id, [p.cx, p.cy]]))
    expect(by.tl).toEqual([7, 17])
    expect(by.br).toEqual([7 + 106, 17 + 56])
    expect(by.tc).toEqual([7 + 53, 17])
    expect(by.ml).toEqual([7, 17 + 28])
  })
})

describe('findHandleHit', () => {
  const handles = boxHandlePositions({ x: 0, y: 0, w: 100, h: 100 }, 0, 0, 1, 0)

  it('hits a handle within its square tolerance', () => {
    expect(findHandleHit(0, 0, handles)).toBe('tl')
    expect(findHandleHit(HANDLE_HIT, HANDLE_HIT, handles)).toBe('tl')
  })

  it('misses just outside it', () => {
    expect(findHandleHit(HANDLE_HIT + 1, HANDLE_HIT + 1, handles)).toBeNull()
  })

  it('returns the first match, so handle order is the priority order', () => {
    // 'tc' and 'tr' never overlap here, but the contract matters for the
    // magnifier's two boxes, which can.
    expect(findHandleHit(50, 0, handles)).toBe('tc')
  })
})

describe('applyHandleResize', () => {
  const box = { x: 100, y: 100, w: 200, h: 100 }

  it('moves only the dragged edge', () => {
    expect(applyHandleResize(box, 'mr', 50, 999)).toEqual({ x: 100, y: 100, w: 250, h: 100 })
    expect(applyHandleResize(box, 'bc', 999, 50)).toEqual({ x: 100, y: 100, w: 200, h: 150 })
  })

  it('moves the origin when dragging a top or left edge', () => {
    expect(applyHandleResize(box, 'tl', 10, 20)).toEqual({ x: 110, y: 120, w: 190, h: 80 })
  })

  it('ignores lockAspect on an edge handle', () => {
    // Only corners can scale uniformly; an edge has one axis to work with.
    expect(applyHandleResize(box, 'mr', 50, 0, true)).toEqual(applyHandleResize(box, 'mr', 50, 0))
  })

  it('keeps the opposite corner fixed while locked', () => {
    const r = applyHandleResize(box, 'br', 100, 0, true)
    expect([r.x, r.y]).toEqual([100, 100])
    expect(r.w / r.h).toBeCloseTo(box.w / box.h, 10)

    const tl = applyHandleResize(box, 'tl', -100, 0, true)
    expect(tl.x + tl.w).toBeCloseTo(300, 10)
    expect(tl.y + tl.h).toBeCloseTo(200, 10)
  })

  it('scales by the dominant axis while locked', () => {
    // A mostly-horizontal drag takes the width's scale factor.
    const r = applyHandleResize(box, 'br', 200, 5, true)
    expect(r.w).toBeCloseTo(400, 10)
    expect(r.h).toBeCloseTo(200, 10)
  })

  it('leaves a zero-sized box alone rather than dividing by it', () => {
    const flat = { x: 0, y: 0, w: 0, h: 0 }
    expect(applyHandleResize(flat, 'br', 10, 10, true)).toEqual({ x: 0, y: 0, w: 10, h: 10 })
  })
})

describe('handleCursorStyle', () => {
  it('gives each handle its own direction', () => {
    expect(handleCursorStyle('tl')).not.toBe(handleCursorStyle('tr'))
    expect(handleCursorStyle('tc')).not.toBe(handleCursorStyle('ml'))
  })

  it('rotates with the shape', () => {
    // A 90-degree rect's top edge points sideways on screen.
    expect(handleCursorStyle('tc', 90)).not.toBe(handleCursorStyle('tc', 0))
  })
})

describe('snapAngle', () => {
  it('snaps to the nearest 45 degrees, keeping the length', () => {
    const p = snapAngle(0, 0, 100, 10)
    expect(p.x).toBeCloseTo(Math.hypot(100, 10), 6)
    expect(p.y).toBeCloseTo(0, 6)
  })

  it('snaps a near-diagonal to the diagonal', () => {
    const p = snapAngle(0, 0, 100, 90)
    expect(p.x).toBeCloseTo(p.y, 6)
  })

  it('leaves a sub-pixel drag alone', () => {
    expect(snapAngle(5, 5, 5.2, 5.3)).toEqual({ x: 5.2, y: 5.3 })
  })
})

describe('clamp', () => {
  it('bounds on both sides and passes the middle through', () => {
    expect(clamp(-5, 0, 10)).toBe(0)
    expect(clamp(15, 0, 10)).toBe(10)
    expect(clamp(5, 0, 10)).toBe(5)
  })
})

describe('unionBounds', () => {
  it('covers both boxes', () => {
    expect(unionBounds({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 5, w: 10, h: 10 }))
      .toEqual({ x: 0, y: 0, w: 30, h: 15 })
  })
})

describe('computeContentBounds', () => {
  it('is the image itself when nothing reaches outside it', () => {
    expect(computeContentBounds([rect({ id: 'r', x: 10, y: 10, w: 20, h: 20 })], 100, 80))
      .toEqual({ x: 0, y: 0, w: 100, h: 80 })
  })

  it('grows to cover an annotation placed off the image', () => {
    expect(computeContentBounds([rect({ id: 'r', x: -30, y: 10, w: 20, h: 20 })], 100, 80))
      .toEqual({ x: -30, y: 0, w: 130, h: 80 })
  })

  it('measures core bounds, so a thick stroke near an edge does not grow it', () => {
    // getAnnotationCoreBounds excludes the stroke halo — see its doc comment.
    expect(computeContentBounds([arrow({ id: 'a', sw: 20, x1: 0, y1: 0, x2: 50, y2: 50 })], 100, 80))
      .toEqual({ x: 0, y: 0, w: 100, h: 80 })
  })

  it('accounts for every annotation, not just the first', () => {
    const b = computeContentBounds([
      num({ id: 'n', cx: -50, cy: 40, r: 10 }),
      text({ id: 't', x: 200, y: 10, text: 'ab', fontSize: 40 }),
    ], 100, 80)
    expect(b.x).toBe(-60)
    expect(b.x + b.w).toBeGreaterThan(200)
  })
})
