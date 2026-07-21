// Annotation types — all coordinates are in image-pixel space.

export interface AnnotationBase {
  id: string
  color: string  // hex, e.g. '#EF4444'
  sw: number     // stroke width in image pixels
}

export type ArrowHead = 'triangle' | 'line' | 'dot'
export interface ArrowAnn extends AnnotationBase {
  type: 'arrow'
  x1: number; y1: number
  x2: number; y2: number
  head: ArrowHead
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
}
export interface EllipseAnn extends AnnotationBase {
  type: 'ellipse'
  cx: number; cy: number
  rx: number; ry: number
  fill: 'stroke' | 'solid' | 'semi'
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
  /** Blur radius preset; absent (pre-existing annotations) = 'medium'. */
  strength?: BlurStrength
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
}
export type Annotation =
  | ArrowAnn | LineAnn | PenAnn | RectAnn | EllipseAnn
  | TextAnn  | NumberAnn | BlurAnn | HighlightAnn
  | SpotlightAnn

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
  white:  '#F8F9FE',
  black:  '#0F1117',
}

// Tailwind v3 full color palette — rows: families, cols: shades 50→950
export const TAILWIND_FAMILY_NAMES = [
  'slate','gray','zinc','neutral','stone',
  'red','orange','amber','yellow','lime',
  'green','emerald','teal','cyan','sky',
  'blue','indigo','violet','purple','fuchsia','pink','rose',
]
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

function drawAnnotationInner(
  ctx: CanvasRenderingContext2D,
  ann: Annotation,
  img?: HTMLImageElement | null,
) {
  ctx.strokeStyle = ann.color
  ctx.fillStyle = ann.color
  ctx.lineWidth = ann.sw
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  switch (ann.type) {
    case 'arrow': {
      const { x1, y1, x2, y2 } = ann
      const dx = x2 - x1; const dy = y2 - y1
      const len = Math.hypot(dx, dy)
      if (len < 2) break
      const angle = Math.atan2(dy, dx)

      if (ann.head === 'line') {
        const headLen = Math.max(10, ann.sw * 4)
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.stroke()

        ctx.beginPath()
        ctx.moveTo(x2 - headLen * Math.cos(angle - Math.PI / 6),
                   y2 - headLen * Math.sin(angle - Math.PI / 6))
        ctx.lineTo(x2, y2)
        ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6),
                   y2 - headLen * Math.sin(angle + Math.PI / 6))
        ctx.stroke()
        break
      }

      if (ann.head === 'dot') {
        const r = Math.max(4, ann.sw * 1.2)
        const shorten = r * 0.6
        const ex = x2 - shorten * Math.cos(angle)
        const ey = y2 - shorten * Math.sin(angle)
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(ex, ey)
        ctx.stroke()

        ctx.beginPath()
        ctx.arc(x2, y2, r, 0, Math.PI * 2)
        ctx.fill()
        break
      }

      // 'triangle' (default)
      const headLen = Math.max(10, ann.sw * 5)
      const shorten = headLen * 0.85
      const ex = x2 - shorten * Math.cos(angle)
      const ey = y2 - shorten * Math.sin(angle)
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(ex, ey)
      ctx.stroke()

      ctx.beginPath()
      ctx.moveTo(x2, y2)
      ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6),
                 y2 - headLen * Math.sin(angle - Math.PI / 6))
      ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6),
                 y2 - headLen * Math.sin(angle + Math.PI / 6))
      ctx.closePath()
      ctx.fill()
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
      if (fill === 'solid') {
        ctx.fillRect(rx, ry, rw, rh)
      } else if (fill === 'semi') {
        ctx.globalAlpha = 0.35
        ctx.fillRect(rx, ry, rw, rh)
        ctx.globalAlpha = 1
      } else {
        ctx.strokeRect(rx, ry, rw, rh)
      }
      break
    }

    case 'ellipse': {
      const { cx, cy, rx, ry, fill } = ann
      if (Math.abs(rx) < 1 || Math.abs(ry) < 1) break
      ctx.beginPath()
      ctx.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2)
      if (fill === 'solid') {
        ctx.fill()
      } else if (fill === 'semi') {
        ctx.globalAlpha = 0.35
        ctx.fill()
        ctx.globalAlpha = 1
      } else {
        ctx.stroke()
      }
      break
    }

    case 'text': {
      const { x, y, text, fontSize, shape } = ann
      if (!text) break
      ctx.font = `bold ${fontSize}px "Inter", system-ui, sans-serif`
      ctx.textBaseline = 'top'
      const lineH = fontSize * 1.25
      const lines = text.split('\n')

      if (shape && shape !== 'none') {
        const pad = textPadding(fontSize)
        const textW = Math.max(...lines.map((l) => ctx.measureText(l).width))
        const textH = lineH * lines.length
        const bx = x - pad
        const by = y - pad
        const bw = textW + pad * 2
        const bh = textH + pad * 2
        const radius = Math.min(fontSize * 0.4, bw / 2, bh / 2)

        ctx.save()
        try {
          ctx.shadowColor = 'rgba(0,0,0,0.35)'
          ctx.shadowBlur = 6
          ctx.shadowOffsetY = 2
          ctx.fillStyle = ann.color
          ctx.beginPath()
          ctx.roundRect(bx, by, bw, bh, radius)
          if (shape === 'bubble') {
            // Small triangular tail hanging off the bottom-left, drawn as a
            // second subpath in the same fill so it merges seamlessly with
            // the rounded body (both filled with the identical solid color).
            const tailH = bubbleTailHeight(fontSize)
            const tailW = tailH * 0.9
            const t0 = bx + bw * 0.22
            ctx.moveTo(t0, by + bh)
            ctx.lineTo(t0 - tailW * 0.3, by + bh + tailH)
            ctx.lineTo(t0 + tailW, by + bh)
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
        lines.forEach((line, i) => ctx.fillText(line, x, firstBaselineY + i * lineH))
        break
      }

      ctx.shadowColor = 'rgba(0,0,0,0.6)'
      ctx.shadowBlur = 4
      lines.forEach((line, i) => ctx.fillText(line, x, y + i * lineH))
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
      ctx.fillStyle = '#FFFFFF'
      ctx.strokeStyle = 'transparent'
      ctx.font = `bold ${r * 1.3}px "Inter", system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.shadowColor = 'transparent'
      ctx.fillText(String(n), cx, cy + r * 0.05)
      void color
      break
    }

    case 'blur': {
      const { x, y, w, h } = ann
      if (Math.abs(w) < 4 || Math.abs(h) < 4) break
      const rx = Math.min(x, x + w); const ry = Math.min(y, y + h)
      const rw = Math.abs(w); const rh = Math.abs(h)
      if (img) {
        // Gaussian blur. Radius scales with the region so intensity stays
        // consistent regardless of image resolution (the export canvas
        // renders at full res); the strength preset shifts the whole scale.
        const div = ann.strength === 'low' ? 12 : ann.strength === 'high' ? 3 : 6
        const minR = ann.strength === 'low' ? 4 : ann.strength === 'high' ? 16 : 8
        const radius = Math.max(minR, Math.min(rw, rh) / div)
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
      ctx.globalAlpha = 0.4
      ctx.lineWidth = sw * 6
      ctx.lineCap = 'butt'
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      ctx.globalAlpha = 1
      break
    }

    case 'spotlight': {
      // Dims everything outside the region by painting four dark rects around it
      // (so the image underneath stays intact inside the region).
      const { x, y, w, h } = ann
      if (Math.abs(w) < 4 || Math.abs(h) < 4) break
      const W = img?.naturalWidth ?? 0
      const H = img?.naturalHeight ?? 0
      if (W === 0 || H === 0) break
      const rx = Math.min(x, x + w); const ry = Math.min(y, y + h)
      const rw = Math.abs(w); const rh = Math.abs(h)
      ctx.fillStyle = `rgba(0,0,0,${ann.dim ?? 0.55})`
      ctx.fillRect(0, 0, W, ry)                  // top
      ctx.fillRect(0, ry + rh, W, H - ry - rh)   // bottom
      ctx.fillRect(0, ry, rx, rh)                // left
      ctx.fillRect(rx + rw, ry, W - rx - rw, rh) // right
      break
    }

  }
}

/** Rough bounding box for an annotation (image-pixel space). */
export function getAnnotationBounds(
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

/** Height (image px) of the speech-bubble tail below the box's bottom edge. */
function bubbleTailHeight(fontSize: number): number {
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

function measureTextBounds(ann: TextAnn): { x: number; y: number; w: number; h: number } {
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

  if (ann.shape && ann.shape !== 'none') {
    const pad = textPadding(ann.fontSize)
    const tailH = ann.shape === 'bubble' ? bubbleTailHeight(ann.fontSize) : 0
    return { x: ann.x - pad, y: ann.y - pad, w: textW + pad * 2, h: textH + pad * 2 + tailH }
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
