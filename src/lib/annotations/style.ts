// Shadow / glow and dash: how an annotation's ink is styled before it is
// painted. See `AnnotationBase`'s shadow fields for what each one means.

import type { Annotation } from './types'

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
export function applyShadowOrGlow(
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
