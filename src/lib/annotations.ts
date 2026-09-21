// Annotation types — all coordinates are in image-pixel space.

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
   *  (emphasis). Absent falls back to `getShadowStyle`'s per-type default:
   *  `'drop'` for `text` (which always had a subtle shadow, for legibility,
   *  before this field existed) and `'none'` for every other pre-existing
   *  annotation (which never had one). */
  shadowStyle?: 'none' | 'drop' | 'glow'
  /** Drop shadow's cast direction, degrees clockwise from due right (canvas
   *  angle convention: 0° = shadow to the right, 90° = straight down).
   *  Ignored for `'glow'` (centered, no direction) and `'none'`. Absent =
   *  135° (down-and-right — the classic drop-shadow direction). */
  shadowAngle?: number
  /** Drop shadow's offset distance, 0-100 — how far it's cast before any
   *  blur. Ignored for `'glow'` (centered, no direction to cast along) and
   *  `'none'`. Absent = 40. */
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
   *  for `'glow'` — picking an explicit color here applies to either style. */
  shadowColor?: string
}

/** Annotation types whose shadow/glow the user can toggle — the "ink" tools,
 *  where it reads as depth or emphasis. `blur`/`spotlight`/`magnifier` are
 *  left out: they dim or resample the underlying image rather than painting
 *  a fill/stroke of their own. `highlight` is also left out — it's a flat
 *  translucent marker-pen wash meant to sit on the image like ink on paper,
 *  not lift off it, and `ToolOptionsPanel`'s `SHADOW_TOOLS` already hides
 *  the Shadow tab for it; leaving it in this set only meant a shared
 *  shadowStyle carried over from whatever shape was drawn last still
 *  rendered on a highlight with no UI to see or clear it. */
export const SHADOW_CAPABLE = new Set<Annotation['type']>([
  'arrow', 'line', 'pen', 'rect', 'ellipse', 'text', 'number', 'image',
])

/** `SHADOW_CAPABLE` types with no filled body of their own — just a stroke.
 *  `resolveShadow`'s drop-shadow distance caps at `sw`-scaled range for
 *  these (see `applyShadowOrGlow`) rather than the flat 30px every other
 *  type gets: a filled rect/ellipse/text has a body a shadow can visually
 *  "reach" from even cast far away, but a thin arrow/line/pen stroke has
 *  nothing but the line itself — cast the same fixed distance, it reads as
 *  a second, detached line floating nearby rather than that line's shadow. */
const LINE_ONLY_TYPES = new Set<Annotation['type']>(['arrow', 'line', 'pen'])

/** `ann`'s effective shadow/glow style — see `AnnotationBase.shadowStyle`. */
export function getShadowStyle(ann: Annotation): 'none' | 'drop' | 'glow' {
  return ann.shadowStyle ?? (ann.type === 'text' ? 'drop' : 'none')
}

/** `ann`'s effective drop-shadow angle — see `AnnotationBase.shadowAngle`. */
export function getShadowAngle(ann: Annotation): number {
  return ann.shadowAngle ?? 135
}

/** `ann`'s effective drop-shadow size (offset distance) — see `AnnotationBase.shadowSize`.
 *  Default is deliberately small (a ~3px cast at the 0-30px scale in
 *  `resolveShadow`): `text` defaults to `'drop'` with no explicit size at
 *  all (see `getShadowStyle`), so this is what every text annotation looks
 *  like out of the box — it needs to stay close to the original fixed
 *  offset (2px) that shadow had before either field existed, not read as an
 *  emphatic effect nobody asked for. */
export function getShadowSize(ann: Annotation): number {
  return ann.shadowSize ?? 10
}

/** `ann`'s effective shadow/glow blur radius — see `AnnotationBase.shadowBlur`.
 *  Same reasoning as `getShadowSize`'s default: kept close to the original
 *  fixed blur (4-6px, depending on shape) text had before this field
 *  existed, since this is what every text annotation renders with unless
 *  something has been customized. */
export function getShadowBlur(ann: Annotation): number {
  return ann.shadowBlur ?? 15
}

/** `ann`'s effective shadow/glow opacity, 0-100 — see
 *  `AnnotationBase.shadowOpacity`. Unlike every other shadow default, the
 *  absent-field fallback differs by style: before this field existed, drop
 *  was fixed at a 45%-alpha shadow color and glow was fully opaque (its
 *  color painted straight, no alpha applied at all) — so a document saved
 *  before `shadowOpacity` existed keeps rendering exactly as it did,
 *  instead of every old glow suddenly reading half-transparent. */
export function getShadowOpacity(ann: Annotation): number {
  return ann.shadowOpacity ?? (getShadowStyle(ann) === 'glow' ? 100 : 45)
}

/** `hex` (`#RRGGBB`) as an `rgba(...)` string at `alpha` — used to carry a
 *  user-picked shadow color into a canvas shadow, which always wants an
 *  explicit alpha (a shadow painted at full opacity reads as a silhouette
 *  pasted behind the shape, not a shadow). */
function hexToRgba(hex: string, alpha: number): string {
  const c = hex.replace('#', '')
  const r = parseInt(c.slice(0, 2), 16) || 0
  const g = parseInt(c.slice(2, 4), 16) || 0
  const b = parseInt(c.slice(4, 6), 16) || 0
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** `ctx.setLineDash` pattern for `dash`, scaled to `sw` so the dashes/dots
 *  stay proportionate as stroke width changes instead of looking
 *  vanishingly fine on a thick stroke or comically chunky on a thin one.
 *  `'dotted'`'s near-zero dash length relies on the caller already having
 *  `ctx.lineCap = 'round'` set (true everywhere in `drawAnnotationInner`) —
 *  a round cap on a dash this short is what actually reads as a dot rather
 *  than a tiny dash. */
function dashArray(dash: 'solid' | 'dashed' | 'dotted' | undefined, sw: number): number[] {
  if (dash === 'dashed') return [Math.max(4, sw * 3), Math.max(3, sw * 2)]
  if (dash === 'dotted') return [0.1, Math.max(4, sw * 2)]
  return []
}

/**
 * Resolves a shadow-capable annotation's shadow/glow into concrete canvas
 * values. `size` (0-100, offset distance), `blur` (0-100, blur radius) and
 * `opacity` (0-100) are independent — a shadow cast far away can still be
 * crisp, one sitting right under the shape can still be soft, and either can
 * be barely-there or solid, so they're three sliders, not one "strength"
 * knob scaling all of them together (that was tried and reverted for
 * size/blur: it couldn't reach "cast far, but sharp" or "soft, but close").
 * `size`/`angle` (degrees, canvas convention: 0° = right, 90° = down) only
 * apply to `'drop'` — `'glow'` is centered, with no direction to cast along.
 *
 * Each end of every 0-100 range is a reachable look, not just padding: blur
 * 0 is a hard-edged, unblurred silhouette (a crisp flat drop shadow, or —
 * for glow — no halo at all), 100 is a big soft one; size 0 sits the drop
 * shadow directly under the shape, 100 casts it far off; opacity 0 is
 * invisible, 100 is fully solid.
 *
 * `inkColor` is what an unset `shadowColor` falls back to for `'glow'` — the
 * annotation's own `color`, or for box/bubble text, its *resolved*
 * background color (`resolveTextColors(ann).bg`), since that's what's
 * actually painted when `color` itself is auto-tracking the text color.
 * `'drop'` instead falls back to a fixed neutral black, matching its
 * pre-this-feature look when nothing has been customized.
 *
 * `maxDistance` is the image-pixel offset `size` 100 reaches — 30 for every
 * filled type, but scaled down for a thin `LINE_ONLY_TYPES` stroke by
 * `applyShadowOrGlow` (see its own comment there), so this only takes the
 * final number, not the shape/stroke-width behind it.
 */
export function resolveShadow(
  style: 'drop' | 'glow', size: number, blur: number, angle: number, opacity: number, shadowColor: string | undefined, inkColor: string, maxDistance = 30,
): { color: string; blur: number; offsetX: number; offsetY: number } {
  const blurPx = (Math.max(0, Math.min(100, blur)) / 100) * (style === 'drop' ? 20 : 25)
  const alpha = Math.max(0, Math.min(100, opacity)) / 100
  if (style === 'drop') {
    const rad = (angle * Math.PI) / 180
    const distance = (Math.max(0, Math.min(100, size)) / 100) * maxDistance
    return {
      color: hexToRgba(shadowColor ?? '#000000', alpha),
      blur: blurPx,
      offsetX: distance * Math.cos(rad),
      offsetY: distance * Math.sin(rad),
    }
  }
  return { color: hexToRgba(shadowColor ?? inkColor, alpha), blur: blurPx, offsetX: 0, offsetY: 0 }
}

/**
 * Sets `ctx.shadow*` for `ann`'s `'drop'`/`'glow'` style (no-op for
 * `'none'`) — factored out of the three call sites (generic ink shapes,
 * boxed/bubble text, plain text) since all three do exactly this.
 */
function applyShadowOrGlow(
  ctx: CanvasRenderingContext2D,
  ann: Annotation,
  viewScale: number,
  inkColor: string,
): void {
  const style = getShadowStyle(ann)
  if (style === 'none') return
  // A thin arrow/line/pen stroke has no body to visually "reach" from —
  // cap how far its shadow can be cast (Size 100) at roughly 3x its own
  // stroke width instead of the flat 30px every filled type gets, or a
  // thin line's shadow drifts far enough to read as a second, detached
  // line rather than that line's own shadow. Floors at 6px so a
  // hairline stroke still has *some* range to drag Size across, caps at
  // the same 30px filled types get so a thick stroke isn't penalized.
  const maxDistance = LINE_ONLY_TYPES.has(ann.type) ? Math.min(30, Math.max(6, ann.sw * 3)) : 30
  const { color, blur, offsetX, offsetY } = resolveShadow(
    style, getShadowSize(ann), getShadowBlur(ann), getShadowAngle(ann), getShadowOpacity(ann), ann.shadowColor, inkColor, maxDistance,
  )
  ctx.shadowColor = color
  ctx.shadowBlur = blur * viewScale
  ctx.shadowOffsetX = offsetX * viewScale
  ctx.shadowOffsetY = offsetY * viewScale
}

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
export interface NumberAnn extends AnnotationBase {
  type: 'number'
  cx: number; cy: number
  n: number
  r: number
  shape: 'circle' | 'square'
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

/**
 * Magic-wand core: starting at (seedX, seedY) in `img`, selects every pixel
 * whose Euclidean RGB distance to the seed pixel's own color is within
 * `tolerancePct` (0..100, mapped to the 0..441.7 max possible distance — see
 * the quadratic easing below), then returns its bounding box and an
 * alpha-only `data:` URL mask the same size as that box (see `EraseAnn`), or
 * null if the seed point falls outside the image.
 *
 * `mode` picks how far the selection is allowed to spread, mirroring GIMP's
 * two color-based selection tools:
 * - `'contiguous'` (default) — flood-fills outward (8-connected —
 *   orthogonal + diagonal, matching GIMP's default) only through pixels
 *   reachable from the seed without ever leaving tolerance, the same
 *   connected-region concept as GIMP's "Fuzzy Select". A same-colored patch
 *   elsewhere in the image, not touching this one, is left alone.
 * - `'global'` — every matching pixel in the whole image is included,
 *   connected or not, like GIMP's "Select by Color". A single click can
 *   then clear a color used in several disconnected places (e.g. the same
 *   background peeking through gaps between foreground shapes) without
 *   clicking each patch individually.
 *
 * Runs once, synchronously, on the click that creates the annotation (or on
 * a pick-mode/tolerance change while one is selected) — not on every redraw
 * — so a click on a huge same-color area (a full-bleed solid background)
 * costs one pass over the image, not one per frame.
 */
export function floodFillColorMask(
  img: HTMLImageElement,
  seedX: number,
  seedY: number,
  tolerancePct: number,
  mode: 'contiguous' | 'global' = 'contiguous',
): { x: number; y: number; w: number; h: number; mask: string; seedColor: string } | null {
  const W = img.naturalWidth
  const H = img.naturalHeight
  if (seedX < 0 || seedY < 0 || seedX >= W || seedY >= H) return null
  const src = document.createElement('canvas')
  src.width = W
  src.height = H
  const sctx = src.getContext('2d', { willReadFrequently: true })
  if (!sctx) return null
  sctx.drawImage(img, 0, 0)
  const { data } = sctx.getImageData(0, 0, W, H)

  const seedI = (seedY * W + seedX) * 4
  const sr = data[seedI]; const sg = data[seedI + 1]; const sb = data[seedI + 2]
  const tolPct = Math.max(0, Math.min(100, tolerancePct))
  // Euclidean RGB distance maxes out at sqrt(3 * 255²) ≈ 441.7 (black↔white),
  // but a *linear* 0-100% → 0-441.7 map makes the slider feel like a light
  // switch: a screenshot's near-duplicate shades (anti-aliased edges,
  // gradients) sit close together in that space, so once the threshold
  // crosses whatever connects them the flood fill leaks through into a
  // totally unrelated region — a couple of % more suddenly erasing a huge
  // extra area. Squaring the fraction keeps 0%→0 and 100%→max exactly as
  // before, but slows the climb through the low/mid range where a real
  // selection actually gets made, so the same slider drag buys much finer
  // control there instead of overshooting past the connected-region cliff.
  // MAX_DIST_FRAC caps what 100% itself reaches: the *literal* maximum
  // (441.7) requires the extreme of every channel at once, which is so
  // permissive that ordinary screenshots — dark UI next to light text,
  // saturated icons next to flat backgrounds — end up entirely
  // within it, so "100%" meant "select the whole image" instead of "very
  // tolerant of similar colors". Capping the reachable distance below that
  // keeps 100% generous while still excluding genuinely different colors.
  const MAX_DIST_FRAC = 0.5
  const t = tolPct / 100
  const tolDist = t * t * Math.sqrt(3 * 255 * 255) * MAX_DIST_FRAC
  const tolDistSq = tolDist * tolDist
  // Only the outer FEATHER_FRAC of the tolerance radius fades out (a ~1-2px
  // antialiased edge, like GIMP's selection) — everything closer to the seed
  // than that is fully removed. Without this band, removal was `1 -
  // dist/tolDist` across the *entire* radius, so at high tolerance (a large
  // tolDist) even pixels well inside the selected region — clearly a
  // different color from the seed, just still under the threshold — got a
  // low removal value, painting large swaths of the "selected" area as
  // faintly see-through instead of cleanly erased. At tolerance=100% that
  // radius covers almost the whole image, so the whole image came out
  // uniformly semi-transparent instead of erased where selected and
  // untouched where not.
  const FEATHER_FRAC = 0.08
  const featherStart = tolDist * (1 - FEATHER_FRAC)
  const removalForDist = (dist: number) => (
    dist <= featherStart || tolDist <= 0
      ? 1
      : 1 - (dist - featherStart) / (tolDist - featherStart)
  )

  const removal = new Float32Array(W * H)
  let minX = seedX; let maxX = seedX; let minY = seedY; let maxY = seedY

  if (mode === 'global') {
    // One straight pass, no connectivity — every pixel stands on its own
    // color distance, so a color that recurs in several disconnected spots
    // (behind a foreground shape, in a repeated icon) is picked up
    // everywhere at once instead of needing one click per patch.
    for (let p = 0; p < W * H; p++) {
      const i = p * 4
      const dr = data[i] - sr
      const dg = data[i + 1] - sg
      const db = data[i + 2] - sb
      const distSq = dr * dr + dg * dg + db * db
      if (distSq > tolDistSq) continue
      removal[p] = removalForDist(Math.sqrt(distSq))
      const px = p % W
      const py = (p / W) | 0
      if (px < minX) minX = px
      if (px > maxX) maxX = px
      if (py < minY) minY = py
      if (py > maxY) maxY = py
    }
  } else {
    const visited = new Uint8Array(W * H)
    const stack: number[] = [seedY * W + seedX]
    visited[seedY * W + seedX] = 1

    while (stack.length > 0) {
      const p = stack.pop()!
      const i = p * 4
      const dr = data[i] - sr
      const dg = data[i + 1] - sg
      const db = data[i + 2] - sb
      const distSq = dr * dr + dg * dg + db * db
      if (distSq > tolDistSq) continue
      removal[p] = removalForDist(Math.sqrt(distSq))
      const px = p % W
      const py = (p / W) | 0
      if (px < minX) minX = px
      if (px > maxX) maxX = px
      if (py < minY) minY = py
      if (py > maxY) maxY = py
      // 8-connected (orthogonal + diagonal), matching GIMP's default fuzzy
      // select — an anti-aliased edge that only touches diagonally (a common
      // shape for a 1px-thin diagonal boundary) would otherwise split into
      // pieces a single click can't fully reach.
      const atLeft = px === 0; const atRight = px === W - 1
      const atTop = py === 0; const atBottom = py === H - 1
      if (!atLeft) { const n = p - 1; if (!visited[n]) { visited[n] = 1; stack.push(n) } }
      if (!atRight) { const n = p + 1; if (!visited[n]) { visited[n] = 1; stack.push(n) } }
      if (!atTop) { const n = p - W; if (!visited[n]) { visited[n] = 1; stack.push(n) } }
      if (!atBottom) { const n = p + W; if (!visited[n]) { visited[n] = 1; stack.push(n) } }
      if (!atLeft && !atTop) { const n = p - W - 1; if (!visited[n]) { visited[n] = 1; stack.push(n) } }
      if (!atRight && !atTop) { const n = p - W + 1; if (!visited[n]) { visited[n] = 1; stack.push(n) } }
      if (!atLeft && !atBottom) { const n = p + W - 1; if (!visited[n]) { visited[n] = 1; stack.push(n) } }
      if (!atRight && !atBottom) { const n = p + W + 1; if (!visited[n]) { visited[n] = 1; stack.push(n) } }
    }
  }

  const w = maxX - minX + 1
  const h = maxY - minY + 1
  const maskCanvas = document.createElement('canvas')
  maskCanvas.width = w
  maskCanvas.height = h
  const mctx = maskCanvas.getContext('2d')!
  const maskData = mctx.createImageData(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const srcP = (minY + y) * W + (minX + x)
      maskData.data[(y * w + x) * 4 + 3] = Math.round(255 * removal[srcP])
    }
  }
  mctx.putImageData(maskData, 0, 0)
  const seedColor = '#' + [sr, sg, sb].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()
  return { x: minX, y: minY, w, h, mask: maskCanvas.toDataURL('image/png'), seedColor }
}

export type Annotation =
  | ArrowAnn | LineAnn | PenAnn | RectAnn | EllipseAnn
  | TextAnn  | NumberAnn | BlurAnn | HighlightAnn
  | SpotlightAnn | MagnifierAnn | ImageAnn | EraseAnn

export function makeId(): string {
  return Math.random().toString(36).slice(2, 10)
}

// ── Embedded pictures (the `image` annotation's pixels) ────────────────────
// `drawAnnotation` is synchronous, but an image annotation carries its picture
// as a `data:` URL the browser decodes asynchronously. Decoded bitmaps are
// cached here by `src` — one entry per distinct picture, shared by every copy
// of it, so duplicating a pasted image costs no second decode — and everything
// waiting to repaint is notified when one finishes. The frame right after a
// paste therefore draws a placeholder and the next draws the picture.
interface EmbeddedEntry {
  img: HTMLImageElement
  ready: boolean
  /** Settles (never rejects) once the decode has finished *or* failed. */
  done: Promise<void>
}
const embeddedImages = new Map<string, EmbeddedEntry>()
const embeddedListeners = new Set<() => void>()

/** Subscribes to "some picture finished decoding". Returns an unsubscribe fn. */
export function onEmbeddedImageLoad(listener: () => void): () => void {
  embeddedListeners.add(listener)
  return () => { embeddedListeners.delete(listener) }
}

/**
 * The decoded bitmap for `src`, or null while it is still decoding (or if it
 * turned out to be undecodable). Starts the decode on the first ask, so simply
 * drawing an image annotation is enough to get it loaded.
 */
export function getEmbeddedImage(src: string): HTMLImageElement | null {
  const hit = embeddedImages.get(src)
  if (hit) return hit.ready ? hit.img : null
  if (typeof Image === 'undefined') return null
  const img = new Image()
  let settle: () => void = () => {}
  const done = new Promise<void>((resolve) => { settle = resolve })
  const entry: EmbeddedEntry = { img, ready: false, done }
  embeddedImages.set(src, entry)
  img.onload = () => {
    entry.ready = true
    settle()
    for (const listener of embeddedListeners) listener()
  }
  img.onerror = () => {
    settle()
    for (const listener of embeddedListeners) listener()
  }
  img.src = src
  return null
}

/**
 * Decodes `src` through the shared cache and resolves with its bitmap, or null
 * if it can't be decoded. For the caller that needs a picture's natural size
 * before it can even build the annotation — going through the cache means that
 * sizing decode is the same one the first draw will use, not a throwaway.
 */
export async function loadEmbeddedImage(src: string): Promise<HTMLImageElement | null> {
  const ready = getEmbeddedImage(src)  // starts the decode if this src is new
  if (ready) return ready
  const entry = embeddedImages.get(src)
  if (!entry) return null
  await entry.done
  return entry.ready ? entry.img : null
}

/** One closed pixel-edge loop from `traceMaskContour`, in mask-local pixel
 *  space (0..maskWidth, 0..maskHeight) — grid *corners*, not pixel centers,
 *  so a filled 1×1 mask traces as the unit square (0,0)-(1,0)-(1,1)-(0,1). */
export type ContourLoop = [number, number][]
const contourCache = new Map<string, ContourLoop[]>()

/**
 * The pixel-accurate outline of `mask`'s alpha>50% region — an `erase`
 * annotation's selection indicator draws this instead of its loose
 * bounding-box rectangle, the same way GIMP's marching ants hug the actual
 * selected silhouette rather than its bounding box. Traces every boundary
 * edge (a filled pixel's side that borders an unfilled one, or the mask's
 * own edge) and stitches them into closed loops by chasing each edge's end
 * point to the next edge that starts there — clockwise winding (top edges
 * run left→right, right edges top→bottom, …) makes that chase alone enough
 * to close a loop without any separate loop-classification pass. A shape
 * with a hole in it (a fully tolerance-excluded island inside a larger
 * erased region) traces as two loops, an outer and an inner — both get
 * drawn, exactly as GIMP would show a ring selection.
 *
 * Synchronous and cached by `mask` (a content-addressed `data:` URL, so the
 * cache never goes stale) — the decode this needs is `getEmbeddedImage`'s
 * own cache, so this returns null (not yet ready to trace) until whatever
 * already triggered that decode finishes it.
 */
export function traceMaskContour(mask: string): ContourLoop[] | null {
  const hit = contourCache.get(mask)
  if (hit) return hit
  const img = getEmbeddedImage(mask)
  if (!img) return null
  const w = img.naturalWidth
  const h = img.naturalHeight
  const off = document.createElement('canvas')
  off.width = w
  off.height = h
  const ctx = off.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0)
  const { data } = ctx.getImageData(0, 0, w, h)
  const filled = (x: number, y: number) =>
    x >= 0 && x < w && y >= 0 && y < h && data[(y * w + x) * 4 + 3] >= 128

  type Edge = [number, number, number, number]
  const edges: Edge[] = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!filled(x, y)) continue
      if (!filled(x, y - 1)) edges.push([x, y, x + 1, y])         // top
      if (!filled(x + 1, y)) edges.push([x + 1, y, x + 1, y + 1]) // right
      if (!filled(x, y + 1)) edges.push([x + 1, y + 1, x, y + 1]) // bottom
      if (!filled(x - 1, y)) edges.push([x, y + 1, x, y])         // left
    }
  }
  const byStart = new Map<string, Edge[]>()
  for (const e of edges) {
    const k = `${e[0]},${e[1]}`
    const arr = byStart.get(k)
    if (arr) arr.push(e); else byStart.set(k, [e])
  }
  const used = new Set<Edge>()
  const loops: ContourLoop[] = []
  for (const start of edges) {
    if (used.has(start)) continue
    const loop: [number, number][] = [[start[0], start[1]]]
    let cur = start
    for (let guard = 0; guard < edges.length + 1; guard++) {
      used.add(cur)
      loop.push([cur[2], cur[3]])
      if (cur[2] === loop[0][0] && cur[3] === loop[0][1]) break
      const next = (byStart.get(`${cur[2]},${cur[3]}`) ?? []).find((c) => !used.has(c))
      if (!next) break  // shouldn't happen for a closed boundary — bail rather than loop forever
      cur = next
    }
    if (loop.length > 2) loops.push(loop)
  }
  contourCache.set(mask, loops)
  return loops
}

/**
 * Resolves once every `image` annotation's picture and every `erase`
 * annotation's mask in `annotations` has decoded (or failed to). The export
 * paths render the whole document to an offscreen canvas in one synchronous
 * pass, so one still decoding at that moment would save as an empty box (for
 * `image`) or a no-op (for `erase`) — this is what the caller awaits first.
 */
export function decodeEmbeddedImages(annotations: Annotation[]): Promise<void> {
  const waits: Promise<void>[] = []
  for (const ann of annotations) {
    const src = ann.type === 'image' ? ann.src : ann.type === 'erase' ? ann.mask : null
    if (!src) continue
    getEmbeddedImage(src)  // starts the decode if this src is new
    const entry = embeddedImages.get(src)
    if (entry && !entry.ready) waits.push(entry.done)
  }
  return Promise.all(waits).then(() => undefined)
}

export const PALETTE: Record<string, string> = {
  red:    '#EF4444',
  orange: '#F97316',
  yellow: '#EAB308',
  green:  '#22C55E',
  blue:   '#4F8EF7',
  purple: '#A855F7',
  white:  '#FFFFFF',
  black:  '#0F1117',
}

// Tailwind v3 full color palette — rows: families, cols: shades 50→950
export const TAILWIND_SHADE_NAMES = ['50','100','200','300','400','500','600','700','800','900','950']

export const TAILWIND_PALETTE: string[][] = [
  ['#f8fafc','#f1f5f9','#e2e8f0','#cbd5e1','#94a3b8','#64748b','#475569','#334155','#1e293b','#0f172a','#020617'],
  ['#f9fafb','#f3f4f6','#e5e7eb','#d1d5db','#9ca3af','#6b7280','#4b5563','#374151','#1f2937','#111827','#030712'],
  ['#fafafa','#f4f4f5','#e4e4e7','#d4d4d8','#a1a1aa','#71717a','#52525b','#3f3f46','#27272a','#18181b','#09090b'],
  ['#fafafa','#f5f5f5','#e5e5e5','#d4d4d4','#a3a3a3','#737373','#525252','#404040','#262626','#171717','#0a0a0a'],
  ['#fafaf9','#f5f5f4','#e7e5e4','#d6d3d1','#a8a29e','#78716c','#57534e','#44403c','#292524','#1c1917','#0c0a09'],
  ['#fef2f2','#fee2e2','#fecaca','#fca5a5','#f87171','#ef4444','#dc2626','#b91c1c','#991b1b','#7f1d1d','#450a0a'],
  ['#fff7ed','#ffedd5','#fed7aa','#fdba74','#fb923c','#f97316','#ea580c','#c2410c','#9a3412','#7c2d12','#431407'],
  ['#fffbeb','#fef3c7','#fde68a','#fcd34d','#fbbf24','#f59e0b','#d97706','#b45309','#92400e','#78350f','#451a03'],
  ['#fefce8','#fef9c3','#fef08a','#fde047','#facc15','#eab308','#ca8a04','#a16207','#854d0e','#713f12','#422006'],
  ['#f7fee7','#ecfccb','#d9f99d','#bef264','#a3e635','#84cc16','#65a30d','#4d7c0f','#3f6212','#365314','#1a2e05'],
  ['#f0fdf4','#dcfce7','#bbf7d0','#86efac','#4ade80','#22c55e','#16a34a','#15803d','#166534','#14532d','#052e16'],
  ['#ecfdf5','#d1fae5','#a7f3d0','#6ee7b7','#34d399','#10b981','#059669','#047857','#065f46','#064e3b','#022c22'],
  ['#f0fdfa','#ccfbf1','#99f6e4','#5eead4','#2dd4bf','#14b8a6','#0d9488','#0f766e','#115e59','#134e4a','#042f2e'],
  ['#ecfeff','#cffafe','#a5f3fc','#67e8f9','#22d3ee','#06b6d4','#0891b2','#0e7490','#155e75','#164e63','#083344'],
  ['#f0f9ff','#e0f2fe','#bae6fd','#7dd3fc','#38bdf8','#0ea5e9','#0284c7','#0369a1','#075985','#0c4a6e','#082f49'],
  ['#eff6ff','#dbeafe','#bfdbfe','#93c5fd','#60a5fa','#3b82f6','#2563eb','#1d4ed8','#1e40af','#1e3a8a','#172554'],
  ['#eef2ff','#e0e7ff','#c7d2fe','#a5b4fc','#818cf8','#6366f1','#4f46e5','#4338ca','#3730a3','#312e81','#1e1b4b'],
  ['#f5f3ff','#ede9fe','#ddd6fe','#c4b5fd','#a78bfa','#8b5cf6','#7c3aed','#6d28d9','#5b21b6','#4c1d95','#2e1065'],
  ['#faf5ff','#f3e8ff','#e9d5ff','#d8b4fe','#c084fc','#a855f7','#9333ea','#7e22ce','#6b21a8','#581c87','#3b0764'],
  ['#fdf4ff','#fae8ff','#f5d0fe','#f0abfc','#e879f9','#d946ef','#c026d3','#a21caf','#86198f','#701a75','#4a044e'],
  ['#fdf2f8','#fce7f3','#fbcfe8','#f9a8d4','#f472b6','#ec4899','#db2777','#be185d','#9d174d','#831843','#500724'],
  ['#fff1f2','#ffe4e6','#fecdd3','#fda4af','#fb7185','#f43f5e','#e11d48','#be123c','#9f1239','#881337','#4c0519'],
]

export const TAILWIND_HEX_SET = new Set(TAILWIND_PALETTE.flat())

/**
 * Draw a single annotation. Call this with the canvas context already
 * transformed to image coordinates (translate by ox,oy then scale by imgScale).
 * `img` is required for blur annotations.
 *
 * `viewScale` is that same `imgScale` (`baseScale * zoom` in
 * `AnnotationCanvas`'s `redraw`), passed again on the side — every *other*
 * value here (positions, stroke widths, radii, …) is expressed in
 * image-pixel space and rides the transform for free, but a canvas 2D
 * shadow's `shadowOffsetX`/`shadowOffsetY`/`shadowBlur` are a
 * long-standing, still-open Chromium quirk: unlike everything drawn through
 * a path or `drawImage`, they're applied in *untransformed* device pixels,
 * ignoring the active `ctx.scale()` entirely. Left alone, a shadow computed
 * in image pixels renders at a fixed on-screen size regardless of zoom, so
 * the shape scales around it while the shadow doesn't — the offset that
 * looked right at one zoom level reads as having silently moved at another.
 * `drawAnnotationInner` multiplies blur/offset by this before handing them
 * to `ctx`, compensating for exactly what the transform should have done.
 * Default 1 for every full-resolution, untransformed context (export,
 * thumbnails) — the same value the transform itself would contribute there.
 */
export function drawAnnotation(
  ctx: CanvasRenderingContext2D,
  ann: Annotation,
  img?: HTMLImageElement | null,
  viewScale = 1,
) {
  // save()/restore() must stay balanced even if the switch below throws —
  // an unmatched save() otherwise leaks onto ctx's state stack, and the
  // *next* redraw's translate/scale (in AnnotationCanvas) compounds on top
  // of it, pushing the whole scene off-canvas so every subsequent frame
  // renders nothing until the page reloads. try/finally guarantees the pop.
  ctx.save()
  try {
    drawAnnotationInner(ctx, ann, img, viewScale)
  } finally {
    ctx.restore()
  }
}

export interface ElbowSegment { x1: number; y1: number; x2: number; y2: number }

/**
 * The 3 orthogonal segments of an elbow arrow's path (Excel-style
 * right-angle connector) between (x1,y1) and (x2,y2). The dominant axis
 * (whichever of |dx|/|dy| is larger) is picked fresh from the current
 * endpoints every call — never persisted — so a glued elbow arrow keeps
 * routing sensibly as its connected shape moves and the dominant axis flips.
 * `bendRatio` (0..1) is where along that axis the bend sits; at either
 * extreme one of the two dominant-axis segments collapses to ~0 length,
 * which just renders as a clean L — no separate mode needed.
 */
export function getElbowSegments(
  x1: number, y1: number, x2: number, y2: number, bendRatio: number,
): [ElbowSegment, ElbowSegment, ElbowSegment] {
  const dx = x2 - x1
  const dy = y2 - y1
  const r = Math.max(0, Math.min(1, bendRatio))
  if (Math.abs(dx) >= Math.abs(dy)) {
    const bendX = x1 + r * dx
    return [
      { x1, y1, x2: bendX, y2: y1 },
      { x1: bendX, y1, x2: bendX, y2 },
      { x1: bendX, y1: y2, x2, y2 },
    ]
  }
  const bendY = y1 + r * dy
  return [
    { x1, y1, x2: x1, y2: bendY },
    { x1, y1: bendY, x2, y2: bendY },
    { x1: x2, y1: bendY, x2, y2 },
  ]
}

/**
 * Runs `paint` (a `ctx.fill()`/`ctx.stroke()` call) with whatever shadow/glow
 * is currently set on `ctx`, but clipped so the shadow can only land outside
 * the shape `buildPath` traces — never bleeding across a border into the
 * shape's own interior. That interior is often fully transparent (an
 * outline-only stroke, a "knockout" caption border), where an unclipped
 * shadow would otherwise show up as a stray halo inside empty space instead
 * of reading as depth around the shape.
 *
 * `buildPath` must do exactly `ctx.beginPath()` + the path-building calls —
 * no fill/stroke of its own — since it's called twice: once to carve the
 * exclusion clip, once to redraw the actual shape.
 *
 * `hasShadow` is the caller's own `getShadowStyle(ann) !== 'none'` — *not*
 * inferred from `ctx.shadowBlur === 0`, which used to be the check here and
 * is wrong: a flat, hard-edged shadow (`shadowBlur` explicitly 0, a fully
 * reachable look — see `resolveShadow`'s doc comment) sets that same
 * `ctx.shadowBlur = 0` while still very much having a shadow to paint. That
 * false negative skipped the outside-only clip below, so a `paint()` that
 * does more than one draw call — `bgFill === 'white'`'s `{ ctx.fill();
 * ctx.stroke() }` — cast the shadow twice, once from each call; where the
 * stroke's thin ring shadow overlapped the fill's solid one, the doubled-up
 * alpha read as a visible extra outline traced around the shadow itself.
 */
function paintShadowOutsideOnly(
  ctx: CanvasRenderingContext2D,
  hasShadow: boolean,
  buildPath: () => void,
  paint: () => void,
) {
  // No shadow active — skip the two-pass clip dance, which would otherwise
  // run for every plain outline shape in the document.
  if (!hasShadow) {
    buildPath()
    paint()
    return
  }

  // Pass 1, clipped: an oversized rect plus the shape's own path, combined
  // under the even-odd rule, clips to "inside the rect but outside the
  // shape" — i.e. everywhere except the shape's interior. `paint()` here
  // casts the caller's shadow, which can now only render in that excluded
  // interior's complement (the outside).
  ctx.save()
  buildPath()
  ctx.rect(-1_000_000, -1_000_000, 2_000_000, 2_000_000)
  ctx.clip('evenodd')
  buildPath()
  paint()
  ctx.restore()

  // Pass 2, unclipped and shadow-off: pass 1's clip also cut away the half
  // of the actual stroke/fill that falls inside the shape, so redraw it
  // whole here — with no shadow, this can't reintroduce the inward bleed.
  const shadowColor = ctx.shadowColor
  ctx.shadowColor = 'transparent'
  buildPath()
  paint()
  ctx.shadowColor = shadowColor
}

/** Direction (radians) of the first non-zero-length hop departing points[0]. */
function leadingAngle(points: { x: number; y: number }[]): number {
  const start = points[0]
  for (let i = 1; i < points.length; i++) {
    const p = points[i]
    if (Math.hypot(p.x - start.x, p.y - start.y) > 0.01) return Math.atan2(p.y - start.y, p.x - start.x)
  }
  return 0
}

/** Direction (radians) of the last non-zero-length hop arriving at the final point. */
function trailingAngle(points: { x: number; y: number }[]): number {
  const end = points[points.length - 1]
  for (let i = points.length - 2; i >= 0; i--) {
    const p = points[i]
    if (Math.hypot(end.x - p.x, end.y - p.y) > 0.01) return Math.atan2(end.y - p.y, end.x - p.x)
  }
  return 0
}

function drawAnnotationInner(
  ctx: CanvasRenderingContext2D,
  ann: Annotation,
  img?: HTMLImageElement | null,
  viewScale = 1,
) {
  const opacity = ann.opacity ?? 1
  ctx.strokeStyle = ann.color
  ctx.fillStyle = ann.color
  ctx.lineWidth = ann.sw
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.globalAlpha = opacity
  // Applies to every stroke/fill below except text, which shapes its own
  // shadow per its shape (plain glyphs vs. box/bubble background) further
  // down — `number` also clears this again before its digit, which stays
  // crisp even when its circle/square badge casts one.
  if (ann.type !== 'text' && SHADOW_CAPABLE.has(ann.type)) {
    applyShadowOrGlow(ctx, ann, viewScale, ann.color)
  }

  switch (ann.type) {
    case 'arrow': {
      const { x1, y1, x2, y2, head, sw, doubleEnded } = ann
      if (Math.hypot(x2 - x1, y2 - y1) < 2) break

      // Straight arrows path as their 2 endpoints; elbow arrows path through
      // the bend's 2 extra corners — everything past this point (head angles,
      // shaft shortening, stroking) is identical either way.
      const points: { x: number; y: number }[] = ann.style === 'elbow'
        ? (() => {
            const segs = getElbowSegments(x1, y1, x2, y2, ann.bendRatio ?? 0.5)
            return [{ x: x1, y: y1 }, { x: segs[0].x2, y: segs[0].y2 }, { x: segs[1].x2, y: segs[1].y2 }, { x: x2, y: y2 }]
          })()
        : [{ x: x1, y: y1 }, { x: x2, y: y2 }]

      // Direction the shaft arrives into the x2 tip, and the direction it
      // departs x1 (the x1 head, when double-ended, points the opposite way).
      const angleEnd = trailingAngle(points)
      const angleLead = leadingAngle(points)
      const angleStart = angleLead + Math.PI

      // 'line' heads are chevrons drawn on top of the tip, not shapes that
      // occupy space at the end — only 'triangle'/'dot' need the shaft
      // shortened so the head doesn't get drawn over by the stroke.
      const shorten = head === 'dot' ? Math.max(4, sw * 1.2) * 0.6
        : head === 'triangle' ? Math.max(10, sw * 5) * 0.85
        : 0
      const startShorten = doubleEnded ? shorten : 0
      points[0] = { x: x1 + startShorten * Math.cos(angleLead), y: y1 + startShorten * Math.sin(angleLead) }
      points[points.length - 1] = { x: x2 - shorten * Math.cos(angleEnd), y: y2 - shorten * Math.sin(angleEnd) }

      // Shaft (stroke) + head(s) (fill, or a 'line' head's own stroke) are
      // separate draw calls — a shadow left active through all of them
      // would cast a fresh copy from each, the head's landing on top of the
      // already-painted shaft wherever it overlaps (same class of bug
      // `paintShadowOutsideOnly` exists to avoid elsewhere). Casting one
      // shadow for the *whole* arrow means painting it once, as a whole:
      // build the complete shaft+head on an offscreen silhouette first
      // (recursing into drawAnnotationInner with shadowStyle forced to
      // 'none' — reuses this exact paint logic instead of duplicating it,
      // and can't recurse again since that forced 'none' makes the check
      // below false on the way back in), then draw *that* onto `ctx` once
      // with the shadow already active (applyShadowOrGlow ran before this
      // switch) — the shadow comes out shaped like the whole arrow, head
      // included, with nothing painted after it to cast a second copy on
      // top. Falls through to the plain paint below if there's no shadow to
      // begin with, or the silhouette can't be sized (degenerate bounds, or
      // implausibly large).
      if (getShadowStyle(ann) !== 'none') {
        const bounds = getAnnotationBounds(ann)
        if (bounds && bounds.w > 0 && bounds.h > 0) {
          const pad = Math.max(20, sw * 6)
          const silW = Math.ceil(bounds.w) + pad * 2
          const silH = Math.ceil(bounds.h) + pad * 2
          if (silW > 0 && silH > 0 && silW < 4000 && silH < 4000) {
            const silhouette = document.createElement('canvas')
            silhouette.width = silW
            silhouette.height = silH
            const sctx = silhouette.getContext('2d')
            if (sctx) {
              sctx.translate(pad - bounds.x, pad - bounds.y)
              drawAnnotationInner(sctx, { ...ann, shadowStyle: 'none' }, img, 1)
              ctx.drawImage(silhouette, bounds.x - pad, bounds.y - pad)
              ctx.shadowColor = 'transparent'
              break
            }
          }
        }
      }

      ctx.beginPath()
      ctx.moveTo(points[0].x, points[0].y)
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
      ctx.setLineDash(dashArray(ann.dash, sw))
      ctx.stroke()
      // The head (triangle/dot fill, or a 'line' head's own chevron stroke)
      // always stays solid — a dashed/dotted arrowhead reads as broken, not
      // stylistic, so the dash pattern set for the shaft above is cleared
      // before it's drawn.
      ctx.setLineDash([])
      ctx.shadowColor = 'transparent'
      drawArrowHead(ctx, x2, y2, angleEnd, head, sw)
      if (doubleEnded) drawArrowHead(ctx, x1, y1, angleStart, head, sw)
      break
    }

    case 'line': {
      const { x1, y1, x2, y2 } = ann
      if (Math.hypot(x2 - x1, y2 - y1) < 2) break
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.setLineDash(dashArray(ann.dash, ann.sw))
      ctx.stroke()
      break
    }

    case 'pen': {
      const { points } = ann
      if (points.length < 2) break
      const penRot = ann.rotation ?? 0
      if (penRot) {
        // Spin the whole stroke around its bounds center — the same pivot
        // `annotationPivot` hands the selection box, handles and hit-testing.
        const pivot = annotationPivot(ann)!
        ctx.translate(pivot.x, pivot.y)
        ctx.rotate((penRot * Math.PI) / 180)
        ctx.translate(-pivot.x, -pivot.y)
      }
      ctx.beginPath()
      ctx.moveTo(points[0].x, points[0].y)
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
      ctx.setLineDash(dashArray(ann.dash, ann.sw))
      ctx.stroke()
      break
    }

    case 'rect': {
      const { x, y, w, h, fill } = ann
      if (Math.abs(w) < 1 || Math.abs(h) < 1) break
      const rx = Math.min(x, x + w); const ry = Math.min(y, y + h)
      const rw = Math.abs(w); const rh = Math.abs(h)
      const rot = ann.rotation ?? 0
      if (rot) {
        const cx = rx + rw / 2; const cy = ry + rh / 2
        ctx.translate(cx, cy)
        ctx.rotate((rot * Math.PI) / 180)
        ctx.translate(-cx, -cy)
      }
      // `ctx.roundRect` itself clamps an oversized radius down to half the
      // shorter side, same as this `Math.max(0, …)` just guards against a
      // stray negative — `radius` absent/0 renders identically to the old
      // plain `ctx.rect`, so this is a strict superset, not a behavior
      // change for every rect drawn before this field existed.
      const radius = Math.max(0, ann.radius ?? 0)
      const buildRectPath = () => { ctx.beginPath(); ctx.roundRect(rx, ry, rw, rh, radius) }
      if (fill === 'solid') {
        buildRectPath()
        ctx.fill()
      } else if (fill === 'semi') {
        ctx.globalAlpha = opacity * 0.35
        buildRectPath()
        ctx.fill()
        ctx.globalAlpha = opacity
      } else {
        // Outline only, fully transparent interior — a shadow/glow must not
        // bleed across the border into it.
        ctx.setLineDash(dashArray(ann.dash, ann.sw))
        paintShadowOutsideOnly(ctx, getShadowStyle(ann) !== 'none', buildRectPath, () => ctx.stroke())
      }
      break
    }

    case 'ellipse': {
      const { cx, cy, rx, ry, fill } = ann
      if (Math.abs(rx) < 1 || Math.abs(ry) < 1) break
      const rot = ((ann.rotation ?? 0) * Math.PI) / 180
      const buildEllipsePath = () => { ctx.beginPath(); ctx.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), rot, 0, Math.PI * 2) }
      buildEllipsePath()
      if (fill === 'solid') {
        ctx.fill()
      } else if (fill === 'semi') {
        ctx.globalAlpha = opacity * 0.35
        ctx.fill()
        ctx.globalAlpha = opacity
      } else {
        // Outline only, fully transparent interior — a shadow/glow must not
        // bleed across the border into it.
        ctx.setLineDash(dashArray(ann.dash, ann.sw))
        paintShadowOutsideOnly(ctx, getShadowStyle(ann) !== 'none', buildEllipsePath, () => ctx.stroke())
      }
      break
    }

    case 'text': {
      const { x, y, text, fontSize, shape, align } = ann
      if (!text) break
      const textRot = ann.rotation ?? 0
      if (textRot) {
        // Spin the whole block (background box/bubble tail included) around
        // its bounds center — the same pivot `annotationPivot` hands the
        // selection box, handles and connection anchors.
        const pivot = annotationPivot(ann)!
        ctx.translate(pivot.x, pivot.y)
        ctx.rotate((textRot * Math.PI) / 180)
        ctx.translate(-pivot.x, -pivot.y)
      }
      ctx.font = `bold ${fontSize}px "Inter", system-ui, sans-serif`
      ctx.textBaseline = 'top'
      const lineH = fontSize * 1.25
      const lines = text.split('\n')
      const lineWidths = lines.map((l) => ctx.measureText(l).width)
      const textW = Math.max(...lineWidths)
      // Each line's own left edge, relative to the block's widest line —
      // not the annotation's box — so a short line in a centered/right-
      // aligned multi-line block shifts on its own, the way word processors
      // align paragraphs. Left (default) needs no per-line adjustment.
      const lineX = (i: number) => align === 'center' ? x + (textW - lineWidths[i]) / 2
        : align === 'right' ? x + (textW - lineWidths[i])
        : x
      // How far a `textBaseline: 'top'` draw needs to shift *down* from the
      // line's own top edge to land where the browser puts a real text run
      // under `line-height` — used by both the plain and box/bubble cases
      // below, so the editing textarea (a real DOM element under CSS
      // `line-height`) and the canvas commit land on the same pixel.
      //
      // This was tried as a font-metrics computation instead — reading
      // `ctx.measureText(...).fontBoundingBoxAscent/Descent` and splitting
      // `lineH - (ascent+descent)` in half, on the theory that `fontSize`
      // alone is a poor stand-in for a font's real vertical metrics. That
      // theory was wrong: a `<textarea>` is a replaced form control, not a
      // plain inline text run, and Chrome does not lay out its internal
      // text using the CSS inline half-leading algorithm applied to the
      // font's own ascent/descent box — empirically (an isolated HTML page,
      // several font sizes, several candidate offsets, screenshotted and
      // compared pixel-by-pixel) the textarea's actual first-line position
      // matches this plain `fontSize`-based formula far more closely than
      // the "more correct-looking" font-metrics one, which was off by
      // several pixels. Measure before re-deriving this from theory again.
      const halfLead = (lineH - fontSize) / 2

      if (shape && shape !== 'none') {
        const { bg, text: textColor } = resolveTextColors(ann)
        const bgFill = ann.bgFill ?? 'solid'
        const pad = textPadding(fontSize)
        const textH = lineH * lines.length
        const bx = x - pad
        const by = y - pad
        const bw = textW + pad * 2
        const bh = textH + pad * 2
        const radius = bubbleCornerRadius(fontSize, bw, bh)

        // Body (rounded rect) and tail as separate path-builders — 'stroke'
        // (below) draws them differently (tail filled, body only outlined),
        // while 'white'/'solid' still want them as one combined path so a
        // single fill/stroke merges them seamlessly. Built fresh each call
        // rather than once into a reusable Path2D: `paintShadowOutsideOnly`
        // needs to retrace its path twice (clip, then the real draw).
        const buildBodyPath = () => { ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, radius) }
        // Small triangular tail hanging off one of the box's 16 tail anchors
        // (default: bottom edge, left of center).
        const tailPoints = () => {
          const tailH = bubbleTailHeight(fontSize)
          return bubbleTailPoints(ann.tailAnchor ?? 's3', bx, by, bw, bh, tailH, radius)
        }
        const buildTailPath = () => {
          const [p0, p1, p2] = tailPoints()
          ctx.beginPath()
          ctx.moveTo(p0.x, p0.y)
          ctx.lineTo(p1.x, p1.y)
          ctx.lineTo(p2.x, p2.y)
          ctx.closePath()
        }
        const buildBoxPath = () => {
          buildBodyPath()
          if (shape === 'bubble') {
            // Second subpath in the same fill/stroke so it merges seamlessly
            // with the rounded body (both painted in the identical color).
            const [p0, p1, p2] = tailPoints()
            ctx.moveTo(p0.x, p0.y)
            ctx.lineTo(p1.x, p1.y)
            ctx.lineTo(p2.x, p2.y)
            ctx.closePath()
          }
        }

        ctx.save()
        try {
          applyShadowOrGlow(ctx, ann, viewScale, bg)
          const hasShadow = getShadowStyle(ann) !== 'none'
          // Every fill/stroke below goes through paintShadowOutsideOnly, even
          // the ones whose interior ends up fully opaque ('white'/'solid') —
          // a later draw call's shadow isn't retroactively hidden by an
          // earlier one's opacity. Concretely: 'white' paints the fill, then
          // the border on top of it as a *separate* draw call; that border's
          // own shadow, if unclipped, is cast fresh from the border's shape
          // and lands on top of the already-painted fill wherever it reaches
          // beyond the border itself — visible sitting in front of the
          // background instead of hidden behind the whole shape. Wrapping
          // every paint call (not just the technically-transparent 'stroke'
          // case) closes that regardless of fill order.
          if (bgFill === 'stroke') {
            // "Knockout": no fill on the body — the image underneath shows
            // through its interior, so a shadow/glow must not bleed across
            // the border into it. The tail stays solid-filled even here
            // rather than following the body's own outline-only treatment:
            // it's a thin sliver sharing an edge with the body's own stroke,
            // and a matching outline there reads as a stray line at the seam
            // rather than a pointer aimed at whatever the bubble points to.
            if (shape === 'bubble') {
              ctx.fillStyle = bg
              paintShadowOutsideOnly(ctx, hasShadow, buildTailPath, () => ctx.fill())
            }
            ctx.strokeStyle = bg
            ctx.lineWidth = ann.sw
            paintShadowOutsideOnly(ctx, hasShadow, buildBodyPath, () => ctx.stroke())
          } else if (bgFill === 'white') {
            // Fixed white fill plus a border in the accent color — the
            // classic outlined-caption look. The tail is its own fill
            // rather than folded into the body's path (the border should
            // trace the body only, not detour around the tail's tip), and
            // paints solid in the border color rather than white: a white
            // flap outlined only where it meets the body reads as a stray
            // white triangle hanging off the border, not part of the same
            // shape — filling it in the border color instead makes it read
            // as the border's own point.
            if (shape === 'bubble') {
              ctx.fillStyle = bg
              paintShadowOutsideOnly(ctx, hasShadow, buildTailPath, () => ctx.fill())
            }
            // Only the fill casts the shadow, not the stroke on top of it —
            // both paint()ing in one pass each cast their own copy, and
            // since the stroke's ring sits right at the fill's own edge, the
            // two shadows nearly coincide almost everywhere *except* that
            // ring, where the doubled-up alpha reads as an extra outline
            // traced around the shadow itself. A soft blur used to smear
            // that seam into invisibility; at blur 0 (a flat, hard-edged
            // shadow, the point of the whole exercise) it's a crisp, visible
            // artifact instead. The fill's own silhouette is already the
            // right shape for a shadow — the classic "card lifted off the
            // page" look — so the stroke doesn't need its own.
            ctx.fillStyle = '#FFFFFF'
            paintShadowOutsideOnly(ctx, hasShadow, buildBodyPath, () => ctx.fill())
            ctx.strokeStyle = bg
            ctx.lineWidth = ann.sw
            ctx.shadowColor = 'transparent'
            buildBodyPath()
            ctx.stroke()
          } else {
            ctx.fillStyle = bg
            paintShadowOutsideOnly(ctx, hasShadow, buildBoxPath, () => ctx.fill())
          }
        } finally {
          ctx.restore()
        }

        ctx.fillStyle = textColor
        ctx.shadowColor = 'transparent'
        // Same `textBaseline: 'top'` + half-leading formula (computed once,
        // above) the plain-text case below uses, not an ink-metrics-based
        // center (`middle` baseline, or measuring actualBoundingBoxAscent/
        // Descent) — `by` is already `y - pad` on each side, so the padded
        // box's content area sits at exactly `y`, same origin plain text
        // starts from; centering on the box's actual *ink* extents instead
        // disagreed with the editing textarea's plain CSS line-height
        // layout (which has no idea what glyphs are actually in the text),
        // producing the same "sits high, jumps on commit" mismatch the
        // plain-text comment below already describes and this case used to
        // independently reintroduce.
        ctx.textBaseline = 'top'
        lines.forEach((line, i) => ctx.fillText(line, lineX(i), y + halfLead + i * lineH))
        break
      }

      applyShadowOrGlow(ctx, ann, viewScale, ann.color)
      // `textBaseline: 'top'` puts the full line-height leading *below* the
      // glyphs, but the bounds box (measureTextBounds) and the edit textarea
      // both split that leading half above / half below (`halfLead`,
      // computed once above). Match them — otherwise the text sits high in
      // its box and jumps up on commit.
      lines.forEach((line, i) => ctx.fillText(line, lineX(i), y + halfLead + i * lineH))
      break
    }

    case 'number': {
      const { cx, cy, n, r, color } = ann
      ctx.beginPath()
      if (ann.shape === 'square') {
        ctx.roundRect(cx - r, cy - r, r * 2, r * 2, r * 0.28)
      } else {
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
      }
      ctx.fill()
      ctx.fillStyle = contrastTextColor(color)
      ctx.strokeStyle = 'transparent'
      ctx.font = `bold ${r * 1.3}px "Inter", system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.shadowColor = 'transparent'
      ctx.fillText(String(n), cx, cy + r * 0.05)
      break
    }

    case 'blur': {
      // Blurs the underlying image rather than painting ink — the shared
      // palette opacity doesn't apply here.
      ctx.globalAlpha = 1
      const { x, y, w, h } = ann
      if (Math.abs(w) < 4 || Math.abs(h) < 4) break
      const rx = Math.min(x, x + w); const ry = Math.min(y, y + h)
      const rw = Math.abs(w); const rh = Math.abs(h)
      if (img) {
        // Gaussian blur. Radius scales with the region so intensity stays
        // consistent regardless of image resolution (the export canvas
        // renders at full res); the strength % shifts the whole scale.
        const pct = blurStrengthPct(ann.strength)
        const radius = Math.max(2, (Math.min(rw, rh) * pct) / 100)
        ctx.save()
        ctx.beginPath()
        ctx.rect(rx, ry, rw, rh)
        ctx.clip()
        ctx.filter = `blur(${radius}px)`
        // Sample a slightly larger area so blurred edges stay opaque inside the clip.
        const pad = radius * 2
        ctx.drawImage(
          img,
          rx - pad, ry - pad, rw + pad * 2, rh + pad * 2,
          rx - pad, ry - pad, rw + pad * 2, rh + pad * 2,
        )
        ctx.restore()
      } else {
        ctx.fillStyle = 'rgba(15, 17, 23, 0.75)'
        ctx.fillRect(rx, ry, rw, rh)
      }
      break
    }

    case 'highlight': {
      const { x1, y1, x2, y2, sw } = ann
      if (Math.hypot(x2 - x1, y2 - y1) < 2) break
      // The marker's own 40% translucency is a look, not the palette
      // opacity — the two multiply, so dialing the palette down further
      // fades the marker instead of overriding its default.
      ctx.globalAlpha = opacity * 0.4
      ctx.lineWidth = sw * 6
      ctx.lineCap = 'butt'
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      ctx.globalAlpha = opacity
      break
    }

    case 'spotlight': {
      // Dims everything outside the lit region, leaving the image underneath
      // untouched inside it. The dim strength is its own field, independent
      // of the shared palette opacity.
      ctx.globalAlpha = 1
      const { x, y, w, h } = ann
      if (Math.abs(w) < 4 || Math.abs(h) < 4) break
      const W = img?.naturalWidth ?? 0
      const H = img?.naturalHeight ?? 0
      if (W === 0 || H === 0) break
      const rx = Math.min(x, x + w); const ry = Math.min(y, y + h)
      const rw = Math.abs(w); const rh = Math.abs(h)
      const dimColor = `rgba(0,0,0,${ann.dim ?? 0.55})`
      if (ann.shape === 'circle') {
        // One path — the whole frame with the lit ellipse subtracted via the
        // even-odd fill rule — painted in a single fill. The ellipse's
        // interior is never painted over at all (not even briefly erased),
        // so it stays exactly as untouched as the square case's inside is.
        // (A fill-then-destination-out-erase two-step looks right in
        // isolation but actually erases the already-composited image
        // underneath, not just this dim layer — there's only one canvas
        // layer here, image and annotations share it.)
        ctx.beginPath()
        ctx.rect(0, 0, W, H)
        ctx.ellipse(rx + rw / 2, ry + rh / 2, rw / 2, rh / 2, 0, 0, Math.PI * 2)
        ctx.fillStyle = dimColor
        ctx.fill('evenodd')
      } else {
        // Four dark rects framing the region — cheaper than a cutout and
        // avoids compositing-mode edge artifacts for the common square case.
        ctx.fillStyle = dimColor
        ctx.fillRect(0, 0, W, ry)                  // top
        ctx.fillRect(0, ry + rh, W, H - ry - rh)   // bottom
        ctx.fillRect(0, ry, rx, rh)                // left
        ctx.fillRect(rx + rw, ry, W - rx - rw, rh) // right
      }
      break
    }

    case 'image': {
      const { x, y, w, h } = ann
      if (Math.abs(w) < 1 || Math.abs(h) < 1) break
      const rx = Math.min(x, x + w); const ry = Math.min(y, y + h)
      const rw = Math.abs(w); const rh = Math.abs(h)
      const rot = ann.rotation ?? 0
      if (rot) {
        const cx = rx + rw / 2; const cy = ry + rh / 2
        ctx.translate(cx, cy)
        ctx.rotate((rot * Math.PI) / 180)
        ctx.translate(-cx, -cy)
      }
      const bitmap = getEmbeddedImage(ann.src)
      if (bitmap) {
        ctx.drawImage(bitmap, rx, ry, rw, rh)
      } else {
        // Still decoding, or undecodable: hold the box with a translucent
        // placeholder. Without it a freshly pasted picture blinks out of
        // existence for a frame, and one that never decodes leaves nothing on
        // screen to select and delete.
        ctx.globalAlpha = opacity * 0.25
        ctx.fillRect(rx, ry, rw, rh)
        ctx.globalAlpha = opacity
      }
      if (ann.border) {
        // Stroked on the box's own edge (half in, half out), exactly like a
        // rect annotation's outline — so the same width slider reads the same
        // way on both. paintShadowOutsideOnly because this stroke is a
        // separate, later draw call than the picture itself: an active
        // shadow left unclipped here is cast fresh from the border's own
        // shape and lands on top of the already-drawn picture wherever it
        // reaches inward, the same bleed a boxed/bubble text's border has
        // (see the 'text' case above) — the picture's own opacity can't
        // retroactively hide a shadow painted after it.
        ctx.strokeStyle = ann.color
        paintShadowOutsideOnly(ctx, getShadowStyle(ann) !== 'none', () => { ctx.beginPath(); ctx.rect(rx, ry, rw, rh) }, () => ctx.strokeRect(rx, ry, rw, rh))
      }
      break
    }

    case 'erase': {
      // The flood fill already ran once, at click time (floodFillColorMask)
      // — this just decodes+applies the resulting mask, exactly like an
      // `image` annotation decodes its own `src` (same cache, same
      // draws-nothing-until-decoded first frame). `ctx.drawImage` scales the
      // mask to (w,h) same as a resize would scale a pasted picture, so
      // resizing this annotation stretches its selection rather than
      // needing a re-run of the flood fill. The mask itself is a pure
      // selection (opaque = selected, see `floodFillColorMask`); what
      // happens inside it is `effect` (absent = `'erase'`, the original
      // behavior).
      const { x, y, w, h } = ann
      if (w < 1 || h < 1) break
      const maskImg = getEmbeddedImage(ann.mask)
      if (!maskImg) break
      const effect = ann.effect ?? 'erase'

      if (effect === 'erase') {
        // Always a full punch to transparent — no partial-opacity erase.
        // `ann.opacity` is ignored here on purpose (unlike every other
        // effect/tool, where it's the normal "how opaque the ink looks"
        // slider): a half-erased selection reads as a rendering glitch, not
        // a look anyone's reaching for, and it only existed here as an
        // inverted "how hard the erase hits" knob (0% = full punch) that
        // just made the Effect toggle's own forced-opacity dance necessary
        // to keep it visibly doing anything.
        ctx.globalAlpha = 1
        ctx.globalCompositeOperation = 'destination-out'
        ctx.drawImage(maskImg, x, y, w, h)
        break
      }

      // fill/blur/pixelate: render the effect into an offscreen canvas the
      // exact size of the mask's own box, cut it down to the selection's
      // silhouette via `destination-in` (so it can never bleed past pixels
      // the color match rejected — a plain clip-rect would), then composite
      // that over the image. This is the same masked-effect trick as
      // `image`/`erase` itself, just building new content instead of a hole.
      const off = document.createElement('canvas')
      off.width = w
      off.height = h
      const octx = off.getContext('2d')
      if (!octx) break
      if (effect === 'fill') {
        octx.fillStyle = ann.fillColor ?? ann.color
        octx.fillRect(0, 0, w, h)
      } else if (img) {
        // Same percent-of-region-size scale (and the same 40% cap, for the
        // same reason — see blurStrengthPct's doc comment) as the
        // standalone Blur tool, just not sharing its field — see
        // `EraseAnn.effectStrength`. Pixelate reuses the identical cap:
        // an oversized block size collapses to the same flat-average
        // problem a too-large blur sigma does.
        const pct = Math.max(1, Math.min(40, ann.effectStrength ?? 20))
        if (effect === 'blur') {
          const radius = Math.max(2, (Math.min(w, h) * pct) / 100)
          const pad = radius * 2
          octx.filter = `blur(${radius}px)`
          // Sample a slightly larger area so the blurred edges stay opaque
          // right up to the canvas boundary — same reasoning as the
          // standalone Blur tool's own `pad`.
          octx.drawImage(img, x - pad, y - pad, w + pad * 2, h + pad * 2, -pad, -pad, w + pad * 2, h + pad * 2)
          octx.filter = 'none'
        } else {
          // Pixelate: downscale the region to blocky tiles, then upscale
          // with smoothing off — the classic mosaic technique, no filter
          // needed.
          const block = Math.max(2, Math.round((Math.min(w, h) * pct) / 100))
          const tw = Math.max(1, Math.round(w / block))
          const th = Math.max(1, Math.round(h / block))
          const tiny = document.createElement('canvas')
          tiny.width = tw
          tiny.height = th
          const tctx = tiny.getContext('2d')
          if (tctx) {
            tctx.drawImage(img, x, y, w, h, 0, 0, tw, th)
            octx.imageSmoothingEnabled = false
            octx.drawImage(tiny, 0, 0, tw, th, 0, 0, w, h)
          }
        }
      }
      octx.globalCompositeOperation = 'destination-in'
      octx.drawImage(maskImg, 0, 0, w, h)
      ctx.globalAlpha = opacity
      ctx.drawImage(off, x, y)
      break
    }

    case 'magnifier': {
      const { source: src, target: tgt } = getMagnifierBoxes(ann)
      if (src.w < 4 || src.h < 4 || tgt.w < 4 || tgt.h < 4 || !img) break
      const isCircle = ann.shape === 'circle'

      const frameW = ann.sw
      ctx.lineWidth = frameW

      // Leader line first, so the boxes' borders sit visually on top of it.
      ctx.globalAlpha = opacity
      const [p1, p2] = magnifierLeaderPoints(src, tgt)
      ctx.beginPath()
      ctx.moveTo(p1.x, p1.y)
      ctx.lineTo(p2.x, p2.y)
      ctx.stroke()

      // Magnified copy — always fully opaque, like blur's sampled pixels.
      ctx.save()
      try {
        pathBoxOutline(ctx, tgt, isCircle)
        ctx.clip()
        ctx.globalAlpha = 1
        ctx.drawImage(img, src.x, src.y, src.w, src.h, tgt.x, tgt.y, tgt.w, tgt.h)
      } finally {
        ctx.restore()
      }

      ctx.globalAlpha = opacity
      ctx.setLineDash([frameW * 3, frameW * 2])
      pathBoxOutline(ctx, src, isCircle)
      ctx.stroke()
      ctx.setLineDash([])
      pathBoxOutline(ctx, tgt, isCircle)
      ctx.stroke()
      break
    }

  }
}

/** Normalizes a possibly-negative-w/h rect to a top-left-origin rect. */
function normalizeRect(x: number, y: number, w: number, h: number): { x: number; y: number; w: number; h: number } {
  return { x: Math.min(x, x + w), y: Math.min(y, y + h), w: Math.abs(w), h: Math.abs(h) }
}

/** Begins a path outlining a box — the rect itself, or (matching
 *  SpotlightAnn's 'circle' shape) the ellipse inscribed in it. */
function pathBoxOutline(ctx: CanvasRenderingContext2D, box: { x: number; y: number; w: number; h: number }, isCircle: boolean) {
  ctx.beginPath()
  if (isCircle) {
    ctx.ellipse(box.x + box.w / 2, box.y + box.h / 2, box.w / 2, box.h / 2, 0, 0, Math.PI * 2)
  } else {
    ctx.rect(box.x, box.y, box.w, box.h)
  }
}

/** A magnifier's source and target boxes, each normalized to top-left origin. */
export function getMagnifierBoxes(ann: MagnifierAnn): {
  source: { x: number; y: number; w: number; h: number }
  target: { x: number; y: number; w: number; h: number }
} {
  return {
    source: normalizeRect(ann.x, ann.y, ann.w, ann.h),
    target: normalizeRect(ann.tx, ann.ty, ann.tw, ann.th),
  }
}

/**
 * The two points a magnifier's leader line connects: the midpoint of
 * whichever edge of each box faces the other — horizontal (left/right) or
 * vertical (top/bottom) is picked by whichever axis separates the boxes'
 * centers more, so the line always runs edge-midpoint to edge-midpoint
 * rather than landing on an arbitrary (e.g. corner) boundary point.
 */
export function magnifierLeaderPoints(
  source: { x: number; y: number; w: number; h: number },
  target: { x: number; y: number; w: number; h: number },
): [{ x: number; y: number }, { x: number; y: number }] {
  const srcCenter = { x: source.x + source.w / 2, y: source.y + source.h / 2 }
  const tgtCenter = { x: target.x + target.w / 2, y: target.y + target.h / 2 }
  const dx = tgtCenter.x - srcCenter.x
  const dy = tgtCenter.y - srcCenter.y
  if (Math.abs(dx) >= Math.abs(dy)) {
    const p1 = dx >= 0 ? { x: source.x + source.w, y: srcCenter.y } : { x: source.x, y: srcCenter.y }
    const p2 = dx >= 0 ? { x: target.x, y: tgtCenter.y } : { x: target.x + target.w, y: tgtCenter.y }
    return [p1, p2]
  }
  const p1 = dy >= 0 ? { x: srcCenter.x, y: source.y + source.h } : { x: srcCenter.x, y: source.y }
  const p2 = dy >= 0 ? { x: tgtCenter.x, y: target.y } : { x: tgtCenter.x, y: target.y + target.h }
  return [p1, p2]
}

/** Which of a magnifier's two boxes (image-pixel) point (px,py) falls
 *  inside, if either — used to route a body-drag to just that sub-rect. */
export function magnifierHitPart(ann: MagnifierAnn, px: number, py: number): 'source' | 'target' | null {
  const { source, target } = getMagnifierBoxes(ann)
  if (px >= source.x && px <= source.x + source.w && py >= source.y && py <= source.y + source.h) return 'source'
  if (px >= target.x && px <= target.x + target.w && py >= target.y && py <= target.y + target.h) return 'target'
  return null
}

/** Draws one arrow head shape at (tipX, tipY), pointing along `angle`. */
function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  tipX: number, tipY: number,
  angle: number,
  head: ArrowHead,
  sw: number,
) {
  if (head === 'none') return
  if (head === 'line') {
    const headLen = Math.max(10, sw * 4)
    ctx.beginPath()
    ctx.moveTo(tipX - headLen * Math.cos(angle - Math.PI / 6),
               tipY - headLen * Math.sin(angle - Math.PI / 6))
    ctx.lineTo(tipX, tipY)
    ctx.lineTo(tipX - headLen * Math.cos(angle + Math.PI / 6),
               tipY - headLen * Math.sin(angle + Math.PI / 6))
    ctx.stroke()
    return
  }
  if (head === 'dot') {
    const r = Math.max(4, sw * 1.2)
    ctx.beginPath()
    ctx.arc(tipX, tipY, r, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  // 'triangle' (default)
  const headLen = Math.max(10, sw * 5)
  ctx.beginPath()
  ctx.moveTo(tipX, tipY)
  ctx.lineTo(tipX - headLen * Math.cos(angle - Math.PI / 6),
             tipY - headLen * Math.sin(angle - Math.PI / 6))
  ctx.lineTo(tipX - headLen * Math.cos(angle + Math.PI / 6),
             tipY - headLen * Math.sin(angle + Math.PI / 6))
  ctx.closePath()
  ctx.fill()
}

/**
 * Rough bounding box for an annotation (image-pixel space). For a rotated
 * rect/ellipse/text this is the axis-aligned box enclosing the *rotated* shape
 * (used for hit-testing, rubber-band selection, and export sizing) — not
 * the shape's own unrotated local box. Use `getAnnotationLocalBounds` when
 * you need the latter (e.g. resize math in the shape's own frame).
 */
export function getAnnotationBounds(
  ann: Annotation,
): { x: number; y: number; w: number; h: number } | null {
  const rot = annotationRotation(ann)
  if (rot !== 0) {
    const local = getAnnotationLocalBounds(ann)
    if (local) return rotatedAabb(local, rot)
  }
  return getAnnotationLocalBounds(ann)
}

/** Bounding box in the shape's own unrotated local frame (rotation ignored). */
export function getAnnotationLocalBounds(
  ann: Annotation,
): { x: number; y: number; w: number; h: number } | null {
  switch (ann.type) {
    case 'arrow': {
      // Include the arrowhead extent (headLen in any direction from tip)
      const headLen = Math.max(10, ann.sw * 5)
      const minX = Math.min(ann.x1, ann.x2) - headLen
      const minY = Math.min(ann.y1, ann.y2) - headLen
      const maxX = Math.max(ann.x1, ann.x2) + headLen
      const maxY = Math.max(ann.y1, ann.y2) + headLen
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
    }
    case 'line': {
      const hw = ann.sw / 2
      const minX = Math.min(ann.x1, ann.x2) - hw
      const minY = Math.min(ann.y1, ann.y2) - hw
      const maxX = Math.max(ann.x1, ann.x2) + hw
      const maxY = Math.max(ann.y1, ann.y2) + hw
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
    }
    case 'pen': {
      const hw = ann.sw / 2
      const xs = ann.points.map((p) => p.x)
      const ys = ann.points.map((p) => p.y)
      const minX = Math.min(...xs) - hw
      const minY = Math.min(...ys) - hw
      const maxX = Math.max(...xs) + hw
      const maxY = Math.max(...ys) + hw
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
    }
    case 'rect':
    case 'blur':
    case 'spotlight':
    case 'image':
    case 'erase': {
      return { x: Math.min(ann.x, ann.x + ann.w), y: Math.min(ann.y, ann.y + ann.h), w: Math.abs(ann.w), h: Math.abs(ann.h) }
    }
    case 'magnifier': {
      const { source, target } = getMagnifierBoxes(ann)
      const minX = Math.min(source.x, target.x)
      const minY = Math.min(source.y, target.y)
      const maxX = Math.max(source.x + source.w, target.x + target.w)
      const maxY = Math.max(source.y + source.h, target.y + target.h)
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
    }
    case 'highlight': {
      const hw = (ann.sw * 6) / 2
      const minX = Math.min(ann.x1, ann.x2) - hw
      const minY = Math.min(ann.y1, ann.y2) - hw
      const maxX = Math.max(ann.x1, ann.x2) + hw
      const maxY = Math.max(ann.y1, ann.y2) + hw
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
    }
    case 'ellipse':
      return { x: ann.cx - ann.rx, y: ann.cy - ann.ry, w: ann.rx * 2, h: ann.ry * 2 }
    case 'number':
      return { x: ann.cx - ann.r, y: ann.cy - ann.r, w: ann.r * 2, h: ann.r * 2 }
    case 'text':
      return measureTextBounds(ann)
    default:
      return null
  }
}

/**
 * Bounding box of an annotation's *geometry only* — the stroke halo (line
 * width, marker width, arrowhead extent) is excluded.
 *
 * Used to decide whether the export canvas has to grow beyond the screenshot.
 * `getAnnotationBounds` pads by half the stroke width so selection boxes and
 * hit-testing cover the ink, but feeding that padding into the export bounds
 * means fattening a stroke near an edge silently enlarges the saved image
 * (a 12px marker pads 36px on every side). The canvas should only grow when
 * the user actually places something outside the screenshot.
 */
export function getAnnotationCoreBounds(
  ann: Annotation,
): { x: number; y: number; w: number; h: number } | null {
  switch (ann.type) {
    case 'arrow':
    case 'line':
    case 'highlight': {
      const minX = Math.min(ann.x1, ann.x2)
      const minY = Math.min(ann.y1, ann.y2)
      return { x: minX, y: minY, w: Math.abs(ann.x2 - ann.x1), h: Math.abs(ann.y2 - ann.y1) }
    }
    case 'pen': {
      const xs = ann.points.map((p) => p.x)
      const ys = ann.points.map((p) => p.y)
      const minX = Math.min(...xs)
      const minY = Math.min(...ys)
      const core = { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY }
      // A rotated stroke reaches past its own unrotated box; the export canvas
      // has to grow to wherever it actually lands. Spinning `core` about its
      // own center is the right pivot here — the halo `getAnnotationLocalBounds`
      // adds is symmetric, so both boxes share a center.
      const rot = ann.rotation ?? 0
      return rot ? rotatedAabb(core, rot) : core
    }
    default:
      return getAnnotationBounds(ann)
  }
}

/** Annotation types carrying a `rotation` field (rect, ellipse, text, image,
 *  pen) — the ones the editor shows a rotate handle for. */
export type RotatableAnnotation = RectAnn | EllipseAnn | TextAnn | ImageAnn | PenAnn

export function isRotatable(ann: Annotation): ann is RotatableAnnotation {
  return ann.type === 'rect' || ann.type === 'ellipse' || ann.type === 'text'
    || ann.type === 'image' || ann.type === 'pen'
}

/** An annotation's rotation in degrees — 0 for types that can't rotate. */
export function annotationRotation(ann: Annotation): number {
  return isRotatable(ann) ? (ann.rotation ?? 0) : 0
}

/**
 * The point a rotatable annotation spins around: the center of its own
 * *unrotated* local bounds. Every consumer (draw, selection box, handles,
 * connection anchors) must use this same pivot or the rendered shape and the
 * UI drawn around it drift apart.
 */
export function annotationPivot(ann: Annotation): { x: number; y: number } | null {
  const local = getAnnotationLocalBounds(ann)
  if (!local) return null
  return { x: local.x + local.w / 2, y: local.y + local.h / 2 }
}

/**
 * Maps an image-pixel point through a whole-image 90° turn: `w`/`h` are the
 * image's dimensions *before* the turn. This is the same rigid transform the
 * turned image itself goes through (pixel (0,0) lands wherever the physical
 * top-left corner ends up), so applying it to an annotation's own coordinates
 * keeps it registered to the same spot on the picture.
 */
export function rotateImagePoint(x: number, y: number, w: number, h: number, dir: 'cw' | 'ccw'): { x: number; y: number } {
  return dir === 'cw' ? { x: h - y, y: x } : { x: y, y: w - x }
}

/**
 * Carries one annotation through a whole-image 90° turn (`w`/`h`: the image's
 * pre-turn dimensions) so it stays registered to the same content after
 * `rotateImage` replaces the base picture.
 *
 * Endpoint/box shapes (arrow, line, highlight, blur, spotlight, magnifier,
 * number) have no orientation of their own, so their defining points/corners
 * are simply run through the turn directly.
 *
 * Shapes with a `rotation` field (rect, ellipse, text, image, pen) carry
 * actual content (glyphs, a pasted bitmap, ink) that has to visibly turn with
 * the picture, not just have its box relabeled — stretching a resized box
 * would distort a picture instead of rotating it. So instead: bump the stored
 * rotation by the turn angle (spinning the content in place), and *translate*
 * the shape by however far its own pivot moved under the turn, rather than
 * transforming its defining coordinates directly. The two are equivalent for
 * a plain geometric outline (rect/ellipse), and only the rotation-bump form is
 * correct once real content is involved (image/text/pen) — since a bitmap's
 * corners always map fixed-corner-to-fixed-corner into its box, resizing the
 * box alone can't reorient what's drawn inside it.
 */
export function rotateAnnotationForImageTurn(ann: Annotation, w: number, h: number, dir: 'cw' | 'ccw'): Annotation {
  const T = (x: number, y: number) => rotateImagePoint(x, y, w, h, dir)
  const turnDeg = dir === 'cw' ? 90 : -90
  const turnRotation = (rot: number | undefined) => (((rot ?? 0) + turnDeg) % 360 + 360) % 360

  switch (ann.type) {
    case 'arrow':
    case 'line':
    case 'highlight': {
      const p1 = T(ann.x1, ann.y1)
      const p2 = T(ann.x2, ann.y2)
      return { ...ann, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }
    }
    case 'number': {
      const c = T(ann.cx, ann.cy)
      return { ...ann, cx: c.x, cy: c.y }
    }
    case 'blur':
    case 'spotlight': {
      const p1 = T(ann.x, ann.y)
      const p2 = T(ann.x + ann.w, ann.y + ann.h)
      return {
        ...ann,
        x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y),
        w: Math.abs(p2.x - p1.x), h: Math.abs(p2.y - p1.y),
      }
    }
    case 'magnifier': {
      const s1 = T(ann.x, ann.y); const s2 = T(ann.x + ann.w, ann.y + ann.h)
      const t1 = T(ann.tx, ann.ty); const t2 = T(ann.tx + ann.tw, ann.ty + ann.th)
      return {
        ...ann,
        x: Math.min(s1.x, s2.x), y: Math.min(s1.y, s2.y),
        w: Math.abs(s2.x - s1.x), h: Math.abs(s2.y - s1.y),
        tx: Math.min(t1.x, t2.x), ty: Math.min(t1.y, t2.y),
        tw: Math.abs(t2.x - t1.x), th: Math.abs(t2.y - t1.y),
      }
    }
    case 'erase': {
      // Unlike blur/spotlight, this box isn't resampled live from the
      // underlying image on every draw — `mask` is a baked raster (see
      // `EraseAnn`), so the box turning 90° means that raster has to
      // physically turn with it too, the same way `rotateBase` turns the
      // picture itself. `getEmbeddedImage` returns the already-decoded
      // bitmap for free since a visible erase annotation's mask was decoded
      // to draw it in the first place; the box/seed point still move even
      // when it isn't (a mask that never finished decoding), just without a
      // matching raster underneath.
      const p1 = T(ann.x, ann.y)
      const p2 = T(ann.x + ann.w, ann.y + ann.h)
      const x = Math.min(p1.x, p2.x); const y = Math.min(p1.y, p2.y)
      const w = Math.abs(p2.x - p1.x); const h = Math.abs(p2.y - p1.y)
      const seed = T(ann.seedX, ann.seedY)
      let mask = ann.mask
      const maskImg = getEmbeddedImage(ann.mask)
      if (maskImg) {
        const off = document.createElement('canvas')
        off.width = maskImg.naturalHeight
        off.height = maskImg.naturalWidth
        const c = off.getContext('2d')
        if (c) {
          if (dir === 'cw') {
            c.translate(maskImg.naturalHeight, 0)
            c.rotate(Math.PI / 2)
          } else {
            c.translate(0, maskImg.naturalWidth)
            c.rotate(-Math.PI / 2)
          }
          c.drawImage(maskImg, 0, 0)
          mask = off.toDataURL('image/png')
        }
      }
      return { ...ann, x, y, w, h, mask, seedX: seed.x, seedY: seed.y }
    }
    case 'ellipse': {
      const c = T(ann.cx, ann.cy)
      return { ...ann, cx: c.x, cy: c.y, rotation: turnRotation(ann.rotation) }
    }
    case 'pen': {
      const pivot = annotationPivot(ann)!
      const newPivot = T(pivot.x, pivot.y)
      const dx = newPivot.x - pivot.x; const dy = newPivot.y - pivot.y
      return {
        ...ann,
        points: ann.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
        rotation: turnRotation(ann.rotation),
      }
    }
    case 'rect':
    case 'text':
    case 'image': {
      const pivot = annotationPivot(ann)!
      const newPivot = T(pivot.x, pivot.y)
      const dx = newPivot.x - pivot.x; const dy = newPivot.y - pivot.y
      return { ...ann, x: ann.x + dx, y: ann.y + dy, rotation: turnRotation(ann.rotation) }
    }
  }
}

/** Rotates (px, py) around (cx, cy) by `deg` degrees, clockwise. */
export function rotatePoint(px: number, py: number, cx: number, cy: number, deg: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad); const sin = Math.sin(rad)
  const dx = px - cx; const dy = py - cy
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
}

/** Axis-aligned box enclosing `local` (a shape's unrotated box) rotated by `deg` around its own center. */
function rotatedAabb(
  local: { x: number; y: number; w: number; h: number },
  deg: number,
): { x: number; y: number; w: number; h: number } {
  const cx = local.x + local.w / 2
  const cy = local.y + local.h / 2
  const corners = [
    [local.x, local.y], [local.x + local.w, local.y],
    [local.x + local.w, local.y + local.h], [local.x, local.y + local.h],
  ].map(([px, py]) => rotatePoint(px, py, cx, cy, deg))
  const xs = corners.map((p) => p.x)
  const ys = corners.map((p) => p.y)
  const minX = Math.min(...xs); const maxX = Math.max(...xs)
  const minY = Math.min(...ys); const maxY = Math.max(...ys)
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

// ── Arrow connections (Excel/PowerPoint-style connectors) ──────────────────

export type ConnectableAnnotation = RectAnn | EllipseAnn | NumberAnn | TextAnn | ImageAnn

/** Annotation types an arrow endpoint can glue to. */
export function isConnectable(ann: Annotation): ann is ConnectableAnnotation {
  return ann.type === 'rect' || ann.type === 'ellipse' || ann.type === 'number'
    || ann.type === 'text' || ann.type === 'image'
}

/** Clockwise from the top — the index is also the anchor's 22.5° step. */
export const CONNECT_ANCHORS: ConnectAnchor[] = [
  'n', 'nne', 'ne', 'ene',
  'e', 'ese', 'se', 'sse',
  's', 'ssw', 'sw', 'wsw',
  'w', 'wnw', 'nw', 'nnw',
]

/** Anchor offsets on a *rectangular* outline, in −1..1 units of half the box
 *  (0,0 = center): corners, edge midpoints, and each edge's quarter points.
 *  Exported so UI (the bubble tail-position picker) can lay out the same 16
 *  points without duplicating this table. */
export const RECT_ANCHOR_UNITS: Record<ConnectAnchor, [number, number]> = {
  n: [0, -1],    nne: [0.5, -1],  ne: [1, -1],    ene: [1, -0.5],
  e: [1, 0],     ese: [1, 0.5],   se: [1, 1],     sse: [0.5, 1],
  s: [0, 1],     ssw: [-0.5, 1],  sw: [-1, 1],    wsw: [-1, 0.5],
  w: [-1, 0],    wnw: [-1, -0.5], nw: [-1, -1],   nnw: [-0.5, -1],
}

/** Clockwise from the top-left of the north edge — the same rotational
 *  convention as `CONNECT_ANCHORS`, just without corners. */
export const BUBBLE_TAIL_ANCHORS: BubbleTailAnchor[] = [
  'n1', 'n2', 'n3', 'n4',
  'e1', 'e2', 'e3', 'e4',
  's1', 's2', 's3', 's4',
  'w1', 'w2', 'w3', 'w4',
]

/** Anchor offsets on a rect's 4 straight edges, in −1..1 units of half the
 *  box (0,0 = center): each edge quartered into 4 equal zones, a point at
 *  each zone's center (±0.75/±0.25), corners (±1 on both axes) never hit. */
export const BUBBLE_TAIL_UNITS: Record<BubbleTailAnchor, [number, number]> = {
  n1: [-0.75, -1], n2: [-0.25, -1], n3: [0.25, -1], n4: [0.75, -1],
  e1: [1, -0.75],  e2: [1, -0.25],  e3: [1, 0.25],  e4: [1, 0.75],
  s1: [0.75, 1],   s2: [0.25, 1],   s3: [-0.25, 1], s4: [-0.75, 1],
  w1: [-1, 0.75],  w2: [-1, 0.25],  w3: [-1, -0.25], w4: [-1, -0.75],
}

/** A bubble's corner radius (image px) — same formula the draw function
 *  uses. Tail anchors need this to stay off the rounded corners: a point
 *  computed from the box's flat rectangle geometry near a corner can land
 *  outside the *actual* (rounded) outline, leaving a visible gap between
 *  the tail's base and the body it's meant to touch. */
export function bubbleCornerRadius(fontSize: number, bw: number, bh: number): number {
  return Math.min(fontSize * 0.4, bw / 2, bh / 2)
}

/** Every tail anchor sits on exactly one edge (never a corner), so its
 *  outward direction is simply that edge's own normal. */
function tailAnchorOutwardDir(anchor: BubbleTailAnchor): { x: number; y: number } {
  switch (anchor[0]) {
    case 'n': return { x: 0, y: -1 }
    case 'e': return { x: 1, y: 0 }
    case 's': return { x: 0, y: 1 }
    default: return { x: -1, y: 0 } // 'w'
  }
}

/** Direction of travel along each edge as its own anchor slot 1→4 —
 *  i.e. the direction bubbleTailAnchorPoint's `t` increases in. */
function tailAnchorAlongDir(anchor: BubbleTailAnchor): { x: number; y: number } {
  switch (anchor[0]) {
    case 'n': return { x: 1, y: 0 }
    case 'e': return { x: 0, y: 1 }
    case 's': return { x: -1, y: 0 }
    default: return { x: 0, y: -1 } // 'w'
  }
}

/**
 * World-space position of one of a bubble body's 16 tail anchors — confined
 * to each edge's *straight* run (excluding the rounded corners at both
 * ends), so it always sits exactly on the rendered outline.
 */
function bubbleTailAnchorPoint(
  anchor: BubbleTailAnchor, bx: number, by: number, bw: number, bh: number, radius: number,
): { x: number; y: number } {
  const slot = Number(anchor[1]) - 1 // 0..3
  const t = (slot + 0.5) / 4 // center of that edge's quarter-zone, 0..1 along the straight run
  switch (anchor[0]) {
    case 'n': return { x: bx + radius + t * (bw - 2 * radius), y: by }
    case 's': return { x: bx + bw - radius - t * (bw - 2 * radius), y: by + bh }
    case 'e': return { x: bx + bw, y: by + radius + t * (bh - 2 * radius) }
    default:  return { x: bx, y: by + bh - radius - t * (bh - 2 * radius) } // 'w'
  }
}

/**
 * The 3 points (near base corner, apex, far base corner) of a bubble's
 * tail: the original hand-drawn-looking asymmetric shape — one base corner
 * sits exactly on `anchor`, the other extends `tailW` further along the
 * edge, and the apex leans slightly toward the *near* corner rather than
 * standing straight up. Which way "near" is flips at each edge's midpoint,
 * so the lean always points toward whichever corner the anchor is closer
 * to instead of leaning a fixed direction regardless of position.
 */
export function bubbleTailPoints(
  anchor: BubbleTailAnchor, bx: number, by: number, bw: number, bh: number, tailH: number, radius: number,
): { x: number; y: number }[] {
  const base = bubbleTailAnchorPoint(anchor, bx, by, bw, bh, radius)
  const out = tailAnchorOutwardDir(anchor)
  const along = tailAnchorAlongDir(anchor)
  const slot = Number(anchor[1]) - 1 // 0..3
  const t = (slot + 0.5) / 4 // must match bubbleTailAnchorPoint's own t
  const sign = t < 0.5 ? 1 : -1 // which half of the edge — flips the lean
  const tailW = tailH * 0.9
  const near = base
  const far = { x: base.x + sign * tailW * along.x, y: base.y + sign * tailW * along.y }
  const apex = {
    x: base.x - sign * 0.3 * tailW * along.x + out.x * tailH,
    y: base.y - sign * 0.3 * tailW * along.y + out.y * tailH,
  }
  return [near, apex, far]
}

/** How far a bubble's tail protrudes beyond its box on each side — grows the
 *  selection/hit-test/export bounds so the tail (which can now point any of
 *  16 ways, not just south) is never clipped. */
function bubbleTailProtrusion(anchor: BubbleTailAnchor, tailH: number): { left: number; right: number; top: number; bottom: number } {
  const dir = tailAnchorOutwardDir(anchor)
  return {
    left: dir.x < 0 ? -dir.x * tailH : 0,
    right: dir.x > 0 ? dir.x * tailH : 0,
    top: dir.y < 0 ? -dir.y * tailH : 0,
    bottom: dir.y > 0 ? dir.y * tailH : 0,
  }
}

/** World-space position of every one of a bubble's 16 tail anchors — for the
 *  tail-position picker UI and the tail-drag handle's nearest-anchor snap.
 *  Rotation included, so the drag snaps to where the anchors actually are. */
export function getBubbleTailAnchors(ann: TextAnn): { anchor: BubbleTailAnchor; x: number; y: number }[] {
  const body = getBubbleBodyBox(ann)
  if (!body) return []
  const radius = bubbleCornerRadius(ann.fontSize, body.w, body.h)
  const rot = ann.rotation ?? 0
  const pivot = rot ? annotationPivot(ann) : null
  return BUBBLE_TAIL_ANCHORS.map((anchor) => {
    const p = bubbleTailAnchorPoint(anchor, body.x, body.y, body.w, body.h, radius)
    return { anchor, ...(pivot ? rotatePoint(p.x, p.y, pivot.x, pivot.y, rot) : p) }
  })
}

/** Round shapes get their anchors on the ellipse itself, not on its box. */
function hasRoundOutline(target: ConnectableAnnotation): boolean {
  return target.type === 'ellipse' || (target.type === 'number' && target.shape === 'circle')
}

/**
 * The outline the anchors sit on. For most shapes it's just the local bounds.
 * Plain text (`shape: 'none'`) gets a small even margin so the 16 points ring
 * the glyphs instead of landing on the letters — its local box already hugs
 * the text tightly (and, since the draw centers the glyphs within it, evenly),
 * so a uniform pad keeps the ring balanced without ballooning.
 */
function getConnectBounds(target: ConnectableAnnotation): { x: number; y: number; w: number; h: number } {
  if (target.type === 'text' && target.shape === 'bubble') {
    // The body only — never the tail-inclusive selection bbox, so another
    // shape's arrow glues to the rounded box's actual edge no matter which
    // of the 16 ways this bubble's own tail happens to be pointing.
    return getBubbleBodyBox(target)!
  }
  const local = getAnnotationLocalBounds(target)!
  if (target.type !== 'text' || (target.shape && target.shape !== 'none')) return local
  const pad = Math.round(target.fontSize * 0.14)
  return { x: local.x - pad, y: local.y - pad, w: local.w + pad * 2, h: local.h + pad * 2 }
}

/** World-space position of one of `target`'s 16 fixed connection points.
 *  Internal: external callers go through `getConnectAnchors` / `resolveArrowConnections`. */
function getConnectAnchorPoint(target: ConnectableAnnotation, anchor: ConnectAnchor): { x: number; y: number } {
  const local = getConnectBounds(target)
  const cx = local.x + local.w / 2
  const cy = local.y + local.h / 2
  let u: number, v: number
  if (hasRoundOutline(target)) {
    const theta = (CONNECT_ANCHORS.indexOf(anchor) * Math.PI * 2) / CONNECT_ANCHORS.length
    u = Math.sin(theta); v = -Math.cos(theta)
  } else {
    ;[u, v] = RECT_ANCHOR_UNITS[anchor] ?? RECT_ANCHOR_UNITS.n
  }
  const px = cx + u * local.w / 2
  const py = cy + v * local.h / 2
  const rot = annotationRotation(target)
  if (!rot) return { x: px, y: py }
  // Spin around the shape's own pivot, not around `local`'s center: a bubble's
  // anchors sit on its body box (`getConnectBounds`) while it rotates about
  // its tail-inclusive bounds center, so the two centers don't coincide.
  const pivot = annotationPivot(target) ?? { x: cx, y: cy }
  return rotatePoint(px, py, pivot.x, pivot.y, rot)
}

/** All 16 connection points of `target`, in world space. */
export function getConnectAnchors(
  target: ConnectableAnnotation,
): { anchor: ConnectAnchor; x: number; y: number }[] {
  return CONNECT_ANCHORS.map((anchor) => ({ anchor, ...getConnectAnchorPoint(target, anchor) }))
}

/**
 * Recomputes every connected arrow's endpoint(s) from its target's current
 * geometry. Call after any store mutation that could move/resize/rotate a
 * connectable annotation (move, resize, rotate, crop) so glued arrows track
 * their targets the way Excel/PowerPoint connectors do. A target that no
 * longer exists (deleted) is left alone — the endpoint freezes at its last
 * resolved position instead of erroring.
 */
export function resolveArrowConnections(annotations: Annotation[]): Annotation[] {
  const byId = new Map(annotations.map((a) => [a.id, a]))
  let changed = false
  const next = annotations.map((a) => {
    if (a.type !== 'arrow' || (!a.startConnect && !a.endConnect)) return a
    const patch: Partial<ArrowAnn> = {}
    if (a.startConnect) {
      const target = byId.get(a.startConnect.targetId)
      if (target && isConnectable(target)) {
        const p = getConnectAnchorPoint(target, a.startConnect.anchor)
        if (p.x !== a.x1 || p.y !== a.y1) { patch.x1 = p.x; patch.y1 = p.y }
      }
    }
    if (a.endConnect) {
      const target = byId.get(a.endConnect.targetId)
      if (target && isConnectable(target)) {
        const p = getConnectAnchorPoint(target, a.endConnect.anchor)
        if (p.x !== a.x2 || p.y !== a.y2) { patch.x2 = p.x; patch.y2 = p.y }
      }
    }
    if (Object.keys(patch).length === 0) return a
    changed = true
    return { ...a, ...patch }
  })
  return changed ? next : annotations
}

/**
 * Un-glues any arrow whose connection target isn't in `annotations` anymore
 * (deleted, or cropped away) — the endpoint just freezes in place as a plain
 * coordinate instead of carrying a reference to a shape that no longer
 * exists. Call before/alongside removing annotations from the list.
 */
export function clearDanglingConnections(annotations: Annotation[]): Annotation[] {
  const ids = new Set(annotations.map((a) => a.id))
  return annotations.map((a) => {
    if (a.type !== 'arrow') return a
    const staleStart = a.startConnect && !ids.has(a.startConnect.targetId)
    const staleEnd = a.endConnect && !ids.has(a.endConnect.targetId)
    if (!staleStart && !staleEnd) return a
    return {
      ...a,
      startConnect: staleStart ? undefined : a.startConnect,
      endConnect: staleEnd ? undefined : a.endConnect,
    }
  })
}

/**
 * Rewrites arrow connection targetIds using `idMap` (old id -> new id) —
 * used when duplicating/pasting so a connector cloned together with its
 * target re-glues to the clone; a target not in `idMap` is left as-is (the
 * clone keeps pointing at the original, external shape).
 */
export function remapArrowConnections(annotations: Annotation[], idMap: Map<string, string>): Annotation[] {
  return annotations.map((a) => {
    if (a.type !== 'arrow' || (!a.startConnect && !a.endConnect)) return a
    const remap = (c?: ArrowConnection): ArrowConnection | undefined =>
      c && idMap.has(c.targetId) ? { ...c, targetId: idMap.get(c.targetId)! } : c
    const startConnect = remap(a.startConnect)
    const endConnect = remap(a.endConnect)
    if (startConnect === a.startConnect && endConnect === a.endConnect) return a
    return { ...a, startConnect, endConnect }
  })
}

let _measureCtx: CanvasRenderingContext2D | null = null
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (_measureCtx) return _measureCtx
  if (typeof document === 'undefined') return null
  _measureCtx = document.createElement('canvas').getContext('2d')
  return _measureCtx
}

/** Padding (image px) between the text and the box/bubble background edge. */
export function textPadding(fontSize: number): number {
  return Math.round(fontSize * 0.35)
}

/** Length (image px) of the speech-bubble tail, in the direction it points. */
export function bubbleTailHeight(fontSize: number): number {
  return Math.round(fontSize * 0.45)
}

/** White or near-black text color, whichever contrasts better against `hex`. */
export function contrastTextColor(hex: string): string {
  const c = hex.replace('#', '')
  if (c.length < 6) return '#FFFFFF'
  const r = parseInt(c.slice(0, 2), 16) / 255
  const g = parseInt(c.slice(2, 4), 16) / 255
  const b = parseInt(c.slice(4, 6), 16) / 255
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return lum > 0.6 ? '#0F1117' : '#FFFFFF'
}

/**
 * Resolves a box/bubble text annotation's effective background and font
 * colors, honoring each side's independent "auto" state: an absent
 * `textColor` auto-tracks `bg`'s contrast, and `bgAuto` tracks `textColor`'s
 * contrast the other way — but only once `textColor` is itself explicit, so
 * the two auto states can't chase each other when neither side has been
 * customized yet (a fresh annotation just keeps its created `color`, with
 * `textColor` auto-contrasting against *that*, same as before either side
 * existed).
 *
 * The Background/Text toggle (ToolOptionsPanel's Color block) is a single
 * palette with two roles, not two independently-remembered colors: picking
 * a color paints whichever side is currently active, and *switching* the
 * toggle carries that same color over to the other side (the one you're
 * leaving becomes the new explicit value; the one you're arriving at goes
 * back to auto-contrasting) — see `Editor.tsx`'s `handleBgAuto`/
 * `handleTextColorAuto`. `textColor` is always cleared the moment it's
 * inactive, so its mere presence is reliably "this document has an explicit
 * text color, honor it" — true for a toggle currently on Text, and equally
 * true for a document saved before this toggle existed, whose `textColor`
 * was set by the old, since-removed standalone text-color swatch.
 *
 * For a bordered fill (`'white'`/`'stroke'` — see `TextBgFill`), the auto
 * default instead *matches* the border (`bg`) rather than contrasting
 * against it: border + text in one accent color is the classic outlined-
 * caption look, and a contrast color would fight the border instead of
 * reading as one unit. `'solid'` (no border) keeps the original contrast
 * default, since there the text sits directly on the fill.
 */
export function resolveTextColors(
  ann: { color: string; textColor?: string; bgAuto?: boolean; bgFill?: TextBgFill },
): { bg: string; text: string } {
  const bg = ann.bgAuto && ann.textColor != null ? contrastTextColor(ann.textColor) : ann.color
  const bordered = ann.bgFill === 'white' || ann.bgFill === 'stroke'
  const text = ann.textColor ?? (bordered ? bg : contrastTextColor(bg))
  return { bg, text }
}

/**
 * Inverse of `measureTextBounds`'s height/position math: given a target
 * bounding box (from a resize-handle drag) and the annotation's current
 * line count/shape, solves for the fontSize and text origin that would
 * make `measureTextBounds` reproduce that box.
 *
 * Needed because `box`/`bubble` shapes add padding (and, for `bubble`, a
 * tail) around the text that scales with fontSize — `b.h` is not the text
 * block height alone. Naively dividing `b.h` by the line-height factor
 * (correct only for `shape: 'none'`) overshoots fontSize by however much
 * padding/tail is baked into `b.h`, which shows up as the box's size
 * visibly jumping the instant a box/bubble resize drag starts, before the
 * cursor has even moved.
 */
export function fontSizeAndOriginForBounds(
  shape: TextShape | undefined,
  lineCount: number,
  b: { x: number; y: number; h: number },
): { fontSize: number; x: number; y: number } {
  if (!shape || shape === 'none') {
    const fontSize = Math.max(8, Math.round(b.h / (1.25 * lineCount)))
    return { fontSize, x: b.x, y: b.y }
  }
  // Continuous approximation of textPadding/bubbleTailHeight (their Math.round
  // is sub-pixel noise at this scale) — h = fontSize * (1.25*lines + 2*0.35 + tailRatio).
  const tailRatio = shape === 'bubble' ? 0.45 : 0
  const fontSize = Math.max(8, Math.round(b.h / (1.25 * lineCount + 0.7 + tailRatio)))
  const pad = textPadding(fontSize)
  return { fontSize, x: b.x + pad, y: b.y + pad }
}

/**
 * A bubble's rounded-rect body box (pad-expanded text box), WITHOUT the
 * tail's protrusion — what the tail triangle is anchored to (`bubbleTailPoints`)
 * and what other shapes' arrows connect to (`getConnectBounds`), so both stay
 * fixed to the actual box regardless of which of the 16 ways the tail points.
 * `null` for non-bubble text (nothing to anchor a tail to).
 */
export function getBubbleBodyBox(ann: TextAnn): { x: number; y: number; w: number; h: number } | null {
  if (ann.shape !== 'bubble') return null
  const lines = ann.text.split('\n')
  const lineH = ann.fontSize * 1.25
  const textH = lineH * lines.length
  const ctx = getMeasureCtx()
  const textW = ctx
    ? (() => {
        ctx.font = `bold ${ann.fontSize}px "Inter", system-ui, sans-serif`
        return Math.max(...lines.map((l) => ctx.measureText(l).width))
      })()
    : Math.max(...lines.map((l) => l.length)) * ann.fontSize * 0.6
  const pad = textPadding(ann.fontSize)
  return { x: ann.x - pad, y: ann.y - pad, w: textW + pad * 2, h: textH + pad * 2 }
}

function measureTextBounds(ann: TextAnn): { x: number; y: number; w: number; h: number } {
  if (ann.shape === 'bubble') {
    const body = getBubbleBodyBox(ann)!
    const p = bubbleTailProtrusion(ann.tailAnchor ?? 's3', bubbleTailHeight(ann.fontSize))
    return { x: body.x - p.left, y: body.y - p.top, w: body.w + p.left + p.right, h: body.h + p.top + p.bottom }
  }

  const lines = ann.text.split('\n')
  const lineH = ann.fontSize * 1.25
  const textH = lineH * lines.length
  const ctx = getMeasureCtx()
  const textW = ctx
    ? (() => {
        ctx.font = `bold ${ann.fontSize}px "Inter", system-ui, sans-serif`
        return Math.max(...lines.map((l) => ctx.measureText(l).width))
      })()
    : Math.max(...lines.map((l) => l.length)) * ann.fontSize * 0.6

  if (ann.shape === 'box') {
    const pad = textPadding(ann.fontSize)
    return { x: ann.x - pad, y: ann.y - pad, w: textW + pad * 2, h: textH + pad * 2 }
  }
  return { x: ann.x, y: ann.y, w: textW, h: textH }
}

/** Returns true if point (px, py) hits the annotation (image-pixel space). */
export function hitTest(ann: Annotation, px: number, py: number): boolean {
  const pad = Math.max(8, ann.sw * 2)
  if (ann.type === 'pen') {
    // A bbox test is too permissive for a squiggly stroke (clicking in the
    // empty middle of a "U" shape would falsely hit) — check actual segments.
    // The points are stored unrotated, so a rotated stroke is tested by
    // spinning the cursor back into the stroke's own frame rather than
    // rotating every segment.
    const { points } = ann
    let qx = px
    let qy = py
    const rot = ann.rotation ?? 0
    if (rot) {
      const pivot = annotationPivot(ann)
      if (pivot) {
        const q = rotatePoint(px, py, pivot.x, pivot.y, -rot)
        qx = q.x; qy = q.y
      }
    }
    for (let i = 1; i < points.length; i++) {
      if (distToSegment(qx, qy, points[i - 1].x, points[i - 1].y, points[i].x, points[i].y) <= pad) return true
    }
    return false
  }
  const b = getAnnotationBounds(ann)
  if (!b) return false
  return (
    px >= b.x - pad && px <= b.x + b.w + pad &&
    py >= b.y - pad && py <= b.y + b.h + pad
  )
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const lenSq = dx * dx + dy * dy
  let t = lenSq > 0 ? ((px - x1) * dx + (py - y1) * dy) / lenSq : 0
  t = Math.max(0, Math.min(1, t))
  const cx = x1 + t * dx
  const cy = y1 + t * dy
  return Math.hypot(px - cx, py - cy)
}
