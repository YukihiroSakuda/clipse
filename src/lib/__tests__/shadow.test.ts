import { describe, expect, it } from 'vitest'
import {
  SHADOW_CAPABLE, blurStrengthPct, getShadowAngle, getShadowBlur,
  getShadowOpacity, getShadowSize, getShadowStyle, glowMaxBlur, dropMaxDistance, resolveOutline,
} from '../annotations'
import { arrow, highlight, rect, text } from './fixtures'

// The absent-field fallbacks below are compatibility rules, not preferences:
// a document saved before per-annotation shadow existed has to keep rendering
// exactly as it did. See each getter's doc comment in annotations.ts.
describe('shadow defaults', () => {
  it('defaults text to drop and everything else to none', () => {
    expect(getShadowStyle(text({ id: 't' }))).toBe('drop')
    expect(getShadowStyle(rect({ id: 'r' }))).toBe('none')
  })

  it('honors an explicit style over the per-type default', () => {
    expect(getShadowStyle(text({ id: 't', shadowStyle: 'none' }))).toBe('none')
    expect(getShadowStyle(rect({ id: 'r', shadowStyle: 'glow' }))).toBe('glow')
  })

  it('defaults angle, size and blur independently of style', () => {
    expect(getShadowAngle(rect({ id: 'r' }))).toBe(135)
    expect(getShadowSize(rect({ id: 'r' }))).toBe(10)
    expect(getShadowBlur(rect({ id: 'r' }))).toBe(15)
  })

  it('defaults opacity by style: glow was opaque, drop was 45%', () => {
    expect(getShadowOpacity(rect({ id: 'r', shadowStyle: 'glow' }))).toBe(100)
    expect(getShadowOpacity(rect({ id: 'r', shadowStyle: 'drop' }))).toBe(45)
    expect(getShadowOpacity(text({ id: 't' }))).toBe(45)
  })

  it('honors an explicit zero rather than treating it as absent', () => {
    expect(getShadowBlur(rect({ id: 'r', shadowBlur: 0 }))).toBe(0)
    expect(getShadowSize(rect({ id: 'r', shadowSize: 0 }))).toBe(0)
    expect(getShadowOpacity(rect({ id: 'r', shadowOpacity: 0 }))).toBe(0)
    expect(getShadowAngle(rect({ id: 'r', shadowAngle: 0 }))).toBe(0)
  })
})

describe('glowMaxBlur', () => {
  it('keeps the old flat 25px for small shapes and a missing box', () => {
    expect(glowMaxBlur(rect({ id: 'r' }), { w: 40, h: 30 })).toBe(25)
    expect(glowMaxBlur(rect({ id: 'r' }), null)).toBe(25)
  })

  it('grows with the geometric mean of the box, up to a cap', () => {
    expect(glowMaxBlur(rect({ id: 'r' }), { w: 400, h: 400 })).toBe(120)
    expect(glowMaxBlur(rect({ id: 'r' }), { w: 1600, h: 100 })).toBe(120)
    expect(glowMaxBlur(rect({ id: 'r' }), { w: 5000, h: 5000 })).toBe(300)
  })

  it('scales a bare stroke with its width, not its length', () => {
    expect(glowMaxBlur(arrow({ id: 'a', sw: 3 }), { w: 2000, h: 2000 })).toBe(25)
    expect(glowMaxBlur(arrow({ id: 'a', sw: 10 }), null)).toBe(60)
  })
})

describe('dropMaxDistance', () => {
  it('keeps the old flat 30px for small shapes and a missing box', () => {
    expect(dropMaxDistance(rect({ id: 'r' }), { w: 40, h: 30 })).toBe(30)
    expect(dropMaxDistance(rect({ id: 'r' }), null)).toBe(30)
  })

  it('grows with the geometric mean of the box, up to a cap', () => {
    expect(dropMaxDistance(rect({ id: 'r' }), { w: 400, h: 400 })).toBe(60)
    expect(dropMaxDistance(rect({ id: 'r' }), { w: 1600, h: 100 })).toBe(60)
    expect(dropMaxDistance(rect({ id: 'r' }), { w: 5000, h: 5000 })).toBe(150)
  })

  it('scales a bare stroke with its width, not its length', () => {
    expect(dropMaxDistance(arrow({ id: 'a', sw: 1 }), { w: 2000, h: 2000 })).toBe(6)
    expect(dropMaxDistance(arrow({ id: 'a', sw: 4 }), null)).toBe(12)
    expect(dropMaxDistance(arrow({ id: 'a', sw: 20 }), null)).toBe(60)
  })
})

describe('resolveOutline', () => {
  it('maps Size to a thickness scaled to the shape, ignoring Blur and Opacity', () => {
    const r = rect({ id: 'r', shadowStyle: 'outline', shadowSize: 50, shadowBlur: 50, shadowOpacity: 30 })
    expect(resolveOutline(r, { w: 40, h: 30 })).toEqual({ width: 6, color: '#FFFFFF' })
    expect(resolveOutline(r, { w: 500, h: 500 }).width).toBe(20)
    expect(resolveOutline(r, { w: 5000, h: 5000 }).width).toBe(30)
  })

  it('defaults to white and honors an explicit color', () => {
    const r = rect({ id: 'r', shadowStyle: 'outline', shadowColor: '#FF0000' })
    expect(resolveOutline(r, null).color).toBe('#FF0000')
  })

  it('scales a bare stroke with its width', () => {
    expect(resolveOutline(arrow({ id: 'a', sw: 10, shadowStyle: 'outline', shadowSize: 100 }), null).width).toBe(20)
  })
})

describe('SHADOW_CAPABLE', () => {
  it('covers the ink tools and excludes the image-resampling ones', () => {
    expect(SHADOW_CAPABLE.has('rect')).toBe(true)
    expect(SHADOW_CAPABLE.has('text')).toBe(true)
    expect(SHADOW_CAPABLE.has('blur')).toBe(false)
    expect(SHADOW_CAPABLE.has('spotlight')).toBe(false)
    expect(SHADOW_CAPABLE.has('magnifier')).toBe(false)
    // A flat marker wash sits on the image rather than lifting off it.
    expect(SHADOW_CAPABLE.has(highlight({ id: 'h' }).type)).toBe(false)
  })
})

describe('blurStrengthPct', () => {
  it('maps the legacy presets', () => {
    expect(blurStrengthPct('low')).toBe(8)
    expect(blurStrengthPct('medium')).toBe(17)
    expect(blurStrengthPct('high')).toBe(33)
  })

  it('defaults an absent strength to medium', () => {
    expect(blurStrengthPct(undefined)).toBe(17)
  })

  it('clamps to 1..40 — past 40 a stronger blur reads weaker', () => {
    expect(blurStrengthPct(0)).toBe(1)
    expect(blurStrengthPct(-5)).toBe(1)
    expect(blurStrengthPct(100)).toBe(40)
    expect(blurStrengthPct(25)).toBe(25)
  })
})
