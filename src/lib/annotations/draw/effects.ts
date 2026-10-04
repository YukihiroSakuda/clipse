// The tools that resample or dim the image underneath rather than painting ink
// of their own — which is also why none of them is `SHADOW_CAPABLE`.

import { getMagnifierBoxes, magnifierLeaderPoints } from '../geometry'
import { blurStrengthPct } from '../types'
import type { BlurAnn, MagnifierAnn, SpotlightAnn } from '../types'
import { pathBoxOutline } from './shared'
import type { DrawEnv } from './env'

export function drawBlur(ctx: CanvasRenderingContext2D, ann: BlurAnn, env: DrawEnv): void {
  const { img } = env
  // Blurs the underlying image rather than painting ink — the shared
  // palette opacity doesn't apply here.
  ctx.globalAlpha = 1
  const { x, y, w, h } = ann
  if (Math.abs(w) < 4 || Math.abs(h) < 4) return
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
  return
}

export function drawSpotlight(ctx: CanvasRenderingContext2D, ann: SpotlightAnn, env: DrawEnv): void {
  const { img } = env
  // Dims everything outside the lit region, leaving the image underneath
  // untouched inside it. The dim strength is its own field, independent
  // of the shared palette opacity.
  ctx.globalAlpha = 1
  const { x, y, w, h } = ann
  if (Math.abs(w) < 4 || Math.abs(h) < 4) return
  const W = img?.naturalWidth ?? 0
  const H = img?.naturalHeight ?? 0
  if (W === 0 || H === 0) return
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
  return
}

export function drawMagnifier(ctx: CanvasRenderingContext2D, ann: MagnifierAnn, env: DrawEnv): void {
  const { img, opacity } = env
  const { source: src, target: tgt } = getMagnifierBoxes(ann)
  if (src.w < 4 || src.h < 4 || tgt.w < 4 || tgt.h < 4 || !img) return
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
  return
}
