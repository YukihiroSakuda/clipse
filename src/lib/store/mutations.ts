// Pure geometry the store applies to annotations: how a resize rewrites each
// type's own coordinates, and how a group is translated.
//
// Separate from the store because none of it touches store state — each is a
// plain (annotation, numbers) -> annotation function, which is also what makes
// them directly testable.

import { fontSizeAndOriginForBounds, getAnnotationBounds } from '../annotations'
import type { Annotation } from '../annotations'

/**
 * Rewrites `a`'s own geometry so it fills the bounding box `b` — the inverse
 * of `getAnnotationLocalBounds`, which is where each case's box comes from.
 */
export function boundsToAnnotation(a: Annotation, b: { x: number; y: number; w: number; h: number }): Annotation {
  switch (a.type) {
    case 'rect':
    case 'blur':
    case 'spotlight':
    case 'image':
    case 'erase':
      return { ...a, x: b.x, y: b.y, w: b.w, h: b.h }
    case 'ellipse':
      return { ...a, cx: b.x + b.w / 2, cy: b.y + b.h / 2, rx: b.w / 2, ry: b.h / 2 }
    case 'number':
      return { ...a, cx: b.x + b.w / 2, cy: b.y + b.h / 2, r: Math.min(b.w, b.h) / 2 }
    case 'text': {
      const lineCount = a.text.split('\n').length
      const { fontSize, x, y } = fontSizeAndOriginForBounds(a.shape, lineCount, b)
      return { ...a, x, y, fontSize }
    }
    case 'pen': {
      // A freehand stroke has no box of its own — resizing it means rewriting
      // every point. `b` describes the *padded* box `getAnnotationLocalBounds`
      // reports (points plus half the stroke width on each side), and the
      // stroke width itself doesn't scale with the drag, so the halo is
      // subtracted before mapping and added back after. Without that the
      // stroke would creep away from the handle being dragged, by more the
      // thicker it is.
      const hw = a.sw / 2
      const xs = a.points.map((p) => p.x)
      const ys = a.points.map((p) => p.y)
      const minX = Math.min(...xs); const spanX = Math.max(...xs) - minX
      const minY = Math.min(...ys); const spanY = Math.max(...ys) - minY
      const targetW = Math.max(1, b.w - a.sw)
      const targetH = Math.max(1, b.h - a.sw)
      // A stroke with no extent on one axis (a perfectly straight horizontal
      // or vertical line) has no ratio to scale by — center it in the target
      // instead, so it tracks the box rather than sticking to one edge.
      const map = (v: number, lo: number, span: number, tLo: number, tSpan: number) =>
        span > 0.01 ? tLo + ((v - lo) * tSpan) / span : tLo + tSpan / 2
      return {
        ...a,
        points: a.points.map((p) => ({
          x: map(p.x, minX, spanX, b.x + hw, targetW),
          y: map(p.y, minY, spanY, b.y + hw, targetH),
        })),
      }
    }
    default:
      return a
  }
}

/**
 * Translates `items` as one group so their combined bounding box overlaps the
 * `width` × `height` image, if it currently doesn't at all. Only for pasting
 * between editor windows: within one document the source coordinates are
 * already on-image, but a copy from a 4K capture pasted into a small one can
 * land entirely off-canvas, where it reads as a paste that silently did
 * nothing. Shifts by the smallest amount that brings the group back inside
 * (with a small margin), so its internal layout is untouched.
 */
export function nudgeIntoView(items: Annotation[], width: number, height: number): Annotation[] {
  if (items.length === 0 || width <= 0 || height <= 0) return items
  type Box = { x: number; y: number; w: number; h: number }
  const boxes = items
    .map((a) => getAnnotationBounds(a))
    .filter((b): b is Box => b !== null)
  if (boxes.length === 0) return items
  const minX = Math.min(...boxes.map((b) => b.x))
  const minY = Math.min(...boxes.map((b) => b.y))
  const maxX = Math.max(...boxes.map((b) => b.x + b.w))
  const maxY = Math.max(...boxes.map((b) => b.y + b.h))
  if (maxX > 0 && minX < width && maxY > 0 && minY < height) return items // already overlaps
  const MARGIN = 16
  // Clamp the group's box into the image on whichever axes it missed.
  const dx = minX >= width ? width - MARGIN - minX : maxX <= 0 ? MARGIN - maxX : 0
  const dy = minY >= height ? height - MARGIN - minY : maxY <= 0 ? MARGIN - maxY : 0
  if (dx === 0 && dy === 0) return items
  return items.map((a) => shiftAnnotation(a, dx, dy))
}

export function shiftAnnotation(a: Annotation, dx: number, dy: number): Annotation {
  switch (a.type) {
    case 'arrow':
    case 'line':
    case 'highlight':
      return { ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy }
    case 'pen':
      return { ...a, points: a.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
    case 'rect':
    case 'blur':
    case 'spotlight':
    case 'image':
    case 'erase':
      return { ...a, x: a.x + dx, y: a.y + dy }
    case 'ellipse':
      return { ...a, cx: a.cx + dx, cy: a.cy + dy }
    case 'text':
      return { ...a, x: a.x + dx, y: a.y + dy }
    case 'number':
      return { ...a, cx: a.cx + dx, cy: a.cy + dy }
    case 'magnifier':
      return { ...a, x: a.x + dx, y: a.y + dy, tx: a.tx + dx, ty: a.ty + dy }
    default:
      return a
  }
}
