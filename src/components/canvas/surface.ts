// The canvas surfaces themselves: the transparency checkerboard and the
// offscreen buffer annotations are composited through, plus the crop
// overlay's own state shape.



export const MIN_CROP = 20

// The canvas element is painted with this behind the image on every redraw
// (see `redraw`), not just left transparent for CSS to show through — a
// `destination-out` erase (see `EraseAnn`) or a source PNG with its own
// alpha needs *something* under it, and a flat fill would silently hide
// those holes. A checker built once and cached as a `CanvasPattern` costs
// one `fillRect` per frame either way, unlike redrawing individual squares.
export let checkerPattern: CanvasPattern | null = null

export function getCheckerPattern(ctx: CanvasRenderingContext2D): CanvasPattern {
  if (checkerPattern) return checkerPattern
  const cell = 16
  const tile = document.createElement('canvas')
  tile.width = cell * 2
  tile.height = cell * 2
  const tctx = tile.getContext('2d')!
  tctx.fillStyle = '#1E1E1E'
  tctx.fillRect(0, 0, cell * 2, cell * 2)
  tctx.fillStyle = '#2A2A2A'
  tctx.fillRect(0, 0, cell, cell)
  tctx.fillRect(cell, cell, cell, cell)
  checkerPattern = ctx.createPattern(tile, 'repeat')!
  return checkerPattern
}

// Image + annotations are painted here first, then composited onto the
// checkered main canvas — see the call site in `redraw` for why: an
// `erase` annotation's `destination-out` hole has to reveal the checker
// underneath, and painting straight onto the already-checkered canvas
// would punch through the checker fill itself (same raster, same hole).
// Cached/resized in place rather than allocated fresh every frame.
export let offscreen: HTMLCanvasElement | null = null

export function getOffscreenCanvas(w: number, h: number): HTMLCanvasElement {
  if (!offscreen) offscreen = document.createElement('canvas')
  if (offscreen.width !== w) offscreen.width = w
  if (offscreen.height !== h) offscreen.height = h
  return offscreen
}
