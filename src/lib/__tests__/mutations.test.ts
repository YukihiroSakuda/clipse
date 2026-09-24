import { describe, expect, it } from 'vitest'
import { boundsToAnnotation, nudgeIntoView, shiftAnnotation } from '../store/mutations'
import { getAnnotationLocalBounds } from '../annotations'
import type { PenAnn } from '../annotations'
import { arrow, ellipse, image, magnifier, num, pen, rect, text } from './fixtures'

describe('boundsToAnnotation', () => {
  const box = { x: 10, y: 20, w: 200, h: 100 }

  it('is the inverse of getAnnotationLocalBounds for box shapes', () => {
    for (const ann of [rect({ id: 'r' }), image({ id: 'i' })]) {
      expect(getAnnotationLocalBounds(boundsToAnnotation(ann, box))).toEqual(box)
    }
  })

  it('maps an ellipse back to its center and radii', () => {
    const e = boundsToAnnotation(ellipse({ id: 'e' }), box)
    expect(e).toMatchObject({ cx: 110, cy: 70, rx: 100, ry: 50 })
    expect(getAnnotationLocalBounds(e)).toEqual(box)
  })

  it('keeps a number marker circular, taking the shorter side', () => {
    const n = boundsToAnnotation(num({ id: 'n' }), box)
    expect(n).toMatchObject({ cx: 110, cy: 70, r: 50 })
  })

  it('solves a text box back to a font size that reproduces its height', () => {
    // Within a pixel, not exactly: `fontSizeAndOriginForBounds` rounds to a
    // whole font size and approximates the padding/tail continuously (see its
    // own comment), so the reproduced height carries sub-pixel noise. What
    // matters is that a drag does not make the box visibly jump.
    const t = boundsToAnnotation(text({ id: 't', shape: 'box', text: 'ab' }), box)
    expect(getAnnotationLocalBounds(t)!.h).toBeCloseTo(box.h, 0)
  })

  it('leaves types with no resizable box alone', () => {
    const a = arrow({ id: 'a' })
    expect(boundsToAnnotation(a, box)).toBe(a)
  })
})

describe('boundsToAnnotation — pen', () => {
  // A freehand stroke has no box of its own, so a resize rewrites every point.
  // The target box is the *padded* one getAnnotationLocalBounds reports, and
  // stroke width does not scale with the drag — so the halo has to be
  // subtracted before mapping and added back after, or the stroke creeps away
  // from the handle being dragged by more the thicker it is.
  const stroke = (sw: number) => pen({
    id: 'p', sw,
    points: [{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 20 }],
  })

  it('round-trips through its own reported bounds', () => {
    const p = stroke(4)
    const b = getAnnotationLocalBounds(p)!
    const resized = boundsToAnnotation(p, b) as PenAnn
    for (let i = 0; i < p.points.length; i++) {
      expect(resized.points[i].x).toBeCloseTo(p.points[i].x, 6)
      expect(resized.points[i].y).toBeCloseTo(p.points[i].y, 6)
    }
  })

  it('lands exactly on the requested box after the resize', () => {
    const target = { x: 100, y: 50, w: 84, h: 44 }
    const resized = boundsToAnnotation(stroke(4), target)
    const got = getAnnotationLocalBounds(resized)!
    expect(got.x).toBeCloseTo(target.x, 6)
    expect(got.y).toBeCloseTo(target.y, 6)
    expect(got.w).toBeCloseTo(target.w, 6)
    expect(got.h).toBeCloseTo(target.h, 6)
  })

  it('lands on the box for a thick stroke too — the halo is not scaled', () => {
    // This is the case that drifts if the halo is mapped along with the points.
    const target = { x: 100, y: 50, w: 120, h: 90 }
    const got = getAnnotationLocalBounds(boundsToAnnotation(stroke(24), target))!
    expect(got.x).toBeCloseTo(target.x, 6)
    expect(got.w).toBeCloseTo(target.w, 6)
    expect(got.h).toBeCloseTo(target.h, 6)
  })

  it('does not scale the stroke width itself', () => {
    const resized = boundsToAnnotation(stroke(4), { x: 0, y: 0, w: 400, h: 400 }) as PenAnn
    expect(resized.sw).toBe(4)
  })

  it('centers a flat stroke instead of pinning it to an edge', () => {
    // A perfectly horizontal stroke has no vertical extent to scale by.
    const flat = pen({ id: 'p', sw: 4, points: [{ x: 0, y: 5 }, { x: 10, y: 5 }] })
    const target = { x: 0, y: 0, w: 104, h: 104 }
    const resized = boundsToAnnotation(flat, target) as PenAnn
    const ys = resized.points.map((p) => p.y)
    expect(ys[0]).toBeCloseTo(ys[1], 6)
    // Centered in the target's inner (halo-subtracted) box.
    expect(ys[0]).toBeCloseTo(target.y + flat.sw / 2 + (target.h - flat.sw) / 2, 6)
  })
})

describe('shiftAnnotation', () => {
  it('translates every type by the same delta', () => {
    expect(shiftAnnotation(rect({ id: 'r', x: 1, y: 2 }), 10, 20)).toMatchObject({ x: 11, y: 22 })
    expect(shiftAnnotation(ellipse({ id: 'e', cx: 1, cy: 2 }), 10, 20)).toMatchObject({ cx: 11, cy: 22 })
    expect(shiftAnnotation(num({ id: 'n', cx: 1, cy: 2 }), 10, 20)).toMatchObject({ cx: 11, cy: 22 })
    expect(shiftAnnotation(arrow({ id: 'a', x1: 0, y1: 0, x2: 5, y2: 5 }), 10, 20))
      .toMatchObject({ x1: 10, y1: 20, x2: 15, y2: 25 })
  })

  it('moves both of a magnifier boxes together', () => {
    expect(shiftAnnotation(magnifier({ id: 'm' }), 10, 20))
      .toMatchObject({ x: 10, y: 20, tx: 110, ty: 120 })
  })

  it('moves every point of a pen stroke', () => {
    const p = shiftAnnotation(pen({ id: 'p', points: [{ x: 0, y: 0 }, { x: 4, y: 4 }] }), 10, 20) as PenAnn
    expect(p.points).toEqual([{ x: 10, y: 20 }, { x: 14, y: 24 }])
  })

  it('preserves relative layout', () => {
    const before = getAnnotationLocalBounds(rect({ id: 'r' }))!
    const after = getAnnotationLocalBounds(shiftAnnotation(rect({ id: 'r' }), 7, -3))!
    expect(after.w).toBe(before.w)
    expect(after.h).toBe(before.h)
  })
})

describe('nudgeIntoView', () => {
  // Only for pasting between editor windows: a copy from a 4K capture pasted
  // into a small one can land entirely off-canvas, reading as a paste that
  // silently did nothing.
  it('leaves a group that already overlaps the image alone', () => {
    const items = [rect({ id: 'r', x: 10, y: 10, w: 50, h: 50 })]
    expect(nudgeIntoView(items, 800, 600)).toBe(items)
  })

  it('leaves a group that only partly overlaps alone', () => {
    const items = [rect({ id: 'r', x: -20, y: -20, w: 50, h: 50 })]
    expect(nudgeIntoView(items, 800, 600)).toBe(items)
  })

  it('pulls a group back when it sits entirely past the right edge', () => {
    const moved = nudgeIntoView([rect({ id: 'r', x: 2000, y: 10, w: 50, h: 50 })], 800, 600)
    // Shifted by the smallest amount that brings it back inside, plus a 16px margin.
    expect(moved[0]).toMatchObject({ x: 800 - 16 })
    const b = getAnnotationLocalBounds(moved[0])!
    expect(b.x).toBeLessThan(800)
  })

  it('pulls a group back when it sits entirely above the image', () => {
    const moved = nudgeIntoView([rect({ id: 'r', x: 10, y: -500, w: 50, h: 50 })], 800, 600)
    const b = getAnnotationLocalBounds(moved[0])!
    expect(b.y + b.h).toBeGreaterThan(0)
  })

  it('shifts the whole group by one delta, keeping its internal layout', () => {
    const items = [
      rect({ id: 'a', x: 2000, y: 10, w: 50, h: 50 }),
      rect({ id: 'b', x: 2100, y: 60, w: 50, h: 50 }),
    ]
    const moved = nudgeIntoView(items, 800, 600)
    const dx = (moved[0] as ReturnType<typeof rect>).x - items[0].x
    expect((moved[1] as ReturnType<typeof rect>).x - items[1].x).toBe(dx)
  })

  it('is a no-op on an empty list or a zero-sized image', () => {
    const items = [rect({ id: 'r', x: 2000, y: 2000 })]
    expect(nudgeIntoView([], 800, 600)).toEqual([])
    expect(nudgeIntoView(items, 0, 0)).toBe(items)
  })
})
