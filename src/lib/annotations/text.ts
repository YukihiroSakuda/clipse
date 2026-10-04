// Text measurement and the speech-bubble geometry built on it. The one place
// that touches a canvas to measure a string — everything else asks here.

import type { BubbleTailAnchor, TextAnn, TextBgFill, TextShape } from './types'

/** Clockwise from the top-left of the north edge — the same rotational
 *  convention as `CONNECT_ANCHORS`, just without corners. */
export const BUBBLE_TAIL_ANCHORS: BubbleTailAnchor[] = [
  'n1', 'n2', 'n3', 'n4',
  'e1', 'e2', 'e3', 'e4',
  's1', 's2', 's3', 's4',
  'w1', 'w2', 'w3', 'w4',
]

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
export function bubbleTailAnchorPoint(
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
 * Resolves a box/bubble text annotation's effective background and font
 * colors, honoring each side's independent "auto" state: an absent
 * `textColor` auto-tracks `bg`'s contrast, and `bgAuto` tracks `textColor`'s
 * contrast the other way — but only once `textColor` is itself explicit, so
 * the two auto states can't chase each other when neither side has been
 * customized yet (a fresh annotation just keeps its created `color`, with
 * `textColor` auto-contrasting against *that*, same as before either side
 * existed).
 *
 * The Background/Text toggle (ToolOptionsPanel's Color block) is a single
 * palette with two roles, not two independently-remembered colors: picking
 * a color paints whichever side is currently active, and *switching* the
 * toggle carries that same color over to the other side (the one you're
 * leaving becomes the new explicit value; the one you're arriving at goes
 * back to auto-contrasting) — see `Editor.tsx`'s `handleBgAuto`/
 * `handleTextColorAuto`. `textColor` is always cleared the moment it's
 * inactive, so its mere presence is reliably "this document has an explicit
 * text color, honor it" — true for a toggle currently on Text, and equally
 * true for a document saved before this toggle existed, whose `textColor`
 * was set by the old, since-removed standalone text-color swatch.
 *
 * For a bordered fill (`'white'`/`'stroke'` — see `TextBgFill`), the auto
 * default instead *matches* the border (`bg`) rather than contrasting
 * against it: border + text in one accent color is the classic outlined-
 * caption look, and a contrast color would fight the border instead of
 * reading as one unit. `'solid'` (no border) keeps the original contrast
 * default, since there the text sits directly on the fill.
 */
export function resolveTextColors(
  ann: { color: string; textColor?: string; bgAuto?: boolean; bgFill?: TextBgFill },
): { bg: string; text: string } {
  const bg = ann.bgAuto && ann.textColor != null ? contrastTextColor(ann.textColor) : ann.color
  const bordered = ann.bgFill === 'white' || ann.bgFill === 'stroke'
  const text = ann.textColor ?? (bordered ? bg : contrastTextColor(bg))
  return { bg, text }
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

export function measureTextBounds(ann: TextAnn): { x: number; y: number; w: number; h: number } {
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
