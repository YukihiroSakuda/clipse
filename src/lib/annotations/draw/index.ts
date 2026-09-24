// The renderer. `drawAnnotation` is the single entry point for every
// annotation type; it expects the context already transformed to image
// coordinates.
//
// This file holds only what is common to every type — the context state and
// shadow the cases below rely on having been set — and then dispatches. Each
// type's own drawing lives in a sibling module, which never imports this one
// back (see `DrawEnv.drawInner`).

import { applyShadowOrGlow } from '../style'
import { SHADOW_CAPABLE } from '../types'
import type { Annotation } from '../types'
import type { DrawEnv } from './env'
import { drawArrow, drawLine, drawPen, drawHighlight } from './strokes'
import { drawRect, drawEllipse, drawNumber } from './shapes'
import { drawText } from './text'
import { drawBlur, drawSpotlight, drawMagnifier } from './effects'
import { drawPicture, drawErase } from './pixels'

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

  const env: DrawEnv = { opacity, img, viewScale, drawInner: drawAnnotationInner }
  switch (ann.type) {
    case 'arrow': return drawArrow(ctx, ann, env)
    case 'line': return drawLine(ctx, ann, env)
    case 'pen': return drawPen(ctx, ann, env)
    case 'rect': return drawRect(ctx, ann, env)
    case 'ellipse': return drawEllipse(ctx, ann, env)
    case 'text': return drawText(ctx, ann, env)
    case 'number': return drawNumber(ctx, ann, env)
    case 'blur': return drawBlur(ctx, ann, env)
    case 'highlight': return drawHighlight(ctx, ann, env)
    case 'spotlight': return drawSpotlight(ctx, ann, env)
    case 'image': return drawPicture(ctx, ann, env)
    case 'erase': return drawErase(ctx, ann, env)
    case 'magnifier': return drawMagnifier(ctx, ann, env)
  }
}
