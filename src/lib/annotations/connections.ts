// Arrow connections (Excel/PowerPoint-style connectors): the 16 fixed anchor
// points a shape offers, and keeping glued endpoints in sync with their target.

import type { Annotation, ArrowAnn, ArrowConnection, ConnectAnchor, EllipseAnn, ImageAnn, NumberAnn, RectAnn, TextAnn } from './types'
import { getBubbleBodyBox } from './text'
import { annotationPivot, annotationRotation, getAnnotationLocalBounds, rotatePoint } from './geometry'

export type ConnectableAnnotation = RectAnn | EllipseAnn | NumberAnn | TextAnn | ImageAnn

/** Annotation types an arrow endpoint can glue to. */
export function isConnectable(ann: Annotation): ann is ConnectableAnnotation {
  return ann.type === 'rect' || ann.type === 'ellipse' || ann.type === 'number'
    || ann.type === 'text' || ann.type === 'image'
}

/** Clockwise from the top — the index is also the anchor's 22.5° step. */
const CONNECT_ANCHORS: ConnectAnchor[] = [
  'n', 'nne', 'ne', 'ene',
  'e', 'ese', 'se', 'sse',
  's', 'ssw', 'sw', 'wsw',
  'w', 'wnw', 'nw', 'nnw',
]

/** Anchor offsets on a *rectangular* outline, in −1..1 units of half the box
 *  (0,0 = center): corners, edge midpoints, and each edge's quarter points.
 *  Module-internal: UI lays its picker out from `getConnectAnchors`, which
 *  resolves these against a specific target (rotation and round outlines
 *  included), rather than from the raw table. */
const RECT_ANCHOR_UNITS: Record<ConnectAnchor, [number, number]> = {
  n: [0, -1],    nne: [0.5, -1],  ne: [1, -1],    ene: [1, -0.5],
  e: [1, 0],     ese: [1, 0.5],   se: [1, 1],     sse: [0.5, 1],
  s: [0, 1],     ssw: [-0.5, 1],  sw: [-1, 1],    wsw: [-1, 0.5],
  w: [-1, 0],    wnw: [-1, -0.5], nw: [-1, -1],   nnw: [-0.5, -1],
}

/** Round shapes get their anchors on the ellipse itself, not on its box. */
function hasRoundOutline(target: ConnectableAnnotation): boolean {
  return target.type === 'ellipse' || (target.type === 'number' && target.shape === 'circle')
}

/**
 * The outline the anchors sit on. For most shapes it's just the local bounds.
 * Plain text (`shape: 'none'`) gets a small even margin so the 16 points ring
 * the glyphs instead of landing on the letters — its local box already hugs
 * the text tightly (and, since the draw centers the glyphs within it, evenly),
 * so a uniform pad keeps the ring balanced without ballooning.
 */
function getConnectBounds(target: ConnectableAnnotation): { x: number; y: number; w: number; h: number } {
  if (target.type === 'text' && target.shape === 'bubble') {
    // The body only — never the tail-inclusive selection bbox, so another
    // shape's arrow glues to the rounded box's actual edge no matter which
    // of the 16 ways this bubble's own tail happens to be pointing.
    return getBubbleBodyBox(target)!
  }
  const local = getAnnotationLocalBounds(target)!
  if (target.type !== 'text' || (target.shape && target.shape !== 'none')) return local
  const pad = Math.round(target.fontSize * 0.14)
  return { x: local.x - pad, y: local.y - pad, w: local.w + pad * 2, h: local.h + pad * 2 }
}

/** World-space position of one of `target`'s 16 fixed connection points.
 *  Internal: external callers go through `getConnectAnchors` / `resolveArrowConnections`. */
function getConnectAnchorPoint(target: ConnectableAnnotation, anchor: ConnectAnchor): { x: number; y: number } {
  const local = getConnectBounds(target)
  const cx = local.x + local.w / 2
  const cy = local.y + local.h / 2
  let u: number, v: number
  if (hasRoundOutline(target)) {
    const theta = (CONNECT_ANCHORS.indexOf(anchor) * Math.PI * 2) / CONNECT_ANCHORS.length
    u = Math.sin(theta); v = -Math.cos(theta)
  } else {
    ;[u, v] = RECT_ANCHOR_UNITS[anchor] ?? RECT_ANCHOR_UNITS.n
  }
  const px = cx + u * local.w / 2
  const py = cy + v * local.h / 2
  const rot = annotationRotation(target)
  if (!rot) return { x: px, y: py }
  // Spin around the shape's own pivot, not around `local`'s center: a bubble's
  // anchors sit on its body box (`getConnectBounds`) while it rotates about
  // its tail-inclusive bounds center, so the two centers don't coincide.
  const pivot = annotationPivot(target) ?? { x: cx, y: cy }
  return rotatePoint(px, py, pivot.x, pivot.y, rot)
}

/** All 16 connection points of `target`, in world space. */
export function getConnectAnchors(
  target: ConnectableAnnotation,
): { anchor: ConnectAnchor; x: number; y: number }[] {
  return CONNECT_ANCHORS.map((anchor) => ({ anchor, ...getConnectAnchorPoint(target, anchor) }))
}

/**
 * Recomputes every connected arrow's endpoint(s) from its target's current
 * geometry. Call after any store mutation that could move/resize/rotate a
 * connectable annotation (move, resize, rotate, crop) so glued arrows track
 * their targets the way Excel/PowerPoint connectors do. A target that no
 * longer exists (deleted) is left alone — the endpoint freezes at its last
 * resolved position instead of erroring.
 */
export function resolveArrowConnections(annotations: Annotation[]): Annotation[] {
  const byId = new Map(annotations.map((a) => [a.id, a]))
  let changed = false
  const next = annotations.map((a) => {
    if (a.type !== 'arrow' || (!a.startConnect && !a.endConnect)) return a
    const patch: Partial<ArrowAnn> = {}
    if (a.startConnect) {
      const target = byId.get(a.startConnect.targetId)
      if (target && isConnectable(target)) {
        const p = getConnectAnchorPoint(target, a.startConnect.anchor)
        if (p.x !== a.x1 || p.y !== a.y1) { patch.x1 = p.x; patch.y1 = p.y }
      }
    }
    if (a.endConnect) {
      const target = byId.get(a.endConnect.targetId)
      if (target && isConnectable(target)) {
        const p = getConnectAnchorPoint(target, a.endConnect.anchor)
        if (p.x !== a.x2 || p.y !== a.y2) { patch.x2 = p.x; patch.y2 = p.y }
      }
    }
    if (Object.keys(patch).length === 0) return a
    changed = true
    return { ...a, ...patch }
  })
  return changed ? next : annotations
}

/**
 * Un-glues any arrow whose connection target isn't in `annotations` anymore
 * (deleted, or cropped away) — the endpoint just freezes in place as a plain
 * coordinate instead of carrying a reference to a shape that no longer
 * exists. Call before/alongside removing annotations from the list.
 */
export function clearDanglingConnections(annotations: Annotation[]): Annotation[] {
  const ids = new Set(annotations.map((a) => a.id))
  return annotations.map((a) => {
    if (a.type !== 'arrow') return a
    const staleStart = a.startConnect && !ids.has(a.startConnect.targetId)
    const staleEnd = a.endConnect && !ids.has(a.endConnect.targetId)
    if (!staleStart && !staleEnd) return a
    return {
      ...a,
      startConnect: staleStart ? undefined : a.startConnect,
      endConnect: staleEnd ? undefined : a.endConnect,
    }
  })
}

/**
 * Rewrites arrow connection targetIds using `idMap` (old id -> new id) —
 * used when duplicating/pasting so a connector cloned together with its
 * target re-glues to the clone; a target not in `idMap` is left as-is (the
 * clone keeps pointing at the original, external shape).
 */
export function remapArrowConnections(annotations: Annotation[], idMap: Map<string, string>): Annotation[] {
  return annotations.map((a) => {
    if (a.type !== 'arrow' || (!a.startConnect && !a.endConnect)) return a
    const remap = (c?: ArrowConnection): ArrowConnection | undefined =>
      c && idMap.has(c.targetId) ? { ...c, targetId: idMap.get(c.targetId)! } : c
    const startConnect = remap(a.startConnect)
    const endConnect = remap(a.endConnect)
    if (startConnect === a.startConnect && endConnect === a.endConnect) return a
    return { ...a, startConnect, endConnect }
  })
}
