// Turning a finished drag into an annotation, plus the per-tool hint shown
// while that drag is in progress.

import { makeId } from '../../lib/annotations'
import type { Annotation, ArrowHead } from '../../lib/annotations'
import type { AnnotationTool, FillMode } from '../../lib/store'
import { clamp, snapAngle } from './geometry'
import { MIN_RESIZE } from './handles'

// Contextual hints shown while drawing with each tool (bottom center).
export const DRAW_HINTS: Partial<Record<AnnotationTool, string>> = {
  arrow:     'Drag onto a shape to connect · Shift: 45° snap · Esc: cancel',
  line:      'Shift: 45° snap · Esc: cancel',
  highlight: 'Shift: 45° snap · Esc: cancel',
  rect:      'Shift: 1:1 · Esc: cancel',
  ellipse:   'Shift: 1:1 · Esc: cancel',
  blur:      'Esc: cancel',
  spotlight: 'Shift: 1:1 · Esc: cancel',
  magnifier: 'Shift: 1:1 · Esc: cancel',
  pen:       'Esc: cancel',
}

export function buildAnnotation(
  tool: AnnotationTool,
  sx: number, sy: number,
  ex: number, ey: number,
  color: string, sw: number, opacity: number, fillMode: FillMode, n: number,
  shift = false,
  numberShape: 'circle' | 'square' = 'circle',
  arrowHead: ArrowHead = 'triangle',
  doubleEndedArrow = false,
  blurStrength = 17,
  spotlightDim = 0.55,
  numberRadius = 15,
  arrowStyle: 'straight' | 'elbow' = 'straight',
  spotlightShape: 'circle' | 'square' = 'circle',
  magnifierZoom = 2.5,
  imageWidth = 0,
  imageHeight = 0,
  magnifierShape: 'circle' | 'square' = 'square',
  shadowStyle: 'none' | 'drop' | 'glow' | 'outline' = 'none',
  shadowAngle = 135,
  shadowSize = 40,
  shadowBlur = 25,
  shadowColor: string | undefined = undefined,
  shadowOpacity = 45,
  dash: 'solid' | 'dashed' | 'dotted' = 'solid',
  rectRadius = 0,
): Annotation | null {
  const id = makeId()
  const base = { id, color, sw, opacity, shadowStyle, shadowAngle, shadowSize, shadowBlur, shadowColor, shadowOpacity, dash }
  switch (tool) {
    case 'arrow': {
      const end = shift ? snapAngle(sx, sy, ex, ey) : { x: ex, y: ey }
      return { ...base, type: 'arrow', x1: sx, y1: sy, x2: end.x, y2: end.y, head: arrowHead, doubleEnded: doubleEndedArrow, style: arrowStyle }
    }
    case 'line': {
      const end = shift ? snapAngle(sx, sy, ex, ey) : { x: ex, y: ey }
      return { ...base, type: 'line', x1: sx, y1: sy, x2: end.x, y2: end.y }
    }
    case 'rect': {
      let rdx = ex - sx
      let rdy = ey - sy
      if (shift) {
        // Same convention as ellipse below: Shift constrains to 1:1.
        const s = Math.max(Math.abs(rdx), Math.abs(rdy))
        rdx = (rdx < 0 ? -1 : 1) * s
        rdy = (rdy < 0 ? -1 : 1) * s
      }
      return { ...base, type: 'rect', x: sx, y: sy, w: rdx, h: rdy, fill: fillMode, radius: rectRadius }
    }
    case 'ellipse': {
      let edx = ex - sx
      let edy = ey - sy
      if (shift) {
        const s = Math.max(Math.abs(edx), Math.abs(edy))
        edx = (edx < 0 ? -1 : 1) * s
        edy = (edy < 0 ? -1 : 1) * s
      }
      return {
        ...base, type: 'ellipse',
        cx: sx + edx / 2, cy: sy + edy / 2,
        rx: Math.abs(edx) / 2, ry: Math.abs(edy) / 2,
        fill: fillMode,
      }
    }
    case 'blur':
      return { ...base, type: 'blur', x: sx, y: sy, w: ex - sx, h: ey - sy, strength: blurStrength }
    case 'highlight': {
      const end = shift ? snapAngle(sx, sy, ex, ey) : { x: ex, y: ey }
      return { ...base, type: 'highlight', x1: sx, y1: sy, x2: end.x, y2: end.y }
    }
    case 'spotlight': {
      let sdx = ex - sx
      let sdy = ey - sy
      if (shift) {
        // Same convention as rect/ellipse above: Shift constrains to 1:1 —
        // a true circle or a square, depending on the active shape.
        const s = Math.max(Math.abs(sdx), Math.abs(sdy))
        sdx = (sdx < 0 ? -1 : 1) * s
        sdy = (sdy < 0 ? -1 : 1) * s
      }
      return { ...base, type: 'spotlight', x: sx, y: sy, w: sdx, h: sdy, dim: spotlightDim, shape: spotlightShape }
    }
    case 'number': {
      // Size comes from the remembered default (updated whenever a number
      // marker is resized), not from the stroke width.
      return { ...base, type: 'number', cx: sx, cy: sy, n, r: numberRadius, shape: numberShape }
    }
    case 'magnifier': {
      let mdx = ex - sx
      let mdy = ey - sy
      if (shift) {
        const s = Math.max(Math.abs(mdx), Math.abs(mdy))
        mdx = (mdx < 0 ? -1 : 1) * s
        mdy = (mdy < 0 ? -1 : 1) * s
      }
      const source = { x: Math.min(sx, sx + mdx), y: Math.min(sy, sy + mdy), w: Math.abs(mdx), h: Math.abs(mdy) }
      const target = placeMagnifierTarget(source, magnifierZoom, imageWidth, imageHeight)
      return { ...base, type: 'magnifier', x: source.x, y: source.y, w: source.w, h: source.h, tx: target.x, ty: target.y, tw: target.w, th: target.h, shape: magnifierShape }
    }
    default:
      return null
  }
}

/**
 * Auto-places a magnifier's target box relative to its just-drawn source:
 * scaled by `zoom`, offset to the source's right; if that would overflow the
 * image's right edge, tried to the left instead, then below as a last
 * resort. Landing off-canvas after that is fine — like every other
 * annotation, the export canvas grows to include it (computeContentBounds).
 */
export function placeMagnifierTarget(
  source: { x: number; y: number; w: number; h: number },
  zoom: number,
  imageWidth: number,
  imageHeight: number,
): { x: number; y: number; w: number; h: number } {
  const w = Math.max(MIN_RESIZE, source.w * zoom)
  const h = Math.max(MIN_RESIZE, source.h * zoom)
  const gap = Math.max(20, source.w * 0.15)
  // Vertically centered on the source, but nudged to stay within the image's
  // vertical extent when there's room — a source near the top/bottom edge
  // shouldn't push most of the target off-canvas for no reason.
  const rawY = source.y + source.h / 2 - h / 2
  const y = h <= imageHeight ? clamp(rawY, 0, imageHeight - h) : rawY
  const right = source.x + source.w + gap
  if (right + w <= imageWidth) return { x: right, y, w, h }
  const left = source.x - gap - w
  if (left >= 0) return { x: left, y, w, h }
  const x = source.x + source.w / 2 - w / 2
  return { x, y: source.y + source.h + gap, w, h }
}
