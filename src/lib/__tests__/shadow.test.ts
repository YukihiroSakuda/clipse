import { describe, expect, it } from 'vitest'
import {
  SHADOW_CAPABLE, blurStrengthPct, getShadowAngle, getShadowBlur,
  getShadowOpacity, getShadowSize, getShadowStyle,
} from '../annotations'
import { highlight, rect, text } from './fixtures'

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
