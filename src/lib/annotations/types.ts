// Annotation types — all coordinates are in image-pixel space.
//
// Definitions only: the behavior each field drives lives in the sibling
// modules (`style`, `geometry`, `text`, `connections`, `draw`), which all
// import from here and never the other way round.

export interface AnnotationBase {
  id: string
  color: string  // hex, e.g. '#EF4444'
  sw: number     // stroke width in image pixels
  /** Stroke pattern — meaningful only for types that actually stroke a path
   *  (arrow/line/pen, and rect/ellipse when their `fill` is `'stroke'`); a
   *  filled rect/ellipse/text background, or anything read only for its
   *  border-*width* elsewhere, ignores this. Absent = `'solid'`. See
   *  `dashArray`. */
  dash?: 'solid' | 'dashed' | 'dotted'
  /** Ink opacity 0..1, shared across the whole color palette (like `color`
   *  itself). Absent (pre-existing annotations) = 1 (fully opaque). Ignored
   *  by `blur`/`spotlight`, which don't paint with `color`. */
  opacity?: number
  /** Shadow/glow behind the annotation's ink. Meaningful only for
   *  `SHADOW_CAPABLE` types — everything else (`blur`/`spotlight`/
   *  `magnifier`) has no fill/stroke of its own to lift off the image, and
   *  ignores this. `'drop'` is a neutral dark offset shadow (depth); `'glow'`
   *  is a soft halo in the annotation's own `color`, centered with no offset
   *  (emphasis); `'outline'` is a solid band of even thickness traced around
   *  the shape's silhouette, white unless recolored (a sticker-style cutout
   *  that separates the shape from a busy image — see `draw/outline.ts`,
   *  since no canvas shadow can draw it). Absent falls back to `getShadowStyle`'s per-type default:
   *  `'drop'` for `text` (which always had a subtle shadow, for legibility,
   *  before this field existed) and `'none'` for every other pre-existing
   *  annotation (which never had one). */
  shadowStyle?: 'none' | 'drop' | 'glow' | 'outline'
  /** Drop shadow's cast direction, degrees clockwise from due right (canvas
   *  angle convention: 0° = shadow to the right, 90° = straight down).
   *  Ignored for `'glow'` (centered, no direction) and `'none'`. Absent =
   *  135° (down-and-right — the classic drop-shadow direction). */
  shadowAngle?: number
  /** Drop shadow's offset distance, 0-100 — how far it's cast before any
   *  blur — and for `'outline'`, the band's thickness. Ignored for `'glow'`
   *  (centered, no direction to cast along) and `'none'`. Absent = 10 (see
   *  `getShadowSize`). */
  shadowSize?: number
  /** Shadow/glow blur radius, 0-100 — independent of `shadowSize`, since a
   *  crisp shadow cast far away and a soft one sitting right under the shape
   *  are both looks worth having on their own. Absent = 15 — see
   *  `getShadowBlur`'s doc comment; a *newly drawn* annotation gets an
   *  explicit value from the shared `shadowBlur` default instead (see
   *  `store.ts`), which starts at 0 (a flat, solid, hard-edged shadow — see
   *  `resolveShadow`'s doc comment for why 0 is a fully reachable look, not
   *  just padding), so this absent-field fallback in practice only matters
   *  for a document saved before per-annotation shadow existed. */
  shadowBlur?: number
  /** Shadow/glow opacity, 0-100 — independent of `shadowColor`, which stays
   *  the pure hue; this is what actually lightens or darkens how strongly
   *  it reads against the image underneath. Absent — see
   *  `getShadowOpacity`'s doc comment for its (style-dependent) fallback;
   *  a *newly drawn* annotation gets an explicit value from the shared
   *  `shadowOpacity` default instead (see `store.ts`). */
  shadowOpacity?: number
  /** Shadow/glow color override. Absent (the common case) means the old
   *  fixed defaults: neutral black for `'drop'`, the annotation's own `color`
   *  for `'glow'`, white for `'outline'` — picking an explicit color here
   *  applies to any style. */
  shadowColor?: string
}

/** Annotation types whose shadow/glow the user can toggle — the "ink" tools,
 *  where it reads as depth or emphasis. `blur`/`spotlight`/`magnifier` are
 *  left out: they dim or resample the underlying image rather than painting
 *  a fill/stroke of their own. `highlight` is also left out — it's a flat
 *  translucent marker-pen wash meant to sit on the image like ink on paper,
 *  not lift off it, and `ToolOptionsPanel`'s `SHADOW_TOOLS` already hides
 *  the Effect tab for it; leaving it in this set only meant a shared
 *  shadowStyle carried over from whatever shape was drawn last still
 *  rendered on a highlight with no UI to see or clear it. */
export const SHADOW_CAPABLE = new Set<Annotation['type']>([
  'arrow', 'line', 'pen', 'rect', 'ellipse', 'text', 'number', 'image',
])

export type ArrowHead = 'triangle' | 'line' | 'dot' | 'none'

/** One of a speech-bubble's 16 tail anchors: 4 evenly-spaced points on each
 *  of the box's 4 straight edges — corners deliberately excluded (a tail
 *  hanging off a corner reads ambiguous, neither edge's own). Independent of
 *  `ConnectAnchor` (the *other* shapes' arrows connect to that one; a
 *  bubble's own tail uses this one) even though both describe 16 points
 *  around a rect — see `BUBBLE_TAIL_UNITS`. */
export type BubbleTailAnchor =
  | 'n1' | 'n2' | 'n3' | 'n4'
  | 'e1' | 'e2' | 'e3' | 'e4'
  | 's1' | 's2' | 's3' | 's4'
  | 'w1' | 'w2' | 'w3' | 'w4'

/** One of a shape's 16 fixed connection points, named by compass direction
 *  and spaced every 1/16th of its outline (corners, edge midpoints and the
 *  quarter points in between) — Excel/PowerPoint-style connectors: the slot
 *  is fixed once attached, its resolved position tracks the target as it
 *  moves/resizes/rotates. */
export type ConnectAnchor =
  | 'n' | 'nne' | 'ne' | 'ene'
  | 'e' | 'ese' | 'se' | 'sse'
  | 's' | 'ssw' | 'sw' | 'wsw'
  | 'w' | 'wnw' | 'nw' | 'nnw'

export interface ArrowConnection {
  targetId: string
  anchor: ConnectAnchor
}

export interface ArrowAnn extends AnnotationBase {
  type: 'arrow'
  x1: number; y1: number
  x2: number; y2: number
  head: ArrowHead
  /** Draw the same head style on the (x1,y1) end too. Absent (pre-existing
   *  annotations) = false (single-headed, at x2/y2 only). */
  doubleEnded?: boolean
  /** 'straight' (absent, pre-existing annotations) = today's direct line.
   *  'elbow' = Excel-style right-angle connector — see `getElbowSegments`. */
  style?: 'straight' | 'elbow'
  /** Elbow only: 0..1 position of the bend along the endpoints' dominant
   *  axis (recomputed live, never persisted — see `getElbowSegments`). Absent = 0.5. */
  bendRatio?: number
  /** (x1,y1) glued to another annotation's connection point. When present,
   *  x1/y1 are kept in sync with the target and shouldn't be edited directly
   *  — see `resolveArrowConnections`. */
  startConnect?: ArrowConnection
  /** Same as `startConnect`, for the (x2,y2) end. */
  endConnect?: ArrowConnection
}

export interface LineAnn extends AnnotationBase {
  type: 'line'
  x1: number; y1: number
  x2: number; y2: number
}

export interface PenAnn extends AnnotationBase {
  type: 'pen'
  points: { x: number; y: number }[]
  /** Rotation in degrees around the stroke's bounding-box center, clockwise.
   *  Stored separately rather than baked into `points` so a rotation stays
   *  reversible (drag the handle back to 0° and the stroke is bit-for-bit what
   *  was drawn) — unlike a resize, which has to rewrite the points. Absent
   *  (pre-existing annotations) = 0. */
  rotation?: number
}

export interface RectAnn extends AnnotationBase {
  type: 'rect'
  x: number; y: number
  w: number; h: number
  fill: 'stroke' | 'solid' | 'semi'
  /** Rotation in degrees around the shape's center, clockwise. Absent (pre-existing annotations) = 0. */
  rotation?: number
  /** Corner radius, image px — clamped at draw time to half the shorter
   *  side (same as `ctx.roundRect` itself would) so an oversized value
   *  can't turn the rect into a self-intersecting shape. Absent
   *  (pre-existing annotations) = 0, i.e. sharp corners, the original look. */
  radius?: number
}

export interface EllipseAnn extends AnnotationBase {
  type: 'ellipse'
  cx: number; cy: number
  rx: number; ry: number
  fill: 'stroke' | 'solid' | 'semi'
  /** Rotation in degrees around the shape's center, clockwise. Absent (pre-existing annotations) = 0. */
  rotation?: number
}

export type TextShape = 'none' | 'box' | 'bubble'

/** How a box/bubble text's background paints: `'solid'` (opaque, in `color`),
 *  `'white'` (fixed white fill plus a `color`-colored border — the classic
 *  "shiro-nuki" caption look), or `'stroke'` (no fill at all — just a
 *  `color`-colored outline, so the image underneath shows through the whole
 *  interior). See `resolveTextColors`. */
export type TextBgFill = 'solid' | 'white' | 'stroke'

export interface TextAnn extends AnnotationBase {
  type: 'text'
  x: number; y: number
  text: string
  fontSize: number
  /** Background behind the text: 'none' (plain, drop-shadowed), 'box' (solid
   *  rounded rect), or 'bubble' (rounded rect with a speech-bubble tail). */
  shape: TextShape
  /** Bubble only: which of the box's 16 tail anchors (4 per straight edge,
   *  no corners — see `BubbleTailAnchor`) the tail hangs off. Absent = 's3',
   *  close to the tail's original fixed bottom-left-ish spot. */
  tailAnchor?: BubbleTailAnchor
  /** Multi-line horizontal alignment, relative to the block's own widest
   *  line (not the annotation's box) — absent (pre-existing annotations) = 'left'. */
  align?: 'left' | 'center' | 'right'
  /** Rotation in degrees around the shape's center, clockwise. Absent (pre-existing annotations) = 0. */
  rotation?: number
  /** Font color, independent of `color` (which is the box/bubble background
   *  for `shape !== 'none'`). Settable from the UI via the Background/Text
   *  toggle in the Color block (`'solid'` fill only — see `bgAuto`); cleared
   *  back to `undefined` the moment Text stops being the active side, so its
   *  presence alone means "explicit" — either the toggle is currently on
   *  Text, or (absent `bgAuto`) this is a document saved before the toggle
   *  existed, whose `textColor` was set by the old, since-removed
   *  standalone text-color swatch and is honored the same way it always
   *  was. Ignored for `shape: 'none'`, where there's no background and
   *  `color` is the font color directly. */
  textColor?: string
  /** `color` (the box/bubble background) auto-follows `textColor`'s contrast
   *  instead of being explicit — the reverse of `textColor`'s own auto
   *  (absent above). Set by the Background/Text toggle (`'solid'` fill
   *  only): `true` makes Text the active/explicit side (Background follows
   *  it); `false` makes Background active instead. The toggle is one
   *  palette with two roles, not two independently-remembered colors —
   *  switching it carries the side you're *leaving*'s current color over to
   *  become the new explicit value on the side you're arriving at (see
   *  `resolveTextColors`'s doc comment and Editor.tsx's `handleBgAuto`/
   *  `handleTextColorAuto`), so the same color just picked for one shows up
   *  on the other the moment you flip back. Ignored for `shape: 'none'`.
   *  Absent (pre-existing annotations) = false. */
  bgAuto?: boolean
  /** How the box/bubble background paints — see `TextBgFill`. Ignored for
   *  `shape: 'none'`, which has no background to begin with. Absent
   *  (pre-existing annotations) = `'solid'`. */
  bgFill?: TextBgFill
}

/** How a marker's `n` is shown. `n` itself stays a plain integer, so the
 *  sequence logic never has to know which one is in use. */
export type NumberFormat = 'decimal' | 'alpha' | 'roman'

export interface NumberAnn extends AnnotationBase {
  type: 'number'
  cx: number; cy: number
  n: number
  r: number
  shape: 'circle' | 'square'
  /** Absent on markers made before formats existed = `'decimal'`. */
  format?: NumberFormat
}

const ROMAN: ReadonlyArray<[number, string]> = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
]

/**
 * What a marker shows for `n`: `3`, `C`, or `III`. Letters run A–Z then
 * AA, AB… like spreadsheet columns. Roman numerals stop at 3999 (the largest
 * one standard notation can write) and fall back to digits past it, as does
 * anything below 1, which neither letters nor numerals can express.
 */
export function formatMarkerLabel(n: number, format: NumberFormat | undefined): string {
  if (format === 'alpha' && n >= 1) {
    let s = ''
    for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s
    return s
  }
  if (format === 'roman' && n >= 1 && n <= 3999) {
    let s = ''
    let k = n
    for (const [v, sym] of ROMAN) while (k >= v) { s += sym; k -= v }
    return s
  }
  return String(n)
}

/**
 * Reads back what the user typed into a marker: digits always work, and
 * otherwise the text is read in the marker's own format (so `C` is 3 on a
 * lettered marker and 100 on a Roman one). `null` if it is neither.
 */
export function parseMarkerLabel(text: string, format: NumberFormat | undefined): number | null {
  const t = text.trim().toUpperCase()
  if (/^\d+$/.test(t)) return parseInt(t, 10)
  if (format === 'alpha' && /^[A-Z]+$/.test(t)) {
    let n = 0
    for (const c of t) n = n * 26 + (c.charCodeAt(0) - 64)
    return n
  }
  if (format === 'roman' && /^[MDCLXVI]+$/.test(t)) {
    let n = 0
    let rest = t
    for (const [v, sym] of ROMAN) while (rest.startsWith(sym)) { n += v; rest = rest.slice(sym.length) }
    // Anything left over was not a well-formed numeral (e.g. "IIII").
    return rest === '' && formatMarkerLabel(n, 'roman') === t ? n : null
  }
  return null
}

export type BlurStrength = 'low' | 'medium' | 'high'

export interface BlurAnn extends AnnotationBase {
  type: 'blur'
  x: number; y: number
  w: number; h: number
  /** Blur strength as a percentage of the region's short side (the radius
   *  scale). Legacy annotations may carry the old presets — `low`/`medium`/
   *  `high` map to 8/17/33; absent = 17 ('medium'). */
  strength?: number | BlurStrength
}

/** Normalizes a blur strength (number, legacy preset, or absent) to a %.
 *  Capped at 40 (not 100): the radius this scales to is a Gaussian sigma
 *  against the region's own short side (see the `'blur'` case in
 *  `drawAnnotationInner`), and a sigma much past ~40% of that side means
 *  the blur's effective kernel (~3×sigma) spans several times the region
 *  itself — every pixel ends up averaging almost the whole padded sample,
 *  so the result collapses toward one flat, low-contrast wash instead of
 *  reading as a *stronger* blur. Past that point, more strength makes the
 *  redaction look weaker, not thicker. */
export function blurStrengthPct(s: number | BlurStrength | undefined): number {
  if (typeof s === 'number') return Math.max(1, Math.min(40, s))
  if (s === 'low') return 8
  if (s === 'high') return 33
  return 17
}

export interface HighlightAnn extends AnnotationBase {
  type: 'highlight'
  x1: number; y1: number
  x2: number; y2: number
}

export interface SpotlightAnn extends AnnotationBase {
  type: 'spotlight'
  x: number; y: number
  w: number; h: number
  /** Outside-dim opacity 0..1; absent (pre-existing annotations) = 0.55. */
  dim?: number
  /** Shape of the lit region: 'circle' (ellipse inscribed in x,y,w,h) or
   *  'square' (the box itself). Absent (pre-existing annotations) = 'square',
   *  matching the tool's original rectangle-only behavior. */
  shape?: 'circle' | 'square'
}

export interface MagnifierAnn extends AnnotationBase {
  type: 'magnifier'
  /** Source: the small region sampled from the original image. */
  x: number; y: number; w: number; h: number
  /** Target: where the magnified copy is displayed. */
  tx: number; ty: number; tw: number; th: number
  /** Shape of both boxes: 'square' (the box itself) or 'circle' (ellipse
   *  inscribed in the box) — same convention as SpotlightAnn.shape. Absent
   *  (pre-existing annotations) = 'square'. */
  shape?: 'circle' | 'square'
}

export interface ImageAnn extends AnnotationBase {
  type: 'image'
  x: number; y: number
  w: number; h: number
  /** The pasted picture itself, as a self-contained `data:` URL. Inline rather
   *  than a path or a handle into some side table, because an annotation has to
   *  survive every trip it already makes on its own: the sidecar JSON written
   *  next to a saved capture, and the copy/paste payload that crosses into
   *  another editor window (a different webview, where a blob: URL from this
   *  one resolves to nothing). Decoding is cached by `src` — see
   *  `getEmbeddedImage`. */
  src: string
  /** Rotation in degrees around the shape's center, clockwise. Absent
   *  (pre-existing annotations) = 0. */
  rotation?: number
  /** Frame the picture with a border drawn in the shared `color` at the shared
   *  `sw` width — the same two palette controls every other annotation uses,
   *  so a border is recolored/thickened exactly like a rect's outline. Absent
   *  (pre-existing annotations) = false. */
  border?: boolean
}

/** Magic-wand "select by color, then fade": a click samples the image at one
 *  point and selects every pixel in the connected patch touching the click
 *  that's within `tolerance` of that seed color (see `floodFillColorMask`'s
 *  default `mode`) — pre-committed to alpha instead of staying a live
 *  selection. `x`/`y`/`w`/`h` are the selected region's bounding box
 *  (computed once, at click time); `mask` is that box's own alpha-only
 *  picture (a `data:` URL, decoded/cached exactly like `ImageAnn.src` via
 *  `getEmbeddedImage`) fully opaque (=selected) through most of the selected
 *  region, fading out only in a thin band right at the tolerance edge (see
 *  `FEATHER_FRAC` in `floodFillColorMask`) — a soft, antialiased boundary
 *  rather than a hard cutout, without the interior of a large-tolerance
 *  selection itself reading as translucent. The mask is a pure *selection*;
 *  how much of it actually punches through is `opacity` (the same shared
 *  ink-opacity slider every other tool uses, so it keeps the same meaning —
 *  100% opaque, dialed down = more see-through — rather than "how hard the
 *  erase hits") via `destination-out` compositing (see `drawAnnotationInner`,
 *  which inverts it to a removal amount) — at 100% opacity the selection is
 *  left untouched, not a real hole; dialed down, it's increasingly punched
 *  through, a real hole (not a see-through patch layered over opaque
 *  pixels) at 0%, which survives into the saved PNG because the export
 *  canvas is created with no background fill. Baking the mask at click time
 *  (rather than recomputing the flood fill on every redraw) is what keeps this
 *  annotation as cheap to redraw as any other — see `floodFillColorMask`.
 *  `sw` is unused — kept only because every annotation has it. */
export interface EraseAnn extends AnnotationBase {
  type: 'erase'
  x: number; y: number
  w: number; h: number
  mask: string
  /** The click that produced this selection, in image-pixel space — kept
   *  (and never touched by a move/resize, unlike `x`/`y`/`w`/`h`) so the
   *  tolerance slider can re-run the flood fill from the same origin while
   *  this annotation is selected, the same "adjust after the fact" flow
   *  blur/spotlight's own sliders already have. See `floodFillColorMask`. */
  seedX: number; seedY: number
  /** 0..100 tolerance the selection was last computed with — what the
   *  tolerance slider shows/edits for a selected instance. */
  tolerance: number
  /** Legacy: how an old document's selection spread out from the seed
   *  click — see the `mode` parameter of `floodFillColorMask`. The Pick
   *  Mode toggle that set this (Connected/Anywhere) has since been removed
   *  (the tool was simplified down to Erase/Fill only), so nothing creates
   *  a `'global'` selection anymore — every new one is implicitly
   *  `'contiguous'`, same as this field reading absent always was. */
  pickMode?: 'contiguous' | 'global'
  /** What the selection does to the image, applied through the mask — see
   *  `drawAnnotationInner`'s `'erase'` case. Absent = `'erase'` (the
   *  original, only behavior): punch the selection to transparent. `'fill'`
   *  paints `fillColor` over it instead. `'blur'`/`'pixelate'` (apply that
   *  effect only within the selection, sampling the base image the same way
   *  the standalone Blur tool does) are legacy — the Effect toggle offered
   *  all four at one point, but the tool was simplified back down to
   *  Erase/Fill, so these two only ever appear on an old document; the
   *  rendering code still supports them so one still displays correctly. */
  effect?: 'erase' | 'fill' | 'blur' | 'pixelate'
  /** Paint color for `effect === 'fill'` — independent of the shared
   *  `color` field, which this annotation uses for the *sampled* seed
   *  color (see `AnnotationCanvas`'s click handler), not an ink choice. */
  fillColor?: string
  /** 0..100 strength for `effect === 'blur' | 'pixelate'` — same percent-
   *  of-region-size scale as `BlurAnn.strength`, just not sharing its field
   *  so a mode switch back to `'erase'` doesn't need to remember to drop it.
   *  Absent = 20. */
  effectStrength?: number
  /** Legacy: an old document's selection that had been grown/shrunk by
   *  Shift/Alt-combining more than one color match (a feature since
   *  removed — the tool was simplified down to Erase/Fill only). A compound
   *  mask was never a pure function of `seedX`/`seedY`/`tolerance`, so
   *  `Editor.tsx`'s `handleEraseTolerance` still skips re-deriving one from
   *  scratch (which would silently discard the combine) if it's ever
   *  selected — nothing can set this `true` anymore. */
  compound?: boolean
}

export type Annotation =
  | ArrowAnn | LineAnn | PenAnn | RectAnn | EllipseAnn
  | TextAnn  | NumberAnn | BlurAnn | HighlightAnn
  | SpotlightAnn | MagnifierAnn | ImageAnn | EraseAnn

export function makeId(): string {
  return Math.random().toString(36).slice(2, 10)
}
