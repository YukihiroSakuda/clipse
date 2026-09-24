// Small geometric helpers the canvas uses on top of the annotation model's
// own — snapping, content bounds, and the connect-anchor proximity test.

import { getAnnotationCoreBounds, getConnectAnchors, isConnectable } from '../../lib/annotations'
import type { Annotation, BubbleTailAnchor, ConnectAnchor } from '../../lib/annotations'

// CSS px snap radius for gluing an arrow endpoint to another shape's connection point.
export const CONNECT_SNAP_DIST = 14

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/**
 * CSS `transform-origin` for the live text editor of a rotated bubble: its
 * body box's center offset half a tail-height toward the edge the tail hangs
 * off, since the committed annotation rotates about its tail-inclusive bounds
 * center. Percentages keep it independent of the box's measured size.
 */
export function bubblePivotOrigin(anchor: BubbleTailAnchor, tailHCss: number): string {
  const half = tailHCss / 2
  const dx = anchor[0] === 'e' ? half : anchor[0] === 'w' ? -half : 0
  const dy = anchor[0] === 's' ? half : anchor[0] === 'n' ? -half : 0
  return `calc(50% + ${dx}px) calc(50% + ${dy}px)`
}

/**
 * A click-sized drag that produced no meaningful shape. Magnifier is
 * special-cased to its own source box: `getAnnotationCoreBounds` returns the
 * source∪target union, and the target is auto-placed at a nonzero default
 * size even when the source is a zero-size click — checking the union would
 * never flag a plain click as degenerate the way every other tool does.
 */
export function isDegenerateAnnotation(ann: Annotation): boolean {
  if (ann.type === 'magnifier') return Math.abs(ann.w) < 4 && Math.abs(ann.h) < 4
  const b = getAnnotationCoreBounds(ann)
  return !b || (b.w < 4 && b.h < 4)
}

/**
 * Union of the original image rect and every annotation's bounds, in
 * image-pixel space. Annotations dragged outside the image grow this box
 * (x/y can go negative), so the exported canvas can expand to include them.
 *
 * Deliberately uses *core* bounds — geometry without the stroke halo — so only
 * where the user puts an annotation grows the export, never how thick they
 * make it. Padding by stroke width here meant nudging the marker-width slider
 * up on a stroke near an edge enlarged the saved PNG (sw 12 → 36px of padding
 * per side) with transparent margin.
 */
export function computeContentBounds(
  annotations: Annotation[],
  imageWidth: number,
  imageHeight: number,
): { x: number; y: number; w: number; h: number } {
  let minX = 0, minY = 0, maxX = imageWidth, maxY = imageHeight
  for (const ann of annotations) {
    const b = getAnnotationCoreBounds(ann)
    if (!b) continue
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.w)
    maxY = Math.max(maxY, b.y + b.h)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export type Bounds = { x: number; y: number; w: number; h: number }

/** Smallest box containing both `a` and `b`. */
export function unionBounds(a: Bounds, b: Bounds): Bounds {
  const minX = Math.min(a.x, b.x)
  const minY = Math.min(a.y, b.y)
  const maxX = Math.max(a.x + a.w, b.x + b.w)
  const maxY = Math.max(a.y + a.h, b.y + b.h)
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/** Snap point (bx,by) so the segment from (ax,ay) lies on the nearest 45° angle. */
export function snapAngle(ax: number, ay: number, bx: number, by: number): { x: number; y: number } {
  const dx = bx - ax
  const dy = by - ay
  const len = Math.hypot(dx, dy)
  if (len < 1) return { x: bx, y: by }
  const step = Math.PI / 4
  const angle = Math.round(Math.atan2(dy, dx) / step) * step
  return { x: ax + Math.cos(angle) * len, y: ay + Math.sin(angle) * len }
}

/** Nearest connection point (of any connectable shape, `excludeId` skipped)
 *  within `maxDistImg` image px of (imgX, imgY), or null if none are close enough. */
export function findNearestConnectAnchor(
  imgX: number, imgY: number,
  annotations: Annotation[],
  excludeId: string | null,
  maxDistImg: number,
): { targetId: string; anchor: ConnectAnchor; x: number; y: number } | null {
  let best: { targetId: string; anchor: ConnectAnchor; x: number; y: number; dist: number } | null = null
  for (const a of annotations) {
    if (a.id === excludeId || !isConnectable(a)) continue
    for (const pt of getConnectAnchors(a)) {
      const dist = Math.hypot(imgX - pt.x, imgY - pt.y)
      if (dist <= maxDistImg && (!best || dist < best.dist)) best = { targetId: a.id, anchor: pt.anchor, x: pt.x, y: pt.y, dist }
    }
  }
  return best ? { targetId: best.targetId, anchor: best.anchor, x: best.x, y: best.y } : null
}
