// The outline shapes and the numbered marker — a box (or a circle inscribed
// in one) that can be stroked, filled, or both.

import { dashArray, getShadowStyle } from '../style'
import { contrastTextColor } from '../text'
import type { EllipseAnn, NumberAnn, RectAnn } from '../types'
import { paintShadowOutsideOnly } from './shared'
import type { DrawEnv } from './env'

export function drawRect(ctx: CanvasRenderingContext2D, ann: RectAnn, env: DrawEnv): void {
  const { opacity } = env
  const { x, y, w, h, fill } = ann
  if (Math.abs(w) < 1 || Math.abs(h) < 1) return
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
  return
}

export function drawEllipse(ctx: CanvasRenderingContext2D, ann: EllipseAnn, env: DrawEnv): void {
  const { opacity } = env
  const { cx, cy, rx, ry, fill } = ann
  if (Math.abs(rx) < 1 || Math.abs(ry) < 1) return
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
  return
}

export function drawNumber(ctx: CanvasRenderingContext2D, ann: NumberAnn, _env: DrawEnv): void {
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
  return
}
