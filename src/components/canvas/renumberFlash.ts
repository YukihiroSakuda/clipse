import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import type { Annotation } from '../../lib/annotations'
import { useStore } from '../../lib/store'

/** How long a renumbered marker's ring stays up, fading out. */
const FLASH_MS = 700
const FLASH_COLOR = '251, 191, 36' // amber — distinct from the selection blue

interface Flash {
  ids: Set<string>
  startedAt: number
}

/**
 * Rings the markers an edit renumbered as a side effect (a delete closing the
 * gap, a retype shifting its neighbors), so a number that changed on its own
 * can be seen changing rather than just being different afterwards.
 *
 * The fade is driven straight through `redraw` on animation frames instead of
 * through React state: it touches nothing but the canvas, and re-rendering
 * the whole editor canvas component forty times to animate a ring would be
 * all cost and no benefit.
 */
export function useRenumberFlash(redrawRef: MutableRefObject<() => void>) {
  const flash = useStore((s) => s.renumberFlash)
  const flashRef = useRef<Flash | null>(null)

  useEffect(() => {
    if (flash.ids.length === 0) return
    flashRef.current = { ids: new Set(flash.ids), startedAt: performance.now() }
    let raf = requestAnimationFrame(function tick() {
      const f = flashRef.current
      if (!f) return
      if (performance.now() - f.startedAt >= FLASH_MS) flashRef.current = null
      redrawRef.current()
      if (flashRef.current) raf = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(raf)
  }, [flash, redrawRef])

  /** Paints the ring (screen space) for the flash in progress, if any. */
  return (ctx: CanvasRenderingContext2D, annotations: Annotation[], ox: number, oy: number, scale: number) => {
    const f = flashRef.current
    if (!f) return
    const alpha = 1 - Math.min(1, (performance.now() - f.startedAt) / FLASH_MS)
    ctx.save()
    ctx.strokeStyle = `rgba(${FLASH_COLOR}, ${alpha})`
    ctx.lineWidth = 3
    for (const a of annotations) {
      if (a.type !== 'number' || !f.ids.has(a.id)) continue
      const cx = ox + a.cx * scale
      const cy = oy + a.cy * scale
      const r = a.r * scale + 5
      ctx.beginPath()
      if (a.shape === 'square') ctx.roundRect(cx - r, cy - r, r * 2, r * 2, r * 0.28)
      else ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
  }
}
