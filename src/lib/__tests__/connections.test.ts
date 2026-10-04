import { describe, expect, it } from 'vitest'
import {
  clearDanglingConnections, getConnectAnchors, isConnectable,
  remapArrowConnections, resolveArrowConnections,
} from '../annotations'
import type { Annotation, ArrowAnn } from '../annotations'
import { arrow, ellipse, image, line, num, rect, text } from './fixtures'

const asArrow = (list: Annotation[], id: string) =>
  list.find((a) => a.id === id) as ArrowAnn

describe('isConnectable', () => {
  it('accepts exactly the five gluable types', () => {
    expect(isConnectable(rect({ id: 'a' }))).toBe(true)
    expect(isConnectable(ellipse({ id: 'b' }))).toBe(true)
    expect(isConnectable(num({ id: 'c' }))).toBe(true)
    expect(isConnectable(text({ id: 'd' }))).toBe(true)
    expect(isConnectable(image({ id: 'e' }))).toBe(true)
    expect(isConnectable(arrow({ id: 'f' }))).toBe(false)
    expect(isConnectable(line({ id: 'g' }))).toBe(false)
  })
})

describe('resolveArrowConnections', () => {
  it('snaps a glued endpoint onto the target anchor', () => {
    const list = resolveArrowConnections([
      rect({ id: 'r', x: 0, y: 0, w: 100, h: 50 }),
      arrow({ id: 'a', x1: 500, y1: 500, x2: 0, y2: 0, endConnect: { targetId: 'r', anchor: 'n' } }),
    ])
    const a = asArrow(list, 'a')
    // 'n' = top edge midpoint of the 100x50 box.
    expect([a.x2, a.y2]).toEqual([50, 0])
    // The free end is left exactly where it was.
    expect([a.x1, a.y1]).toEqual([500, 500])
  })

  it('tracks the target when it moves', () => {
    const glue: ArrowAnn['endConnect'] = { targetId: 'r', anchor: 'n' }
    const at = (x: number) => asArrow(resolveArrowConnections([
      rect({ id: 'r', x, y: 0, w: 100, h: 50 }),
      arrow({ id: 'a', endConnect: glue }),
    ]), 'a')
    expect(at(0).x2).toBe(50)
    expect(at(200).x2).toBe(250)
  })

  it('returns the SAME array reference when nothing needed moving', () => {
    // Load-bearing: the editor tracks unsaved changes by array identity
    // (see CLAUDE.md, "Closing an editor with unsaved changes asks first").
    // A resolve that always rebuilt the array would mark a document dirty on
    // every no-op pass.
    const input: Annotation[] = [
      rect({ id: 'r', x: 0, y: 0, w: 100, h: 50 }),
      arrow({ id: 'a', x1: 0, y1: 0, x2: 50, y2: 0, endConnect: { targetId: 'r', anchor: 'n' } }),
    ]
    expect(resolveArrowConnections(input)).toBe(input)
  })

  it('returns the same reference when there are no connections at all', () => {
    const input: Annotation[] = [rect({ id: 'r' }), arrow({ id: 'a' })]
    expect(resolveArrowConnections(input)).toBe(input)
  })

  it('leaves an endpoint alone when its target is gone', () => {
    const list = resolveArrowConnections([
      arrow({ id: 'a', x2: 7, y2: 9, endConnect: { targetId: 'missing', anchor: 'n' } }),
    ])
    expect([asArrow(list, 'a').x2, asArrow(list, 'a').y2]).toEqual([7, 9])
  })
})

describe('clearDanglingConnections', () => {
  it('un-glues an endpoint whose target is no longer in the list', () => {
    const list = clearDanglingConnections([
      arrow({ id: 'a', endConnect: { targetId: 'deleted', anchor: 'n' } }),
    ])
    expect(asArrow(list, 'a').endConnect).toBeUndefined()
  })

  it('keeps a connection whose target is still present', () => {
    const list = clearDanglingConnections([
      rect({ id: 'r' }),
      arrow({ id: 'a', endConnect: { targetId: 'r', anchor: 'n' } }),
    ])
    expect(asArrow(list, 'a').endConnect).toEqual({ targetId: 'r', anchor: 'n' })
  })

  it('clears only the stale end of a doubly-glued arrow', () => {
    const list = clearDanglingConnections([
      rect({ id: 'r' }),
      arrow({
        id: 'a',
        startConnect: { targetId: 'r', anchor: 's' },
        endConnect: { targetId: 'gone', anchor: 'n' },
      }),
    ])
    expect(asArrow(list, 'a').startConnect).toEqual({ targetId: 'r', anchor: 's' })
    expect(asArrow(list, 'a').endConnect).toBeUndefined()
  })
})

describe('remapArrowConnections', () => {
  it('re-points a duplicated connector at the duplicated target', () => {
    const list = remapArrowConnections(
      [arrow({ id: 'a2', endConnect: { targetId: 'r1', anchor: 'n' } })],
      new Map([['r1', 'r2']]),
    )
    expect(asArrow(list, 'a2').endConnect).toEqual({ targetId: 'r2', anchor: 'n' })
  })

  it('leaves a target outside the map pointing at the original', () => {
    const list = remapArrowConnections(
      [arrow({ id: 'a2', endConnect: { targetId: 'external', anchor: 'n' } })],
      new Map([['r1', 'r2']]),
    )
    expect(asArrow(list, 'a2').endConnect).toEqual({ targetId: 'external', anchor: 'n' })
  })
})

describe('getConnectAnchors', () => {
  it('offers all 16 anchors on a rect', () => {
    expect(getConnectAnchors(rect({ id: 'r', x: 0, y: 0, w: 100, h: 50 }))).toHaveLength(16)
  })

  it('puts a round outline’s anchors off the bounding box corners', () => {
    // An ellipse's 'ne' sits on the curve, not at the box corner a rect uses.
    const e = getConnectAnchors(ellipse({ id: 'e', cx: 50, cy: 50, rx: 50, ry: 50 }))
      .find((a) => a.anchor === 'ne')!
    expect(e.x).toBeLessThan(100)
    expect(e.y).toBeGreaterThan(0)
  })
})
