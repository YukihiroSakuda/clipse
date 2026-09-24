// The magic wand's pixel work: the flood fill that turns a click into a mask,
// and the contour trace that turns that mask back into an outline to draw.

import { getEmbeddedImage } from './images'

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
