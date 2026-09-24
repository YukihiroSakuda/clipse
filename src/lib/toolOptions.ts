import { useMemo } from 'react'
import type { Annotation, ArrowHead, TextShape } from './annotations'
import { SHADOW_CAPABLE } from './annotations'
import type { AppState, FillMode } from './store'
import { useStore } from './store'

/**
 * The plain tool options — the ones whose whole behavior is "set a field".
 *
 * Every one of them does the same two things when the user picks a value, and
 * the reasons are shared, so they are stated once here instead of once per
 * handler:
 *
 *  - **Adopt the value as the shared default**, even while a selection is
 *    being edited. Otherwise the default is left behind and the control
 *    appears to "reset" (to the stale default) the moment the selection
 *    clears — e.g. on a tool switch right after drawing, since newly drawn
 *    annotations stay selected.
 *  - **Apply it to the selection**, when the selection can carry that option
 *    (`types` / `scope` below).
 *
 * Options with any behavior beyond that — the ones that also clear a
 * neighbouring field, push a color into the shared recents list, or have to
 * round-trip through the canvas — stay as their own handlers in `Editor.tsx`,
 * where that extra step can be read next to the reason for it.
 */
export interface ToolOption<V> {
  /** Store action that records the value as the shared default. */
  setter: keyof AppState
  /** Annotation types this option applies to. */
  types: readonly Annotation['type'][]
  /** The fields to merge into each matching selected annotation. */
  patch: (v: V) => object
  /**
   * `'uniform'` (the default) edits the selection only when *all* of it is
   * one of `types` — the option belongs to one tool, and the panel only
   * shows it for that tool.
   *
   * `'selection'` edits whenever anything is selected, patching just the
   * members that match `types`. Shadow uses this: the Shadow block stays
   * visible for a mixed selection, and dialling it there has to reach every
   * shadow-capable shape in it rather than doing nothing.
   */
  scope?: 'uniform' | 'selection'
  /**
   * Continuous controls (sliders). They edit through `mutateAnnotationsLive`,
   * which pushes no history of its own, after a single `beginSliderAdjust()`
   * — so one drag collapses into one undo step instead of one per tick.
   */
  live?: boolean
}

/**
 * Builds a `ToolOption` while keeping `patch` checked against the exact
 * annotation members `types` names — `{ fontSize }` is only accepted for
 * `['text']`, `{ head }` only for `['arrow']`, and so on. The single cast is
 * here so no call site needs one.
 */
function option<T extends Annotation['type'], V>(
  setter: keyof AppState,
  types: readonly T[],
  patch: (v: V) => Partial<Extract<Annotation, { type: T }>>,
  extra?: { scope?: 'uniform' | 'selection'; live?: boolean },
): ToolOption<V> {
  return { setter, types, patch: patch as (v: V) => object, ...extra }
}

/** Types whose `dash` actually renders — see `AnnotationBase.dash`. */
const DASH_TYPES = ['arrow', 'pen', 'line', 'rect', 'ellipse'] as const

const SHADOW_TYPES = [...SHADOW_CAPABLE] as readonly Annotation['type'][]

export const TOOL_OPTIONS = {
  fontSize: option('setFontSize', ['text'], (v: number) => ({ fontSize: v }), { live: true }),
  textShape: option('setTextShape', ['text'], (v: TextShape) => ({ shape: v })),
  textAlign: option('setTextAlign', ['text'], (v: 'left' | 'center' | 'right') => ({ align: v })),

  numberShape: option('setNumberShape', ['number'], (v: 'circle' | 'square') => ({ shape: v })),
  numberRadius: option('setNumberRadius', ['number'], (v: number) => ({ r: v }), { live: true }),

  arrowHead: option('setArrowHead', ['arrow'], (v: ArrowHead) => ({ head: v })),
  doubleEndedArrow: option('setDoubleEndedArrow', ['arrow'], (v: boolean) => ({ doubleEnded: v })),
  arrowStyle: option('setArrowStyle', ['arrow'], (v: 'straight' | 'elbow') => ({ style: v })),

  fillMode: option('setFillMode', ['rect', 'ellipse'], (v: FillMode) => ({ fill: v })),
  rectRadius: option('setRectRadius', ['rect'], (v: number) => ({ radius: v }), { live: true }),
  lineDash: option('setLineDash', DASH_TYPES, (v: 'solid' | 'dashed' | 'dotted') => ({ dash: v })),

  blurStrength: option('setBlurStrength', ['blur'], (v: number) => ({ strength: v }), { live: true }),
  spotlightDim: option('setSpotlightDim', ['spotlight'], (v: number) => ({ dim: v })),
  spotlightShape: option('setSpotlightShape', ['spotlight'], (v: 'circle' | 'square') => ({ shape: v })),
  magnifierShape: option('setMagnifierShape', ['magnifier'], (v: 'circle' | 'square') => ({ shape: v })),
  imageBorder: option('setImageBorder', ['image'], (v: boolean) => ({ border: v })),

  shadowAngle: option('setShadowAngle', SHADOW_TYPES, (v: number) => ({ shadowAngle: v }), { scope: 'selection', live: true }),
  shadowSize: option('setShadowSize', SHADOW_TYPES, (v: number) => ({ shadowSize: v }), { scope: 'selection', live: true }),
  shadowBlur: option('setShadowBlur', SHADOW_TYPES, (v: number) => ({ shadowBlur: v }), { scope: 'selection', live: true }),
  shadowOpacity: option('setShadowOpacity', SHADOW_TYPES, (v: number) => ({ shadowOpacity: v }), { scope: 'selection', live: true }),
} as const

/** The value each option's handler takes, derived from its own `patch`. */
type OptionValue<K extends keyof typeof TOOL_OPTIONS> =
  (typeof TOOL_OPTIONS)[K] extends ToolOption<infer V> ? V : never

export type ToolOptionHandlers = {
  [K in keyof typeof TOOL_OPTIONS]: (v: OptionValue<K>) => void
}

export interface ToolOptionContext {
  /** The selection's common type, or `null` when it is empty or mixed. */
  uniformType: Annotation['type'] | null
  selectedIds: string[]
  /** Coalesces a slider drag's ticks into one undo step — see `live`. */
  beginSliderAdjust: () => void
}

/**
 * Applies one option, exactly as its handler would.
 *
 * Kept separate from the hook so the whole contract above (adopt the default,
 * then edit the selection when it applies) is reachable without React — see
 * `toolOptions.test.ts`.
 *
 * The store actions are read through `useStore.getState()` rather than
 * subscribed to: they are stable for the life of the store, so subscribing
 * would only add re-renders.
 */
export function applyToolOption<K extends keyof typeof TOOL_OPTIONS>(
  key: K,
  value: OptionValue<K>,
  ctx: ToolOptionContext,
): void {
  // True by construction — `OptionValue<K>` is read off this very entry — but
  // not something TypeScript can follow through a generic index, so it is
  // asserted once here.
  const spec = TOOL_OPTIONS[key] as ToolOption<OptionValue<K>>
  const matches = (type: Annotation['type']) => spec.types.includes(type)

  const store = useStore.getState()
  ;(store[spec.setter] as (v: OptionValue<K>) => void)(value)

  const applies = spec.scope === 'selection'
    ? ctx.selectedIds.length > 0
    : ctx.uniformType !== null && matches(ctx.uniformType)
  if (!applies) return

  if (spec.live) ctx.beginSliderAdjust()
  const mutate = spec.live ? store.mutateAnnotationsLive : store.mutateAnnotations
  mutate(ctx.selectedIds, (a) => (matches(a.type) ? { ...a, ...spec.patch(value) } as Annotation : a))
}

/** One handler per entry in `TOOL_OPTIONS`, keyed by the same names. */
export function useToolOptions(ctx: ToolOptionContext): ToolOptionHandlers {
  const { uniformType, selectedIds, beginSliderAdjust } = ctx

  return useMemo(() => {
    const bound = { uniformType, selectedIds, beginSliderAdjust }
    const keys = Object.keys(TOOL_OPTIONS) as (keyof typeof TOOL_OPTIONS)[]
    return Object.fromEntries(
      keys.map((k) => [k, (v: never) => applyToolOption(k, v, bound)]),
    ) as ToolOptionHandlers
  }, [uniformType, selectedIds, beginSliderAdjust])
}
