import { describe, expect, it } from 'vitest'
import { annotationRotation, rotateAnnotationForImageTurn } from '../annotations'
import { arrow, num, pen, rect, text } from './fixtures'

// A whole-image 90-degree turn has to keep every annotation registered to the
// same content. Two mechanisms do that (see `rotateAnnotationForImageTurn`'s
// doc comment) and a refactor must not swap one for the other:
//   - endpoint/box shapes: defining points run through the turn directly
//   - shapes carrying content (rect/ellipse/text/image/pen): rotation bumped,
//     shape translated by however far its own pivot moved
describe('rotateAnnotationForImageTurn', () => {
  it('maps arrow endpoints straight through the turn', () => {
    const a = rotateAnnotationForImageTurn(
      arrow({ id: 'a', x1: 0, y1: 0, x2: 100, y2: 100 }), 200, 100, 'cw',
    )
    expect(a).toMatchObject({ type: 'arrow', x1: 100, y1: 0, x2: 0, y2: 100 })
  })

  it('bumps a rect rotation instead of transforming its corners', () => {
    const r = rotateAnnotationForImageTurn(
      rect({ id: 'r', x: 0, y: 0, w: 100, h: 50 }), 200, 100, 'cw',
    )
    expect(annotationRotation(r)).toBe(90)
    // The box keeps its own w/h — only the rotation and position change.
    expect(r).toMatchObject({ type: 'rect', w: 100, h: 50 })
  })

  it('normalizes a bumped rotation into 0..359', () => {
    const r = rotateAnnotationForImageTurn(
      rect({ id: 'r', rotation: 350 }), 200, 100, 'cw',
    )
    expect(annotationRotation(r)).toBe(80)
  })

  it('wraps a counter-clockwise turn past zero rather than going negative', () => {
    const r = rotateAnnotationForImageTurn(
      rect({ id: 'r', rotation: 0 }), 200, 100, 'ccw',
    )
    expect(annotationRotation(r)).toBe(270)
  })

  it('round-trips an arrow through cw then ccw', () => {
    const original = arrow({ id: 'a', x1: 12, y1: 34, x2: 56, y2: 78 })
    // The turned image is h x w, so the inverse turn is given the swapped dims.
    const turned = rotateAnnotationForImageTurn(original, 200, 100, 'cw')
    const back = rotateAnnotationForImageTurn(turned, 100, 200, 'ccw')
    expect(back).toMatchObject({ x1: 12, y1: 34, x2: 56, y2: 78 })
  })

  it('round-trips a rect through cw then ccw', () => {
    const original = rect({ id: 'r', x: 12, y: 34, w: 100, h: 50 })
    const turned = rotateAnnotationForImageTurn(original, 200, 100, 'cw')
    const back = rotateAnnotationForImageTurn(turned, 100, 200, 'ccw')
    expect(back).toMatchObject({ x: 12, y: 34, w: 100, h: 50 })
    expect(annotationRotation(back)).toBe(0)
  })

  it('round-trips a number marker', () => {
    const original = num({ id: 'n', cx: 40, cy: 60, r: 20 })
    const back = rotateAnnotationForImageTurn(
      rotateAnnotationForImageTurn(original, 200, 100, 'cw'), 100, 200, 'ccw',
    )
    expect(back).toMatchObject({ cx: 40, cy: 60, r: 20 })
  })

  it('translates pen points without baking the turn into them', () => {
    // The stroke is *moved* by however far its own pivot travelled and spun
    // via `rotation`; the turn is never baked into the points, which is what
    // keeps it reversible — see the PenAnn.rotation doc comment.
    const p = pen({ id: 'p', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] })
    const turned = rotateAnnotationForImageTurn(p, 200, 100, 'cw')
    expect(turned.type).toBe('pen')
    const pts = (turned as typeof p).points
    // Same shape, rigidly translated: every point moved by one shared delta.
    expect(pts[1].x - pts[0].x).toBe(2)
    expect(pts[1].y - pts[0].y).toBe(2)
    expect(annotationRotation(turned)).toBe(90)
  })

  it('round-trips a pen stroke through cw then ccw', () => {
    const original = pen({ id: 'p', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] })
    const back = rotateAnnotationForImageTurn(
      rotateAnnotationForImageTurn(original, 200, 100, 'cw'), 100, 200, 'ccw',
    )
    expect(back).toMatchObject({ points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] })
    expect(annotationRotation(back)).toBe(0)
  })

  it('turns text by rotation, keeping its font size and content', () => {
    const t = rotateAnnotationForImageTurn(
      text({ id: 't', x: 10, y: 20, text: 'ab', fontSize: 40 }), 200, 100, 'cw',
    )
    expect(t).toMatchObject({ type: 'text', text: 'ab', fontSize: 40 })
    expect(annotationRotation(t)).toBe(90)
  })
})
