import { describe, expect, it } from 'vitest'
import {
  OVERLAY_RATIOS,
  RegionConstraint,
  constraintValue,
  containsPoint,
  cycleRatio,
  effectiveConstraint,
  lockToRatio,
  positionFrom,
} from './regionConstraint'

describe('cycleRatio', () => {
  it('steps free → every ratio in order → free', () => {
    const seen: string[] = []
    let c: RegionConstraint | null = null
    for (let i = 0; i <= OVERLAY_RATIOS.length; i++) {
      c = cycleRatio(c, 1)
      seen.push(c ? constraintValue(c) : 'free')
    }
    expect(seen).toEqual(['1:1', '4:3', '16:9', '3:2', '3:4', '9:16', 'free'])
  })

  it('steps backwards from free to the last ratio', () => {
    expect(cycleRatio(null, -1)).toEqual({ kind: 'ratio', w: 9, h: 16 })
    expect(cycleRatio({ kind: 'ratio', w: 1, h: 1 }, -1)).toBeNull()
  })

  it('treats a size or position recall as free', () => {
    expect(cycleRatio({ kind: 'size', w: 800, h: 600 }, 1)).toEqual({ kind: 'ratio', w: 1, h: 1 })
    expect(cycleRatio(positionFrom({ x: 0, y: 0, w: 10, h: 10 }), -1)).toEqual({ kind: 'ratio', w: 9, h: 16 })
  })
})

describe('effectiveConstraint', () => {
  const session: RegionConstraint = { kind: 'ratio', w: 4, h: 3 }

  it('takes none in scroll mode', () => {
    expect(effectiveConstraint(true, { is_ratio: true, w: 16, h: 9 }, session)).toBeNull()
  })

  it('lets a Fixed Capture session outrank the keys', () => {
    expect(effectiveConstraint(false, { is_ratio: false, w: 1280, h: 720 }, session))
      .toEqual({ kind: 'size', w: 1280, h: 720 })
  })

  it('falls back to the key-picked constraint', () => {
    expect(effectiveConstraint(false, null, session)).toBe(session)
    expect(effectiveConstraint(false, null, null)).toBeNull()
  })
})

describe('lockToRatio', () => {
  it('keeps the wider axis and derives the other', () => {
    expect(lockToRatio(0, 0, 160, 10, 16 / 9)).toEqual({ x: 160, y: 90 })
    expect(lockToRatio(0, 0, 10, 90, 16 / 9)).toEqual({ x: 160, y: 90 })
  })

  it('squares a drag at 1:1 in every direction', () => {
    expect(lockToRatio(100, 100, 40, 70, 1)).toEqual({ x: 40, y: 40 })
    expect(lockToRatio(100, 100, 130, 20, 1)).toEqual({ x: 180, y: 20 })
  })
})

describe('containsPoint', () => {
  const r = { x: -1920, y: 0, w: 100, h: 50 }

  it('is inclusive of the top-left edge and exclusive of the bottom-right', () => {
    expect(containsPoint(r, -1920, 0)).toBe(true)
    expect(containsPoint(r, -1821, 49)).toBe(true)
    expect(containsPoint(r, -1820, 49)).toBe(false)
    expect(containsPoint(r, -1821, 50)).toBe(false)
  })
})
