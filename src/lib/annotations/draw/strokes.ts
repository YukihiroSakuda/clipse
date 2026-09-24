// The stroke tools: shapes made of a path rather than a box.

import { annotationPivot, getAnnotationBounds, getElbowSegments } from '../geometry'
import { dashArray, getShadowStyle } from '../style'
import type { ArrowAnn, HighlightAnn, LineAnn, PenAnn } from '../types'
import { drawArrowHead, leadingAngle, trailingAngle } from './shared'
import type { DrawEnv } from './env'

export function drawArrow(ctx: CanvasRenderingContext2D, ann: ArrowAnn, env: DrawEnv): void {
  const { img, drawInner } = env
  const { x1, y1, x2, y2, head, sw, doubleEnded } = ann
  if (Math.hypot(x2 - x1, y2 - y1) < 2) return

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
  // (recursing into drawInner with shadowStyle forced to
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
          drawInner(sctx, { ...ann, shadowStyle: 'none' }, img, 1)
          ctx.drawImage(silhouette, bounds.x - pad, bounds.y - pad)
          ctx.shadowColor = 'transparent'
          return
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
  return
}

export function drawLine(ctx: CanvasRenderingContext2D, ann: LineAnn, _env: DrawEnv): void {
  const { x1, y1, x2, y2 } = ann
  if (Math.hypot(x2 - x1, y2 - y1) < 2) return
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.setLineDash(dashArray(ann.dash, ann.sw))
  ctx.stroke()
  return
}

export function drawPen(ctx: CanvasRenderingContext2D, ann: PenAnn, _env: DrawEnv): void {
  const { points } = ann
  if (points.length < 2) return
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
  return
}

export function drawHighlight(ctx: CanvasRenderingContext2D, ann: HighlightAnn, env: DrawEnv): void {
  const { opacity } = env
  const { x1, y1, x2, y2, sw } = ann
  if (Math.hypot(x2 - x1, y2 - y1) < 2) return
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
  return
}
