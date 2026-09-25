// The editor's tool defaults: the color, width, shape and shadow a newly
// drawn annotation is created with, and the setters the options panel calls.
//
// Most of them are remembered across sessions — see `persist.ts`, which owns
// the single list of which ones and how they are validated. The ones that are
// deliberately *not* remembered say so on their own field below.

import type { StateCreator } from 'zustand'
import { PALETTE, blurStrengthPct, isPaletteColor } from '../annotations'
import type { ArrowHead, BubbleTailAnchor, TextBgFill, TextShape } from '../annotations'
import type { AppState } from './index'
import type { AnnotationTool, FillMode } from './types'
import { loadPersistedDefaults } from './persist'

/** Restored once, at module load, and read by the initial values below. */
const persisted = loadPersistedDefaults()

export interface ToolDefaultsSlice {
  // Active annotation tool
  activeTool: AnnotationTool
  setActiveTool: (tool: AnnotationTool) => void

  // Active annotation color (hex)
  activeColor: string
  setActiveColor: (hex: string) => void
  recentColors: string[]  // custom colors added via picker (max 5)
  /** Registers a custom (non-palette) hex into the shared `recentColors`
   *  list without touching `activeColor` — every `ColorSwatchPicker` in the
   *  editor (the main ink color, Erase's Fill Color, Shadow/Glow color) is
   *  handed the same `recentColors` and calls this on a custom pick, so a
   *  color picked from any one of them shows up in all the others. Palette
   *  colors are never added (they already have a fixed swatch), and an
   *  already-recent one is left in place rather than bumped to the end — no
   *  MRU reshuffling, so a swatch stays where muscle memory expects it. */
  addRecentColor: (hex: string) => void
  /** Last palette-chosen color — what activeColor falls back to when a new
   *  image clears the picked colors it may currently point at. */
  lastPaletteColor: string

  // Stroke width
  strokeWidth: number
  setStrokeWidth: (w: number) => void

  // Ink opacity (0.1..1 — the Opacity slider floors at 10%, not 0%, since a
  // shape at literal 0% opacity is indistinguishable from not being there
  // at all, which reads as the tool having silently failed rather than as a
  // deliberate "barely visible" look), shared across the whole color
  // palette. Deliberately *not* persisted (see the subscribe block below) —
  // unlike color/stroke width/etc., a session ending on a low opacity would
  // otherwise start the next one with every new shape faint by default and
  // no visible reason why, which reads as the app being broken rather than
  // as a remembered preference. Always starts at 1 (100%).
  activeOpacity: number
  setActiveOpacity: (o: number) => void

  // Font size (for Text tool)
  fontSize: number
  setFontSize: (s: number) => void

  // Text background shape (for Text tool)
  textShape: TextShape
  setTextShape: (s: TextShape) => void

  /** How a new box/bubble text's background paints — see `TextBgFill`.
   *  Ignored for `textShape: 'none'`. */
  textBgFill: TextBgFill
  setTextBgFill: (f: TextBgFill) => void

  /** Whether a new `'solid'`-fill box/bubble text starts with its
   *  Background swatch set to Auto (following the text color) instead of
   *  the text swatch — see `TextAnn.bgAuto`. Ignored for any other
   *  `textBgFill`. */
  textBgAuto: boolean
  setTextBgAuto: (v: boolean) => void

  // Multi-line text horizontal alignment
  textAlign: 'left' | 'center' | 'right'
  setTextAlign: (a: 'left' | 'center' | 'right') => void

  // Bubble tail position (one of 16 compass points around the box)
  tailAnchor: BubbleTailAnchor
  setTailAnchor: (a: BubbleTailAnchor) => void

  // Blur strength (for Blur tool) — % of the region's short side, see
  // `blurStrengthPct`.
  blurStrength: number
  setBlurStrength: (s: number) => void

  // Color-match tolerance (for the Erase tool) — 0..100, how close a pixel's
  // color must be to the key color (the active color) to fade toward
  // transparent. See EraseAnn.tolerance.
  eraseTolerance: number
  setEraseTolerance: (t: number) => void

  // What a fresh selection does to the image — see EraseAnn.effect. Only
  // ever set to 'erase'/'fill' now (the tool was simplified down to those
  // two — Pick Mode and the Blur/Pixelate effects were removed), but the
  // type stays as wide as EraseAnn.effect itself so an old document's
  // 'blur'/'pixelate' value still round-trips through the store correctly
  // when that annotation is selected.
  eraseEffect: 'erase' | 'fill' | 'blur' | 'pixelate'
  setEraseEffect: (e: 'erase' | 'fill' | 'blur' | 'pixelate') => void

  // Paint color for the Erase tool's 'fill' effect — see EraseAnn.fillColor.
  // Its own default rather than falling back to `activeColor`: `color` on an
  // erase annotation already means "the sampled seed color", not an ink
  // choice, and `activeColor` can easily be some unrelated shade the user
  // last drew with — picking a fill color would then look like it keeps
  // reverting to that shade instead of actually taking the pick.
  eraseFillColor: string
  setEraseFillColor: (hex: string) => void

  // Spotlight outside-dim opacity (for Spotlight tool)
  spotlightDim: number
  setSpotlightDim: (d: number) => void

  // Spotlight lit-region shape
  spotlightShape: 'circle' | 'square'
  setSpotlightShape: (s: 'circle' | 'square') => void

  // Magnifier default zoom (target box size / source box size) — remembered
  // from the last target-box resize, same convention as numberRadius.
  magnifierZoom: number
  setMagnifierZoom: (z: number) => void

  // Magnifier box shape (both source and target) — same convention as spotlightShape.
  magnifierShape: 'circle' | 'square'
  setMagnifierShape: (s: 'circle' | 'square') => void

  /** Whether a pasted picture gets a border (drawn in `activeColor` at
   *  `strokeWidth`) — the default new pastes start with. */
  imageBorder: boolean
  setImageBorder: (b: boolean) => void

  /** Shadow/glow default a newly drawn annotation is created with (see
   *  `getShadowStyle`/`SHADOW_CAPABLE`) — shared across every shadow-capable
   *  tool, the same way `strokeWidth`/`activeOpacity` are. */
  shadowStyle: 'none' | 'drop' | 'glow' | 'outline'
  setShadowStyle: (s: 'none' | 'drop' | 'glow' | 'outline') => void

  /** Drop-shadow direction default — see `AnnotationBase.shadowAngle`. */
  shadowAngle: number
  setShadowAngle: (deg: number) => void

  /** Drop-shadow offset-distance default (0-100) — see `AnnotationBase.shadowSize`. */
  shadowSize: number
  setShadowSize: (s: number) => void

  /** Shadow/glow blur-radius default (0-100) — see `AnnotationBase.shadowBlur`. */
  shadowBlur: number
  setShadowBlur: (b: number) => void

  /** Shadow/glow opacity default (0-100) — see `AnnotationBase.shadowOpacity`. */
  shadowOpacity: number
  setShadowOpacity: (o: number) => void

  /** Shadow/glow color override default; `null` = auto (see
   *  `AnnotationBase.shadowColor`). */
  shadowColor: string | null
  setShadowColor: (hex: string | null) => void

  // Fill mode (for Rect / Ellipse)
  fillMode: FillMode
  setFillMode: (m: FillMode) => void

  /** Stroke pattern for a new arrow/line/pen, or a new rect/ellipse whose
   *  fill is `'stroke'` — see `AnnotationBase.dash`. */
  lineDash: 'solid' | 'dashed' | 'dotted'
  setLineDash: (d: 'solid' | 'dashed' | 'dotted') => void

  /** Corner radius (image px) for a new rect — see `RectAnn.radius`. */
  rectRadius: number
  setRectRadius: (r: number) => void

  // Number marker shape
  numberShape: 'circle' | 'square'
  setNumberShape: (s: 'circle' | 'square') => void

  // Number marker radius (image px) — remembered from the last resize so the
  // next marker comes out the same size.
  numberRadius: number
  setNumberRadius: (r: number) => void

  // Arrowhead style
  arrowHead: ArrowHead
  setArrowHead: (h: ArrowHead) => void

  // Arrow: head on both ends vs. just the tip
  doubleEndedArrow: boolean
  setDoubleEndedArrow: (d: boolean) => void

  // Arrow: straight line vs. Excel-style right-angle elbow connector
  arrowStyle: 'straight' | 'elbow'
  setArrowStyle: (s: 'straight' | 'elbow') => void
}

export const createToolDefaults: StateCreator<AppState, [], [], ToolDefaultsSlice> = (set, get) => ({
  activeTool: 'arrow',
  setActiveTool: (tool) => set({ activeTool: tool, selectedIds: [] }),

  activeColor: persisted.activeColor ?? PALETTE.red,
  setActiveColor: (hex) => {
    get().addRecentColor(hex)
    set(isPaletteColor(hex) ? { activeColor: hex, lastPaletteColor: hex } : { activeColor: hex })
  },
  addRecentColor: (hex) => set((s) => {
    // Picked colors keep their position (pick order, oldest first) — no
    // MRU reshuffling, so a swatch stays where the user's muscle memory
    // expects it. The oldest is dropped once the cap is hit.
    if (isPaletteColor(hex) || s.recentColors.includes(hex)) return {}
    return { recentColors: [...s.recentColors, hex].slice(-5) }
  }),
  // Picked (eyedropper) colors are per-editor-session on purpose — they come
  // from one specific image, so carrying them across restarts isn't useful.
  recentColors: [],
  lastPaletteColor: persisted.activeColor ?? PALETTE.red,

  strokeWidth: persisted.strokeWidth ?? 3,
  setStrokeWidth: (w) => set({ strokeWidth: w }),

  // Always 1 on startup — see the field's own doc comment above for why
  // this is the one shared "ink" default that never reads from `persisted`.
  activeOpacity: 1,
  setActiveOpacity: (o) => set({ activeOpacity: Math.max(0.1, Math.min(1, o)) }),

  fontSize: persisted.fontSize ?? 20,
  setFontSize: (s) => set({ fontSize: s }),

  textShape: persisted.textShape ?? 'none',
  setTextShape: (s) => set({ textShape: s }),

  textBgFill: persisted.textBgFill ?? 'solid',
  setTextBgFill: (f) => set({ textBgFill: f }),

  textBgAuto: persisted.textBgAuto ?? false,
  setTextBgAuto: (v) => set({ textBgAuto: v }),

  textAlign: persisted.textAlign ?? 'left',
  setTextAlign: (a) => set({ textAlign: a }),

  tailAnchor: persisted.tailAnchor ?? 's3',
  setTailAnchor: (a) => set({ tailAnchor: a }),

  blurStrength: blurStrengthPct(persisted.blurStrength),
  // Capped at 40 — see blurStrengthPct's doc comment (annotations.ts).
  setBlurStrength: (s) => set({ blurStrength: Math.max(1, Math.min(40, s)) }),

  eraseTolerance: persisted.eraseTolerance ?? 30,
  setEraseTolerance: (t) => set({ eraseTolerance: Math.max(0, Math.min(100, t)) }),

  eraseEffect: persisted.eraseEffect ?? 'erase',
  setEraseEffect: (e) => set({ eraseEffect: e }),

  eraseFillColor: persisted.eraseFillColor ?? PALETTE.red,
  setEraseFillColor: (hex) => set({ eraseFillColor: hex }),

  spotlightDim: persisted.spotlightDim ?? 0.55,
  setSpotlightDim: (d) => set({ spotlightDim: d }),

  spotlightShape: persisted.spotlightShape ?? 'circle',
  setSpotlightShape: (s) => set({ spotlightShape: s }),

  magnifierZoom: persisted.magnifierZoom ?? 2.5,
  setMagnifierZoom: (z) => set({ magnifierZoom: Math.max(1.1, Math.min(10, z)) }),

  magnifierShape: persisted.magnifierShape ?? 'square',
  setMagnifierShape: (s) => set({ magnifierShape: s }),

  imageBorder: persisted.imageBorder ?? false,
  setImageBorder: (b) => set({ imageBorder: b }),

  shadowStyle: persisted.shadowStyle ?? 'drop',
  setShadowStyle: (s) => set({ shadowStyle: s }),

  // 45 — a *newly drawn* shadow's starting direction; `getShadowAngle`'s own
  // absent-field fallback stays 135 (unchanged) so a document saved before
  // this default changed keeps rendering exactly as it did.
  shadowAngle: persisted.shadowAngle ?? 45,
  setShadowAngle: (deg) => set({ shadowAngle: ((deg % 360) + 360) % 360 }),

  shadowSize: persisted.shadowSize ?? 10,
  setShadowSize: (s) => set({ shadowSize: Math.max(0, Math.min(100, s)) }),

  // 0 (a flat, solid, hard-edged shadow) — unlike `getShadowBlur`'s own
  // absent-field fallback (15, kept for pre-existing documents' sake, see
  // its doc comment), this is what a *newly drawn* annotation's shadow
  // actually starts at.
  shadowBlur: persisted.shadowBlur ?? 0,
  setShadowBlur: (b) => set({ shadowBlur: Math.max(0, Math.min(100, b)) }),

  // 45 — matches the fixed alpha drop shadow used before this field existed
  // (see `getShadowOpacity`'s doc comment); glow's own pre-existing default
  // was fully opaque, but a single shared slider needs one starting point,
  // and drop is the more common style to start a fresh session on.
  shadowOpacity: persisted.shadowOpacity ?? 45,
  setShadowOpacity: (o) => set({ shadowOpacity: Math.max(0, Math.min(100, o)) }),

  shadowColor: persisted.shadowColor ?? null,
  setShadowColor: (hex) => set({ shadowColor: hex }),

  fillMode: persisted.fillMode ?? 'stroke',
  setFillMode: (m) => set({ fillMode: m }),

  lineDash: persisted.lineDash ?? 'solid',
  setLineDash: (d) => set({ lineDash: d }),

  rectRadius: persisted.rectRadius ?? 0,
  setRectRadius: (r) => set({ rectRadius: Math.max(0, Math.min(200, r)) }),

  numberShape: persisted.numberShape ?? 'circle',
  setNumberShape: (s) => set({ numberShape: s }),

  // Default matches the old sw-derived size at the default stroke width
  // (max(10, 3*5) = 15).
  numberRadius: persisted.numberRadius ?? 15,
  setNumberRadius: (r) => set({ numberRadius: Math.max(6, Math.min(200, r)) }),

  arrowHead: persisted.arrowHead ?? 'triangle',
  setArrowHead: (h) => set({ arrowHead: h }),

  doubleEndedArrow: persisted.doubleEndedArrow ?? false,
  setDoubleEndedArrow: (d) => set({ doubleEndedArrow: d }),

  arrowStyle: persisted.arrowStyle ?? 'straight',
  setArrowStyle: (s) => set({ arrowStyle: s }),
})
