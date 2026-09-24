// The two annotations that carry their own pixels inline, as `data:` URLs: a
// pasted picture and the magic wand's mask. Both decode asynchronously while
// drawing is synchronous — see `getEmbeddedImage`.

import { getEmbeddedImage } from '../images'
import { getShadowStyle } from '../style'
import type { EraseAnn, ImageAnn } from '../types'
import { paintShadowOutsideOnly } from './shared'
import type { DrawEnv } from './env'

export function drawPicture(ctx: CanvasRenderingContext2D, ann: ImageAnn, env: DrawEnv): void {
  const { opacity } = env
  const { x, y, w, h } = ann
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
  return
}

export function drawErase(ctx: CanvasRenderingContext2D, ann: EraseAnn, env: DrawEnv): void {
  const { opacity, img } = env
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
  if (w < 1 || h < 1) return
  const maskImg = getEmbeddedImage(ann.mask)
  if (!maskImg) return
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
    return
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
  if (!octx) return
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
  return
}
