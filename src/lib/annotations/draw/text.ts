// Text, in all three of its shapes: plain glyphs, a boxed caption, and a
// speech bubble. The longest case by far, because the box/bubble backgrounds,
// the tail, and the baseline math all have to agree with `measureTextBounds`
// and with the editing textarea's own CSS layout.

import { annotationPivot } from '../geometry'
import { applyShadowOrGlow, getShadowStyle } from '../style'
import { bubbleCornerRadius, bubbleTailHeight, bubbleTailPoints, resolveTextColors, textPadding } from '../text'
import type { TextAnn } from '../types'
import { paintShadowOutsideOnly } from './shared'
import type { DrawEnv } from './env'

export function drawText(ctx: CanvasRenderingContext2D, ann: TextAnn, env: DrawEnv): void {
  const { viewScale } = env
  const { x, y, text, fontSize, shape, align } = ann
  if (!text) return
  const textRot = ann.rotation ?? 0
  if (textRot) {
    // Spin the whole block (background box/bubble tail included) around
    // its bounds center — the same pivot `annotationPivot` hands the
    // selection box, handles and connection anchors.
    const pivot = annotationPivot(ann)!
    ctx.translate(pivot.x, pivot.y)
    ctx.rotate((textRot * Math.PI) / 180)
    ctx.translate(-pivot.x, -pivot.y)
  }
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
  // How far a `textBaseline: 'top'` draw needs to shift *down* from the
  // line's own top edge to land where the browser puts a real text run
  // under `line-height` — used by both the plain and box/bubble cases
  // below, so the editing textarea (a real DOM element under CSS
  // `line-height`) and the canvas commit land on the same pixel.
  //
  // This was tried as a font-metrics computation instead — reading
  // `ctx.measureText(...).fontBoundingBoxAscent/Descent` and splitting
  // `lineH - (ascent+descent)` in half, on the theory that `fontSize`
  // alone is a poor stand-in for a font's real vertical metrics. That
  // theory was wrong: a `<textarea>` is a replaced form control, not a
  // plain inline text run, and Chrome does not lay out its internal
  // text using the CSS inline half-leading algorithm applied to the
  // font's own ascent/descent box — empirically (an isolated HTML page,
  // several font sizes, several candidate offsets, screenshotted and
  // compared pixel-by-pixel) the textarea's actual first-line position
  // matches this plain `fontSize`-based formula far more closely than
  // the "more correct-looking" font-metrics one, which was off by
  // several pixels. Measure before re-deriving this from theory again.
  const halfLead = (lineH - fontSize) / 2

  if (shape && shape !== 'none') {
    const { bg, text: textColor } = resolveTextColors(ann)
    const bgFill = ann.bgFill ?? 'solid'
    const pad = textPadding(fontSize)
    const textH = lineH * lines.length
    const bx = x - pad
    const by = y - pad
    const bw = textW + pad * 2
    const bh = textH + pad * 2
    const radius = bubbleCornerRadius(fontSize, bw, bh)

    // Body (rounded rect) and tail as separate path-builders — 'stroke'
    // (below) draws them differently (tail filled, body only outlined),
    // while 'white'/'solid' still want them as one combined path so a
    // single fill/stroke merges them seamlessly. Built fresh each call
    // rather than once into a reusable Path2D: `paintShadowOutsideOnly`
    // needs to retrace its path twice (clip, then the real draw).
    const buildBodyPath = () => { ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, radius) }
    // Small triangular tail hanging off one of the box's 16 tail anchors
    // (default: bottom edge, left of center).
    const tailPoints = () => {
      const tailH = bubbleTailHeight(fontSize)
      return bubbleTailPoints(ann.tailAnchor ?? 's3', bx, by, bw, bh, tailH, radius)
    }
    const buildTailPath = () => {
      const [p0, p1, p2] = tailPoints()
      ctx.beginPath()
      ctx.moveTo(p0.x, p0.y)
      ctx.lineTo(p1.x, p1.y)
      ctx.lineTo(p2.x, p2.y)
      ctx.closePath()
    }
    const buildBoxPath = () => {
      buildBodyPath()
      if (shape === 'bubble') {
        // Second subpath in the same fill/stroke so it merges seamlessly
        // with the rounded body (both painted in the identical color).
        const [p0, p1, p2] = tailPoints()
        ctx.moveTo(p0.x, p0.y)
        ctx.lineTo(p1.x, p1.y)
        ctx.lineTo(p2.x, p2.y)
        ctx.closePath()
      }
    }

    ctx.save()
    try {
      applyShadowOrGlow(ctx, ann, viewScale, bg, { w: bw, h: bh })
      const hasShadow = getShadowStyle(ann) !== 'none'
      // Every fill/stroke below goes through paintShadowOutsideOnly, even
      // the ones whose interior ends up fully opaque ('white'/'solid') —
      // a later draw call's shadow isn't retroactively hidden by an
      // earlier one's opacity. Concretely: 'white' paints the fill, then
      // the border on top of it as a *separate* draw call; that border's
      // own shadow, if unclipped, is cast fresh from the border's shape
      // and lands on top of the already-painted fill wherever it reaches
      // beyond the border itself — visible sitting in front of the
      // background instead of hidden behind the whole shape. Wrapping
      // every paint call (not just the technically-transparent 'stroke'
      // case) closes that regardless of fill order.
      if (bgFill === 'stroke') {
        // "Knockout": no fill on the body — the image underneath shows
        // through its interior, so a shadow/glow must not bleed across
        // the border into it. The tail stays solid-filled even here
        // rather than following the body's own outline-only treatment:
        // it's a thin sliver sharing an edge with the body's own stroke,
        // and a matching outline there reads as a stray line at the seam
        // rather than a pointer aimed at whatever the bubble points to.
        if (shape === 'bubble') {
          ctx.fillStyle = bg
          paintShadowOutsideOnly(ctx, hasShadow, buildTailPath, () => ctx.fill())
        }
        ctx.strokeStyle = bg
        ctx.lineWidth = ann.sw
        paintShadowOutsideOnly(ctx, hasShadow, buildBodyPath, () => ctx.stroke())
      } else if (bgFill === 'white') {
        // Fixed white fill plus a border in the accent color — the
        // classic outlined-caption look. The tail is its own fill
        // rather than folded into the body's path (the border should
        // trace the body only, not detour around the tail's tip), and
        // paints solid in the border color rather than white: a white
        // flap outlined only where it meets the body reads as a stray
        // white triangle hanging off the border, not part of the same
        // shape — filling it in the border color instead makes it read
        // as the border's own point.
        if (shape === 'bubble') {
          ctx.fillStyle = bg
          paintShadowOutsideOnly(ctx, hasShadow, buildTailPath, () => ctx.fill())
        }
        // Only the fill casts the shadow, not the stroke on top of it —
        // both paint()ing in one pass each cast their own copy, and
        // since the stroke's ring sits right at the fill's own edge, the
        // two shadows nearly coincide almost everywhere *except* that
        // ring, where the doubled-up alpha reads as an extra outline
        // traced around the shadow itself. A soft blur used to smear
        // that seam into invisibility; at blur 0 (a flat, hard-edged
        // shadow, the point of the whole exercise) it's a crisp, visible
        // artifact instead. The fill's own silhouette is already the
        // right shape for a shadow — the classic "card lifted off the
        // page" look — so the stroke doesn't need its own.
        ctx.fillStyle = '#FFFFFF'
        paintShadowOutsideOnly(ctx, hasShadow, buildBodyPath, () => ctx.fill())
        ctx.strokeStyle = bg
        ctx.lineWidth = ann.sw
        ctx.shadowColor = 'transparent'
        buildBodyPath()
        ctx.stroke()
      } else {
        ctx.fillStyle = bg
        paintShadowOutsideOnly(ctx, hasShadow, buildBoxPath, () => ctx.fill())
      }
    } finally {
      ctx.restore()
    }

    ctx.fillStyle = textColor
    ctx.shadowColor = 'transparent'
    // Same `textBaseline: 'top'` + half-leading formula (computed once,
    // above) the plain-text case below uses, not an ink-metrics-based
    // center (`middle` baseline, or measuring actualBoundingBoxAscent/
    // Descent) — `by` is already `y - pad` on each side, so the padded
    // box's content area sits at exactly `y`, same origin plain text
    // starts from; centering on the box's actual *ink* extents instead
    // disagreed with the editing textarea's plain CSS line-height
    // layout (which has no idea what glyphs are actually in the text),
    // producing the same "sits high, jumps on commit" mismatch the
    // plain-text comment below already describes and this case used to
    // independently reintroduce.
    ctx.textBaseline = 'top'
    lines.forEach((line, i) => ctx.fillText(line, lineX(i), y + halfLead + i * lineH))
    return
  }

  applyShadowOrGlow(ctx, ann, viewScale, ann.color, { w: textW, h: lineH * lines.length })
  // `textBaseline: 'top'` puts the full line-height leading *below* the
  // glyphs, but the bounds box (measureTextBounds) and the edit textarea
  // both split that leading half above / half below (`halfLead`,
  // computed once above). Match them — otherwise the text sits high in
  // its box and jumps up on commit.
  lines.forEach((line, i) => ctx.fillText(line, lineX(i), y + halfLead + i * lineH))
  return
}
