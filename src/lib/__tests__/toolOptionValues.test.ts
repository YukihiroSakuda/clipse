import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '../store'
import { toolOptionValues } from '../toolOptionValues'
import type { Annotation } from '../annotations'
import { blur, num, rect, text } from './fixtures'

const values = (firstSelected: Annotation | null) =>
  toolOptionValues(useStore.getState(), {
    firstSelected,
    uniformType: firstSelected?.type ?? null,
  })

/** A mixed selection: something is selected, but it has no common type. */
const mixedValues = (firstSelected: Annotation) =>
  toolOptionValues(useStore.getState(), { firstSelected, uniformType: null })

beforeEach(() => {
  useStore.getState().restoreAnnotations([], 1)
})

describe('with nothing selected', () => {
  it('shows the shared defaults — what the next shape would get', () => {
    useStore.getState().setFontSize(33)
    useStore.getState().setArrowHead('dot')
    const v = values(null)
    expect(v.fontSize).toBe(33)
    expect(v.arrowHead).toBe('dot')
    expect(v.selectedAnnotationType).toBeNull()
  })
})

describe('options shared across every type', () => {
  it('reads color, opacity and stroke width off any selection', () => {
    const v = values(rect({ id: 'r', color: '#123456', sw: 9, opacity: 0.4 }))
    expect(v.activeColor).toBe('#123456')
    expect(v.strokeWidth).toBe(9)
    expect(v.opacity).toBe(0.4)
  })

  it('defaults an absent opacity to fully opaque, not to the shared default', () => {
    useStore.getState().setActiveOpacity(0.2)
    expect(values(rect({ id: 'r' })).opacity).toBe(1)
  })

  it('reads the dash off any selected type, not just the dashable ones', () => {
    // Deliberately wider than the option's own edit rule — a selected shape
    // shows the dash it actually carries.
    expect(values(num({ id: 'n', dash: 'dotted' })).lineDash).toBe('dotted')
  })

  it('reads shadow through the per-type fallbacks', () => {
    // text defaults to 'drop', everything else to 'none' — see getShadowStyle.
    expect(values(text({ id: 't' })).shadowStyle).toBe('drop')
    expect(values(rect({ id: 'r' })).shadowStyle).toBe('none')
    expect(values(rect({ id: 'r', shadowBlur: 77 })).shadowBlur).toBe(77)
  })

  it('still reads them off a mixed selection', () => {
    const v = mixedValues(rect({ id: 'r', color: '#ABCDEF' }))
    expect(v.activeColor).toBe('#ABCDEF')
  })
})

describe('per-tool options', () => {
  it('reads the selection value when the selection is uniformly that type', () => {
    useStore.getState().setFontSize(10)
    expect(values(text({ id: 't', fontSize: 64 })).fontSize).toBe(64)
  })

  it('falls back to the shared default for a different type', () => {
    useStore.getState().setFontSize(10)
    expect(values(rect({ id: 'r' })).fontSize).toBe(10)
  })

  it('falls back to the shared default for a mixed selection', () => {
    useStore.getState().setFontSize(10)
    expect(mixedValues(text({ id: 't', fontSize: 64 })).fontSize).toBe(10)
  })

  it('applies each option-specific absent-field fallback', () => {
    expect(values(rect({ id: 'r' })).rectRadius).toBe(0)
    expect(values(text({ id: 't' })).textAlign).toBe('left')
    expect(values(text({ id: 't' })).bgFill).toBe('solid')
  })

  it('normalizes a legacy blur preset through blurStrengthPct', () => {
    expect(values(blur({ id: 'b', strength: 'high' })).blurStrength).toBe(33)
  })
})

describe('the Background / Text color pair', () => {
  it('resolves both sides off a solid box text', () => {
    const v = values(text({ id: 't', shape: 'box', color: '#000000' }))
    expect(v.textBoxBg).toBe('#000000')
    expect(v.textBoxFontColor).toBe('#FFFFFF')
    expect(v.textBoxBgAuto).toBe(false)
  })

  it('reports Text as the active side when the text carries bgAuto', () => {
    const v = values(text({ id: 't', shape: 'box', color: '#000000', textColor: '#FFFFFF', bgAuto: true }))
    expect(v.textBoxBgAuto).toBe(true)
    expect(v.textBoxFontColor).toBe('#FFFFFF')
  })

  it('stays out of the plain Color swatch for a non-solid fill', () => {
    // 'white'/'stroke' auto-match their border to `color` on their own.
    expect(values(text({ id: 't', shape: 'box', bgFill: 'white' })).textBoxBg).toBeNull()
  })

  it('stays out of it for any other type', () => {
    expect(values(rect({ id: 'r' })).textBoxBg).toBeNull()
  })

  it('previews the next new text when nothing is selected', () => {
    const s = useStore.getState()
    s.setActiveTool('text')
    s.setTextShape('box')
    s.setTextBgFill('solid')
    s.setActiveColor('#000000')
    const v = values(null)
    expect(v.textBoxBg).toBe('#000000')
    expect(v.textBoxFontColor).toBe('#FFFFFF')
  })

  it('previews nothing while the Text tool is not active', () => {
    const s = useStore.getState()
    s.setActiveTool('rect')
    s.setTextShape('box')
    expect(values(null).textBoxBg).toBeNull()
  })
})

describe('erase', () => {
  it('never hides Tolerance while nothing erase-typed is selected', () => {
    // `eraseCompound` gates that row, and it steers the *next* click too.
    expect(values(null).eraseCompound).toBe(false)
    expect(values(rect({ id: 'r' })).eraseCompound).toBe(false)
  })

  it('falls back to the shared fill color when the selection has none', () => {
    useStore.getState().setEraseFillColor('#ABCDEF')
    expect(values(null).eraseFillColor).toBe('#ABCDEF')
  })
})
