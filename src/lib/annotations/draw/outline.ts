// The `'outline'` shadow style: a band of even thickness traced around the
// shape's silhouette, painted solid and crisp under the shape.
//
// A canvas shadow can't draw this. `shadowBlur` spreads a shape's edge into
// a gradient, never a solid band, and there is no dilate in Canvas2D. So the
// shape is rendered alone into an offscreen canvas and grown by stamping that
// canvas at offsets around a circle: the union of a shape shifted to every
// point of a circle of radius ρ is the shape grown by ρ *only along that
// ring*, but doing it twice fills the ring in — the Minkowski sum of two
// circles of radius ρ is the whole disk of radius 2ρ. Two passes of ~N
// stamps each, instead of one pass per ring of a filled disk.

import { getAnnotationBounds, getAnnotationLocalBounds } from '../geometry'
import { resolveOutline } from '../style'
import type { Annotation } from '../types'
import type { DrawEnv } from './env'

/** Longest side, in device px, the offscreen buffers may reach. Past it the
 *  outline is built at a lower resolution rather than allocating a buffer
 *  the size of a poster — it is scaled up onto the canvas instead. */
const MAX_BUFFER_PX = 4096

interface Built {
  scale: number
  canvas: HTMLCanvasElement
  x: number
  y: number
  w: number
  h: number
}

/** Built outlines by annotation object. An edit replaces the object (see
 *  "Frontend tests" in CLAUDE.md — the store never mutates an annotation in
 *  place), so the object itself is a complete cache key apart from the
 *  resolution it was built at; redraws that change nothing about the shape
 *  (hover, selection, another annotation being dragged) reuse it. */
const cache = new WeakMap<Annotation, Built>()

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  return ctx ? { canvas, ctx } : null
}

/** `src` unioned with itself shifted to every point of a circle of `radius`. */
function stampRing(src: HTMLCanvasElement, dst: CanvasRenderingContext2D, radius: number): void {
  dst.drawImage(src, 0, 0)
  // Neighbouring stamps no more than ~1.5px apart, so the ring has no gaps
  // the second pass would leave as notches.
  const n = Math.min(96, Math.max(8, Math.ceil((2 * Math.PI * radius) / 1.5)))
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI
    dst.drawImage(src, Math.cos(a) * radius, Math.sin(a) * radius)
  }
}

function build(ann: Annotation, plain: Annotation, img: HTMLImageElement | null | undefined, scale: number, drawInner: DrawEnv['drawInner']): Built | null {
  const bounds = getAnnotationBounds(ann)
  if (!bounds) return null
  const { width, color } = resolveOutline(ann, getAnnotationLocalBounds(ann))
  const pad = width + 2
  const x = bounds.x - pad
  const y = bounds.y - pad
  const w = bounds.w + pad * 2
  const h = bounds.h + pad * 2
  const k = Math.min(scale, MAX_BUFFER_PX / Math.max(w, h, 1))
  const pw = Math.ceil(w * k)
  const ph = Math.ceil(h * k)
  if (pw <= 0 || ph <= 0) return null

  const sil = makeCanvas(pw, ph)
  if (!sil) return null
  sil.ctx.setTransform(k, 0, 0, k, -x * k, -y * k)
  // Fully opaque: the band is solid, and a translucent silhouette (the
  // ink's own Opacity) would compound over every stamp — that opacity is
  // applied once, when the band is drawn onto the canvas.
  drawInner(sil.ctx, { ...plain, opacity: 1 }, img, k)

  let band = sil.canvas
  const r = width * k
  if (r >= 0.5) {
    const a = makeCanvas(pw, ph)
    const b = makeCanvas(pw, ph)
    if (!a || !b) return null
    stampRing(sil.canvas, a.ctx, r / 2)
    stampRing(a.canvas, b.ctx, r / 2)
    band = b.canvas
  }
  const bctx = band.getContext('2d')
  if (!bctx) return null
  bctx.setTransform(1, 0, 0, 1, 0, 0)
  bctx.globalCompositeOperation = 'source-in'
  bctx.fillStyle = color
  bctx.fillRect(0, 0, pw, ph)
  return { scale, canvas: band, x, y, w: pw / k, h: ph / k }
}

/**
 * Paints `ann`'s outline onto `ctx` (already in image coordinates). `plain`
 * is `ann` with its shadow style cleared — what the silhouette is rendered
 * from, and what the caller draws on top afterwards. Does nothing where no
 * DOM canvas exists (tests), or when the outline has no extent.
 */
export function drawOutline(
  ctx: CanvasRenderingContext2D,
  ann: Annotation,
  plain: Annotation,
  img: HTMLImageElement | null | undefined,
  drawInner: DrawEnv['drawInner'],
): void {
  if (typeof document === 'undefined') return
  if (resolveOutline(ann, null).width <= 0) return
  // Built at the device resolution the canvas is drawn at, so the band stays
  // crisp when the editor zooms in rather than being a stretched 1x bitmap.
  const m = ctx.getTransform()
  const scale = Math.hypot(m.a, m.b) || 1
  let built = cache.get(ann)
  if (!built || built.scale !== scale) {
    built = build(ann, plain, img, scale, drawInner) ?? undefined
    if (!built) return
    // A pasted picture draws a placeholder until it has decoded (see
    // `getEmbeddedImage`) — caching that would outline the placeholder for
    // good, so a picture's outline is rebuilt on every draw.
    if (ann.type !== 'image') cache.set(ann, built)
  }
  ctx.save()
  ctx.globalAlpha = ann.opacity ?? 1
  ctx.drawImage(built.canvas, built.x, built.y, built.w, built.h)
  ctx.restore()
}
