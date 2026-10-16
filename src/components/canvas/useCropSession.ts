import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getEmbeddedImage, rotatePoint } from '../../lib/annotations'
import { clamp } from './geometry'
import { HANDLE_SIZE, applyHandleResize, boxHandlePositions, findHandleHit } from './handles'
import type { CropDragState, CropRect, HandleId, HandlePos } from './handles'

/** Smallest crop rectangle a drag can produce, in image pixels — below this a
 *  draw is treated as a stray click and discarded. */
export const MIN_CROP = 20

/** A pasted picture being cropped in place of the base image. Its crop
 *  rectangle lives in the picture's own unrotated box (origin top-left, size
 *  `w`×`h` in image pixels), so a rotated picture is cropped along its own
 *  axes rather than the canvas's. */
export interface CropPicture {
  id: string
  x: number; y: number
  w: number; h: number
  rotation: number
  src: string
}

/** What cropping a picture changes: the new box, and the pixels cut to it. */
export interface PictureCrop {
  x: number; y: number
  w: number; h: number
  src: string
}

/** The picture's new box once `(rx, ry, rw, rh)` — given in its own unrotated
 *  frame — is all that is kept. The new center is the old one moved by the
 *  offset between the two centers, turned by the picture's rotation because
 *  that offset was measured along its axes; a picture cropped at 90° must
 *  shrink toward the side it was cropped from, not toward the canvas's. */
export function pictureCropBox(
  pic: Pick<CropPicture, 'x' | 'y' | 'w' | 'h' | 'rotation'>,
  rx: number, ry: number, rw: number, rh: number,
): { x: number; y: number; w: number; h: number } {
  const d = rotatePoint(rx + rw / 2 - pic.w / 2, ry + rh / 2 - pic.h / 2, 0, 0, pic.rotation)
  const cx = pic.x + pic.w / 2 + d.x
  const cy = pic.y + pic.h / 2 + d.y
  return { x: cx - rw / 2, y: cy - rh / 2, w: rw, h: rh }
}

export interface CropSessionOptions {
  /** True while the Crop tool owns the canvas. Everything here is inert
   *  otherwise, and leaving the tool clears the pending rectangle. */
  active: boolean
  imageWidth: number
  imageHeight: number
  /** The loaded base image the applied crop is cut from. */
  imgRef: React.RefObject<HTMLImageElement | null>
  /** Shared with the annotation handles, so both can only light up one at a
   *  time — the crop overlay and a selection are never both on screen. */
  setActiveHandle: (h: HandleId | null) => void
  onApplyCrop: (dataUrl: string, width: number, height: number, dx: number, dy: number) => void
  /** Set while the tool was entered with a pasted picture selected: the crop
   *  then applies to that picture alone and leaves the base image be. */
  picture: CropPicture | null
  onApplyPictureCrop: (id: string, crop: PictureCrop) => void
  onCropDone: () => void
}

/**
 * The Crop tool's own state machine: a pending rectangle, the drag that draws,
 * moves or resizes it, and the Enter/Escape that commits or discards it.
 *
 * It is a hook rather than a branch of the canvas's own mouse handlers because
 * none of its state is shared with them — nothing outside crop reads
 * `cropRect`, and nothing inside crop touches the selection, the undo stack or
 * the annotation list. The canvas keeps only the two lines that route a crop
 * event here and the overlay it paints.
 */
export function useCropSession(opts: CropSessionOptions) {
  const { active, imgRef, setActiveHandle, onApplyCrop, picture, onApplyPictureCrop, onCropDone } = opts
  // The box the rectangle lives in: the picture's own, or the base image.
  const imageWidth = picture ? picture.w : opts.imageWidth
  const imageHeight = picture ? picture.h : opts.imageHeight
  const pictureRef = useRef(picture)
  pictureRef.current = picture

  /** Canvas image-space point -> the crop box's coordinates. Identity for the
   *  base image; for a picture, undoes its rotation about its center. */
  const toBox = useCallback((imgX: number, imgY: number) => {
    const pic = pictureRef.current
    if (!pic) return { x: imgX, y: imgY }
    const q = rotatePoint(imgX, imgY, pic.x + pic.w / 2, pic.y + pic.h / 2, -pic.rotation)
    return { x: q.x - pic.x, y: q.y - pic.y }
  }, [])

  const [rect, setRect] = useState<CropRect | null>(null)
  /** Cursor is inside the rect (so it can be dragged) — drives the cursor. */
  const [hovered, setHovered] = useState(false)
  const dragRef = useRef<CropDragState | null>(null)
  const handlePosRef = useRef<HandlePos[]>([])
  // Mirrors `rect` for the key handler below, which must not re-subscribe on
  // every drag-move frame.
  const rectRef = useRef<CropRect | null>(null)
  rectRef.current = rect

  /** Discards the pending rectangle — called on a tool switch and on cancel. */
  const reset = useCallback(() => {
    dragRef.current = null
    setRect(null)
    setHovered(false)
  }, [])

  const applyToPicture = useCallback(() => {
    const pic = pictureRef.current
    const r = rectRef.current
    if (!pic || !r) return
    const bitmap = getEmbeddedImage(pic.src)
    if (!bitmap) return  // still decoding — the pending rectangle stays put
    const rx = Math.round(r.x)
    const ry = Math.round(r.y)
    const rw = Math.round(r.w)
    const rh = Math.round(r.h)
    if (rw < 1 || rh < 1) return
    // The picture may be shown at another size than its pixels: cut the source
    // at its own resolution, so a crop never softens what is left.
    const kx = bitmap.naturalWidth / pic.w
    const ky = bitmap.naturalHeight / pic.h
    const off = document.createElement('canvas')
    off.width = Math.max(1, Math.round(rw * kx))
    off.height = Math.max(1, Math.round(rh * ky))
    off.getContext('2d')!.drawImage(
      bitmap, rx * kx, ry * ky, rw * kx, rh * ky, 0, 0, off.width, off.height,
    )
    setRect(null)
    onApplyPictureCrop(pic.id, {
      ...pictureCropBox(pic, rx, ry, rw, rh), src: off.toDataURL('image/png'),
    })
    onCropDone()
  }, [onApplyPictureCrop, onCropDone])

  const apply = useCallback(() => {
    if (pictureRef.current) { applyToPicture(); return }
    const img = imgRef.current
    const r = rectRef.current
    if (!r || !img) return
    const x = Math.round(r.x)
    const y = Math.round(r.y)
    const w = Math.round(r.w)
    const h = Math.round(r.h)
    if (w < 1 || h < 1) return
    const off = document.createElement('canvas')
    off.width = w
    off.height = h
    const c = off.getContext('2d')!
    c.drawImage(img, x, y, w, h, 0, 0, w, h)
    const dataUrl = off.toDataURL('image/png')
    setRect(null)
    onApplyCrop(dataUrl, w, h, -x, -y)
    onCropDone()
  }, [imgRef, onApplyCrop, onCropDone, applyToPicture])

  const cancel = useCallback(() => {
    setRect(null)
    onCropDone()
  }, [onCropDone])

  // Enter applies the pending crop, Escape cancels it. Reads `rectRef`
  // (rather than depending on `rect`) so this doesn't tear down and
  // re-subscribe the listener on every drag-move frame while sizing the rect.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (!rectRef.current) return
      if (e.key === 'Enter') { e.preventDefault(); apply() }
      if (e.key === 'Escape') { e.preventDefault(); cancel() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, apply, cancel])

  const onMouseDown = useCallback((canvasX: number, canvasY: number, cssX: number, cssY: number) => {
    const { x: imgX, y: imgY } = toBox(canvasX, canvasY)
    const r = rectRef.current
    if (r) {
      const hit = findHandleHit(cssX, cssY, handlePosRef.current)
      if (hit) {
        dragRef.current = { mode: hit, startImgX: imgX, startImgY: imgY, startRect: r }
        setActiveHandle(hit)
        return
      }
      const inside = imgX >= r.x && imgX <= r.x + r.w && imgY >= r.y && imgY <= r.y + r.h
      if (inside) {
        dragRef.current = { mode: 'move', startImgX: imgX, startImgY: imgY, startRect: r }
        return
      }
    }
    // Outside the current rect (or no rect yet): start drawing a fresh one.
    const startRect = { x: imgX, y: imgY, w: 0, h: 0 }
    dragRef.current = { mode: 'draw', startImgX: imgX, startImgY: imgY, startRect }
    setRect(startRect)
  }, [setActiveHandle, toBox])

  const onMouseMove = useCallback((canvasX: number, canvasY: number, cssX: number, cssY: number) => {
    const { x: imgX, y: imgY } = toBox(canvasX, canvasY)
    const drag = dragRef.current
    if (drag) {
      const { mode, startImgX, startImgY, startRect } = drag
      if (mode === 'draw') {
        const x0 = clamp(startRect.x, 0, imageWidth)
        const y0 = clamp(startRect.y, 0, imageHeight)
        const x1 = clamp(imgX, 0, imageWidth)
        const y1 = clamp(imgY, 0, imageHeight)
        setRect({
          x: Math.min(x0, x1),
          y: Math.min(y0, y1),
          w: Math.abs(x1 - x0),
          h: Math.abs(y1 - y0),
        })
      } else if (mode === 'move') {
        const nx = clamp(startRect.x + (imgX - startImgX), 0, imageWidth - startRect.w)
        const ny = clamp(startRect.y + (imgY - startImgY), 0, imageHeight - startRect.h)
        setRect({ ...startRect, x: nx, y: ny })
      } else {
        const nb = applyHandleResize(startRect, mode, imgX - startImgX, imgY - startImgY, false)
        let { x, y, w, h } = nb
        if (x < 0) { w += x; x = 0 }
        if (y < 0) { h += y; y = 0 }
        if (x + w > imageWidth) w = imageWidth - x
        if (y + h > imageHeight) h = imageHeight - y
        if (w >= MIN_CROP && h >= MIN_CROP) setRect({ x, y, w, h })
      }
      return
    }
    const r = rectRef.current
    if (r) {
      const hit = findHandleHit(cssX, cssY, handlePosRef.current)
      setActiveHandle(hit)
      setHovered(!hit && imgX >= r.x && imgX <= r.x + r.w && imgY >= r.y && imgY <= r.y + r.h)
    }
  }, [imageWidth, imageHeight, setActiveHandle, toBox])

  /** True when a crop drag was in progress and has now been ended. */
  const onMouseUp = useCallback((): boolean => {
    if (!dragRef.current) return false
    const wasDraw = dragRef.current.mode === 'draw'
    dragRef.current = null
    setActiveHandle(null)
    const r = rectRef.current
    // A draw that never grew past the minimum was a stray click, not a crop.
    if (wasDraw && r && (r.w < MIN_CROP || r.h < MIN_CROP)) setRect(null)
    return true
  }, [setActiveHandle])

  /**
   * Paints the dim-outside-the-rect overlay and its handles, and records
   * where those handles landed for the next hit test. Called from `redraw`
   * with the context already back in CSS-pixel space.
   */
  const paint = useCallback((
    ctx: CanvasRenderingContext2D,
    view: { ox: number; oy: number; scale: number; W: number; H: number },
  ) => {
    const r = rectRef.current
    if (!active || !r) {
      handlePosRef.current = []
      return
    }
    const { ox, oy, scale, W, H } = view
    const pic = pictureRef.current
    if (pic) {
      // Painted in the picture's own frame — origin at its top-left corner,
      // turned by its rotation — so the dim and the dashed edge follow a
      // rotated picture. The handles are drawn upright afterwards, at the
      // places that frame puts them.
      const bw = pic.w * scale
      const bh = pic.h * scale
      const ccx = ox + (pic.x + pic.w / 2) * scale
      const ccy = oy + (pic.y + pic.h / 2) * scale
      const rad = (pic.rotation * Math.PI) / 180
      ctx.save()
      ctx.translate(ccx, ccy)
      ctx.rotate(rad)
      ctx.translate(-bw / 2, -bh / 2)
      const lx = r.x * scale
      const ly = r.y * scale
      const lw = r.w * scale
      const lh = r.h * scale
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
      ctx.fillRect(0, 0, bw, ly)
      ctx.fillRect(0, ly + lh, bw, bh - ly - lh)
      ctx.fillRect(0, ly, lx, lh)
      ctx.fillRect(lx + lw, ly, bw - lx - lw, lh)
      ctx.strokeStyle = '#FFFFFF'
      ctx.lineWidth = 1.5
      ctx.setLineDash([5, 4])
      ctx.strokeRect(lx, ly, lw, lh)
      ctx.setLineDash([])
      ctx.restore()
      const cos = Math.cos(rad)
      const sin = Math.sin(rad)
      const handles = boxHandlePositions(r, 0, 0, scale, 0).map((h) => {
        const dx = h.cx - bw / 2
        const dy = h.cy - bh / 2
        return { ...h, cx: ccx + dx * cos - dy * sin, cy: ccy + dx * sin + dy * cos }
      })
      handlePosRef.current = handles
      const HS = HANDLE_SIZE
      ctx.save()
      ctx.fillStyle = '#FFFFFF'
      ctx.strokeStyle = '#60A5FA'
      ctx.lineWidth = 1.5
      for (const h of handles) {
        ctx.fillRect(h.cx - HS / 2, h.cy - HS / 2, HS, HS)
        ctx.strokeRect(h.cx - HS / 2, h.cy - HS / 2, HS, HS)
      }
      ctx.restore()
      return
    }
    const sx = ox + r.x * scale
    const sy = oy + r.y * scale
    const sw = r.w * scale
    const sh = r.h * scale
    ctx.save()
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
    ctx.fillRect(0, 0, W, sy)                  // top
    ctx.fillRect(0, sy + sh, W, H - sy - sh)   // bottom
    ctx.fillRect(0, sy, sx, sh)                // left
    ctx.fillRect(sx + sw, sy, W - sx - sw, sh) // right
    ctx.strokeStyle = '#FFFFFF'
    ctx.lineWidth = 1.5
    ctx.setLineDash([5, 4])
    ctx.strokeRect(sx, sy, sw, sh)
    ctx.setLineDash([])
    const handles = boxHandlePositions(r, ox, oy, scale, 0)
    handlePosRef.current = handles
    const HS = HANDLE_SIZE
    ctx.fillStyle = '#FFFFFF'
    ctx.strokeStyle = '#60A5FA'
    ctx.lineWidth = 1.5
    for (const h of handles) {
      ctx.fillRect(h.cx - HS / 2, h.cy - HS / 2, HS, HS)
      ctx.strokeRect(h.cx - HS / 2, h.cy - HS / 2, HS, HS)
    }
    ctx.restore()
  }, [active])

  /** Drops only the hover highlight, keeping the pending rectangle — what a
   *  pointer leaving the canvas means. */
  const clearHover = useCallback(() => setHovered(false), [])

  /** Whether a crop drag is in flight — for the canvas's global mouseup,
   *  which has to notice a release that happened off-canvas. */
  const isDragging = useCallback(() => dragRef.current !== null, [])

  // Memoized so the canvas's own handlers, which list `crop` among their
  // dependencies, are re-created only when something here actually changed —
  // the same cadence the inlined `cropRect` dependency used to give them.
  return useMemo(
    () => ({ rect, hovered, reset, clearHover, apply, cancel, isDragging, onMouseDown, onMouseMove, onMouseUp, paint }),
    [rect, hovered, reset, clearHover, apply, cancel, isDragging, onMouseDown, onMouseMove, onMouseUp, paint],
  )
}
