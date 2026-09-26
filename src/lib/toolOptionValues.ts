import { useMemo } from 'react'
import type { Annotation } from './annotations'
import {
  blurStrengthPct, getShadowAngle, getShadowBlur, getShadowOpacity,
  getShadowSize, getShadowStyle, resolveTextColors,
} from './annotations'
import type { AppState } from './store'
import { useStore } from './store'

/**
 * What the tool-options panel needs to know about the current selection.
 *
 * `firstSelected` is what every "show the selection's value" control reads
 * from; `uniformType` is the selection's common type, or `null` when it is
 * empty or mixed.
 */
export interface ToolSelection {
  firstSelected: Annotation | null
  uniformType: Annotation['type'] | null
}

/**
 * Every control in the tool-options panel shows the same thing: the selected
 * annotation's own value when the selection can carry that option, and the
 * shared default otherwise — the value a newly drawn shape would get.
 *
 * Which of the two applies is per option, and the differences are deliberate:
 * Color/Opacity/Stroke Width/Shadow read off *any* selection (they apply to
 * every type), while the per-tool options only read off a selection that is
 * uniformly of their own type, since a mixed selection has no single value to
 * show.
 */
export function toolOptionValues(store: AppState, selection: ToolSelection) {
  const { firstSelected: sel, uniformType } = selection
  // A 'solid'-fill box/bubble text shows Background and Text as one swatch
  // plus a toggle naming which side it currently edits — one palette, two
  // roles, not two independently-remembered colors (see `TextAnn.bgAuto`'s
  // doc comment), so `activeColor` alone drives both here. Gated to exactly
  // that context (not just "a text is selected" or "nothing is") so this
  // never leaks into the plain shared Color swatch every other tool (and
  // non-solid text) uses.
  //
  // With a text selected, both resolve off *that* annotation; with nothing
  // selected (setting the next new text's defaults), `resolveTextColors` is
  // fed the same synthetic object `AnnotationCanvas`'s `commitText`/
  // editing-preview logic effectively uses — see their own comments — so
  // the panel's preview always matches what actually gets created.
  const isSolidTextSelection = uniformType === 'text' && sel?.type === 'text'
    && (sel.bgFill ?? 'solid') === 'solid'
  const isSolidTextDefault = !sel && store.activeTool === 'text'
    && store.textShape !== 'none' && store.textBgFill === 'solid'
  const resolvedTextBox = isSolidTextSelection
    ? resolveTextColors(sel!)
    : isSolidTextDefault
      ? resolveTextColors({
          color: store.activeColor,
          textColor: store.textBgAuto ? store.activeColor : undefined,
          bgAuto: store.textBgAuto,
          bgFill: 'solid',
        })
      : null

  return {
    activeTool: store.activeTool,
    recentColors: store.recentColors,
    selectedAnnotationType: uniformType,

    // ── Shared across every type: read off any selection ──
    activeColor: sel ? sel.color : store.activeColor,
    opacity: sel ? sel.opacity ?? 1 : store.activeOpacity,
    strokeWidth: sel ? sel.sw : store.strokeWidth,
    lineDash: sel ? sel.dash ?? 'solid' : store.lineDash,
    shadowStyle: sel ? getShadowStyle(sel) : store.shadowStyle,
    shadowAngle: sel ? getShadowAngle(sel) : store.shadowAngle,
    shadowSize: sel ? getShadowSize(sel) : store.shadowSize,
    shadowBlur: sel ? getShadowBlur(sel) : store.shadowBlur,
    shadowOpacity: sel ? getShadowOpacity(sel) : store.shadowOpacity,
    shadowColor: sel ? sel.shadowColor ?? null : store.shadowColor,

    // ── Per-tool: read only off a selection uniformly of that type ──
    fontSize: uniformType === 'text' && sel?.type === 'text' ? sel.fontSize : store.fontSize,
    textShape: uniformType === 'text' && sel?.type === 'text' ? sel.shape : store.textShape,
    bgFill: uniformType === 'text' && sel?.type === 'text' ? sel.bgFill ?? 'solid' : store.textBgFill,
    textAlign: uniformType === 'text' && sel?.type === 'text' ? sel.align ?? 'left' : store.textAlign,

    fillMode: (uniformType === 'rect' || uniformType === 'ellipse')
      && (sel?.type === 'rect' || sel?.type === 'ellipse')
      ? sel.fill
      : store.fillMode,
    rectRadius: uniformType === 'rect' && sel?.type === 'rect' ? sel.radius ?? 0 : store.rectRadius,

    numberShape: uniformType === 'number' && sel?.type === 'number' ? sel.shape : store.numberShape,
    numberFormat: uniformType === 'number' && sel?.type === 'number' ? sel.format ?? 'decimal' : store.numberFormat,
    numberRadius: uniformType === 'number' && sel?.type === 'number' ? sel.r : store.numberRadius,

    arrowHead: uniformType === 'arrow' && sel?.type === 'arrow' ? sel.head : store.arrowHead,
    doubleEndedArrow: uniformType === 'arrow' && sel?.type === 'arrow' ? sel.doubleEnded ?? false : store.doubleEndedArrow,
    arrowStyle: uniformType === 'arrow' && sel?.type === 'arrow' ? sel.style ?? 'straight' : store.arrowStyle,

    blurStrength: uniformType === 'blur' && sel?.type === 'blur' ? blurStrengthPct(sel.strength) : store.blurStrength,
    spotlightDim: uniformType === 'spotlight' && sel?.type === 'spotlight' ? sel.dim ?? 0.55 : store.spotlightDim,
    spotlightShape: uniformType === 'spotlight' && sel?.type === 'spotlight' ? sel.shape ?? 'square' : store.spotlightShape,
    magnifierShape: uniformType === 'magnifier' && sel?.type === 'magnifier' ? sel.shape ?? 'square' : store.magnifierShape,
    imageBorder: uniformType === 'image' && sel?.type === 'image' ? sel.border ?? false : store.imageBorder,

    eraseTolerance: uniformType === 'erase' && sel?.type === 'erase' ? sel.tolerance : store.eraseTolerance,
    // `false` (never hides Tolerance) while nothing erase-typed is selected,
    // since the setting still steers the *next* click — see `eraseCompound`
    // on the panel's own props for the whole rule.
    eraseCompound: uniformType === 'erase' && sel?.type === 'erase' ? sel.compound ?? false : false,
    eraseEffect: uniformType === 'erase' && sel?.type === 'erase' ? sel.effect ?? 'erase' : store.eraseEffect,
    eraseFillColor: uniformType === 'erase' && sel?.type === 'erase' ? sel.fillColor ?? store.eraseFillColor : store.eraseFillColor,

    textBoxBg: resolvedTextBox?.bg ?? null,
    textBoxBgAuto: isSolidTextSelection ? !!sel!.bgAuto : isSolidTextDefault ? store.textBgAuto : false,
    textBoxFontColor: resolvedTextBox?.text ?? null,
  }
}

export type ToolOptionValues = ReturnType<typeof toolOptionValues>

/** `toolOptionValues` against the live store, memoized for the panel. */
export function useToolOptionValues(selection: ToolSelection): ToolOptionValues {
  const store = useStore()
  const { firstSelected, uniformType } = selection
  return useMemo(
    () => toolOptionValues(store, { firstSelected, uniformType }),
    [store, firstSelected, uniformType],
  )
}
