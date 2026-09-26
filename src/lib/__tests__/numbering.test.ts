import { beforeEach, describe, expect, it } from 'vitest'
import type { Annotation, NumberAnn } from '../annotations'
import { formatMarkerLabel, parseMarkerLabel } from '../annotations'
import {
  continueSequence, moveMarker, nextMarkerNumber, renumberMarkers,
  renumberedIds, reseriesMarkers,
} from '../store/numbering'
import { useStore } from '../store'
import { num, rect } from './fixtures'

/** The markers' numbers keyed by id, in array order — what each test checks. */
const numbers = (anns: Annotation[]) =>
  Object.fromEntries(anns.filter((a): a is NumberAnn => a.type === 'number').map((a) => [a.id, a.n]))

const seq = (...ns: number[]) => ns.map((n, i) => num({ id: `m${i + 1}`, n }))

describe('renumberMarkers', () => {
  it('closes gaps from the lowest number', () => {
    expect(numbers(renumberMarkers(seq(1, 2, 4, 5)))).toEqual({ m1: 1, m2: 2, m3: 3, m4: 4 })
    expect(numbers(renumberMarkers(seq(6, 8)))).toEqual({ m1: 6, m2: 7 })
  })

  it('breaks duplicates by array order', () => {
    expect(numbers(renumberMarkers(seq(1, 1, 2)))).toEqual({ m1: 1, m2: 2, m3: 3 })
  })

  it('returns the same array when already consecutive', () => {
    const anns = [rect({ id: 'r' }), ...seq(3, 4, 5)]
    expect(renumberMarkers(anns)).toBe(anns)
  })

  it('renumbers only the given markers, from their own lowest', () => {
    const out = renumberMarkers(seq(1, 2, 3, 1, 5), { ids: ['m4', 'm5'] })
    expect(numbers(out)).toEqual({ m1: 1, m2: 2, m3: 3, m4: 1, m5: 2 })
  })
})

describe('moveMarker', () => {
  it('moves a marker to a place inside the sequence', () => {
    expect(numbers(moveMarker(seq(1, 2, 3, 4, 5), 'm5', 2)))
      .toEqual({ m1: 1, m2: 3, m3: 4, m4: 5, m5: 2 })
    expect(numbers(moveMarker(seq(1, 2, 3, 4, 5), 'm1', 3)))
      .toEqual({ m1: 3, m2: 1, m3: 2, m4: 4, m5: 5 })
  })

  it('moves below the start to the front, starting the sequence there', () => {
    expect(numbers(moveMarker(seq(6, 7, 8), 'm3', 2))).toEqual({ m1: 3, m2: 4, m3: 2 })
  })

  it('clamps past the end to the end', () => {
    expect(numbers(moveMarker(seq(1, 2, 3), 'm2', 9))).toEqual({ m1: 1, m2: 3, m3: 2 })
  })

  it('renumbers everything from there when the first marker goes past the end', () => {
    expect(numbers(moveMarker(seq(1, 2, 3), 'm1', 6))).toEqual({ m1: 6, m2: 7, m3: 8 })
    expect(numbers(moveMarker(seq(1), 'm1', 6))).toEqual({ m1: 6 })
  })

  it('is a no-op (same array) when the marker is already there', () => {
    const anns = seq(1, 2, 3)
    expect(moveMarker(anns, 'm2', 2)).toBe(anns)
  })
})

describe('continueSequence', () => {
  it('numbers incoming markers after the existing ones, in their own order', () => {
    const added = [num({ id: 'a', n: 2 }), rect({ id: 'r' }), num({ id: 'b', n: 1 })]
    expect(numbers(continueSequence(seq(1, 2, 3), added))).toEqual({ a: 5, b: 4 })
  })
})

describe('renumberedIds / nextMarkerNumber', () => {
  it('lists only markers whose number changed', () => {
    const before = seq(1, 2, 3)
    expect(renumberedIds(before, moveMarker(before, 'm3', 1))).toEqual(['m1', 'm2', 'm3'])
    expect(renumberedIds(before, before)).toEqual([])
  })

  it('is one past the highest marker', () => {
    expect(nextMarkerNumber(seq(1, 7, 3))).toBe(8)
    expect(nextMarkerNumber([rect({ id: 'r' })])).toBe(1)
  })
})

// ── Through the store ───────────────────────────────────────────────────

const s = () => useStore.getState()

describe('store numbering', () => {
  beforeEach(() => {
    s().setAutoRenumber(true)
    s().restoreAnnotations(seq(1, 2, 3, 4, 5), 6)
  })

  it('closes the gap on delete, keeping the start', () => {
    s().deleteAnnotations(['m1', 'm3'])
    expect(numbers(s().annotations)).toEqual({ m2: 1, m4: 2, m5: 3 })
    expect(s().nextNumber).toBe(4)
    expect(s().renumberFlash.ids).toEqual(['m2', 'm4', 'm5'])
  })

  it('treats a retype as a move, flashing the markers it shifted', () => {
    s().updateNumberValue('m5', 2)
    expect(numbers(s().annotations)).toEqual({ m1: 1, m2: 3, m3: 4, m4: 5, m5: 2 })
    expect(s().renumberFlash.ids).toEqual(['m2', 'm3', 'm4'])
  })

  it('keeps a no-op retype out of undo', () => {
    const before = s().annotations
    s().updateNumberValue('m2', 2)
    expect(s().annotations).toBe(before)
    expect(s().annotationHistory).toHaveLength(0)
  })

  it('places a new marker, then moves it into the middle by retyping', () => {
    s().addAnnotation(num({ id: 'new', n: 6 }))
    s().updateNumberValue('new', 3)
    expect(numbers(s().annotations)).toEqual({ m1: 1, m2: 2, m3: 4, m4: 5, m5: 6, new: 3 })
    expect(s().nextNumber).toBe(7)
  })

  it('continues the sequence on duplicate', () => {
    s().duplicateAnnotations(['m1'])
    const clone = s().annotations[5] as NumberAnn
    expect(clone.n).toBe(6)
  })

  it('leaves numbers alone with auto renumber off', () => {
    s().setAutoRenumber(false)
    s().deleteAnnotations(['m3'])
    expect(numbers(s().annotations)).toEqual({ m1: 1, m2: 2, m4: 4, m5: 5 })
    s().updateNumberValue('m5', 9)
    expect(numbers(s().annotations)).toEqual({ m1: 1, m2: 2, m4: 4, m5: 9 })
    s().renumberNumbers([])
    expect(numbers(s().annotations)).toEqual({ m1: 1, m2: 2, m4: 3, m5: 4 })
  })
})

describe('formatMarkerLabel / parseMarkerLabel', () => {
  it('writes digits, spreadsheet-style letters and Roman numerals', () => {
    expect([1, 3, 26, 27, 52].map((n) => formatMarkerLabel(n, 'alpha'))).toEqual(['A', 'C', 'Z', 'AA', 'AZ'])
    expect([1, 4, 9, 14, 40, 1994].map((n) => formatMarkerLabel(n, 'roman')))
      .toEqual(['I', 'IV', 'IX', 'XIV', 'XL', 'MCMXCIV'])
    expect(formatMarkerLabel(12, 'decimal')).toBe('12')
    expect(formatMarkerLabel(12, undefined)).toBe('12')
  })

  it('falls back to digits where a format has no way to write the number', () => {
    expect(formatMarkerLabel(0, 'alpha')).toBe('0')
    expect(formatMarkerLabel(4000, 'roman')).toBe('4000')
  })

  it('reads back what it writes', () => {
    for (let n = 1; n <= 800; n++) {
      expect(parseMarkerLabel(formatMarkerLabel(n, 'alpha'), 'alpha')).toBe(n)
      expect(parseMarkerLabel(formatMarkerLabel(n, 'roman'), 'roman')).toBe(n)
    }
  })

  it('reads text in the marker\'s own format, and digits in any', () => {
    expect(parseMarkerLabel('c', 'alpha')).toBe(3)
    expect(parseMarkerLabel('C', 'roman')).toBe(100)
    expect(parseMarkerLabel(' 7 ', 'roman')).toBe(7)
    expect(parseMarkerLabel('C', 'decimal')).toBeNull()
    expect(parseMarkerLabel('IIII', 'roman')).toBeNull()
  })
})

describe('one sequence per format', () => {
  const mixed = () => [
    num({ id: 'd1', n: 1 }), num({ id: 'a1', n: 1, format: 'alpha' }),
    num({ id: 'd2', n: 2 }), num({ id: 'a2', n: 2, format: 'alpha' }),
    num({ id: 'r1', n: 1, format: 'roman' }),
  ]

  it('counts each format on its own', () => {
    expect(nextMarkerNumber(mixed(), 'decimal')).toBe(3)
    expect(nextMarkerNumber(mixed(), 'alpha')).toBe(3)
    expect(nextMarkerNumber(mixed(), 'roman')).toBe(2)
  })

  it('moves a marker only within its own sequence', () => {
    expect(numbers(moveMarker(mixed(), 'a2', 1))).toEqual({ d1: 1, a1: 2, d2: 2, a2: 1, r1: 1 })
  })

  it('closes a gap only in the sequence it opened in', () => {
    const anns = mixed().filter((a) => a.id !== 'd1')
    expect(numbers(renumberMarkers(anns, { startsFrom: mixed() }))).toEqual({ a1: 1, d2: 1, a2: 2, r1: 1 })
  })

  it('continues each pasted marker in its own sequence', () => {
    const added = [num({ id: 'x', n: 1, format: 'alpha' }), num({ id: 'y', n: 1 })]
    expect(numbers(continueSequence(mixed(), added))).toEqual({ x: 3, y: 3 })
  })

  it('moves a marker that changed format to the end of its new sequence', () => {
    const before = mixed()
    const after = before.map((a) => (a.id === 'd1' ? { ...a, format: 'alpha' as const } : a))
    expect(numbers(reseriesMarkers(before, after))).toEqual({ d1: 3, a1: 1, d2: 1, a2: 2, r1: 1 })
  })

  it('is a no-op when no marker changed format', () => {
    const before = mixed()
    const after = before.map((a) => (a.id === 'd1' ? { ...a, color: '#000' } : a))
    expect(reseriesMarkers(before, after)).toBe(after)
  })

  it('reseries through the store when the Format option is applied', () => {
    s().setAutoRenumber(true)
    s().restoreAnnotations(mixed(), 3)
    s().mutateAnnotations(['d2'], (a) => (a.type === 'number' ? { ...a, format: 'roman' } : a))
    expect(numbers(s().annotations)).toEqual({ d1: 1, a1: 1, d2: 2, a2: 2, r1: 1 })
    expect((s().annotations[2] as NumberAnn).format).toBe('roman')
  })
})
