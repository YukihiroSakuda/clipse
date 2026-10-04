// Bounds, rotation and hit testing, all in image-pixel space.

import type { Annotation, BubbleTailAnchor, EllipseAnn, ImageAnn, MagnifierAnn, PenAnn, RectAnn, TextAnn } from './types'
import { getEmbeddedImage } from './images'
import { BUBBLE_TAIL_ANCHORS, bubbleCornerRadius, bubbleTailAnchorPoint, getBubbleBodyBox, measureTextBounds } from './text'

export interface ElbowSegment { x1: number; y1: number; x2: number; y2: number }

/**
 * The 3 orthogonal segments of an elbow arrow's path (Excel-style
 * right-angle connector) between (x1,y1) and (x2,y2). The dominant axis
 * (whichever of |dx|/|dy| is larger) is picked fresh from the current
 * endpoints every call — never persisted — so a glued elbow arrow keeps
 * routing sensibly as its connected shape moves and the dominant axis flips.
 * `bendRatio` (0..1) is where along that axis the bend sits; at either
 * extreme one of the two dominant-axis segments collapses to ~0 length,
 * which just renders as a clean L — no separate mode needed.
 */
export function getElbowSegments(
  x1: number, y1: number, x2: number, y2: number, bendRatio: number,
): [ElbowSegment, ElbowSegment, ElbowSegment] {
  const dx = x2 - x1
  const dy = y2 - y1
  const r = Math.max(0, Math.min(1, bendRatio))
  if (Math.abs(dx) >= Math.abs(dy)) {
    const bendX = x1 + r * dx
    return [
      { x1, y1, x2: bendX, y2: y1 },
      { x1: bendX, y1, x2: bendX, y2 },
      { x1: bendX, y1: y2, x2, y2 },
    ]
  }
  const bendY = y1 + r * dy
  return [
    { x1, y1, x2: x1, y2: bendY },
    { x1, y1: bendY, x2, y2: bendY },
    { x1: x2, y1: bendY, x2, y2 },
  ]
}

/** Normalizes a possibly-negative-w/h rect to a top-left-origin rect. */
function normalizeRect(x: number, y: number, w: number, h: number): { x: number; y: number; w: number; h: number } {
  return { x: Math.min(x, x + w), y: Math.min(y, y + h), w: Math.abs(w), h: Math.abs(h) }
}

/** A magnifier's source and target boxes, each normalized to top-left origin. */
export function getMagnifierBoxes(ann: MagnifierAnn): {
  source: { x: number; y: number; w: number; h: number }
  target: { x: number; y: number; w: number; h: number }
} {
  return {
    source: normalizeRect(ann.x, ann.y, ann.w, ann.h),
    target: normalizeRect(ann.tx, ann.ty, ann.tw, ann.th),
  }
}

/**
 * The two points a magnifier's leader line connects: the midpoint of
 * whichever edge of each box faces the other — horizontal (left/right) or
 * vertical (top/bottom) is picked by whichever axis separates the boxes'
 * centers more, so the line always runs edge-midpoint to edge-midpoint
 * rather than landing on an arbitrary (e.g. corner) boundary point.
 */
export function magnifierLeaderPoints(
  source: { x: number; y: number; w: number; h: number },
  target: { x: number; y: number; w: number; h: number },
): [{ x: number; y: number }, { x: number; y: number }] {
  const srcCenter = { x: source.x + source.w / 2, y: source.y + source.h / 2 }
  const tgtCenter = { x: target.x + target.w / 2, y: target.y + target.h / 2 }
  const dx = tgtCenter.x - srcCenter.x
  const dy = tgtCenter.y - srcCenter.y
  if (Math.abs(dx) >= Math.abs(dy)) {
    const p1 = dx >= 0 ? { x: source.x + source.w, y: srcCenter.y } : { x: source.x, y: srcCenter.y }
    const p2 = dx >= 0 ? { x: target.x, y: tgtCenter.y } : { x: target.x + target.w, y: tgtCenter.y }
    return [p1, p2]
  }
  const p1 = dy >= 0 ? { x: srcCenter.x, y: source.y + source.h } : { x: srcCenter.x, y: source.y }
  const p2 = dy >= 0 ? { x: tgtCenter.x, y: target.y } : { x: tgtCenter.x, y: target.y + target.h }
  return [p1, p2]
}

/** Which of a magnifier's two boxes (image-pixel) point (px,py) falls
 *  inside, if either — used to route a body-drag to just that sub-rect. */
export function magnifierHitPart(ann: MagnifierAnn, px: number, py: number): 'source' | 'target' | null {
  const { source, target } = getMagnifierBoxes(ann)
  if (px >= source.x && px <= source.x + source.w && py >= source.y && py <= source.y + source.h) return 'source'
  if (px >= target.x && px <= target.x + target.w && py >= target.y && py <= target.y + target.h) return 'target'
  return null
}

/**
 * Rough bounding box for an annotation (image-pixel space). For a rotated
 * rect/ellipse/text this is the axis-aligned box enclosing the *rotated* shape
 * (used for hit-testing, rubber-band selection, and export sizing) — not
 * the shape's own unrotated local box. Use `getAnnotationLocalBounds` when
 * you need the latter (e.g. resize math in the shape's own frame).
 */
export function getAnnotationBounds(
  ann: Annotation,
): { x: number; y: number; w: number; h: number } | null {
  const rot = annotationRotation(ann)
  if (rot !== 0) {
    const local = getAnnotationLocalBounds(ann)
    if (local) return rotatedAabb(local, rot)
  }
  return getAnnotationLocalBounds(ann)
}

/** Bounding box in the shape's own unrotated local frame (rotation ignored). */
export function getAnnotationLocalBounds(
  ann: Annotation,
): { x: number; y: number; w: number; h: number } | null {
  switch (ann.type) {
    case 'arrow': {
      // Include the arrowhead extent (headLen in any direction from tip)
      const headLen = Math.max(10, ann.sw * 5)
      const minX = Math.min(ann.x1, ann.x2) - headLen
      const minY = Math.min(ann.y1, ann.y2) - headLen
      const maxX = Math.max(ann.x1, ann.x2) + headLen
      const maxY = Math.max(ann.y1, ann.y2) + headLen
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
    }
    case 'line': {
      const hw = ann.sw / 2
      const minX = Math.min(ann.x1, ann.x2) - hw
      const minY = Math.min(ann.y1, ann.y2) - hw
      const maxX = Math.max(ann.x1, ann.x2) + hw
      const maxY = Math.max(ann.y1, ann.y2) + hw
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
    }
    case 'pen': {
      const hw = ann.sw / 2
      const xs = ann.points.map((p) => p.x)
      const ys = ann.points.map((p) => p.y)
      const minX = Math.min(...xs) - hw
      const minY = Math.min(...ys) - hw
      const maxX = Math.max(...xs) + hw
      const maxY = Math.max(...ys) + hw
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
    }
    case 'rect':
    case 'blur':
    case 'spotlight':
    case 'image':
    case 'erase': {
      return { x: Math.min(ann.x, ann.x + ann.w), y: Math.min(ann.y, ann.y + ann.h), w: Math.abs(ann.w), h: Math.abs(ann.h) }
    }
    case 'magnifier': {
      const { source, target } = getMagnifierBoxes(ann)
      const minX = Math.min(source.x, target.x)
      const minY = Math.min(source.y, target.y)
      const maxX = Math.max(source.x + source.w, target.x + target.w)
      const maxY = Math.max(source.y + source.h, target.y + target.h)
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
    }
    case 'highlight': {
      const hw = (ann.sw * 6) / 2
      const minX = Math.min(ann.x1, ann.x2) - hw
      const minY = Math.min(ann.y1, ann.y2) - hw
      const maxX = Math.max(ann.x1, ann.x2) + hw
      const maxY = Math.max(ann.y1, ann.y2) + hw
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
    }
    case 'ellipse':
      return { x: ann.cx - ann.rx, y: ann.cy - ann.ry, w: ann.rx * 2, h: ann.ry * 2 }
    case 'number':
      return { x: ann.cx - ann.r, y: ann.cy - ann.r, w: ann.r * 2, h: ann.r * 2 }
    case 'text':
      return measureTextBounds(ann)
    default:
      return null
  }
}

/**
 * Bounding box of an annotation's *geometry only* — the stroke halo (line
 * width, marker width, arrowhead extent) is excluded.
 *
 * Used to decide whether the export canvas has to grow beyond the screenshot.
 * `getAnnotationBounds` pads by half the stroke width so selection boxes and
 * hit-testing cover the ink, but feeding that padding into the export bounds
 * means fattening a stroke near an edge silently enlarges the saved image
 * (a 12px marker pads 36px on every side). The canvas should only grow when
 * the user actually places something outside the screenshot.
 */
export function getAnnotationCoreBounds(
  ann: Annotation,
): { x: number; y: number; w: number; h: number } | null {
  switch (ann.type) {
    case 'arrow':
    case 'line':
    case 'highlight': {
      const minX = Math.min(ann.x1, ann.x2)
      const minY = Math.min(ann.y1, ann.y2)
      return { x: minX, y: minY, w: Math.abs(ann.x2 - ann.x1), h: Math.abs(ann.y2 - ann.y1) }
    }
    case 'pen': {
      const xs = ann.points.map((p) => p.x)
      const ys = ann.points.map((p) => p.y)
      const minX = Math.min(...xs)
      const minY = Math.min(...ys)
      const core = { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY }
      // A rotated stroke reaches past its own unrotated box; the export canvas
      // has to grow to wherever it actually lands. Spinning `core` about its
      // own center is the right pivot here — the halo `getAnnotationLocalBounds`
      // adds is symmetric, so both boxes share a center.
      const rot = ann.rotation ?? 0
      return rot ? rotatedAabb(core, rot) : core
    }
    default:
      return getAnnotationBounds(ann)
  }
}

/** Annotation types carrying a `rotation` field (rect, ellipse, text, image,
 *  pen) — the ones the editor shows a rotate handle for. */
export type RotatableAnnotation = RectAnn | EllipseAnn | TextAnn | ImageAnn | PenAnn

export function isRotatable(ann: Annotation): ann is RotatableAnnotation {
  return ann.type === 'rect' || ann.type === 'ellipse' || ann.type === 'text'
    || ann.type === 'image' || ann.type === 'pen'
}

/** An annotation's rotation in degrees — 0 for types that can't rotate. */
export function annotationRotation(ann: Annotation): number {
  return isRotatable(ann) ? (ann.rotation ?? 0) : 0
}

/**
 * The point a rotatable annotation spins around: the center of its own
 * *unrotated* local bounds. Every consumer (draw, selection box, handles,
 * connection anchors) must use this same pivot or the rendered shape and the
 * UI drawn around it drift apart.
 */
export function annotationPivot(ann: Annotation): { x: number; y: number } | null {
  const local = getAnnotationLocalBounds(ann)
  if (!local) return null
  return { x: local.x + local.w / 2, y: local.y + local.h / 2 }
}

/**
 * Maps an image-pixel point through a whole-image 90° turn: `w`/`h` are the
 * image's dimensions *before* the turn. This is the same rigid transform the
 * turned image itself goes through (pixel (0,0) lands wherever the physical
 * top-left corner ends up), so applying it to an annotation's own coordinates
 * keeps it registered to the same spot on the picture.
 */
function rotateImagePoint(x: number, y: number, w: number, h: number, dir: 'cw' | 'ccw'): { x: number; y: number } {
  return dir === 'cw' ? { x: h - y, y: x } : { x: y, y: w - x }
}

/**
 * Carries one annotation through a whole-image 90° turn (`w`/`h`: the image's
 * pre-turn dimensions) so it stays registered to the same content after
 * `rotateImage` replaces the base picture.
 *
 * Endpoint/box shapes (arrow, line, highlight, blur, spotlight, magnifier,
 * number) have no orientation of their own, so their defining points/corners
 * are simply run through the turn directly.
 *
 * Shapes with a `rotation` field (rect, ellipse, text, image, pen) carry
 * actual content (glyphs, a pasted bitmap, ink) that has to visibly turn with
 * the picture, not just have its box relabeled — stretching a resized box
 * would distort a picture instead of rotating it. So instead: bump the stored
 * rotation by the turn angle (spinning the content in place), and *translate*
 * the shape by however far its own pivot moved under the turn, rather than
 * transforming its defining coordinates directly. The two are equivalent for
 * a plain geometric outline (rect/ellipse), and only the rotation-bump form is
 * correct once real content is involved (image/text/pen) — since a bitmap's
 * corners always map fixed-corner-to-fixed-corner into its box, resizing the
 * box alone can't reorient what's drawn inside it.
 */
export function rotateAnnotationForImageTurn(ann: Annotation, w: number, h: number, dir: 'cw' | 'ccw'): Annotation {
  const T = (x: number, y: number) => rotateImagePoint(x, y, w, h, dir)
  const turnDeg = dir === 'cw' ? 90 : -90
  const turnRotation = (rot: number | undefined) => (((rot ?? 0) + turnDeg) % 360 + 360) % 360

  switch (ann.type) {
    case 'arrow':
    case 'line':
    case 'highlight': {
      const p1 = T(ann.x1, ann.y1)
      const p2 = T(ann.x2, ann.y2)
      return { ...ann, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }
    }
    case 'number': {
      const c = T(ann.cx, ann.cy)
      return { ...ann, cx: c.x, cy: c.y }
    }
    case 'blur':
    case 'spotlight': {
      const p1 = T(ann.x, ann.y)
      const p2 = T(ann.x + ann.w, ann.y + ann.h)
      return {
        ...ann,
        x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y),
        w: Math.abs(p2.x - p1.x), h: Math.abs(p2.y - p1.y),
      }
    }
    case 'magnifier': {
      const s1 = T(ann.x, ann.y); const s2 = T(ann.x + ann.w, ann.y + ann.h)
      const t1 = T(ann.tx, ann.ty); const t2 = T(ann.tx + ann.tw, ann.ty + ann.th)
      return {
        ...ann,
        x: Math.min(s1.x, s2.x), y: Math.min(s1.y, s2.y),
        w: Math.abs(s2.x - s1.x), h: Math.abs(s2.y - s1.y),
        tx: Math.min(t1.x, t2.x), ty: Math.min(t1.y, t2.y),
        tw: Math.abs(t2.x - t1.x), th: Math.abs(t2.y - t1.y),
      }
    }
    case 'erase': {
      // Unlike blur/spotlight, this box isn't resampled live from the
      // underlying image on every draw — `mask` is a baked raster (see
      // `EraseAnn`), so the box turning 90° means that raster has to
      // physically turn with it too, the same way `rotateBase` turns the
      // picture itself. `getEmbeddedImage` returns the already-decoded
      // bitmap for free since a visible erase annotation's mask was decoded
      // to draw it in the first place; the box/seed point still move even
      // when it isn't (a mask that never finished decoding), just without a
      // matching raster underneath.
      const p1 = T(ann.x, ann.y)
      const p2 = T(ann.x + ann.w, ann.y + ann.h)
      const x = Math.min(p1.x, p2.x); const y = Math.min(p1.y, p2.y)
      const w = Math.abs(p2.x - p1.x); const h = Math.abs(p2.y - p1.y)
      const seed = T(ann.seedX, ann.seedY)
      let mask = ann.mask
      const maskImg = getEmbeddedImage(ann.mask)
      if (maskImg) {
        const off = document.createElement('canvas')
        off.width = maskImg.naturalHeight
        off.height = maskImg.naturalWidth
        const c = off.getContext('2d')
        if (c) {
          if (dir === 'cw') {
            c.translate(maskImg.naturalHeight, 0)
            c.rotate(Math.PI / 2)
          } else {
            c.translate(0, maskImg.naturalWidth)
            c.rotate(-Math.PI / 2)
          }
          c.drawImage(maskImg, 0, 0)
          mask = off.toDataURL('image/png')
        }
      }
      return { ...ann, x, y, w, h, mask, seedX: seed.x, seedY: seed.y }
    }
    case 'ellipse': {
      const c = T(ann.cx, ann.cy)
      return { ...ann, cx: c.x, cy: c.y, rotation: turnRotation(ann.rotation) }
    }
    case 'pen': {
      const pivot = annotationPivot(ann)!
      const newPivot = T(pivot.x, pivot.y)
      const dx = newPivot.x - pivot.x; const dy = newPivot.y - pivot.y
      return {
        ...ann,
        points: ann.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
        rotation: turnRotation(ann.rotation),
      }
    }
    case 'rect':
    case 'text':
    case 'image': {
      const pivot = annotationPivot(ann)!
      const newPivot = T(pivot.x, pivot.y)
      const dx = newPivot.x - pivot.x; const dy = newPivot.y - pivot.y
      return { ...ann, x: ann.x + dx, y: ann.y + dy, rotation: turnRotation(ann.rotation) }
    }
  }
}

/** Rotates (px, py) around (cx, cy) by `deg` degrees, clockwise. */
export function rotatePoint(px: number, py: number, cx: number, cy: number, deg: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad); const sin = Math.sin(rad)
  const dx = px - cx; const dy = py - cy
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
}

/** Axis-aligned box enclosing `local` (a shape's unrotated box) rotated by `deg` around its own center. */
function rotatedAabb(
  local: { x: number; y: number; w: number; h: number },
  deg: number,
): { x: number; y: number; w: number; h: number } {
  const cx = local.x + local.w / 2
  const cy = local.y + local.h / 2
  const corners = [
    [local.x, local.y], [local.x + local.w, local.y],
    [local.x + local.w, local.y + local.h], [local.x, local.y + local.h],
  ].map(([px, py]) => rotatePoint(px, py, cx, cy, deg))
  const xs = corners.map((p) => p.x)
  const ys = corners.map((p) => p.y)
  const minX = Math.min(...xs); const maxX = Math.max(...xs)
  const minY = Math.min(...ys); const maxY = Math.max(...ys)
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

// ── Arrow connections (Excel/PowerPoint-style connectors) ──────────────────

/** Returns true if point (px, py) hits the annotation (image-pixel space). */
export function hitTest(ann: Annotation, px: number, py: number): boolean {
  const pad = Math.max(8, ann.sw * 2)
  if (ann.type === 'pen') {
    // A bbox test is too permissive for a squiggly stroke (clicking in the
    // empty middle of a "U" shape would falsely hit) — check actual segments.
    // The points are stored unrotated, so a rotated stroke is tested by
    // spinning the cursor back into the stroke's own frame rather than
    // rotating every segment.
    const { points } = ann
    let qx = px
    let qy = py
    const rot = ann.rotation ?? 0
    if (rot) {
      const pivot = annotationPivot(ann)
      if (pivot) {
        const q = rotatePoint(px, py, pivot.x, pivot.y, -rot)
        qx = q.x; qy = q.y
      }
    }
    for (let i = 1; i < points.length; i++) {
      if (distToSegment(qx, qy, points[i - 1].x, points[i - 1].y, points[i].x, points[i].y) <= pad) return true
    }
    return false
  }
  const b = getAnnotationBounds(ann)
  if (!b) return false
  return (
    px >= b.x - pad && px <= b.x + b.w + pad &&
    py >= b.y - pad && py <= b.y + b.h + pad
  )
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const lenSq = dx * dx + dy * dy
  let t = lenSq > 0 ? ((px - x1) * dx + (py - y1) * dy) / lenSq : 0
  t = Math.max(0, Math.min(1, t))
  const cx = x1 + t * dx
  const cy = y1 + t * dy
  return Math.hypot(px - cx, py - cy)
}

/** World-space position of every one of a bubble's 16 tail anchors — for the
 *  tail-position picker UI and the tail-drag handle's nearest-anchor snap.
 *  Rotation included, so the drag snaps to where the anchors actually are. */
export function getBubbleTailAnchors(ann: TextAnn): { anchor: BubbleTailAnchor; x: number; y: number }[] {
  const body = getBubbleBodyBox(ann)
  if (!body) return []
  const radius = bubbleCornerRadius(ann.fontSize, body.w, body.h)
  const rot = ann.rotation ?? 0
  const pivot = rot ? annotationPivot(ann) : null
  return BUBBLE_TAIL_ANCHORS.map((anchor) => {
    const p = bubbleTailAnchorPoint(anchor, body.x, body.y, body.w, body.h, radius)
    return { anchor, ...(pivot ? rotatePoint(p.x, p.y, pivot.x, pivot.y, rot) : p) }
  })
}
