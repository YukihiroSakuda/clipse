// Annotation types — all coordinates are in image-pixel space.

export interface AnnotationBase {
  id: string
  color: string  // hex, e.g. '#EF4444'
  sw: number     // stroke width in image pixels
  /** Ink opacity 0..1, shared across the whole color palette (like `color`
   *  itself). Absent (pre-existing annotations) = 1 (fully opaque). Ignored
   *  by `blur`/`spotlight`, which don't paint with `color`. */
  opacity?: number
}

export type ArrowHead = 'triangle' | 'line' | 'dot' | 'none'
/** One of a speech-bubble's 16 tail anchors: 4 evenly-spaced points on each
 *  of the box's 4 straight edges — corners deliberately excluded (a tail
 *  hanging off a corner reads ambiguous, neither edge's own). Independent of
 *  `ConnectAnchor` (the *other* shapes' arrows connect to that one; a
 *  bubble's own tail uses this one) even though both describe 16 points
 *  around a rect — see `BUBBLE_TAIL_UNITS`. */
export type BubbleTailAnchor =
  | 'n1' | 'n2' | 'n3' | 'n4'
  | 'e1' | 'e2' | 'e3' | 'e4'
  | 's1' | 's2' | 's3' | 's4'
  | 'w1' | 'w2' | 'w3' | 'w4'
/** One of a shape's 16 fixed connection points, named by compass direction
 *  and spaced every 1/16th of its outline (corners, edge midpoints and the
 *  quarter points in between) — Excel/PowerPoint-style connectors: the slot
 *  is fixed once attached, its resolved position tracks the target as it
 *  moves/resizes/rotates. */
export type ConnectAnchor =
  | 'n' | 'nne' | 'ne' | 'ene'
  | 'e' | 'ese' | 'se' | 'sse'
  | 's' | 'ssw' | 'sw' | 'wsw'
  | 'w' | 'wnw' | 'nw' | 'nnw'
export interface ArrowConnection {
  targetId: string
  anchor: ConnectAnchor
}
export interface ArrowAnn extends AnnotationBase {
  type: 'arrow'
  x1: number; y1: number
  x2: number; y2: number
  head: ArrowHead
  /** Draw the same head style on the (x1,y1) end too. Absent (pre-existing
   *  annotations) = false (single-headed, at x2/y2 only). */
  doubleEnded?: boolean
  /** 'straight' (absent, pre-existing annotations) = today's direct line.
   *  'elbow' = Excel-style right-angle connector — see `getElbowSegments`. */
  style?: 'straight' | 'elbow'
  /** Elbow only: 0..1 position of the bend along the endpoints' dominant
   *  axis (recomputed live, never persisted — see `getElbowSegments`). Absent = 0.5. */
  bendRatio?: number
  /** (x1,y1) glued to another annotation's connection point. When present,
   *  x1/y1 are kept in sync with the target and shouldn't be edited directly
   *  — see `resolveArrowConnections`. */
  startConnect?: ArrowConnection
  /** Same as `startConnect`, for the (x2,y2) end. */
  endConnect?: ArrowConnection
}
export interface LineAnn extends AnnotationBase {
  type: 'line'
  x1: number; y1: number
  x2: number; y2: number
}
export interface PenAnn extends AnnotationBase {
  type: 'pen'
  points: { x: number; y: number }[]
}
export interface RectAnn extends AnnotationBase {
  type: 'rect'
  x: number; y: number
  w: number; h: number
  fill: 'stroke' | 'solid' | 'semi'
  /** Rotation in degrees around the shape's center, clockwise. Absent (pre-existing annotations) = 0. */
  rotation?: number
}
export interface EllipseAnn extends AnnotationBase {
  type: 'ellipse'
  cx: number; cy: number
  rx: number; ry: number
  fill: 'stroke' | 'solid' | 'semi'
  /** Rotation in degrees around the shape's center, clockwise. Absent (pre-existing annotations) = 0. */
  rotation?: number
}
export type TextShape = 'none' | 'box' | 'bubble'
export interface TextAnn extends AnnotationBase {
  type: 'text'
  x: number; y: number
  text: string
  fontSize: number
  /** Background behind the text: 'none' (plain, drop-shadowed), 'box' (solid
   *  rounded rect), or 'bubble' (rounded rect with a speech-bubble tail). */
  shape: TextShape
  /** Bubble only: which of the box's 16 tail anchors (4 per straight edge,
   *  no corners — see `BubbleTailAnchor`) the tail hangs off. Absent = 's3',
   *  close to the tail's original fixed bottom-left-ish spot. */
  tailAnchor?: BubbleTailAnchor
  /** Multi-line horizontal alignment, relative to the block's own widest
   *  line (not the annotation's box) — absent (pre-existing annotations) = 'left'. */
  align?: 'left' | 'center' | 'right'
}
export interface NumberAnn extends AnnotationBase {
  type: 'number'
  cx: number; cy: number
  n: number
  r: number
  shape: 'circle' | 'square'
}
export type BlurStrength = 'low' | 'medium' | 'high'
export interface BlurAnn extends AnnotationBase {
  type: 'blur'
  x: number; y: number
  w: number; h: number
  /** Blur strength as a percentage of the region's short side (the radius
   *  scale). Legacy annotations may carry the old presets — `low`/`medium`/
   *  `high` map to 8/17/33; absent = 17 ('medium'). */
  strength?: number | BlurStrength
}

/** Normalizes a blur strength (number, legacy preset, or absent) to a %. */
export function blurStrengthPct(s: number | BlurStrength | undefined): number {
  if (typeof s === 'number') return Math.max(1, Math.min(60, s))
  if (s === 'low') return 8
  if (s === 'high') return 33
  return 17
}
export interface HighlightAnn extends AnnotationBase {
  type: 'highlight'
  x1: number; y1: number
  x2: number; y2: number
}
export interface SpotlightAnn extends AnnotationBase {
  type: 'spotlight'
  x: number; y: number
  w: number; h: number
  /** Outside-dim opacity 0..1; absent (pre-existing annotations) = 0.55. */
  dim?: number
  /** Shape of the lit region: 'circle' (ellipse inscribed in x,y,w,h) or
   *  'square' (the box itself). Absent (pre-existing annotations) = 'square',
   *  matching the tool's original rectangle-only behavior. */
  shape?: 'circle' | 'square'
}
export interface MagnifierAnn extends AnnotationBase {
  type: 'magnifier'
  /** Source: the small region sampled from the original image. */
  x: number; y: number; w: number; h: number
  /** Target: where the magnified copy is displayed. */
  tx: number; ty: number; tw: number; th: number
  /** Shape of both boxes: 'square' (the box itself) or 'circle' (ellipse
   *  inscribed in the box) — same convention as SpotlightAnn.shape. Absent
   *  (pre-existing annotations) = 'square'. */
  shape?: 'circle' | 'square'
}
export type Annotation =
  | ArrowAnn | LineAnn | PenAnn | RectAnn | EllipseAnn
  | TextAnn  | NumberAnn | BlurAnn | HighlightAnn
  | SpotlightAnn | MagnifierAnn

export function makeId(): string {
  return Math.random().toString(36).slice(2, 10)
}

export const PALETTE: Record<string, string> = {
  red:    '#EF4444',
  orange: '#F97316',
  yellow: '#EAB308',
  green:  '#22C55E',
  blue:   '#4F8EF7',
  purple: '#A855F7',
  white:  '#FFFFFF',
  black:  '#0F1117',
}

// Tailwind v3 full color palette — rows: families, cols: shades 50→950
export const TAILWIND_SHADE_NAMES = ['50','100','200','300','400','500','600','700','800','900','950']

export const TAILWIND_PALETTE: string[][] = [
  ['#f8fafc','#f1f5f9','#e2e8f0','#cbd5e1','#94a3b8','#64748b','#475569','#334155','#1e293b','#0f172a','#020617'],
  ['#f9fafb','#f3f4f6','#e5e7eb','#d1d5db','#9ca3af','#6b7280','#4b5563','#374151','#1f2937','#111827','#030712'],
  ['#fafafa','#f4f4f5','#e4e4e7','#d4d4d8','#a1a1aa','#71717a','#52525b','#3f3f46','#27272a','#18181b','#09090b'],
  ['#fafafa','#f5f5f5','#e5e5e5','#d4d4d4','#a3a3a3','#737373','#525252','#404040','#262626','#171717','#0a0a0a'],
  ['#fafaf9','#f5f5f4','#e7e5e4','#d6d3d1','#a8a29e','#78716c','#57534e','#44403c','#292524','#1c1917','#0c0a09'],
  ['#fef2f2','#fee2e2','#fecaca','#fca5a5','#f87171','#ef4444','#dc2626','#b91c1c','#991b1b','#7f1d1d','#450a0a'],
  ['#fff7ed','#ffedd5','#fed7aa','#fdba74','#fb923c','#f97316','#ea580c','#c2410c','#9a3412','#7c2d12','#431407'],
  ['#fffbeb','#fef3c7','#fde68a','#fcd34d','#fbbf24','#f59e0b','#d97706','#b45309','#92400e','#78350f','#451a03'],
  ['#fefce8','#fef9c3','#fef08a','#fde047','#facc15','#eab308','#ca8a04','#a16207','#854d0e','#713f12','#422006'],
  ['#f7fee7','#ecfccb','#d9f99d','#bef264','#a3e635','#84cc16','#65a30d','#4d7c0f','#3f6212','#365314','#1a2e05'],
  ['#f0fdf4','#dcfce7','#bbf7d0','#86efac','#4ade80','#22c55e','#16a34a','#15803d','#166534','#14532d','#052e16'],
  ['#ecfdf5','#d1fae5','#a7f3d0','#6ee7b7','#34d399','#10b981','#059669','#047857','#065f46','#064e3b','#022c22'],
  ['#f0fdfa','#ccfbf1','#99f6e4','#5eead4','#2dd4bf','#14b8a6','#0d9488','#0f766e','#115e59','#134e4a','#042f2e'],
  ['#ecfeff','#cffafe','#a5f3fc','#67e8f9','#22d3ee','#06b6d4','#0891b2','#0e7490','#155e75','#164e63','#083344'],
  ['#f0f9ff','#e0f2fe','#bae6fd','#7dd3fc','#38bdf8','#0ea5e9','#0284c7','#0369a1','#075985','#0c4a6e','#082f49'],
  ['#eff6ff','#dbeafe','#bfdbfe','#93c5fd','#60a5fa','#3b82f6','#2563eb','#1d4ed8','#1e40af','#1e3a8a','#172554'],
  ['#eef2ff','#e0e7ff','#c7d2fe','#a5b4fc','#818cf8','#6366f1','#4f46e5','#4338ca','#3730a3','#312e81','#1e1b4b'],
  ['#f5f3ff','#ede9fe','#ddd6fe','#c4b5fd','#a78bfa','#8b5cf6','#7c3aed','#6d28d9','#5b21b6','#4c1d95','#2e1065'],
  ['#faf5ff','#f3e8ff','#e9d5ff','#d8b4fe','#c084fc','#a855f7','#9333ea','#7e22ce','#6b21a8','#581c87','#3b0764'],
  ['#fdf4ff','#fae8ff','#f5d0fe','#f0abfc','#e879f9','#d946ef','#c026d3','#a21caf','#86198f','#701a75','#4a044e'],
  ['#fdf2f8','#fce7f3','#fbcfe8','#f9a8d4','#f472b6','#ec4899','#db2777','#be185d','#9d174d','#831843','#500724'],
  ['#fff1f2','#ffe4e6','#fecdd3','#fda4af','#fb7185','#f43f5e','#e11d48','#be123c','#9f1239','#881337','#4c0519'],
]

export const TAILWIND_HEX_SET = new Set(TAILWIND_PALETTE.flat())

/**
 * Draw a single annotation. Call this with the canvas context already
 * transformed to image coordinates (translate by ox,oy then scale by imgScale).
 * `img` is required for blur annotations.
 */
export function drawAnnotation(
  ctx: CanvasRenderingContext2D,
  ann: Annotation,
  img?: HTMLImageElement | null,
) {
  // save()/restore() must stay balanced even if the switch below throws —
  // an unmatched save() otherwise leaks onto ctx's state stack, and the
  // *next* redraw's translate/scale (in AnnotationCanvas) compounds on top
  // of it, pushing the whole scene off-canvas so every subsequent frame
  // renders nothing until the page reloads. try/finally guarantees the pop.
  ctx.save()
  try {
    drawAnnotationInner(ctx, ann, img)
  } finally {
    ctx.restore()
  }
}

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

/** Direction (radians) of the first non-zero-length hop departing points[0]. */
function leadingAngle(points: { x: number; y: number }[]): number {
  const start = points[0]
  for (let i = 1; i < points.length; i++) {
    const p = points[i]
    if (Math.hypot(p.x - start.x, p.y - start.y) > 0.01) return Math.atan2(p.y - start.y, p.x - start.x)
  }
  return 0
}

/** Direction (radians) of the last non-zero-length hop arriving at the final point. */
function trailingAngle(points: { x: number; y: number }[]): number {
  const end = points[points.length - 1]
  for (let i = points.length - 2; i >= 0; i--) {
    const p = points[i]
    if (Math.hypot(end.x - p.x, end.y - p.y) > 0.01) return Math.atan2(end.y - p.y, end.x - p.x)
  }
  return 0
}

function drawAnnotationInner(
  ctx: CanvasRenderingContext2D,
  ann: Annotation,
  img?: HTMLImageElement | null,
) {
  const opacity = ann.opacity ?? 1
  ctx.strokeStyle = ann.color
  ctx.fillStyle = ann.color
  ctx.lineWidth = ann.sw
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.globalAlpha = opacity

  switch (ann.type) {
    case 'arrow': {
      const { x1, y1, x2, y2, head, sw, doubleEnded } = ann
      if (Math.hypot(x2 - x1, y2 - y1) < 2) break

      // Straight arrows path as their 2 endpoints; elbow arrows path through
      // the bend's 2 extra corners — everything past this point (head angles,
      // shaft shortening, stroking) is identical either way.
      const points: { x: number; y: number }[] = ann.style === 'elbow'
        ? (() => {
            const segs = getElbowSegments(x1, y1, x2, y2, ann.bendRatio ?? 0.5)
            return [{ x: x1, y: y1 }, { x: segs[0].x2, y: segs[0].y2 }, { x: segs[1].x2, y: segs[1].y2 }, { x: x2, y: y2 }]
          })()
        : [{ x: x1, y: y1 }, { x: x2, y: y2 }]

      // Direction the shaft arrives into the x2 tip, and the direction it
      // departs x1 (the x1 head, when double-ended, points the opposite way).
      const angleEnd = trailingAngle(points)
      const angleLead = leadingAngle(points)
      const angleStart = angleLead + Math.PI

      // 'line' heads are chevrons drawn on top of the tip, not shapes that
      // occupy space at the end — only 'triangle'/'dot' need the shaft
      // shortened so the head doesn't get drawn over by the stroke.
      const shorten = head === 'dot' ? Math.max(4, sw * 1.2) * 0.6
        : head === 'triangle' ? Math.max(10, sw * 5) * 0.85
        : 0
      const startShorten = doubleEnded ? shorten : 0
      points[0] = { x: x1 + startShorten * Math.cos(angleLead), y: y1 + startShorten * Math.sin(angleLead) }
      points[points.length - 1] = { x: x2 - shorten * Math.cos(angleEnd), y: y2 - shorten * Math.sin(angleEnd) }

      ctx.beginPath()
      ctx.moveTo(points[0].x, points[0].y)
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
      ctx.stroke()

      drawArrowHead(ctx, x2, y2, angleEnd, head, sw)
      if (doubleEnded) drawArrowHead(ctx, x1, y1, angleStart, head, sw)
      break
    }

    case 'line': {
      const { x1, y1, x2, y2 } = ann
      if (Math.hypot(x2 - x1, y2 - y1) < 2) break
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      break
    }

    case 'pen': {
      const { points } = ann
      if (points.length < 2) break
      ctx.beginPath()
      ctx.moveTo(points[0].x, points[0].y)
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
      ctx.stroke()
      break
    }

    case 'rect': {
      const { x, y, w, h, fill } = ann
      if (Math.abs(w) < 1 || Math.abs(h) < 1) break
      const rx = Math.min(x, x + w); const ry = Math.min(y, y + h)
      const rw = Math.abs(w); const rh = Math.abs(h)
      const rot = ann.rotation ?? 0
      if (rot) {
        const cx = rx + rw / 2; const cy = ry + rh / 2
        ctx.translate(cx, cy)
        ctx.rotate((rot * Math.PI) / 180)
        ctx.translate(-cx, -cy)
      }
      if (fill === 'solid') {
        ctx.fillRect(rx, ry, rw, rh)
      } else if (fill === 'semi') {
        ctx.globalAlpha = opacity * 0.35
        ctx.fillRect(rx, ry, rw, rh)
        ctx.globalAlpha = opacity
      } else {
        ctx.strokeRect(rx, ry, rw, rh)
      }
      break
    }

    case 'ellipse': {
      const { cx, cy, rx, ry, fill } = ann
      if (Math.abs(rx) < 1 || Math.abs(ry) < 1) break
      const rot = ((ann.rotation ?? 0) * Math.PI) / 180
      ctx.beginPath()
      ctx.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), rot, 0, Math.PI * 2)
      if (fill === 'solid') {
        ctx.fill()
      } else if (fill === 'semi') {
        ctx.globalAlpha = opacity * 0.35
        ctx.fill()
        ctx.globalAlpha = opacity
      } else {
        ctx.stroke()
      }
      break
    }

    case 'text': {
      const { x, y, text, fontSize, shape, align } = ann
      if (!text) break
      ctx.font = `bold ${fontSize}px "Inter", system-ui, sans-serif`
      ctx.textBaseline = 'top'
      const lineH = fontSize * 1.25
      const lines = text.split('\n')
      const lineWidths = lines.map((l) => ctx.measureText(l).width)
      const textW = Math.max(...lineWidths)
      // Each line's own left edge, relative to the block's widest line —
      // not the annotation's box — so a short line in a centered/right-
      // aligned multi-line block shifts on its own, the way word processors
      // align paragraphs. Left (default) needs no per-line adjustment.
      const lineX = (i: number) => align === 'center' ? x + (textW - lineWidths[i]) / 2
        : align === 'right' ? x + (textW - lineWidths[i])
        : x

      if (shape && shape !== 'none') {
        const pad = textPadding(fontSize)
        const textH = lineH * lines.length
        const bx = x - pad
        const by = y - pad
        const bw = textW + pad * 2
        const bh = textH + pad * 2
        const radius = bubbleCornerRadius(fontSize, bw, bh)

        ctx.save()
        try {
          ctx.shadowColor = 'rgba(0,0,0,0.35)'
          ctx.shadowBlur = 6
          ctx.shadowOffsetY = 2
          ctx.fillStyle = ann.color
          ctx.beginPath()
          ctx.roundRect(bx, by, bw, bh, radius)
          if (shape === 'bubble') {
            // Small triangular tail hanging off one of the box's 16 tail
            // anchors (default: bottom edge, left of center), drawn as a
            // second subpath in the same fill so it merges seamlessly with
            // the rounded body (both filled with the identical solid color).
            const tailH = bubbleTailHeight(fontSize)
            const [p0, p1, p2] = bubbleTailPoints(ann.tailAnchor ?? 's3', bx, by, bw, bh, tailH, radius)
            ctx.moveTo(p0.x, p0.y)
            ctx.lineTo(p1.x, p1.y)
            ctx.lineTo(p2.x, p2.y)
            ctx.closePath()
          }
          ctx.fill()
        } finally {
          ctx.restore()
        }

        ctx.fillStyle = contrastTextColor(ann.color)
        ctx.shadowColor = 'transparent'
        // Center on the box's actual ink extents, not the font's nominal
        // em-box metrics: 'middle' baseline centers between the font's full
        // ascent/descent, which reserves headroom for accents/diacritics
        // most text never uses — that reads as sitting noticeably above true
        // center. actualBoundingBoxAscent/Descent measure the real glyph
        // extents of the rendered text instead, giving the true optical
        // center of the block within the box.
        ctx.textBaseline = 'alphabetic'
        const topM = ctx.measureText(lines[0] || 'Mg')
        const botM = ctx.measureText(lines[lines.length - 1] || 'Mg')
        const ascent = topM.actualBoundingBoxAscent || fontSize * 0.72
        const descent = botM.actualBoundingBoxDescent || fontSize * 0.2
        const blockH = ascent + (lines.length - 1) * lineH + descent
        const boxCenterY = by + bh / 2
        const firstBaselineY = boxCenterY - blockH / 2 + ascent
        lines.forEach((line, i) => ctx.fillText(line, lineX(i), firstBaselineY + i * lineH))
        break
      }

      ctx.shadowColor = 'rgba(0,0,0,0.6)'
      ctx.shadowBlur = 4
      // `textBaseline: 'top'` puts the full line-height leading *below* the
      // glyphs, but the bounds box (measureTextBounds) and the edit textarea
      // (CSS line-height: 1.25) both split that leading half above / half
      // below. Match them by nudging down by the top half — otherwise the
      // text sits high in its box and jumps up on commit.
      const halfLead = (lineH - fontSize) / 2
      lines.forEach((line, i) => ctx.fillText(line, lineX(i), y + halfLead + i * lineH))
      break
    }

    case 'number': {
      const { cx, cy, n, r, color } = ann
      ctx.beginPath()
      if (ann.shape === 'square') {
        ctx.roundRect(cx - r, cy - r, r * 2, r * 2, r * 0.28)
      } else {
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
      }
      ctx.fill()
      ctx.fillStyle = contrastTextColor(color)
      ctx.strokeStyle = 'transparent'
      ctx.font = `bold ${r * 1.3}px "Inter", system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.shadowColor = 'transparent'
      ctx.fillText(String(n), cx, cy + r * 0.05)
      break
    }

    case 'blur': {
      // Blurs the underlying image rather than painting ink — the shared
      // palette opacity doesn't apply here.
      ctx.globalAlpha = 1
      const { x, y, w, h } = ann
      if (Math.abs(w) < 4 || Math.abs(h) < 4) break
      const rx = Math.min(x, x + w); const ry = Math.min(y, y + h)
      const rw = Math.abs(w); const rh = Math.abs(h)
      if (img) {
        // Gaussian blur. Radius scales with the region so intensity stays
        // consistent regardless of image resolution (the export canvas
        // renders at full res); the strength % shifts the whole scale.
        const pct = blurStrengthPct(ann.strength)
        const radius = Math.max(2, (Math.min(rw, rh) * pct) / 100)
        ctx.save()
        ctx.beginPath()
        ctx.rect(rx, ry, rw, rh)
        ctx.clip()
        ctx.filter = `blur(${radius}px)`
        // Sample a slightly larger area so blurred edges stay opaque inside the clip.
        const pad = radius * 2
        ctx.drawImage(
          img,
          rx - pad, ry - pad, rw + pad * 2, rh + pad * 2,
          rx - pad, ry - pad, rw + pad * 2, rh + pad * 2,
        )
        ctx.restore()
      } else {
        ctx.fillStyle = 'rgba(15, 17, 23, 0.75)'
        ctx.fillRect(rx, ry, rw, rh)
      }
      break
    }

    case 'highlight': {
      const { x1, y1, x2, y2, sw } = ann
      if (Math.hypot(x2 - x1, y2 - y1) < 2) break
      // The marker's own 40% translucency is a look, not the palette
      // opacity — the two multiply, so dialing the palette down further
      // fades the marker instead of overriding its default.
      ctx.globalAlpha = opacity * 0.4
      ctx.lineWidth = sw * 6
      ctx.lineCap = 'butt'
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      ctx.globalAlpha = opacity
      break
    }

    case 'spotlight': {
      // Dims everything outside the lit region, leaving the image underneath
      // untouched inside it. The dim strength is its own field, independent
      // of the shared palette opacity.
      ctx.globalAlpha = 1
      const { x, y, w, h } = ann
      if (Math.abs(w) < 4 || Math.abs(h) < 4) break
      const W = img?.naturalWidth ?? 0
      const H = img?.naturalHeight ?? 0
      if (W === 0 || H === 0) break
      const rx = Math.min(x, x + w); const ry = Math.min(y, y + h)
      const rw = Math.abs(w); const rh = Math.abs(h)
      const dimColor = `rgba(0,0,0,${ann.dim ?? 0.55})`
      if (ann.shape === 'circle') {
        // One path — the whole frame with the lit ellipse subtracted via the
        // even-odd fill rule — painted in a single fill. The ellipse's
        // interior is never painted over at all (not even briefly erased),
        // so it stays exactly as untouched as the square case's inside is.
        // (A fill-then-destination-out-erase two-step looks right in
        // isolation but actually erases the already-composited image
        // underneath, not just this dim layer — there's only one canvas
        // layer here, image and annotations share it.)
        ctx.beginPath()
        ctx.rect(0, 0, W, H)
        ctx.ellipse(rx + rw / 2, ry + rh / 2, rw / 2, rh / 2, 0, 0, Math.PI * 2)
        ctx.fillStyle = dimColor
        ctx.fill('evenodd')
      } else {
        // Four dark rects framing the region — cheaper than a cutout and
        // avoids compositing-mode edge artifacts for the common square case.
        ctx.fillStyle = dimColor
        ctx.fillRect(0, 0, W, ry)                  // top
        ctx.fillRect(0, ry + rh, W, H - ry - rh)   // bottom
        ctx.fillRect(0, ry, rx, rh)                // left
        ctx.fillRect(rx + rw, ry, W - rx - rw, rh) // right
      }
      break
    }

    case 'magnifier': {
      const { source: src, target: tgt } = getMagnifierBoxes(ann)
      if (src.w < 4 || src.h < 4 || tgt.w < 4 || tgt.h < 4 || !img) break
      const isCircle = ann.shape === 'circle'

      // The border/leader-line weight is a thin constant, independent of the
      // shared ink stroke-width slider — unlike ink strokes (arrow/pen/...),
      // this is a frame around the callout, not a mark whose weight the user
      // tunes; inheriting a thick `sw` from another tool made it look heavy.
      const frameW = 1.5
      ctx.lineWidth = frameW

      // Leader line first, so the boxes' borders sit visually on top of it.
      ctx.globalAlpha = opacity
      const [p1, p2] = magnifierLeaderPoints(src, tgt)
      ctx.beginPath()
      ctx.moveTo(p1.x, p1.y)
      ctx.lineTo(p2.x, p2.y)
      ctx.stroke()

      // Magnified copy — always fully opaque, like blur's sampled pixels.
      ctx.save()
      try {
        pathBoxOutline(ctx, tgt, isCircle)
        ctx.clip()
        ctx.globalAlpha = 1
        ctx.drawImage(img, src.x, src.y, src.w, src.h, tgt.x, tgt.y, tgt.w, tgt.h)
      } finally {
        ctx.restore()
      }

      ctx.globalAlpha = opacity
      ctx.setLineDash([frameW * 3, frameW * 2])
      pathBoxOutline(ctx, src, isCircle)
      ctx.stroke()
      ctx.setLineDash([])
      pathBoxOutline(ctx, tgt, isCircle)
      ctx.stroke()
      break
    }

  }
}

/** Normalizes a possibly-negative-w/h rect to a top-left-origin rect. */
function normalizeRect(x: number, y: number, w: number, h: number): { x: number; y: number; w: number; h: number } {
  return { x: Math.min(x, x + w), y: Math.min(y, y + h), w: Math.abs(w), h: Math.abs(h) }
}

/** Begins a path outlining a box — the rect itself, or (matching
 *  SpotlightAnn's 'circle' shape) the ellipse inscribed in it. */
function pathBoxOutline(ctx: CanvasRenderingContext2D, box: { x: number; y: number; w: number; h: number }, isCircle: boolean) {
  ctx.beginPath()
  if (isCircle) {
    ctx.ellipse(box.x + box.w / 2, box.y + box.h / 2, box.w / 2, box.h / 2, 0, 0, Math.PI * 2)
  } else {
    ctx.rect(box.x, box.y, box.w, box.h)
  }
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

/** Draws one arrow head shape at (tipX, tipY), pointing along `angle`. */
function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  tipX: number, tipY: number,
  angle: number,
  head: ArrowHead,
  sw: number,
) {
  if (head === 'none') return
  if (head === 'line') {
    const headLen = Math.max(10, sw * 4)
    ctx.beginPath()
    ctx.moveTo(tipX - headLen * Math.cos(angle - Math.PI / 6),
               tipY - headLen * Math.sin(angle - Math.PI / 6))
    ctx.lineTo(tipX, tipY)
    ctx.lineTo(tipX - headLen * Math.cos(angle + Math.PI / 6),
               tipY - headLen * Math.sin(angle + Math.PI / 6))
    ctx.stroke()
    return
  }
  if (head === 'dot') {
    const r = Math.max(4, sw * 1.2)
    ctx.beginPath()
    ctx.arc(tipX, tipY, r, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  // 'triangle' (default)
  const headLen = Math.max(10, sw * 5)
  ctx.beginPath()
  ctx.moveTo(tipX, tipY)
  ctx.lineTo(tipX - headLen * Math.cos(angle - Math.PI / 6),
             tipY - headLen * Math.sin(angle - Math.PI / 6))
  ctx.lineTo(tipX - headLen * Math.cos(angle + Math.PI / 6),
             tipY - headLen * Math.sin(angle + Math.PI / 6))
  ctx.closePath()
  ctx.fill()
}

/**
 * Rough bounding box for an annotation (image-pixel space). For a rotated
 * rect/ellipse this is the axis-aligned box enclosing the *rotated* shape
 * (used for hit-testing, rubber-band selection, and export sizing) — not
 * the shape's own unrotated local box. Use `getAnnotationLocalBounds` when
 * you need the latter (e.g. resize math in the shape's own frame).
 */
export function getAnnotationBounds(
  ann: Annotation,
): { x: number; y: number; w: number; h: number } | null {
  if ((ann.type === 'rect' || ann.type === 'ellipse') && (ann.rotation ?? 0) !== 0) {
    const local = getAnnotationLocalBounds(ann)!
    return rotatedAabb(local, ann.rotation ?? 0)
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
    case 'spotlight': {
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
      return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY }
    }
    default:
      return getAnnotationBounds(ann)
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

export type ConnectableAnnotation = RectAnn | EllipseAnn | NumberAnn | TextAnn

/** Annotation types an arrow endpoint can glue to. */
export function isConnectable(ann: Annotation): ann is ConnectableAnnotation {
  return ann.type === 'rect' || ann.type === 'ellipse' || ann.type === 'number' || ann.type === 'text'
}

/** Clockwise from the top — the index is also the anchor's 22.5° step. */
export const CONNECT_ANCHORS: ConnectAnchor[] = [
  'n', 'nne', 'ne', 'ene',
  'e', 'ese', 'se', 'sse',
  's', 'ssw', 'sw', 'wsw',
  'w', 'wnw', 'nw', 'nnw',
]

/** Anchor offsets on a *rectangular* outline, in −1..1 units of half the box
 *  (0,0 = center): corners, edge midpoints, and each edge's quarter points.
 *  Exported so UI (the bubble tail-position picker) can lay out the same 16
 *  points without duplicating this table. */
export const RECT_ANCHOR_UNITS: Record<ConnectAnchor, [number, number]> = {
  n: [0, -1],    nne: [0.5, -1],  ne: [1, -1],    ene: [1, -0.5],
  e: [1, 0],     ese: [1, 0.5],   se: [1, 1],     sse: [0.5, 1],
  s: [0, 1],     ssw: [-0.5, 1],  sw: [-1, 1],    wsw: [-1, 0.5],
  w: [-1, 0],    wnw: [-1, -0.5], nw: [-1, -1],   nnw: [-0.5, -1],
}

/** Clockwise from the top-left of the north edge — the same rotational
 *  convention as `CONNECT_ANCHORS`, just without corners. */
export const BUBBLE_TAIL_ANCHORS: BubbleTailAnchor[] = [
  'n1', 'n2', 'n3', 'n4',
  'e1', 'e2', 'e3', 'e4',
  's1', 's2', 's3', 's4',
  'w1', 'w2', 'w3', 'w4',
]

/** Anchor offsets on a rect's 4 straight edges, in −1..1 units of half the
 *  box (0,0 = center): each edge quartered into 4 equal zones, a point at
 *  each zone's center (±0.75/±0.25), corners (±1 on both axes) never hit. */
export const BUBBLE_TAIL_UNITS: Record<BubbleTailAnchor, [number, number]> = {
  n1: [-0.75, -1], n2: [-0.25, -1], n3: [0.25, -1], n4: [0.75, -1],
  e1: [1, -0.75],  e2: [1, -0.25],  e3: [1, 0.25],  e4: [1, 0.75],
  s1: [0.75, 1],   s2: [0.25, 1],   s3: [-0.25, 1], s4: [-0.75, 1],
  w1: [-1, 0.75],  w2: [-1, 0.25],  w3: [-1, -0.25], w4: [-1, -0.75],
}

/** A bubble's corner radius (image px) — same formula the draw function
 *  uses. Tail anchors need this to stay off the rounded corners: a point
 *  computed from the box's flat rectangle geometry near a corner can land
 *  outside the *actual* (rounded) outline, leaving a visible gap between
 *  the tail's base and the body it's meant to touch. */
export function bubbleCornerRadius(fontSize: number, bw: number, bh: number): number {
  return Math.min(fontSize * 0.4, bw / 2, bh / 2)
}

/** Every tail anchor sits on exactly one edge (never a corner), so its
 *  outward direction is simply that edge's own normal. */
function tailAnchorOutwardDir(anchor: BubbleTailAnchor): { x: number; y: number } {
  switch (anchor[0]) {
    case 'n': return { x: 0, y: -1 }
    case 'e': return { x: 1, y: 0 }
    case 's': return { x: 0, y: 1 }
    default: return { x: -1, y: 0 } // 'w'
  }
}

/** Direction of travel along each edge as its own anchor slot 1→4 —
 *  i.e. the direction bubbleTailAnchorPoint's `t` increases in. */
function tailAnchorAlongDir(anchor: BubbleTailAnchor): { x: number; y: number } {
  switch (anchor[0]) {
    case 'n': return { x: 1, y: 0 }
    case 'e': return { x: 0, y: 1 }
    case 's': return { x: -1, y: 0 }
    default: return { x: 0, y: -1 } // 'w'
  }
}

/**
 * World-space position of one of a bubble body's 16 tail anchors — confined
 * to each edge's *straight* run (excluding the rounded corners at both
 * ends), so it always sits exactly on the rendered outline.
 */
function bubbleTailAnchorPoint(
  anchor: BubbleTailAnchor, bx: number, by: number, bw: number, bh: number, radius: number,
): { x: number; y: number } {
  const slot = Number(anchor[1]) - 1 // 0..3
  const t = (slot + 0.5) / 4 // center of that edge's quarter-zone, 0..1 along the straight run
  switch (anchor[0]) {
    case 'n': return { x: bx + radius + t * (bw - 2 * radius), y: by }
    case 's': return { x: bx + bw - radius - t * (bw - 2 * radius), y: by + bh }
    case 'e': return { x: bx + bw, y: by + radius + t * (bh - 2 * radius) }
    default:  return { x: bx, y: by + bh - radius - t * (bh - 2 * radius) } // 'w'
  }
}

/**
 * The 3 points (near base corner, apex, far base corner) of a bubble's
 * tail: the original hand-drawn-looking asymmetric shape — one base corner
 * sits exactly on `anchor`, the other extends `tailW` further along the
 * edge, and the apex leans slightly toward the *near* corner rather than
 * standing straight up. Which way "near" is flips at each edge's midpoint,
 * so the lean always points toward whichever corner the anchor is closer
 * to instead of leaning a fixed direction regardless of position.
 */
export function bubbleTailPoints(
  anchor: BubbleTailAnchor, bx: number, by: number, bw: number, bh: number, tailH: number, radius: number,
): { x: number; y: number }[] {
  const base = bubbleTailAnchorPoint(anchor, bx, by, bw, bh, radius)
  const out = tailAnchorOutwardDir(anchor)
  const along = tailAnchorAlongDir(anchor)
  const slot = Number(anchor[1]) - 1 // 0..3
  const t = (slot + 0.5) / 4 // must match bubbleTailAnchorPoint's own t
  const sign = t < 0.5 ? 1 : -1 // which half of the edge — flips the lean
  const tailW = tailH * 0.9
  const near = base
  const far = { x: base.x + sign * tailW * along.x, y: base.y + sign * tailW * along.y }
  const apex = {
    x: base.x - sign * 0.3 * tailW * along.x + out.x * tailH,
    y: base.y - sign * 0.3 * tailW * along.y + out.y * tailH,
  }
  return [near, apex, far]
}

/** How far a bubble's tail protrudes beyond its box on each side — grows the
 *  selection/hit-test/export bounds so the tail (which can now point any of
 *  16 ways, not just south) is never clipped. */
function bubbleTailProtrusion(anchor: BubbleTailAnchor, tailH: number): { left: number; right: number; top: number; bottom: number } {
  const dir = tailAnchorOutwardDir(anchor)
  return {
    left: dir.x < 0 ? -dir.x * tailH : 0,
    right: dir.x > 0 ? dir.x * tailH : 0,
    top: dir.y < 0 ? -dir.y * tailH : 0,
    bottom: dir.y > 0 ? dir.y * tailH : 0,
  }
}

/** World-space position of every one of a bubble's 16 tail anchors — for the
 *  tail-position picker UI and the tail-drag handle's nearest-anchor snap. */
export function getBubbleTailAnchors(ann: TextAnn): { anchor: BubbleTailAnchor; x: number; y: number }[] {
  const body = getBubbleBodyBox(ann)
  if (!body) return []
  const radius = bubbleCornerRadius(ann.fontSize, body.w, body.h)
  return BUBBLE_TAIL_ANCHORS.map((anchor) => ({ anchor, ...bubbleTailAnchorPoint(anchor, body.x, body.y, body.w, body.h, radius) }))
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
  // Only rect/ellipse can be rotated (text/number have no `rotation` field).
  const rot = (target.type === 'rect' || target.type === 'ellipse') ? (target.rotation ?? 0) : 0
  return rot ? rotatePoint(px, py, cx, cy, rot) : { x: px, y: py }
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

let _measureCtx: CanvasRenderingContext2D | null = null
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (_measureCtx) return _measureCtx
  if (typeof document === 'undefined') return null
  _measureCtx = document.createElement('canvas').getContext('2d')
  return _measureCtx
}

/** Padding (image px) between the text and the box/bubble background edge. */
export function textPadding(fontSize: number): number {
  return Math.round(fontSize * 0.35)
}

/** Length (image px) of the speech-bubble tail, in the direction it points. */
export function bubbleTailHeight(fontSize: number): number {
  return Math.round(fontSize * 0.45)
}

/** White or near-black text color, whichever contrasts better against `hex`. */
export function contrastTextColor(hex: string): string {
  const c = hex.replace('#', '')
  if (c.length < 6) return '#FFFFFF'
  const r = parseInt(c.slice(0, 2), 16) / 255
  const g = parseInt(c.slice(2, 4), 16) / 255
  const b = parseInt(c.slice(4, 6), 16) / 255
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return lum > 0.6 ? '#0F1117' : '#FFFFFF'
}

/**
 * Inverse of `measureTextBounds`'s height/position math: given a target
 * bounding box (from a resize-handle drag) and the annotation's current
 * line count/shape, solves for the fontSize and text origin that would
 * make `measureTextBounds` reproduce that box.
 *
 * Needed because `box`/`bubble` shapes add padding (and, for `bubble`, a
 * tail) around the text that scales with fontSize — `b.h` is not the text
 * block height alone. Naively dividing `b.h` by the line-height factor
 * (correct only for `shape: 'none'`) overshoots fontSize by however much
 * padding/tail is baked into `b.h`, which shows up as the box's size
 * visibly jumping the instant a box/bubble resize drag starts, before the
 * cursor has even moved.
 */
export function fontSizeAndOriginForBounds(
  shape: TextShape | undefined,
  lineCount: number,
  b: { x: number; y: number; h: number },
): { fontSize: number; x: number; y: number } {
  if (!shape || shape === 'none') {
    const fontSize = Math.max(8, Math.round(b.h / (1.25 * lineCount)))
    return { fontSize, x: b.x, y: b.y }
  }
  // Continuous approximation of textPadding/bubbleTailHeight (their Math.round
  // is sub-pixel noise at this scale) — h = fontSize * (1.25*lines + 2*0.35 + tailRatio).
  const tailRatio = shape === 'bubble' ? 0.45 : 0
  const fontSize = Math.max(8, Math.round(b.h / (1.25 * lineCount + 0.7 + tailRatio)))
  const pad = textPadding(fontSize)
  return { fontSize, x: b.x + pad, y: b.y + pad }
}

/**
 * A bubble's rounded-rect body box (pad-expanded text box), WITHOUT the
 * tail's protrusion — what the tail triangle is anchored to (`bubbleTailPoints`)
 * and what other shapes' arrows connect to (`getConnectBounds`), so both stay
 * fixed to the actual box regardless of which of the 16 ways the tail points.
 * `null` for non-bubble text (nothing to anchor a tail to).
 */
export function getBubbleBodyBox(ann: TextAnn): { x: number; y: number; w: number; h: number } | null {
  if (ann.shape !== 'bubble') return null
  const lines = ann.text.split('\n')
  const lineH = ann.fontSize * 1.25
  const textH = lineH * lines.length
  const ctx = getMeasureCtx()
  const textW = ctx
    ? (() => {
        ctx.font = `bold ${ann.fontSize}px "Inter", system-ui, sans-serif`
        return Math.max(...lines.map((l) => ctx.measureText(l).width))
      })()
    : Math.max(...lines.map((l) => l.length)) * ann.fontSize * 0.6
  const pad = textPadding(ann.fontSize)
  return { x: ann.x - pad, y: ann.y - pad, w: textW + pad * 2, h: textH + pad * 2 }
}

function measureTextBounds(ann: TextAnn): { x: number; y: number; w: number; h: number } {
  if (ann.shape === 'bubble') {
    const body = getBubbleBodyBox(ann)!
    const p = bubbleTailProtrusion(ann.tailAnchor ?? 's3', bubbleTailHeight(ann.fontSize))
    return { x: body.x - p.left, y: body.y - p.top, w: body.w + p.left + p.right, h: body.h + p.top + p.bottom }
  }

  const lines = ann.text.split('\n')
  const lineH = ann.fontSize * 1.25
  const textH = lineH * lines.length
  const ctx = getMeasureCtx()
  const textW = ctx
    ? (() => {
        ctx.font = `bold ${ann.fontSize}px "Inter", system-ui, sans-serif`
        return Math.max(...lines.map((l) => ctx.measureText(l).width))
      })()
    : Math.max(...lines.map((l) => l.length)) * ann.fontSize * 0.6

  if (ann.shape === 'box') {
    const pad = textPadding(ann.fontSize)
    return { x: ann.x - pad, y: ann.y - pad, w: textW + pad * 2, h: textH + pad * 2 }
  }
  return { x: ann.x, y: ann.y, w: textW, h: textH }
}

/** Returns true if point (px, py) hits the annotation (image-pixel space). */
export function hitTest(ann: Annotation, px: number, py: number): boolean {
  const pad = Math.max(8, ann.sw * 2)
  if (ann.type === 'pen') {
    // A bbox test is too permissive for a squiggly stroke (clicking in the
    // empty middle of a "U" shape would falsely hit) — check actual segments.
    const { points } = ann
    for (let i = 1; i < points.length; i++) {
      if (distToSegment(px, py, points[i - 1].x, points[i - 1].y, points[i].x, points[i].y) <= pad) return true
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
