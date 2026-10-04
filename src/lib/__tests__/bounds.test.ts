import { describe, expect, it } from 'vitest'
import {
  annotationPivot, annotationRotation, getAnnotationBounds, getAnnotationCoreBounds,
  getAnnotationLocalBounds, getMagnifierBoxes, isRotatable, rotatePoint,
} from '../annotations'
import { arrow, ellipse, highlight, line, magnifier, num, pen, rect, text } from './fixtures'

// Characterization: these pin the *current* numbers, halo padding included,
// because the halo is exactly what a careless extraction would drop. See
// `getAnnotationLocalBounds` for which types pad by what.
describe('getAnnotationLocalBounds', () => {
  it('returns a rect box unchanged', () => {
    expect(getAnnotationLocalBounds(rect({ id: 'r', x: 10, y: 20, w: 100, h: 50 })))
      .toEqual({ x: 10, y: 20, w: 100, h: 50 })
  })

  it('normalizes a rect dragged out negative', () => {
    expect(getAnnotationLocalBounds(rect({ id: 'r', x: 100, y: 80, w: -40, h: -30 })))
      .toEqual({ x: 60, y: 50, w: 40, h: 30 })
  })

  it('converts an ellipse center/radii to a box', () => {
    expect(getAnnotationLocalBounds(ellipse({ id: 'e', cx: 50, cy: 50, rx: 30, ry: 20 })))
      .toEqual({ x: 20, y: 30, w: 60, h: 40 })
  })

  it('converts a number marker center/radius to a box', () => {
    expect(getAnnotationLocalBounds(num({ id: 'n', cx: 50, cy: 50, r: 20 })))
      .toEqual({ x: 30, y: 30, w: 40, h: 40 })
  })

  it('pads a line by half its stroke width', () => {
    expect(getAnnotationLocalBounds(line({ id: 'l', sw: 4, x1: 0, y1: 0, x2: 100, y2: 100 })))
      .toEqual({ x: -2, y: -2, w: 104, h: 104 })
  })

  it('pads an arrow by its arrowhead extent, not by sw/2', () => {
    // headLen = max(10, sw * 5)
    expect(getAnnotationLocalBounds(arrow({ id: 'a', sw: 4, x1: 0, y1: 0, x2: 100, y2: 100 })))
      .toEqual({ x: -20, y: -20, w: 140, h: 140 })
  })

  it('pads a pen stroke by half its stroke width', () => {
    expect(getAnnotationLocalBounds(pen({ id: 'p', sw: 4, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] })))
      .toEqual({ x: -2, y: -2, w: 14, h: 14 })
  })

  it('pads a highlight by half its 6x marker width', () => {
    expect(getAnnotationLocalBounds(highlight({ id: 'h', sw: 4, x1: 0, y1: 0, x2: 100, y2: 0 })))
      .toEqual({ x: -12, y: -12, w: 124, h: 24 })
  })

  it('unions a magnifier source and target box', () => {
    expect(getAnnotationLocalBounds(magnifier({ id: 'm' })))
      .toEqual({ x: 0, y: 0, w: 160, h: 160 })
  })

  it('measures plain text from the no-DOM fallback', () => {
    // No canvas in node: textW = longestLine * fontSize * 0.6, textH = fontSize * 1.25.
    expect(getAnnotationLocalBounds(text({ id: 't', x: 10, y: 20, text: 'ab', fontSize: 40 })))
      .toEqual({ x: 10, y: 20, w: 48, h: 50 })
  })

  it('expands a box text by textPadding on every side', () => {
    expect(getAnnotationLocalBounds(text({ id: 't', x: 10, y: 20, text: 'ab', fontSize: 40, shape: 'box' })))
      .toEqual({ x: -4, y: 6, w: 76, h: 78 })
  })
})

describe('getMagnifierBoxes', () => {
  it('normalizes both boxes independently', () => {
    expect(getMagnifierBoxes(magnifier({ id: 'm', x: 20, y: 20, w: -20, h: -20 })))
      .toEqual({ source: { x: 0, y: 0, w: 20, h: 20 }, target: { x: 100, y: 100, w: 60, h: 60 } })
  })
})

describe('getAnnotationBounds', () => {
  it('matches the local box when unrotated', () => {
    const r = rect({ id: 'r', x: 10, y: 20, w: 100, h: 50 })
    expect(getAnnotationBounds(r)).toEqual(getAnnotationLocalBounds(r))
  })

  it('swaps width and height for a 90-degree rect', () => {
    const b = getAnnotationBounds(rect({ id: 'r', x: 0, y: 0, w: 100, h: 50, rotation: 90 }))!
    expect(b.w).toBeCloseTo(50, 10)
    expect(b.h).toBeCloseTo(100, 10)
    expect(b.x).toBeCloseTo(25, 10)
    expect(b.y).toBeCloseTo(-25, 10)
  })

  it('ignores rotation on a type that cannot carry one', () => {
    // `rotation` is not part of NumberAnn — annotationRotation must report 0
    // even if a stray field rode in on a hand-edited sidecar.
    const n = { ...num({ id: 'n' }), rotation: 90 } as ReturnType<typeof num>
    expect(annotationRotation(n)).toBe(0)
    expect(getAnnotationBounds(n)).toEqual(getAnnotationLocalBounds(n))
  })
})

describe('getAnnotationCoreBounds', () => {
  it('drops the arrowhead halo so an export canvas does not grow for it', () => {
    expect(getAnnotationCoreBounds(arrow({ id: 'a', sw: 4, x1: 0, y1: 0, x2: 100, y2: 100 })))
      .toEqual({ x: 0, y: 0, w: 100, h: 100 })
  })

  it('drops the pen halo', () => {
    expect(getAnnotationCoreBounds(pen({ id: 'p', sw: 12, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] })))
      .toEqual({ x: 0, y: 0, w: 10, h: 10 })
  })

  it('keeps the halo for types that have none of their own', () => {
    const r = rect({ id: 'r', x: 10, y: 20, w: 100, h: 50 })
    expect(getAnnotationCoreBounds(r)).toEqual(getAnnotationBounds(r))
  })
})

describe('isRotatable / annotationPivot', () => {
  it('accepts exactly the five rotatable types', () => {
    expect(isRotatable(rect({ id: 'a' }))).toBe(true)
    expect(isRotatable(ellipse({ id: 'b' }))).toBe(true)
    expect(isRotatable(text({ id: 'c' }))).toBe(true)
    expect(isRotatable(pen({ id: 'd' }))).toBe(true)
    expect(isRotatable(num({ id: 'e' }))).toBe(false)
    expect(isRotatable(arrow({ id: 'f' }))).toBe(false)
  })

  it('pivots on the center of the unrotated local box', () => {
    // Load-bearing: draw, selection box, handles and connection anchors all
    // have to agree on this point or the shape and its UI drift apart.
    expect(annotationPivot(rect({ id: 'r', x: 0, y: 0, w: 100, h: 50, rotation: 30 })))
      .toEqual({ x: 50, y: 25 })
  })
})

describe('rotatePoint', () => {
  it('rotates clockwise in canvas convention', () => {
    const p = rotatePoint(10, 0, 0, 0, 90)
    expect(p.x).toBeCloseTo(0, 10)
    expect(p.y).toBeCloseTo(10, 10)
  })
})
