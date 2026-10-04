// The selection handles: where each one sits for a given annotation, which
// one a click lands on, what cursor it shows, and what dragging it does to
// the shape's own geometry.

import { bubbleCornerRadius, bubbleTailHeight, bubbleTailPoints, getAnnotationLocalBounds, getBubbleBodyBox, getElbowSegments, getMagnifierBoxes, rotatePoint } from '../../lib/annotations'
import type { Annotation } from '../../lib/annotations'

export type BoxHandleId = 'tl' | 'tc' | 'tr' | 'ml' | 'mr' | 'bl' | 'bc' | 'br'

// Magnifier source/target boxes reuse the 8 box-handle ids, prefixed to tell
// the two independent boxes apart (see beginHandleDrag / computeHandlePositions).
export type MagnifierHandleId = `s-${BoxHandleId}` | `t-${BoxHandleId}`

export type HandleId = BoxHandleId | 'p1' | 'p2' | 'thick' | 'thick2' | 'rot' | 'bend' | 'tail' | MagnifierHandleId

export interface HandlePos { id: HandleId; cx: number; cy: number }

export interface ResizeState {
  handle: HandleId
  startImgX: number
  startImgY: number
  startBounds?: { x: number; y: number; w: number; h: number }
  startLine?: { x1: number; y1: number; x2: number; y2: number }
  lockEligible?: boolean  // aspect-lock when Shift is held (ellipse)
  lockAlways?: boolean    // always aspect-lock (text scales uniformly with font size)
  // Aspect-locked on corner handles *unless* Shift is held — the inverse of
  // lockEligible. Pasted pictures: stretching one out of proportion is almost
  // always a slip, so the default protects the picture and Shift opts out.
  lockUnlessShift?: boolean
  lockCenter?: boolean    // resize about the fixed center instead of the opposite corner/edge (number marker)
  // Floor for the resized box on each axis (default MIN_RESIZE). Lower only
  // where a shape can legitimately already be thinner than that: a flat pen
  // stroke — an underline — has a box only as tall as its stroke halo, and
  // the default floor would reject every drag on it outright.
  minSize?: number
  rotationDeg?: number    // shape's current rotation — resize math happens in its local (unrotated) frame
  isArrow?: boolean       // p1/p2 on an arrow can glue to another shape's connection point
  startSw?: number        // stroke width at drag start (marker edge drags need the original thickness)
  magnifierPart?: 'source' | 'target'  // which of a magnifier's two independent boxes this handle resizes
  magnifierRatio?: number  // target only: source w/h at drag start, so the target stays undistorted
}

export interface RotateState {
  id: string
  cx: number
  cy: number
  startAngleDeg: number   // ann.rotation at drag start
  startMouseAngle: number // radians, atan2 of the initial mouse position around (cx, cy)
}

export const MIN_RESIZE = 10

export const SEL_PAD = 6

export const HANDLE_SIZE = 7

export const HANDLE_HIT = 8

// CSS px, constant regardless of zoom: distance from a rect/ellipse's top
// edge to its rotate handle (Excel/PowerPoint-style stalk).
export const ROT_HANDLE_DIST = 26

export function computeHandlePositions(
  ann: Annotation,
  b: { x: number; y: number; w: number; h: number },
  ox: number, oy: number, scale: number, pad: number,
): HandlePos[] {
  if (ann.type === 'text') {
    // Corners only — text scales uniformly with its font size, so edge
    // handles would promise a single-axis stretch it can't do.
    const local = getAnnotationLocalBounds(ann)
    if (!local) return []
    const rot = ann.rotation ?? 0
    const handles = rotatedBoxHandlePositions(local, rot, ox, oy, scale, pad, ['tl', 'tr', 'bl', 'br'])
    if (ann.shape === 'bubble') {
      // The handle sits on the tail's tip (apex) — the part that's actually
      // furthest from the box and reads most directly as "grab the tail".
      const body = getBubbleBodyBox(ann)
      if (body) {
        const radius = bubbleCornerRadius(ann.fontSize, body.w, body.h)
        const tailH = bubbleTailHeight(ann.fontSize)
        let apex = bubbleTailPoints(ann.tailAnchor ?? 's3', body.x, body.y, body.w, body.h, tailH, radius)[1]
        if (rot) apex = rotatePoint(apex.x, apex.y, local.x + local.w / 2, local.y + local.h / 2, rot)
        handles.push({ id: 'tail', cx: ox + apex.x * scale, cy: oy + apex.y * scale })
      }
    }
    return handles
  }
  if (ann.type === 'arrow' || ann.type === 'line') {
    const handles: HandlePos[] = [
      { id: 'p1', cx: ox + ann.x1 * scale, cy: oy + ann.y1 * scale },
      { id: 'p2', cx: ox + ann.x2 * scale, cy: oy + ann.y2 * scale },
    ]
    if (ann.type === 'arrow' && ann.style === 'elbow') {
      // Midpoint of the elbow's middle (jog) segment — dragging it slides
      // the bend along the dominant axis (see resizeBend / getElbowSegments).
      const segs = getElbowSegments(ann.x1, ann.y1, ann.x2, ann.y2, ann.bendRatio ?? 0.5)
      const mid = segs[1]
      handles.push({
        id: 'bend',
        cx: ox + ((mid.x1 + mid.x2) / 2) * scale,
        cy: oy + ((mid.y1 + mid.y2) / 2) * scale,
      })
    }
    return handles
  }
  if (ann.type === 'highlight') {
    const { x1, y1, x2, y2, sw } = ann
    const handles: HandlePos[] = [
      { id: 'p1', cx: ox + x1 * scale, cy: oy + y1 * scale },
      { id: 'p2', cx: ox + x2 * scale, cy: oy + y2 * scale },
    ]
    const dx = x2 - x1
    const dy = y2 - y1
    const len = Math.hypot(dx, dy)
    if (len >= 1) {
      // One handle on each of the band's edges, perpendicular to the stroke —
      // dragging one pulls that edge only (the opposite edge stays fixed),
      // with no upper bound (unlike the toolbar slider).
      const nx = -dy / len
      const ny = dx / len
      const ht = (sw * 6) / 2
      const mcx = (x1 + x2) / 2
      const mcy = (y1 + y2) / 2
      handles.push({ id: 'thick',  cx: ox + (mcx + nx * ht) * scale, cy: oy + (mcy + ny * ht) * scale })
      handles.push({ id: 'thick2', cx: ox + (mcx - nx * ht) * scale, cy: oy + (mcy - ny * ht) * scale })
    }
    return handles
  }
  if (ann.type === 'rect' || ann.type === 'ellipse' || ann.type === 'image' || ann.type === 'pen') {
    const local = getAnnotationLocalBounds(ann)
    if (!local) return []
    return rotatedBoxHandlePositions(local, ann.rotation ?? 0, ox, oy, scale, pad)
  }
  if (ann.type === 'magnifier') {
    // Two independent 8-point boxes — source/target — distinguished by the
    // 's-'/'t-' prefix on their handle ids (see beginHandleDrag).
    const { source, target } = getMagnifierBoxes(ann)
    const srcHandles = boxHandlePositions(source, ox, oy, scale, pad).map((h) => ({ ...h, id: `s-${h.id}` as HandleId }))
    const tgtHandles = boxHandlePositions(target, ox, oy, scale, pad).map((h) => ({ ...h, id: `t-${h.id}` as HandleId }))
    return [...srcHandles, ...tgtHandles]
  }
  return boxHandlePositions(b, ox, oy, scale, pad)
}

/** 8-point resize handles for a plain box, in screen-space coordinates. */
export function boxHandlePositions(
  b: { x: number; y: number; w: number; h: number },
  ox: number, oy: number, scale: number, pad: number,
): HandlePos[] {
  const sx = ox + b.x * scale - pad
  const sy = oy + b.y * scale - pad
  const sw = b.w * scale + pad * 2
  const sh = b.h * scale + pad * 2
  return [
    { id: 'tl', cx: sx,          cy: sy },
    { id: 'tc', cx: sx + sw / 2, cy: sy },
    { id: 'tr', cx: sx + sw,     cy: sy },
    { id: 'ml', cx: sx,          cy: sy + sh / 2 },
    { id: 'mr', cx: sx + sw,     cy: sy + sh / 2 },
    { id: 'bl', cx: sx,          cy: sy + sh },
    { id: 'bc', cx: sx + sw / 2, cy: sy + sh },
    { id: 'br', cx: sx + sw,     cy: sy + sh },
  ]
}

/**
 * Resize handles plus a rotate handle, for a rotatable shape's own (possibly
 * rotated) local frame — each point is placed in the shape's unrotated local
 * space, rotated around its center, then projected to screen space. At
 * rotation 0 this matches `boxHandlePositions`. `ids` selects which of the 8
 * box handles to emit (text takes corners only, since it scales uniformly).
 */
export function rotatedBoxHandlePositions(
  local: { x: number; y: number; w: number; h: number },
  rotationDeg: number,
  ox: number, oy: number, scale: number, pad: number,
  ids: BoxHandleId[] = ['tl', 'tc', 'tr', 'ml', 'mr', 'bl', 'bc', 'br'],
): HandlePos[] {
  const cx = local.x + local.w / 2
  const cy = local.y + local.h / 2
  // `pad` (like ROT_HANDLE_DIST) is a screen-pixel gap, so it converts to
  // image units before joining the local-space math — otherwise it would come
  // out scaled by the zoom, unlike the unrotated `boxHandlePositions` path.
  const hw = local.w / 2 + pad / scale
  const hh = local.h / 2 + pad / scale
  const toScreen = (lx: number, ly: number): { cx: number; cy: number } => {
    const p = rotatePoint(cx + lx, cy + ly, cx, cy, rotationDeg)
    return { cx: ox + p.x * scale, cy: oy + p.y * scale }
  }
  const offsets: Record<BoxHandleId, [number, number]> = {
    tl: [-hw, -hh], tc: [0, -hh], tr: [hw, -hh],
    ml: [-hw, 0],                 mr: [hw, 0],
    bl: [-hw, hh],  bc: [0, hh],  br: [hw, hh],
  }
  const handles: HandlePos[] = ids.map((id) => ({ id, ...toScreen(...offsets[id]) }))
  // Rotate handle: a fixed screen-pixel distance above the top edge.
  handles.push({ id: 'rot', ...toScreen(0, -hh - ROT_HANDLE_DIST / scale) })
  return handles
}

/** Contextual hint for an in-progress resize of `ann` via `handle`. */
export function resizeHint(ann: Annotation, handle: HandleId): string {
  if (handle === 'p1' || handle === 'p2') {
    return ann.type === 'arrow'
      ? 'Drag onto a shape to connect · Shift: 45° snap · Esc: cancel'
      : 'Shift: 45° snap · Esc: cancel'
  }
  if (handle === 'bend') return 'Drag to reposition the bend · Esc: cancel'
  if (handle === 'tail') return 'Drag to snap the tail to a compass point · Esc: cancel'
  if (ann.type === 'image') return 'Corners keep the ratio · Shift: stretch freely · Esc: cancel'
  if (ann.type === 'ellipse' || ann.type === 'pen') return 'Shift: keep ratio · Esc: cancel'
  return 'Esc: cancel'
}

export function findHandleHit(cssX: number, cssY: number, handles: HandlePos[]): HandleId | null {
  for (const h of handles) {
    if (Math.abs(cssX - h.cx) <= HANDLE_HIT && Math.abs(cssY - h.cy) <= HANDLE_HIT) return h.id
  }
  return null
}

/**
 * Corrects a free box-handle resize (`nb`) so its aspect ratio matches
 * `ratio` (w/h) — used to keep a magnifier's target box always showing its
 * source undistorted. Unlike `applyHandleResize`'s own `lockAspect` (corner
 * handles only, ratio = the box's own start-of-drag shape), this locks to an
 * *external* ratio and covers edge handles too: a corner drag rescales
 * whichever axis moved more, an edge drag derives the untouched axis from
 * the dragged one, growing/shrinking it around the box's own center on that
 * axis (there's no "dragged" edge on that axis to anchor to instead).
 */
export function lockMagnifierAspect(
  sb: { x: number; y: number; w: number; h: number },
  nb: { x: number; y: number; w: number; h: number },
  handle: BoxHandleId,
  ratio: number,
): { x: number; y: number; w: number; h: number } {
  let { w, h } = nb
  if (handle === 'tl' || handle === 'tr' || handle === 'bl' || handle === 'br') {
    const wScale = sb.w !== 0 ? nb.w / sb.w : 1
    const hScale = sb.h !== 0 ? nb.h / sb.h : 1
    if (Math.abs(wScale - 1) >= Math.abs(hScale - 1)) h = w / ratio
    else w = h * ratio
  } else if (handle === 'ml' || handle === 'mr') {
    h = w / ratio
  } else if (handle === 'tc' || handle === 'bc') {
    w = h * ratio
  }
  const right = sb.x + sb.w
  const bottom = sb.y + sb.h
  let x = nb.x
  let y = nb.y
  switch (handle) {
    case 'tl': x = right - w;             y = bottom - h;            break
    case 'tr': x = sb.x;                  y = bottom - h;            break
    case 'bl': x = right - w;             y = sb.y;                  break
    case 'br': x = sb.x;                  y = sb.y;                  break
    // Edge handles: the dragged edge's own axis is already anchored by
    // applyHandleResize (x for ml/mr, y for tc/bc); the derived axis has no
    // dragged edge to anchor to, so it grows/shrinks around the original
    // box's center on that axis instead.
    case 'ml': x = right - w;             y = sb.y + (sb.h - h) / 2; break
    case 'mr':                            y = sb.y + (sb.h - h) / 2; break
    case 'tc': x = sb.x + (sb.w - w) / 2; y = bottom - h;            break
    case 'bc': x = sb.x + (sb.w - w) / 2;                            break
  }
  return { x, y, w, h }
}

export function applyHandleResize(
  sb: { x: number; y: number; w: number; h: number },
  handle: HandleId,
  dix: number,
  diy: number,
  lockAspect = false,
): { x: number; y: number; w: number; h: number } {
  let { x, y, w, h } = sb
  switch (handle) {
    case 'tl': x += dix; y += diy; w -= dix; h -= diy; break
    case 'tc':           y += diy;            h -= diy; break
    case 'tr':           y += diy; w += dix;  h -= diy; break
    case 'ml': x += dix;           w -= dix;            break
    case 'mr':                     w += dix;            break
    case 'bl': x += dix;           w -= dix;  h += diy; break
    case 'bc':                                h += diy; break
    case 'br':                     w += dix;  h += diy; break
  }

  const isCorner = handle === 'tl' || handle === 'tr' || handle === 'bl' || handle === 'br'
  if (lockAspect && isCorner && sb.w > 0 && sb.h > 0) {
    // Scale both dimensions uniformly by the dominant axis, keeping the opposite corner fixed.
    const scale = Math.abs(w / sb.w) >= Math.abs(h / sb.h) ? w / sb.w : h / sb.h
    w = sb.w * scale
    h = sb.h * scale
    const right = sb.x + sb.w
    const bottom = sb.y + sb.h
    switch (handle) {
      case 'tl': x = right - w; y = bottom - h; break
      case 'tr': x = sb.x;      y = bottom - h; break
      case 'bl': x = right - w; y = sb.y;       break
      case 'br': x = sb.x;      y = sb.y;       break
    }
  }
  return { x, y, w, h }
}

// Rotated resize cursors are generated as data-URI SVGs (Figma-style): CSS
// only ships 4 fixed resize cursors, so a handle on a rotated shape would
// otherwise point along the screen axes instead of the shape's own axes.
export const rotatedCursorCache = new Map<number, string>()

export function rotatedResizeCursor(angleDeg: number, fallback: string): string {
  const key = Math.round(angleDeg * 10)
  let url = rotatedCursorCache.get(key)
  if (!url) {
    const arrow = 'M3 12 L8 7 M3 12 L8 17 M3 12 H21 M21 12 L16 7 M21 12 L16 17'
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">` +
      `<g transform="rotate(${angleDeg} 12 12)" fill="none" stroke-linecap="round" stroke-linejoin="round">` +
      `<path d="${arrow}" stroke="white" stroke-width="4.5"/>` +
      `<path d="${arrow}" stroke="black" stroke-width="2"/>` +
      `</g></svg>`
    url = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12`
    rotatedCursorCache.set(key, url)
  }
  return `${url}, ${fallback}`
}

export function handleCursorStyle(h: HandleId, rotationDeg = 0): string {
  // Axis each handle resizes along, unrotated, as an angle mod 180°
  // (y-down screen coords: 0 = ↔, 45 = ↘, 90 = ↕, 135 = ↙).
  const base = h === 'ml' || h === 'mr' ? 0
    : h === 'tl' || h === 'br' ? 45
    : h === 'tc' || h === 'bc' ? 90
    : h === 'tr' || h === 'bl' ? 135
    : null
  if (base === null) return 'crosshair'
  const angle = (((base + rotationDeg) % 180) + 180) % 180
  const native = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][Math.round(angle / 45) % 4]
  // On a 45° step the native cursor is exact — skip the custom image.
  if (Math.abs(angle - Math.round(angle / 45) * 45) < 0.5) return native
  return rotatedResizeCursor(angle, native)
}

// ── Annotation builder ─────────────────────────────────────────────────────

// The crop overlay drags through the same box handles an annotation does,
// so its own drag state is keyed on their ids.
export interface CropRect { x: number; y: number; w: number; h: number }

export type CropDragMode = 'draw' | 'move' | HandleId

export interface CropDragState {
  mode: CropDragMode
  startImgX: number
  startImgY: number
  startRect: CropRect
}
