// "Beautiful screenshot" frame: rounded corners on the exported PNG.

export interface FrameConfig {
  radius: number  // image px corner radius (0 = square)
}

export const DEFAULT_FRAME: FrameConfig = {
  radius: 0,
}

/** Draws the screenshot at [x,y,w,h] with optional rounded corners. */
export function drawFramedImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number, y: number, w: number, h: number,
  radius: number,
) {
  if (radius <= 0) {
    ctx.drawImage(img, x, y, w, h)
    return
  }
  const r = Math.min(radius, Math.min(w, h) / 2)
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.clip()
  ctx.drawImage(img, x, y, w, h)
  ctx.restore()
}
