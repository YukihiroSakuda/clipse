import { useCallback, useEffect, useRef, useState } from 'react'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { emit, listen } from '@tauri-apps/api/event'
import { ipc, WindowInfo, MonitorInfo, ElementRect, FixedRegionSpec } from '../lib/ipc'
import { t, Lang } from '../lib/i18n'
import styles from './Overlay.module.css'

type HoverTarget =
  | { type: 'window'; info: WindowInfo }
  | { type: 'monitor'; info: MonitorInfo }
  | null

interface DragRect {
  startX: number
  startY: number
  endX: number
  endY: number
}

function normalized(r: DragRect) {
  return {
    x: Math.min(r.startX, r.endX),
    y: Math.min(r.startY, r.endY),
    w: Math.abs(r.endX - r.startX),
    h: Math.abs(r.endY - r.startY),
  }
}

// Physical global → canvas-local CSS pixels
function physToLocal(px: number, py: number, ox: number, oy: number, dpr: number) {
  return { lx: (px - ox) / dpr, ly: (py - oy) / dpr }
}

const DRAG_THRESHOLD = 5
const HIGHLIGHT_COLOR = '#4F8EF7'

// Drag-time pixel magnifier (loupe): device pixels sampled around the cursor
// and the zoom factor they're blown up by. MAG_SRC must stay odd so a single
// center pixel exists for the crosshair. Box edge = MAG_SRC * MAG_ZOOM CSS px.
const MAG_SRC = 17
const MAG_ZOOM = 8
const MAG_SIZE = MAG_SRC * MAG_ZOOM
const MAG_TEXT_H = 22 // coordinate strip under the zoom box


export default function Overlay() {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const originRef = useRef<[number, number]>([0, 0])
  const windowsRef = useRef<WindowInfo[]>([])
  const monitorsRef = useRef<MonitorInfo[]>([])
  const hoverTargetRef = useRef<HoverTarget>(null)
  const dragRef = useRef<DragRect | null>(null)
  const mouseDownPosRef = useRef<{ x: number; y: number } | null>(null)
  const isDraggingRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  const scrollModeRef = useRef(false)
  // Selection constraint set by the Fixed Capture window (tray → dedicated
  // window → this overlay), or null for a normal free-form capture. Fetched
  // once per session in init(), same lifecycle as scrollModeRef.
  const fixedRegionRef = useRef<FixedRegionSpec | null>(null)
  // Size-mode only: the fixed-size rect (global physical px) centered on the
  // cursor, recomputed every mouse move. Null in ratio mode / no constraint
  // — findTarget/hover own the highlight there instead.
  const fixedCursorRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  // Partial-redraw bookkeeping: avoid repainting the whole virtual-screen dim layer
  // every frame (the main source of overlay sluggishness on large/multi-monitor setups).
  const needFullDimRef = useRef(true)
  const prevDirtyRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  // Screenpresso-style sub-window targeting: UIA element rects cached per window id.
  const elementRectsRef = useRef<Map<number, ElementRect[]>>(new Map())
  const requestedWindowsRef = useRef<Set<number>>(new Set())
  // The sub-element rect currently under the cursor (physical px), if finer than window.
  const subRectRef = useRef<ElementRect | null>(null)
  // Nested rects under the cursor, smallest→largest, for mouse-wheel level navigation.
  const hierarchyRef = useRef<ElementRect[]>([])
  // Depth measured from the widest level: 0 = whole window (default), higher = finer.
  const subLevelRef = useRef(0)
  // Last cursor position in CSS pixels, for re-resolving after async rect fetch.
  const lastPointRef = useRef<{ cx: number; cy: number } | null>(null)
  // Cursor position in CSS pixels, tracked through drags too (lastPointRef is
  // hover-only) — drives the drag-time magnifier and size readout.
  const cursorRef = useRef<{ cx: number; cy: number } | null>(null)
  // Toggle: hold Ctrl to suppress sub-element targeting and select the whole window.
  const subTargetEnabledRef = useRef(true)
  // Highlight rect (global physical) broadcast from whichever overlay the cursor is
  // on, so a window/element spanning displays is outlined on every monitor. Only the
  // overlay without a local hover renders this. Updated on hover change (cheap), not
  // per mouse move.
  const externalHoverRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  const lastSentHoverRef = useRef<string | null>(null)
  const langRef = useRef<Lang>('en')
  // PrintScreen-time frozen desktop snapshot (this monitor's slice), drawn as the
  // background so highlighted/dimmed regions show what was on screen at that
  // instant — a context menu included — instead of relying on this window's own
  // transparency to reveal the (possibly since-changed) live desktop. `null`
  // means no frozen frame is available yet/at all; draw() then falls back to
  // the old transparent-window behavior for that frame.
  const frozenBitmapRef = useRef<ImageBitmap | null>(null)

  const [hint, setHint] = useState(t('overlayHintRegion', 'en'))
  const [cursor, setCursor] = useState<'crosshair' | 'default'>('default')

  // The idle-state hint text: scroll mode takes priority (the two can't
  // co-occur — see FixedRegionSpec), then a fixed size/ratio constraint,
  // then the plain free-form region hint.
  const defaultHint = useCallback((): string => {
    if (scrollModeRef.current) return t('overlayHintScroll', langRef.current)
    const fixed = fixedRegionRef.current
    if (fixed) {
      const value = fixed.is_ratio ? `${fixed.w}:${fixed.h}` : `${fixed.w}×${fixed.h}`
      return t(fixed.is_ratio ? 'overlayHintFixedRatio' : 'overlayHintFixedSize', langRef.current, { value })
    }
    return t('overlayHintRegion', langRef.current)
  }, [])

  // Set every render, read by the mount-only `overlay-show` effect below —
  // see the note next to `resizeCanvas`.
  const resizeCanvasRef = useRef<() => void>(() => {})

  // True from the moment a capture is submitted (which hides the root so the
  // overlay stays out of the screenshot) until the backend hides or re-shows
  // this window. Read by `ensureShown` to tell that deliberate hide apart from
  // a session that should be on screen.
  const submittingRef = useRef(false)
  // The `overlay-show` handler, reachable from the mouse handlers below — same
  // pattern as `resizeCanvasRef`, since those are re-created every render while
  // the listener is registered once on mount.
  const showRef = useRef<() => void>(() => {})

  // Sends one failure line to `clipse.log` (a webview console is unreachable in
  // a release build) and keeps it on the console for dev.
  const report = useCallback((where: string, err: unknown) => {
    console.error(`[overlay] ${where}`, err)
    void ipc.logDiag(`overlay: ${where} failed — ${String(err)}`).catch(() => {})
  }, [])

  useEffect(() => {
    const init = () => {
      const thisWin = getCurrentWebviewWindow()
      // Every fetch carries its own fallback, and the dim layer is painted no
      // matter what. This window is transparent and full-screen: if a rejected
      // promise skipped the draw, the user would be left looking at an unchanged
      // desktop that silently swallows every click — visually identical to the
      // hotkey never firing, and only escapable with Esc. A degraded overlay
      // (no window targets, no frozen background) is always better than that.
      Promise.all([
        // Use the overlay's actual physical position rather than xcap's estimate.
        // outerPosition() returns PhysicalPosition — the exact OS-reported top-left
        // of the window content area (no rounding from phys_x/scale_factor).
        thisWin.outerPosition().catch(() => null),
        thisWin.outerSize().catch(() => null),
        ipc.getWindowsInfo().catch((e) => { report('getWindowsInfo', e); return [] }),
        ipc.getMonitors().catch((e) => { report('getMonitors', e); return [] }),
        ipc.getScrollMode().catch((e) => { report('getScrollMode', e); return false }),
        ipc.getFixedRegion().catch(() => null),
        ipc.getSettings().catch(() => null),
      ])
        .then(([pos, size, windows, monitors, scrollMode, fixedRegion, settings]) => {
          originRef.current = pos ? [pos.x, pos.y] : [0, 0]
          windowsRef.current = windows
          monitorsRef.current = monitors
          scrollModeRef.current = scrollMode
          fixedRegionRef.current = fixedRegion
          fixedCursorRectRef.current = null
          langRef.current = settings?.language ?? 'en'
          setHint(defaultHint())
          scheduleDraw()

          if (!pos || !size) {
            report('geometry', 'outerPosition/outerSize unavailable')
            return
          }
          // Fetch this monitor's own slice of the PrintScreen-time frozen snapshot
          // separately, so decoding it doesn't hold up the rest of the overlay
          // becoming interactive. `null` (freeze failed, or off-Windows) leaves
          // draw() falling back to this window's own transparency.
          ipc.getFrozenFrame(pos.x, pos.y, size.width, size.height)
            .then((buf) => (buf ? createImageBitmap(new Blob([buf], { type: 'image/png' })) : null))
            .then((bitmap) => {
              frozenBitmapRef.current?.close()
              frozenBitmapRef.current = bitmap
              needFullDimRef.current = true
              scheduleDraw()
            })
            .catch((e) => report('getFrozenFrame', e))
        })
        .catch((e) => {
          report('init', e)
          setHint(defaultHint())
          scheduleDraw()
        })
    }
    init()

    // Wipes everything the previous capture session left painted on the canvas
    // (the frozen-desktop background above all), so the pooled window can never
    // flash the old capture when the backend re-shows it. The OS-level show()
    // happens *before* the frontend can react to `overlay-show`, so this must
    // run at hide time (`overlay-hidden`) — the show-time call is only a
    // defensive backstop in case the hide event was missed.
    const clearStaleFrame = () => {
      frozenBitmapRef.current?.close()
      frozenBitmapRef.current = null
      const canvas = canvasRef.current
      // canvas.width/height are device px ≥ CSS px, so this covers the full
      // surface regardless of the dpr transform on the context.
      canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
      needFullDimRef.current = true
    }

    // The backend hid the pool (capture submitted on some monitor, or Esc).
    // Only the overlay the user interacted with hides its own root; the others
    // — and the Esc path — still have the whole previous session on screen.
    // Clear it all now, while hidden.
    const unHide = listen('overlay-hidden', () => {
      if (rootRef.current) rootRef.current.style.visibility = 'hidden'
      submittingRef.current = false
      clearStaleFrame()
    })

    // The backend keeps this overlay alive and hidden between captures (a
    // prewarmed pool — no webview rebuild per PrintScreen) and re-shows it with
    // this event. Everything from the previous session is stale: the window
    // list, the scroll mode, the cached UIA rects, any in-progress drag, and
    // the root visibility (hidden right before the last capture). Reset it all
    // and re-fetch.
    const onShow = () => {
      submittingRef.current = false
      dragRef.current = null
      mouseDownPosRef.current = null
      isDraggingRef.current = false
      hoverTargetRef.current = null
      subRectRef.current = null
      hierarchyRef.current = []
      subLevelRef.current = 0
      lastPointRef.current = null
      cursorRef.current = null
      subTargetEnabledRef.current = true
      externalHoverRef.current = null
      lastSentHoverRef.current = null
      elementRectsRef.current.clear()
      requestedWindowsRef.current.clear()
      fixedCursorRectRef.current = null
      clearStaleFrame()
      setCursor('default')
      // Only after the stale frame is gone: restoring visibility first would
      // re-expose whatever the last session drew for a frame or two.
      if (rootRef.current) rootRef.current.style.visibility = ''
      // Re-measure unconditionally — the window may have been moved or resized
      // onto a different monitor while hidden, and a same-size re-show fires no
      // resize event at all (see `resizeCanvas`).
      resizeCanvasRef.current()
      init()
    }
    showRef.current = onShow
    const un = listen('overlay-show', onShow)
    return () => {
      un.then((f) => f())
      unHide.then((f) => f())
    }
  }, [])

  // Backstop for an `overlay-show` this window never received.
  //
  // The root is left `visibility: hidden` between sessions — by the capture
  // submit below, and by `overlay-hidden` — and only `overlay-show` brings it
  // back. Should that one event go missing (it is broadcast to every pooled
  // webview at the instant the backend shows them), this overlay would stay
  // blank yet clickable for the rest of the session: from the user's side,
  // "the overlay didn't appear on that monitor". A mouse event is proof the
  // window really is on screen, so treat it as the show that never arrived.
  // `submittingRef` keeps the deliberate hide during a capture submit out of
  // it — re-showing there would paint the overlay into the shot being taken.
  const ensureShown = useCallback(() => {
    if (submittingRef.current) return
    if (rootRef.current?.style.visibility !== 'hidden') return
    void ipc.logDiag('overlay: recovering from a missed overlay-show').catch(() => {})
    showRef.current()
  }, [])

  const findTarget = useCallback((cssX: number, cssY: number): HoverTarget => {
    const [ox, oy] = originRef.current
    const dpr = window.devicePixelRatio
    const px = ox + cssX * dpr
    const py = oy + cssY * dpr

    for (const win of windowsRef.current) {
      if (px >= win.x && px < win.x + win.width && py >= win.y && py < win.y + win.height) {
        return { type: 'window', info: win }
      }
    }
    for (const mon of monitorsRef.current) {
      if (px >= mon.x && px < mon.x + mon.width && py >= mon.y && py < mon.y + mon.height) {
        return { type: 'monitor', info: mon }
      }
    }
    return null
  }, [])

  // Physical-pixel point under a CSS-pixel cursor position.
  const toPhys = useCallback((cssX: number, cssY: number): [number, number] => {
    const [ox, oy] = originRef.current
    const dpr = window.devicePixelRatio
    return [ox + cssX * dpr, oy + cssY * dpr]
  }, [])

  // Fixed-size capture: the exact-pixel rect (global physical) centered on a
  // CSS-pixel cursor position, clamped to this monitor's own bounds (each
  // overlay is sized to exactly one monitor's physical bounds — see the
  // module-level notes on multi-monitor overlay layout).
  const computeFixedSizeRect = useCallback((cssX: number, cssY: number, w: number, h: number) => {
    const [pcx, pcy] = toPhys(cssX, cssY)
    const [ox, oy] = originRef.current
    const canvas = canvasRef.current
    const dpr = window.devicePixelRatio
    const monW = canvas?.width ?? window.innerWidth * dpr
    const monH = canvas?.height ?? window.innerHeight * dpr
    const x = Math.max(ox, Math.min(Math.round(pcx - w / 2), ox + Math.max(0, monW - w)))
    const y = Math.max(oy, Math.min(Math.round(pcy - h / 2), oy + Math.max(0, monH - h)))
    return { x, y, w, h }
  }, [toPhys])

  // Build the nested stack of rects under the cursor (smallest → largest), so the
  // mouse wheel can step out to wider enclosing regions or in to finer ones.
  // The whole window is always the outermost level, guaranteeing a wide-area option.
  const resolveSubRect = useCallback((px: number, py: number, win: WindowInfo) => {
    const rects = elementRectsRef.current.get(win.id) ?? []
    const winRight = win.x + win.width
    const winBottom = win.y + win.height
    const winArea = win.width * win.height
    const containing: ElementRect[] = []
    for (const r of rects) {
      if (px < r.x || px >= r.x + r.width || py < r.y || py >= r.y + r.height) continue
      // Clamp to the window's visible frame: UIA root/border rects can extend past the
      // DWM frame (into shadows / non-client area), which looks unnatural as a highlight.
      const x = Math.max(r.x, win.x)
      const y = Math.max(r.y, win.y)
      const width = Math.min(r.x + r.width, winRight) - x
      const height = Math.min(r.y + r.height, winBottom) - y
      if (width < 8 || height < 8) continue
      // Skip window-sized roots; the exact window rect below is the canonical widest level.
      if (width * height >= winArea * 0.98) continue
      containing.push({ x, y, width, height })
    }
    // The window itself (exact DWM frame) is the guaranteed, natural widest level.
    containing.push({ x: win.x, y: win.y, width: win.width, height: win.height })
    containing.sort((a, b) => a.width * a.height - b.width * b.height)
    // Drop near-duplicate levels so each wheel step is a meaningful size change.
    const stack: ElementRect[] = []
    for (const r of containing) {
      const last = stack[stack.length - 1]
      if (
        last &&
        Math.abs(last.x - r.x) <= 2 &&
        Math.abs(last.y - r.y) <= 2 &&
        Math.abs(last.width - r.width) <= 4 &&
        Math.abs(last.height - r.height) <= 4
      )
        continue
      stack.push(r)
    }
    hierarchyRef.current = stack
    subLevelRef.current = Math.max(0, Math.min(subLevelRef.current, stack.length - 1))
    // Depth 0 = widest (window) by default; deeper indices step toward finer elements.
    subRectRef.current = stack[stack.length - 1 - subLevelRef.current] ?? null
  }, [])

  // Lazily fetch UIA element rects for a window the first time it's hovered, then
  // re-resolve the sub-rect for the current cursor position once they arrive.
  const ensureRects = useCallback(
    (win: WindowInfo) => {
      if (requestedWindowsRef.current.has(win.id)) return
      requestedWindowsRef.current.add(win.id)
      ipc
        .getElementRects(win.id)
        .then(rects => {
          elementRectsRef.current.set(win.id, rects)
          // Cursor may still be over this window — refresh the highlight now.
          const pt = lastPointRef.current
          const cur = hoverTargetRef.current
          if (pt && cur?.type === 'window' && cur.info.id === win.id && subTargetEnabledRef.current) {
            const [px, py] = toPhys(pt.cx, pt.cy)
            resolveSubRect(px, py, win)
            broadcastHover()
            scheduleDraw()
          }
        })
        .catch(() => {
          elementRectsRef.current.set(win.id, [])
        })
    },
    [resolveSubRect, toPhys]
  )

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const [ox, oy] = originRef.current
    const dpr = window.devicePixelRatio
    // Backing store is sized in device pixels and the context is pre-scaled by dpr
    // (see resize), so we draw in CSS-pixel coordinates but rasterize crisply at
    // native resolution — no browser upscaling blur on the selection outline.
    const W = canvas.width / dpr
    const H = canvas.height / dpr
    const DIM = 'rgba(0,0,0,0.50)'

    // Draws the PrintScreen-time frozen snapshot into a CSS-pixel rect of the
    // canvas, so that area reads as "what was really on screen" — a right-click
    // menu included — rather than this window's own (possibly stale) transparency.
    // Falls back to a plain clearRect (today's transparent-peek-through behavior)
    // if no frozen frame is available yet/at all.
    const bitmap = frozenBitmapRef.current
    const drawFrozen = (rx: number, ry: number, rw: number, rh: number) => {
      if (bitmap) {
        ctx.drawImage(bitmap, rx * dpr, ry * dpr, rw * dpr, rh * dpr, rx, ry, rw, rh)
      } else {
        ctx.clearRect(rx, ry, rw, rh)
      }
    }

    // ── Pixel magnifier (loupe) ──────────────────────────────────────────
    // Sampled from the frozen snapshot (physical resolution), so it shows the
    // exact device pixels a selection edge would land on. Drawn in *both*
    // hover mode (before the click that fixes the drag's start point — the
    // whole point of a precision loupe is choosing where to click, so
    // showing it only after dragging has begun is too late) and drag mode
    // (where the start-corner loupe stays pinned so both edges can be
    // fine-tuned together). Defined once here so both modes share it.
    // `anchor` only steers the box's default offset direction (so the
    // cursor and drag-start loupes tend to land on opposite sides of their
    // point instead of overlapping when the selection is still small) and
    // its label/accent color; the sampling and crosshair math is identical.
    const drawMagnifier = (cssX: number, cssY: number, anchor: 'cursor' | 'start') => {
      if (!bitmap) return
      const half = (MAG_SRC - 1) / 2
      // Bitmap pixel (0,0) is this window's top-left, in device pixels.
      const sx = Math.min(Math.max(Math.round(cssX * dpr) - half, 0), Math.max(0, bitmap.width - MAG_SRC))
      const sy = Math.min(Math.max(Math.round(cssY * dpr) - half, 0), Math.max(0, bitmap.height - MAG_SRC))

      let bx: number, by: number
      if (anchor === 'cursor') {
        bx = cssX + 24; by = cssY + 24
        if (bx + MAG_SIZE + 8 > W) bx = cssX - 24 - MAG_SIZE
        if (by + MAG_SIZE + MAG_TEXT_H + 8 > H) by = cssY - 24 - MAG_SIZE - MAG_TEXT_H
      } else {
        bx = cssX - 24 - MAG_SIZE; by = cssY - 24 - MAG_SIZE - MAG_TEXT_H
        if (bx < 4) bx = cssX + 24
        if (by < 4) by = cssY + 24
      }
      bx = Math.min(Math.max(bx, 4), Math.max(4, W - MAG_SIZE - 4))
      by = Math.min(Math.max(by, 4), Math.max(4, H - MAG_SIZE - MAG_TEXT_H - 4))

      ctx.save()
      ctx.imageSmoothingEnabled = false
      ctx.fillStyle = 'rgba(18,18,22,0.95)'
      ctx.fillRect(bx - 1, by - 1, MAG_SIZE + 2, MAG_SIZE + MAG_TEXT_H + 2)
      ctx.drawImage(bitmap, sx, sy, MAG_SRC, MAG_SRC, bx, by, MAG_SIZE, MAG_SIZE)
      // Crosshair marking the exact pixel at (cssX, cssY): its index within
      // the sampled window — the window itself may be clamped away from
      // that pixel near a screen edge, in which case the crosshair
      // correctly slides off-center to keep tracking the true point rather
      // than staying pinned to the box's middle.
      const cpx = bx + (Math.round(cssX * dpr) - sx) * MAG_ZOOM
      const cpy = by + (Math.round(cssY * dpr) - sy) * MAG_ZOOM
      const accent = anchor === 'cursor' ? HIGHLIGHT_COLOR : '#F97316'
      ctx.strokeStyle = 'rgba(79,142,247,0.55)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(cpx + MAG_ZOOM / 2, by)
      ctx.lineTo(cpx + MAG_ZOOM / 2, by + MAG_SIZE)
      ctx.moveTo(bx, cpy + MAG_ZOOM / 2)
      ctx.lineTo(bx + MAG_SIZE, cpy + MAG_ZOOM / 2)
      ctx.stroke()
      ctx.strokeStyle = accent
      ctx.strokeRect(cpx + 0.5, cpy + 0.5, MAG_ZOOM - 1, MAG_ZOOM - 1)
      ctx.strokeRect(bx - 0.5, by - 0.5, MAG_SIZE + 1, MAG_SIZE + MAG_TEXT_H + 1)
      const [gox, goy] = originRef.current
      ctx.fillStyle = '#fff'
      ctx.font = '11px system-ui, sans-serif'
      const coord = `${Math.round(gox + cssX * dpr)}, ${Math.round(goy + cssY * dpr)}`
      ctx.fillText(anchor === 'start' ? `start ${coord}` : coord, bx + 6, by + MAG_SIZE + 15)
      ctx.restore()
    }

    if (isDraggingRef.current && dragRef.current) {
      // Region-drag mode: classic selection rect (full repaint — deliberate gesture).
      // Confined to this monitor; coords are clamped to the canvas in onMouseMove.
      ctx.clearRect(0, 0, W, H)
      drawFrozen(0, 0, W, H)
      const { x, y, w, h } = normalized(dragRef.current)

      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.fillRect(0, 0, W, y)
      ctx.fillRect(0, y + h, W, H - y - h)
      ctx.fillRect(0, y, x, h)
      ctx.fillRect(x + w, y, W - x - w, h)

      ctx.strokeStyle = HIGHLIGHT_COLOR
      ctx.lineWidth = 1.5
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)

      // ── Live size readout (physical px, what the capture will actually be) ──
      {
        const pw = Math.round(w * dpr)
        const ph = Math.round(h * dpr)
        const label = `${pw} × ${ph}`
        ctx.font = '12px system-ui, sans-serif'
        const tw = ctx.measureText(label).width
        // Below-right of the selection; flip inward near the canvas edges.
        let lx = x + w + 8
        let ly = y + h + 18
        if (lx + tw + 12 > W) lx = Math.max(4, x + w - tw - 12)
        if (ly > H - 6) ly = Math.max(14, y - 8)
        ctx.fillStyle = 'rgba(18,18,22,0.85)'
        ctx.fillRect(lx - 5, ly - 12, tw + 10, 17)
        ctx.fillStyle = '#fff'
        ctx.fillText(label, lx, ly)
      }

      // ── Pixel magnifier (loupe): cursor + pinned drag-start corner ──────
      const pt = cursorRef.current
      if (bitmap && pt) {
        const r = dragRef.current
        if (r) drawMagnifier(r.startX, r.startY, 'start')
        drawMagnifier(pt.cx, pt.cy, 'cursor')
      }

      // The drag repaint dirties the whole canvas; force a full dim when hover resumes.
      needFullDimRef.current = true
      prevDirtyRef.current = null
    } else {
      // Hover mode: dim the whole canvas, then punch through the hovered target.
      // A full repaint every frame (rather than restoring only the previous dirty
      // region) keeps it simple and artifact-free — partial restores could leave a
      // faint remnant of the previous highlight's border when moving quickly between
      // sub-elements. Each overlay covers a single monitor, so a full fill is cheap.
      ctx.clearRect(0, 0, W, H)
      drawFrozen(0, 0, W, H)
      ctx.fillStyle = DIM
      ctx.fillRect(0, 0, W, H)
      needFullDimRef.current = false

      const fixedRect = fixedCursorRectRef.current
      if (fixedRect) {
        // Fixed-size capture: punch through the exact rect the next click
        // will capture — same rendering as the window/monitor highlight
        // below, just sourced from the constraint instead of a hover.
        const { lx, ly } = physToLocal(fixedRect.x, fixedRect.y, ox, oy, dpr)
        const rx = Math.round(lx)
        const ry = Math.round(ly)
        const rw = Math.round(fixedRect.w / dpr)
        const rh = Math.round(fixedRect.h / dpr)
        drawFrozen(rx, ry, rw, rh)
        ctx.strokeStyle = HIGHLIGHT_COLOR
        ctx.lineWidth = 1.5
        ctx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1)
      } else {
        const target = hoverTargetRef.current
        const sub = subRectRef.current
        if (!target) {
          // No local hover. If another monitor's overlay broadcast a highlight (e.g.
          // a window spanning displays is hovered there), outline this monitor's slice
          // of it. Out-of-canvas parts are clipped by clearRect/strokeRect.
          const ext = externalHoverRef.current
          if (ext) {
            const lx = (ext.x - ox) / dpr
            const ly = (ext.y - oy) / dpr
            const lw = ext.w / dpr
            const lh = ext.h / dpr
            const pad = -2
            const rx = Math.round(lx - pad)
            const ry = Math.round(ly - pad)
            const rw = Math.round(lw + pad * 2)
            const rh = Math.round(lh + pad * 2)
            drawFrozen(rx, ry, rw, rh)
            ctx.strokeStyle = HIGHLIGHT_COLOR
            ctx.lineWidth = 1.5
            ctx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1)
          }
        } else {
          // A hovered sub-element (Screenpresso-style) takes priority over the whole
          // window; otherwise highlight the window/monitor bounds as before.
          const useSub = sub !== null && target.type === 'window'
          const phys = useSub ? sub! : target.info
          const { lx, ly } = physToLocal(phys.x, phys.y, ox, oy, dpr)
          const lw = phys.width / dpr
          const lh = phys.height / dpr
          // All borders drawn inward so they stay within canvas even for maximized windows.
          const pad = target.type === 'monitor' ? -4 : useSub ? -1 : -2

          // Pixel-snap the rect to integer CSS coords so an even-width stroke lands on
          // exact device pixels — sharp, solid edges instead of a soft anti-aliased line.
          const rx = Math.round(lx - pad)
          const ry = Math.round(ly - pad)
          const rw = Math.round(lw + pad * 2)
          const rh = Math.round(lh + pad * 2)

          // Punch through to the frozen snapshot (or live desktop, if unavailable)
          drawFrozen(rx, ry, rw, rh)

          // Sharp 1.5px border, pixel-snapped to avoid sub-pixel blur
          ctx.strokeStyle = HIGHLIGHT_COLOR
          ctx.lineWidth = 1.5
          ctx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1)
        }
      }

      // Precision loupe before the click, not just after: by the time a drag
      // has already started, its start point is fixed — seeing the
      // magnified cursor only then can't help you correct where you
      // clicked. Drawn *last* (on top of any hover-highlight redraw above)
      // — `drawFrozen` there can repaint a large area (the whole monitor
      // when hovering empty desktop), which would otherwise paint straight
      // over an already-drawn magnifier and make it flicker away.
      const hoverPt = cursorRef.current
      if (bitmap && hoverPt) drawMagnifier(hoverPt.cx, hoverPt.cy, 'cursor')
    }
  }, [])

  const scheduleDraw = useCallback(() => {
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      draw()
    })
  }, [draw])

  // Broadcast the currently highlighted rect (global physical) so other monitors'
  // overlays can outline their slice of a window/element that spans displays.
  // Deduped: only emits when the rect actually changes, so it never floods like a
  // per-mouse-move stream would. A monitor hover (single display) broadcasts null.
  const broadcastHover = useCallback(() => {
    const target = hoverTargetRef.current
    const sub = subRectRef.current
    let rect: { x: number; y: number; w: number; h: number } | null = null
    if (target?.type === 'window') {
      const r = sub && subTargetEnabledRef.current ? sub : target.info
      rect = { x: r.x, y: r.y, w: r.width, h: r.height }
    }
    const key = rect ? `${rect.x},${rect.y},${rect.w},${rect.h}` : null
    if (key === lastSentHoverRef.current) return
    lastSentHoverRef.current = key
    void emit('overlay-hover', rect)
  }, [])

  // Receive highlight broadcasts. The overlay with a local hover ignores them in
  // draw() (local wins); the others render this rect's slice.
  useEffect(() => {
    const un = listen<{ x: number; y: number; w: number; h: number } | null>(
      'overlay-hover',
      (e) => {
        externalHoverRef.current = e.payload
        needFullDimRef.current = true
        scheduleDraw()
      },
    )
    return () => { un.then((f) => f()) }
  }, [scheduleDraw])

  // Sizes the canvas backing store to the window. Must be callable on demand,
  // not just from a `resize` event: this window is pooled and gets shown/hidden
  // rather than created per capture, so if it is re-shown at the same size no
  // resize event fires and the canvas keeps whatever dimensions it had at mount.
  // A canvas that measured 0×0 back then would stay 0×0 forever, and every draw
  // would paint nothing — leaving a transparent full-screen window that
  // swallows clicks and looks exactly like the hotkey never firing.
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio
    // Backing store at native resolution for crisp 1:1 lines; CSS size stays 100%.
    canvas.width = Math.round(window.innerWidth * dpr)
    canvas.height = Math.round(window.innerHeight * dpr)
    const ctx = canvas.getContext('2d')!
    // Setting canvas.width resets context state, so re-apply the dpr transform here.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    // Resizing clears the backing store; the dim layer must be fully repainted.
    needFullDimRef.current = true
    draw()
  }, [draw])
  // Always-current handle for the mount-only `overlay-show` effect above, whose
  // own closure would otherwise stay pinned to the first render's `resizeCanvas`.
  resizeCanvasRef.current = resizeCanvas

  useEffect(() => {
    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)
    return () => window.removeEventListener('resize', resizeCanvas)
  }, [resizeCanvas])

  // Keyboard
  // Re-resolve the sub-element highlight for the last cursor position (after the
  // Ctrl toggle changes whether sub-targeting is active).
  const refreshHover = useCallback(() => {
    const pt = lastPointRef.current
    const target = hoverTargetRef.current
    if (pt && target?.type === 'window' && subTargetEnabledRef.current) {
      const [px, py] = toPhys(pt.cx, pt.cy)
      resolveSubRect(px, py, target.info)
    } else {
      subRectRef.current = null
      hierarchyRef.current = []
    }
    broadcastHover()
    scheduleDraw()
  }, [resolveSubRect, toPhys, scheduleDraw])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc cancels selection on every monitor's overlay, not just this one.
      if (e.key === 'Escape') void ipc.cancelOverlay()
      if (e.key === 'Enter' && isDraggingRef.current) void submitRegionCapture()
      // Hold Ctrl to suppress sub-element targeting and grab the whole window.
      if (e.key === 'Control' && subTargetEnabledRef.current) {
        subTargetEnabledRef.current = false
        refreshHover()
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control' && !subTargetEnabledRef.current) {
        subTargetEnabledRef.current = true
        refreshHover()
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
    }
  })

  const submitRegionCapture = useCallback(async () => {
    const r = dragRef.current
    if (!r) return
    const { x, y, w, h } = normalized(r)
    if (w < 4 || h < 4) return

    // Hide entire overlay (canvas + hint) before IPC so nothing shows in the
    // screenshot. `submittingRef` marks it as deliberate, so `ensureShown`
    // doesn't undo it on a stray mouse move while the capture is in flight.
    submittingRef.current = true
    if (rootRef.current) rootRef.current.style.visibility = 'hidden'
    await new Promise<void>(res => requestAnimationFrame(() => requestAnimationFrame(() => res())))

    setHint('Capturing…')
    const [ox, oy] = originRef.current
    const dpr = window.devicePixelRatio
    // Round to nearest physical pixel to avoid sub-pixel drift from float DPR.
    const px = Math.round(ox + x * dpr)
    const py = Math.round(oy + y * dpr)
    const pw = Math.round(w * dpr)
    const ph = Math.round(h * dpr)
    console.debug('[capture] origin=', ox, oy, 'dpr=', dpr, 'css=', x, y, w, h, 'phys=', px, py, pw, ph)
    try {
      if (scrollModeRef.current) {
        setHint('Scrolling & stitching…')
        await ipc.completeScrollCapture(px, py, pw, ph)
      } else {
        await ipc.completeRegionCapture(px, py, pw, ph)
      }
    } catch (e) {
      console.error('region capture error', e)
      setHint(t('overlayHintCaptureFailed', langRef.current))
    }
  }, [])

  // Capture an explicit physical-pixel rect (sub-element of a window). `windowId`,
  // when given, tells the backend to raise that window to the front first so the
  // region isn't occluded by other windows.
  const submitPhysRect = useCallback(async (x: number, y: number, width: number, height: number, windowId?: number) => {
    submittingRef.current = true
    if (rootRef.current) rootRef.current.style.visibility = 'hidden'
    await new Promise<void>(res => requestAnimationFrame(() => requestAnimationFrame(() => res())))
    setHint(scrollModeRef.current ? 'Scrolling & stitching…' : 'Capturing…')
    try {
      if (scrollModeRef.current) {
        await ipc.completeScrollCapture(x, y, width, height)
      } else {
        await ipc.completeRegionCapture(x, y, width, height, windowId)
      }
    } catch (e) {
      console.error('rect capture error', e)
      setHint(t('overlayHintCaptureFailed', langRef.current))
    }
  }, [])

  const submitTargetCapture = useCallback(async (target: HoverTarget) => {
    if (!target) return

    // Hide entire overlay (canvas + hint) before IPC so nothing shows in the
    // screenshot. `submittingRef` marks it as deliberate, so `ensureShown`
    // doesn't undo it on a stray mouse move while the capture is in flight.
    submittingRef.current = true
    if (rootRef.current) rootRef.current.style.visibility = 'hidden'
    await new Promise<void>(res => requestAnimationFrame(() => requestAnimationFrame(() => res())))

    setHint(scrollModeRef.current ? 'Scrolling & stitching…' : 'Capturing…')
    try {
      if (target.type === 'window') {
        if (scrollModeRef.current) {
          // Scroll capture works on a screen region, so pass the window bounds
          // (already physical px from DWMWA_EXTENDED_FRAME_BOUNDS) plus the
          // window id so the backend can raise it to the front first — the
          // overlay's own click never actually focuses/raises the window
          // underneath it, so without this whatever was really on top of
          // those coordinates gets captured in every scroll frame instead.
          const { x, y, width, height, id } = target.info
          await ipc.completeScrollCapture(x, y, width, height, id)
        } else {
          // True per-window capture (Windows.Graphics.Capture): handles occlusion,
          // GPU-accelerated apps (Chromium/Electron), and windows spanning monitors.
          await ipc.completeWindowCaptureById(target.info.id)
        }
      } else if (scrollModeRef.current) {
        const m = target.info as MonitorInfo
        await ipc.completeScrollCapture(m.x, m.y, m.width, m.height)
      } else {
        await ipc.completeMonitorCapture((target.info as MonitorInfo).id)
      }
    } catch (e) {
      console.error('target capture error', e)
      setHint(t('overlayHintCaptureFailed', langRef.current))
    }
  }, [])

  // Mouse wheel steps through the nested element hierarchy under the cursor:
  // scroll up → wider enclosing region, scroll down → finer element.
  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (isDraggingRef.current || !subTargetEnabledRef.current) return
    if (hoverTargetRef.current?.type !== 'window') return
    const stack = hierarchyRef.current
    if (stack.length === 0) return
    // Depth grows toward finer elements; scroll up (deltaY<0) widens (smaller depth).
    const next = subLevelRef.current + (e.deltaY < 0 ? -1 : 1)
    subLevelRef.current = Math.max(0, Math.min(next, stack.length - 1))
    subRectRef.current = stack[stack.length - 1 - subLevelRef.current] ?? null
    broadcastHover()
    scheduleDraw()
  }

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    ensureShown()
    mouseDownPosRef.current = { x: e.clientX, y: e.clientY }
    dragRef.current = { startX: e.clientX, startY: e.clientY, endX: e.clientX, endY: e.clientY }
    cursorRef.current = { cx: e.clientX, cy: e.clientY }
  }

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    ensureShown()
    cursorRef.current = { cx: e.clientX, cy: e.clientY }

    // Fixed-size capture: no drag concept — the selection is always this
    // exact size, centered on the cursor. Recompute it on every move
    // (whether or not the mouse is down) instead of the usual hover/drag
    // logic below; onMouseUp captures it directly as a plain click.
    const fixedSize = fixedRegionRef.current
    if (fixedSize && !fixedSize.is_ratio) {
      fixedCursorRectRef.current = computeFixedSizeRect(e.clientX, e.clientY, fixedSize.w, fixedSize.h)
      scheduleDraw()
      return
    }

    if (mouseDownPosRef.current) {
      const dx = e.clientX - mouseDownPosRef.current.x
      const dy = e.clientY - mouseDownPosRef.current.y
      if (!isDraggingRef.current && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        isDraggingRef.current = true
        setCursor('crosshair')
        setHint(t('overlayHintDragConfirm', langRef.current))
      }
      if (isDraggingRef.current && dragRef.current) {
        const r = dragRef.current
        // Confine the selection to this monitor's overlay: clamp to the canvas so
        // an implicit mouse-capture drag past the edge can't spill onto another
        // display (region drag is single-display by design).
        let ex = Math.max(0, Math.min(e.clientX, window.innerWidth))
        let ey = Math.max(0, Math.min(e.clientY, window.innerHeight))
        // Fixed-ratio capture: lock the dragged corner to the configured w:h
        // proportions. The axis that moved further (relative to the ratio)
        // stays as dragged; the other is derived from it — same "scale the
        // smaller axis" convention as the editor's Shift-constrain.
        const fixedRatio = fixedRegionRef.current
        if (fixedRatio?.is_ratio) {
          const ddx = ex - r.startX
          const ddy = ey - r.startY
          const ratio = fixedRatio.w / fixedRatio.h
          if (Math.abs(ddx) >= Math.abs(ddy) * ratio) {
            ey = r.startY + (ddy < 0 ? -1 : 1) * Math.abs(ddx) / ratio
          } else {
            ex = r.startX + (ddx < 0 ? -1 : 1) * Math.abs(ddy) * ratio
          }
        }
        r.endX = ex
        r.endY = ey
      }
    } else {
      lastPointRef.current = { cx: e.clientX, cy: e.clientY }
      // This overlay now owns the cursor, so it draws its own highlight — drop any
      // stale rect broadcast from another monitor.
      externalHoverRef.current = null
      const target = findTarget(e.clientX, e.clientY)
      hoverTargetRef.current = target
      if (target?.type === 'window' && subTargetEnabledRef.current) {
        ensureRects(target.info)
        const [px, py] = toPhys(e.clientX, e.clientY)
        resolveSubRect(px, py, target.info)
      } else {
        subRectRef.current = null
        hierarchyRef.current = []
      }
      broadcastHover()
    }
    scheduleDraw()
  }

  // The cursor left this monitor's overlay: clear local hover so a stale highlight
  // doesn't linger, and let broadcasts from the now-active monitor drive the view.
  const onMouseLeave = () => {
    if (isDraggingRef.current) return
    hoverTargetRef.current = null
    subRectRef.current = null
    hierarchyRef.current = []
    lastPointRef.current = null
    cursorRef.current = null
    lastSentHoverRef.current = null
    // Fixed-size capture: don't leave a stale preview rect pinned at the
    // last in-canvas cursor position once the cursor moves off this monitor.
    fixedCursorRectRef.current = null
    needFullDimRef.current = true
    scheduleDraw()
  }

  const onMouseUp = async (e: React.MouseEvent<HTMLCanvasElement>) => {
    // Fixed-size capture: click-to-capture at whatever rect is currently
    // shown at the cursor — no drag, no window/monitor targeting. Recompute
    // fresh at the release position rather than trusting the last drawn
    // frame, which could be a tick stale.
    const fixedSize = fixedRegionRef.current
    if (fixedSize && !fixedSize.is_ratio) {
      mouseDownPosRef.current = null
      dragRef.current = null
      const r = computeFixedSizeRect(e.clientX, e.clientY, fixedSize.w, fixedSize.h)
      await submitPhysRect(r.x, r.y, r.w, r.h)
      return
    }

    if (isDraggingRef.current) {
      isDraggingRef.current = false
      setCursor('default')
      setHint(defaultHint())
      const { w, h } = dragRef.current ? normalized(dragRef.current) : { w: 0, h: 0 }
      if (w > 4 && h > 4) {
        await submitRegionCapture()
        return
      }
      dragRef.current = null
      mouseDownPosRef.current = null
      scheduleDraw()
    } else {
      mouseDownPosRef.current = null
      dragRef.current = null
      // Fixed-ratio capture: a plain click (no drag) would normally grab the
      // hovered window/monitor whole — that can't honor the locked ratio, so
      // it's a no-op here; only a ratio-constrained drag (above) submits.
      if (fixedRegionRef.current?.is_ratio) {
        scheduleDraw()
        return
      }
      const target = hoverTargetRef.current ?? findTarget(e.clientX, e.clientY)
      // A *finer* sub-element (scrolled in with the wheel, subLevel > 0) is captured
      // as a screen region. The whole-window level (subLevel 0, the default) instead
      // goes through submitTargetCapture → true window capture (WGC), which handles
      // occlusion, GPU apps, and windows spanning monitors.
      const sub = subRectRef.current
      if (sub && target?.type === 'window' && subLevelRef.current > 0) {
        // Sub-element of a window: pass the window id so the backend raises it to
        // the front before capturing the region (avoids occlusion).
        await submitPhysRect(sub.x, sub.y, sub.width, sub.height, target.info.id)
      } else {
        await submitTargetCapture(target)
      }
    }
  }

  return (
    <div ref={rootRef} className={styles.root}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        style={{ cursor }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
        onWheel={onWheel}
      />
      <div className={styles.hint}>{hint}</div>
    </div>
  )
}
