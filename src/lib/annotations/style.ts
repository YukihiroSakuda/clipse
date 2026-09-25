// Shadow / glow and dash: how an annotation's ink is styled before it is
// painted. See `AnnotationBase`'s shadow fields for what each one means.

import type { Annotation } from './types'

/** `SHADOW_CAPABLE` types with no filled body of their own — just a stroke.
 *  Their drop distance and glow radius scale with `sw` rather than with
 *  their box (see `dropMaxDistance`/`glowMaxBlur`): a filled rect/ellipse/
 *  text has a body a shadow can visually "reach" from even cast far away,
 *  but a thin arrow/line/pen stroke has nothing but the line itself, and
 *  its length says nothing about how heavy it looks — a long line's box is
 *  huge while the line stays thin, so a box-sized shadow would read as a
 *  second, detached line floating nearby rather than that line's shadow. */
const LINE_ONLY_TYPES = new Set<Annotation['type']>(['arrow', 'line', 'pen'])

/** Glow blur radius (image px) at Blur 100 — never less than this, however
 *  small the shape, and never more than the cap, however large. The floor is
 *  the flat radius every glow used to get; the cap only bounds how much work
 *  a single canvas shadow can cost on a huge shape. */
const GLOW_BLUR_MIN = 25
const GLOW_BLUR_MAX = 300

/** Drop-shadow offset (image px) at Size 100, bounded the same way. The
 *  floor is the flat distance every filled shape used to get. */
const DROP_DISTANCE_MIN = 30
const DROP_DISTANCE_MAX = 150

/**
 * How big a filled shape reads, for sizing its shadow: the geometric mean of
 * its box. A flat maximum made a shadow shrink relative to the shape as the
 * shape grew — the same slider value that gave a small box a soft glow or a
 * lifted drop shadow read as a thin rim or a barely-offset copy on a large
 * one. The mean rather than the short side, so a long, thin banner still
 * gets a shadow that reads as part of it, and rather than the long side, so
 * that shadow doesn't swamp it. `extent` is the shape's box in image pixels
 * (its unrotated local bounds); `null` reads as zero, i.e. the floor.
 */
function shapeReach(extent: { w: number; h: number } | null): number {
  return extent ? Math.sqrt(Math.max(0, extent.w) * Math.max(0, extent.h)) : 0
}

/** The glow blur radius Blur 100 reaches for `ann` — see `shapeReach`. */
export function glowMaxBlur(ann: Annotation, extent: { w: number; h: number } | null): number {
  const reach = LINE_ONLY_TYPES.has(ann.type) ? ann.sw * 6 : shapeReach(extent) * 0.3
  return Math.min(GLOW_BLUR_MAX, Math.max(GLOW_BLUR_MIN, reach))
}

/** The drop-shadow offset Size 100 reaches for `ann` — see `shapeReach`.
 *  A bare stroke gets roughly 3x its own width, floored at 6px so a
 *  hairline still has *some* range to drag Size across. */
export function dropMaxDistance(ann: Annotation, extent: { w: number; h: number } | null): number {
  if (LINE_ONLY_TYPES.has(ann.type)) return Math.min(DROP_DISTANCE_MAX, Math.max(6, ann.sw * 3))
  return Math.min(DROP_DISTANCE_MAX, Math.max(DROP_DISTANCE_MIN, shapeReach(extent) * 0.15))
}

/** Outline thickness (image px) at Size 100, bounded the same way. */
const OUTLINE_WIDTH_MIN = 12
const OUTLINE_WIDTH_MAX = 60

/** The outline thickness Size 100 reaches for `ann` — see `shapeReach`.
 *  A bare stroke gets twice its own width, floored at 6px. */
export function outlineMaxWidth(ann: Annotation, extent: { w: number; h: number } | null): number {
  if (LINE_ONLY_TYPES.has(ann.type)) return Math.min(OUTLINE_WIDTH_MAX, Math.max(6, ann.sw * 2))
  return Math.min(OUTLINE_WIDTH_MAX, Math.max(OUTLINE_WIDTH_MIN, shapeReach(extent) * 0.08))
}

/**
 * Resolves `ann`'s `'outline'` style into concrete values: a solid, crisp
 * band `width` image px thick traced around the shape's silhouette (Size),
 * in `color`. Blur and Opacity don't apply — a soft or faded band is what
 * `'glow'` already is, and the outline is kept distinct from it by being
 * neither; a stored `shadowBlur`/`shadowOpacity` left over from switching
 * styles is ignored rather than cleared. An unset color is white — the
 * sticker-style cutout border that lifts a shape off a busy screenshot,
 * which is what an outline is for; the ink's own color would merge with it.
 */
export function resolveOutline(
  ann: Annotation, extent: { w: number; h: number } | null,
): { width: number; color: string } {
  const width = (Math.max(0, Math.min(100, getShadowSize(ann))) / 100) * outlineMaxWidth(ann, extent)
  return { width, color: ann.shadowColor ?? '#FFFFFF' }
}

/** `ann`'s effective shadow/glow style — see `AnnotationBase.shadowStyle`. */
export function getShadowStyle(ann: Annotation): 'none' | 'drop' | 'glow' | 'outline' {
  return ann.shadowStyle ?? (ann.type === 'text' ? 'drop' : 'none')
}

/** `ann`'s effective drop-shadow angle — see `AnnotationBase.shadowAngle`. */
export function getShadowAngle(ann: Annotation): number {
  return ann.shadowAngle ?? 135
}

/** `ann`'s effective drop-shadow size (offset distance) — see `AnnotationBase.shadowSize`.
 *  Default is deliberately small (a ~3px cast at the 0-30px scale a
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
export function dashArray(dash: 'solid' | 'dashed' | 'dotted' | undefined, sw: number): number[] {
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
 * `maxDistance` is the image-pixel offset `size` 100 reaches and
 * `maxGlowBlur` the glow's blur radius at Blur 100 — both sized to the shape
 * by `applyShadowOrGlow` (`dropMaxDistance`, `glowMaxBlur`), so this only
 * takes the final numbers, not the shape behind them.
 */
export function resolveShadow(
  style: 'drop' | 'glow', size: number, blur: number, angle: number, opacity: number, shadowColor: string | undefined, inkColor: string, maxDistance = DROP_DISTANCE_MIN, maxGlowBlur = GLOW_BLUR_MIN,
): { color: string; blur: number; offsetX: number; offsetY: number } {
  const blurPx = (Math.max(0, Math.min(100, blur)) / 100) * (style === 'drop' ? 20 : maxGlowBlur)
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
 * `extent` is the painted shape's box, which sizes both a glow's radius
 * (`glowMaxBlur`) and a drop shadow's reach (`dropMaxDistance`).
 */
export function applyShadowOrGlow(
  ctx: CanvasRenderingContext2D,
  ann: Annotation,
  viewScale: number,
  inkColor: string,
  extent: { w: number; h: number } | null = null,
): void {
  const style = getShadowStyle(ann)
  // `'outline'` isn't a canvas shadow at all — `drawOutline` paints it.
  if (style !== 'drop' && style !== 'glow') return
  const { color, blur, offsetX, offsetY } = resolveShadow(
    style, getShadowSize(ann), getShadowBlur(ann), getShadowAngle(ann), getShadowOpacity(ann), ann.shadowColor, inkColor,
    style === 'drop' ? dropMaxDistance(ann, extent) : DROP_DISTANCE_MIN,
    style === 'glow' ? glowMaxBlur(ann, extent) : GLOW_BLUR_MIN,
  )
  ctx.shadowColor = color
  ctx.shadowBlur = blur * viewScale
  ctx.shadowOffsetX = offsetX * viewScale
  ctx.shadowOffsetY = offsetY * viewScale
}
