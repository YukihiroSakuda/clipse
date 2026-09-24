import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store'
import { TOOL_OPTIONS, applyToolOption } from '../toolOptions'
import type { ToolOptionContext } from '../toolOptions'
import type { Annotation, RectAnn, TextAnn } from '../annotations'
import { blur, num, rect, text } from './fixtures'

const s = () => useStore.getState()

const ctx = (over: Partial<ToolOptionContext> = {}): ToolOptionContext => ({
  uniformType: null,
  selectedIds: [],
  beginSliderAdjust: () => {},
  ...over,
})

/** The context for "this exact list is selected, and it is homogeneous". */
const selecting = (list: Annotation[], beginSliderAdjust = () => {}): ToolOptionContext => ({
  uniformType: list[0].type,
  selectedIds: list.map((a) => a.id),
  beginSliderAdjust,
})

beforeEach(() => {
  s().restoreAnnotations([], 1)
})

describe('adopting the shared default', () => {
  it('records the value even with nothing selected', () => {
    applyToolOption('fontSize', 72, ctx())
    expect(s().fontSize).toBe(72)
  })

  it('records the value while a selection is being edited', () => {
    // Load-bearing: if the default were left behind, the control would snap
    // back to the stale value the moment the selection cleared.
    const t = text({ id: 't' })
    s().restoreAnnotations([t], 1)
    applyToolOption('textShape', 'bubble', selecting([t]))
    expect(s().textShape).toBe('bubble')
    expect((s().annotations[0] as TextAnn).shape).toBe('bubble')
  })
})

describe('scope: uniform (the default)', () => {
  it('edits a homogeneous selection', () => {
    const list = [text({ id: 'a' }), text({ id: 'b' })]
    s().restoreAnnotations(list, 1)
    applyToolOption('textAlign', 'center', selecting(list))
    expect(s().annotations.map((a) => (a as TextAnn).align)).toEqual(['center', 'center'])
  })

  it('leaves a mixed selection alone', () => {
    s().restoreAnnotations([text({ id: 't' }), rect({ id: 'r' })], 1)
    const before = s().annotations
    applyToolOption('textAlign', 'center', ctx({ uniformType: null, selectedIds: ['t', 'r'] }))
    expect(s().annotations).toBe(before)
    // The default is still adopted.
    expect(s().textAlign).toBe('center')
  })

  it('leaves a selection of the wrong type alone', () => {
    const list = [rect({ id: 'r' })]
    s().restoreAnnotations(list, 1)
    const before = s().annotations
    applyToolOption('textAlign', 'center', selecting(list))
    expect(s().annotations).toBe(before)
  })

  it('applies to every type it names, not just the first', () => {
    // fillMode covers rect and ellipse.
    const list = [rect({ id: 'a' }), rect({ id: 'b' })]
    s().restoreAnnotations(list, 1)
    applyToolOption('fillMode', 'solid', selecting(list))
    expect(s().annotations.map((a) => (a as RectAnn).fill)).toEqual(['solid', 'solid'])
  })
})

describe('scope: selection (shadow)', () => {
  it('reaches every shadow-capable member of a mixed selection', () => {
    // The Shadow block stays visible for a mixed selection, so dialling it
    // there has to do something.
    s().restoreAnnotations([text({ id: 't' }), rect({ id: 'r' })], 1)
    applyToolOption('shadowBlur', 60, ctx({ uniformType: null, selectedIds: ['t', 'r'] }))
    expect(s().annotations.map((a) => a.shadowBlur)).toEqual([60, 60])
  })

  it('skips members that cannot carry a shadow', () => {
    s().restoreAnnotations([rect({ id: 'r' }), blur({ id: 'b' })], 1)
    applyToolOption('shadowBlur', 60, ctx({ uniformType: null, selectedIds: ['r', 'b'] }))
    expect(s().annotations[0].shadowBlur).toBe(60)
    expect(s().annotations[1].shadowBlur).toBeUndefined()
  })

  it('does nothing to the document when nothing is selected', () => {
    s().restoreAnnotations([rect({ id: 'r' })], 1)
    const before = s().annotations
    applyToolOption('shadowBlur', 60, ctx())
    expect(s().annotations).toBe(before)
    expect(s().shadowBlur).toBe(60)
  })
})

describe('live options', () => {
  it('coalesces a drag into one undo step', () => {
    // beginSliderAdjust pushes the single history entry; the edits themselves
    // go through mutateAnnotationsLive, which pushes none.
    const list = [rect({ id: 'r' })]
    s().restoreAnnotations(list, 1)
    const begin = vi.fn()
    for (const v of [4, 8, 12]) applyToolOption('rectRadius', v, selecting(list, begin))
    expect(begin).toHaveBeenCalledTimes(3)  // the 800ms coalescing lives in the caller
    expect(s().annotationHistory).toHaveLength(0)
    expect((s().annotations[0] as RectAnn).radius).toBe(12)
  })

  it('does not call beginSliderAdjust when the option does not apply', () => {
    const begin = vi.fn()
    s().restoreAnnotations([], 1)
    applyToolOption('rectRadius', 4, ctx({ beginSliderAdjust: begin }))
    expect(begin).not.toHaveBeenCalled()
  })

  it('pushes history for a discrete option instead', () => {
    const list = [num({ id: 'n' })]
    s().restoreAnnotations(list, 1)
    applyToolOption('numberShape', 'square', selecting(list))
    expect(s().annotationHistory).toHaveLength(1)
  })
})

describe('the table itself', () => {
  it('names a real store setter for every option', () => {
    const store = s() as unknown as Record<string, unknown>
    for (const [key, spec] of Object.entries(TOOL_OPTIONS)) {
      expect(typeof store[spec.setter], `${key} -> ${String(spec.setter)}`).toBe('function')
    }
  })

  it('names at least one annotation type for every option', () => {
    for (const [key, spec] of Object.entries(TOOL_OPTIONS)) {
      expect(spec.types.length, key).toBeGreaterThan(0)
    }
  })

  it('keeps every shadow option on the shadow-capable set', () => {
    const shadow = ['shadowAngle', 'shadowSize', 'shadowBlur', 'shadowOpacity'] as const
    for (const key of shadow) {
      expect(TOOL_OPTIONS[key].scope, key).toBe('selection')
      expect(TOOL_OPTIONS[key].types).toContain('text')
      expect(TOOL_OPTIONS[key].types).not.toContain('blur')
    }
  })
})
