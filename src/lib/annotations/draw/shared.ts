// Helpers shared by more than one of the per-type draw functions.

import type { ArrowHead } from '../types'

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
export function paintShadowOutsideOnly(
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
export function leadingAngle(points: { x: number; y: number }[]): number {
  const start = points[0]
  for (let i = 1; i < points.length; i++) {
    const p = points[i]
    if (Math.hypot(p.x - start.x, p.y - start.y) > 0.01) return Math.atan2(p.y - start.y, p.x - start.x)
  }
  return 0
}

/** Direction (radians) of the last non-zero-length hop arriving at the final point. */
export function trailingAngle(points: { x: number; y: number }[]): number {
  const end = points[points.length - 1]
  for (let i = points.length - 2; i >= 0; i--) {
    const p = points[i]
    if (Math.hypot(end.x - p.x, end.y - p.y) > 0.01) return Math.atan2(end.y - p.y, end.x - p.x)
  }
  return 0
}

/** Begins a path outlining a box — the rect itself, or (matching
 *  SpotlightAnn's 'circle' shape) the ellipse inscribed in it. */
export function pathBoxOutline(ctx: CanvasRenderingContext2D, box: { x: number; y: number; w: number; h: number }, isCircle: boolean) {
  ctx.beginPath()
  if (isCircle) {
    ctx.ellipse(box.x + box.w / 2, box.y + box.h / 2, box.w / 2, box.h / 2, 0, 0, Math.PI * 2)
  } else {
    ctx.rect(box.x, box.y, box.w, box.h)
  }
}

/** Draws one arrow head shape at (tipX, tipY), pointing along `angle`. */
export function drawArrowHead(
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
