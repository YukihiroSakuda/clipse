import { describe, expect, it } from 'vitest'
import {
  bubbleCornerRadius, bubbleTailHeight, fontSizeAndOriginForBounds,
  getAnnotationLocalBounds, getBubbleBodyBox, getBubbleTailAnchors,
  resolveTextColors, textPadding,
} from '../annotations'
import { text } from './fixtures'

describe('textPadding / bubbleTailHeight', () => {
  it('scales with font size', () => {
    expect(textPadding(40)).toBe(14)
    expect(bubbleTailHeight(40)).toBe(18)
  })
})

describe('fontSizeAndOriginForBounds', () => {
  // This is the inverse of measureTextBounds' height math. If the two ever
  // disagree, a box/bubble visibly jumps the instant a resize drag starts —
  // so the invariant is tested as a round trip, not against magic numbers.
  const roundTrips = (shape: 'none' | 'box' | 'bubble', content: string) => {
    const before = text({ id: 't', x: 10, y: 20, text: content, fontSize: 40, shape })
    const box = getAnnotationLocalBounds(before)!
    const solved = fontSizeAndOriginForBounds(shape, content.split('\n').length, box)
    const after = text({ id: 't', ...solved, text: content, shape })
    const reproduced = getAnnotationLocalBounds(after)!
    expect(reproduced.h).toBeCloseTo(box.h, 6)
    expect(reproduced.x).toBeCloseTo(box.x, 6)
    expect(reproduced.y).toBeCloseTo(box.y, 6)
  }

  it('round-trips plain text', () => roundTrips('none', 'ab'))
  it('round-trips box text', () => roundTrips('box', 'ab'))
  it('round-trips bubble text', () => roundTrips('bubble', 'ab'))
  it('round-trips multi-line box text', () => roundTrips('box', 'ab\ncde'))

  it('never solves below the 8px floor', () => {
    expect(fontSizeAndOriginForBounds('none', 1, { x: 0, y: 0, h: 1 }).fontSize).toBe(8)
  })

  it('leaves the origin at the box corner for plain text', () => {
    expect(fontSizeAndOriginForBounds('none', 1, { x: 5, y: 7, h: 50 }))
      .toEqual({ fontSize: 40, x: 5, y: 7 })
  })

  it('insets the origin by the padding for a box', () => {
    const r = fontSizeAndOriginForBounds('box', 1, { x: 5, y: 7, h: 78 })
    expect(r.fontSize).toBe(40)
    expect(r.x).toBe(5 + textPadding(40))
    expect(r.y).toBe(7 + textPadding(40))
  })
})

describe('getBubbleBodyBox', () => {
  it('is null for non-bubble text', () => {
    expect(getBubbleBodyBox(text({ id: 't', shape: 'none' }))).toBeNull()
    expect(getBubbleBodyBox(text({ id: 't', shape: 'box' }))).toBeNull()
  })

  it('is the pad-expanded text box, excluding the tail protrusion', () => {
    const body = getBubbleBodyBox(text({ id: 't', x: 10, y: 20, text: 'ab', fontSize: 40, shape: 'bubble' }))!
    expect(body).toEqual({ x: -4, y: 6, w: 76, h: 78 })
    // The annotation's own bounds are larger — they include the tail.
    const full = getAnnotationLocalBounds(text({ id: 't', x: 10, y: 20, text: 'ab', fontSize: 40, shape: 'bubble' }))!
    expect(full.h).toBeGreaterThan(body.h)
  })

  it('stays fixed to the body regardless of which way the tail points', () => {
    const at = (tailAnchor: 'n1' | 's3' | 'w2') =>
      getBubbleBodyBox(text({ id: 't', x: 10, y: 20, text: 'ab', fontSize: 40, shape: 'bubble', tailAnchor }))
    expect(at('n1')).toEqual(at('s3'))
    expect(at('w2')).toEqual(at('s3'))
  })
})

describe('getBubbleTailAnchors', () => {
  it('offers 16 tail positions, none of them on a corner', () => {
    const body = getBubbleBodyBox(text({ id: 't', x: 10, y: 20, text: 'ab', fontSize: 40, shape: 'bubble' }))!
    const anchors = getBubbleTailAnchors(text({ id: 't', x: 10, y: 20, text: 'ab', fontSize: 40, shape: 'bubble' }))
    expect(anchors).toHaveLength(16)
    const corners = [
      [body.x, body.y], [body.x + body.w, body.y],
      [body.x, body.y + body.h], [body.x + body.w, body.y + body.h],
    ]
    for (const a of anchors) {
      for (const [cx, cy] of corners) {
        expect(Math.hypot(a.x - cx, a.y - cy)).toBeGreaterThan(0)
      }
    }
  })
})

describe('bubbleCornerRadius', () => {
  it('is capped by the shorter half-side', () => {
    expect(bubbleCornerRadius(40, 76, 78)).toBe(16)
    expect(bubbleCornerRadius(40, 10, 78)).toBe(5)
  })
})

describe('resolveTextColors', () => {
  it('auto-contrasts the font color against a solid background', () => {
    expect(resolveTextColors({ color: '#FFFFFF' })).toEqual({ bg: '#FFFFFF', text: '#0F1117' })
    expect(resolveTextColors({ color: '#000000' })).toEqual({ bg: '#000000', text: '#FFFFFF' })
  })

  it('matches the border instead of contrasting for a bordered fill', () => {
    // border + text in one accent color is the outlined-caption look.
    expect(resolveTextColors({ color: '#EF4444', bgFill: 'white' }))
      .toEqual({ bg: '#EF4444', text: '#EF4444' })
    expect(resolveTextColors({ color: '#EF4444', bgFill: 'stroke' }))
      .toEqual({ bg: '#EF4444', text: '#EF4444' })
  })

  it('honors an explicit font color over the auto contrast', () => {
    expect(resolveTextColors({ color: '#000000', textColor: '#00FF00' }))
      .toEqual({ bg: '#000000', text: '#00FF00' })
  })

  it('lets bgAuto follow the font color once that is explicit', () => {
    expect(resolveTextColors({ color: '#123456', textColor: '#FFFFFF', bgAuto: true }))
      .toEqual({ bg: '#0F1117', text: '#FFFFFF' })
  })

  it('does not let the two auto states chase each other', () => {
    // bgAuto with no explicit textColor keeps the created color.
    expect(resolveTextColors({ color: '#123456', bgAuto: true }))
      .toEqual({ bg: '#123456', text: '#FFFFFF' })
  })
})
