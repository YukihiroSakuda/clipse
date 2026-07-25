import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, Maximize, MoveDiagonal2, X } from 'lucide-react'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { PhysicalSize } from '@tauri-apps/api/dpi'
import { ipc } from '../lib/ipc'
import { useToast, ToastContainer } from '../components/Toast'
import styles from './Pin.module.css'

const MIN_W = 80
const MIN_H = 60
const MIN_ZOOM = 1
const MAX_ZOOM = 8

// At `zoom`, the image box is `zoom` times the container size but still
// anchored so translating it by more than (zoom-1)*size would slide it
// past the container edge, exposing the root's background underneath —
// clamping keeps the box's edges from ever crossing the container's.
function clampPan(pan: { x: number; y: number }, zoom: number, w: number, h: number) {
  const minX = -(zoom - 1) * w
  const minY = -(zoom - 1) * h
  return {
    x: Math.min(0, Math.max(minX, pan.x)),
    y: Math.min(0, Math.max(minY, pan.y)),
  }
}

/** A single "Pin to Screen" window: a borderless, always-on-top floating copy
 * of one screenshot, opened by Editor's or Gallery's "Pin" action
 * (`window::open_pin_window`). Drag the image (left-click) to move the
 * window; Ctrl+wheel zooms into the image *within* the window (cursor-
 * centered, like Figma/Photoshop) without resizing the window itself;
 * middle-click-drag pans around while zoomed in; the Fit button resets
 * both. The window itself is `resizable(false)` — Tauri has no declarative
 * "lock aspect ratio" option, and correcting a native resize after the fact
 * (letting the OS set the raw dragged size, then snapping it) is visibly
 * janky on a live drag. Instead the bottom-right handle below computes an
 * already-correct, aspect-locked target size directly from the mouse delta
 * and applies it once per frame — nothing to correct, so nothing to jitter. */
export default function Pin() {
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [resizing, setResizing] = useState(false)
  const [panningActive, setPanningActive] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const { toasts, showToast } = useToast()
  const rootRef = useRef<HTMLDivElement>(null)
  const bytesRef = useRef<Uint8Array | null>(null)
  const urlRef = useRef<string | null>(null)
  // Image width/height ratio — set once the <img> loads, drives the resize
  // handle's math below.
  const aspectRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    const label = getCurrentWebviewWindow().label
    ipc.getPinnedImage(label)
      .then((buf) => {
        if (cancelled) return
        // `buf` being a valid-but-empty ArrayBuffer (byteLength 0) is
        // truthy, so an explicit length check is needed — otherwise a
        // failed/missing lookup on the Rust side silently renders as a
        // permanently blank window instead of surfacing an error.
        if (!buf || buf.byteLength === 0) {
          showToast('Failed to load pinned image', 'err')
          return
        }
        const bytes = new Uint8Array(buf)
        bytesRef.current = bytes
        const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
        urlRef.current = url
        setImgUrl(url)
      })
      .catch(() => {
        if (!cancelled) showToast('Failed to load pinned image', 'err')
      })
    return () => {
      cancelled = true
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    }
  }, [showToast])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') getCurrentWebviewWindow().close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const handleCopy = useCallback(() => {
    if (!bytesRef.current) return
    ipc.copyImageBytesToClipboard(bytesRef.current)
      .then(() => showToast('Copied to clipboard'))
      .catch(() => showToast('Copy failed', 'err'))
  }, [showToast])

  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = e.currentTarget
    if (naturalWidth > 0 && naturalHeight > 0) aspectRef.current = naturalWidth / naturalHeight
  }, [])

  // The bytes can fetch fine (getPinnedImage above) yet still fail to decode
  // as an image — that failure was previously silent, leaving a permanently
  // blank window with no clue why.
  const handleImageError = useCallback(() => {
    showToast('Pinned image failed to decode', 'err')
  }, [showToast])

  // Mirrors `zoom`/`pan` state, updated synchronously alongside every
  // setZoom/setPan call below. handleWheel needs to read-then-write both
  // values together in one native (non-React) event handler; doing that via
  // React's functional setState updaters (`setZoom(prev => ...)` calling
  // `setPan(prev => ...)` *inside* that updater) is the exact nested-update
  // pattern React.StrictMode's dev-mode double-invocation exists to catch —
  // it fired the inner setPan twice per wheel tick, compounding a drift off
  // the cursor position with every tick. Reading/writing this ref instead
  // sidesteps React's update batching entirely, so there's nothing to
  // double-invoke.
  const viewRef = useRef({ zoom: 1, pan: { x: 0, y: 0 } })
  const applyView = useCallback((next: { zoom: number; pan: { x: number; y: number } }) => {
    viewRef.current = next
    setZoom(next.zoom)
    setPan(next.pan)
  }, [])

  // Attached as a native (non-passive) listener rather than JSX `onWheel`:
  // React delegates wheel events as passive by default, so `preventDefault()`
  // inside a React handler silently no-ops (and logs a console warning) —
  // it never actually stops WebView2 from scrolling/zooming on its own.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const rect = root.getBoundingClientRect()
      const { zoom: prevZoom, pan: prevPan } = viewRef.current
      const factor = Math.exp(-e.deltaY * 0.01)
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prevZoom * factor))
      if (newZoom === prevZoom) return
      if (newZoom <= MIN_ZOOM) {
        applyView({ zoom: MIN_ZOOM, pan: { x: 0, y: 0 } })
        return
      }
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const ratio = newZoom / prevZoom
      const newPan = clampPan(
        { x: mx - (mx - prevPan.x) * ratio, y: my - (my - prevPan.y) * ratio },
        newZoom,
        rect.width,
        rect.height
      )
      applyView({ zoom: newZoom, pan: newPan })
    }
    root.addEventListener('wheel', onWheel, { passive: false })
    return () => root.removeEventListener('wheel', onWheel)
  }, [applyView])

  const handleMiddleDown = useCallback((e: React.MouseEvent) => {
    const { zoom: curZoom, pan: curPan } = viewRef.current
    if (e.button !== 1 || curZoom <= MIN_ZOOM) return
    e.preventDefault()
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return
    const startX = e.clientX
    const startY = e.clientY
    setPanningActive(true)
    const onMove = (ev: MouseEvent) => {
      applyView({
        zoom: curZoom,
        pan: clampPan(
          { x: curPan.x + (ev.clientX - startX), y: curPan.y + (ev.clientY - startY) },
          curZoom,
          rect.width,
          rect.height
        ),
      })
    }
    const onUp = () => {
      setPanningActive(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [applyView])

  const handleFit = useCallback(() => {
    applyView({ zoom: 1, pan: { x: 0, y: 0 } })
  }, [applyView])

  // Custom corner-drag resize (native OS resize is disabled — see the
  // module comment). All math stays in physical pixels throughout: mouse
  // events report CSS/logical px, so screen coordinates are scaled by
  // devicePixelRatio up front and never mixed with logical values again.
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const win = getCurrentWebviewWindow()
    const dpr = window.devicePixelRatio || 1
    let dragging = true
    let rafId: number | null = null
    let pending: { x: number; y: number } | null = null
    // The handle's own visibility is otherwise driven by :hover on the root
    // — but resizing routinely drags the cursor outside the (currently
    // shrinking/growing) window bounds, which drops that :hover state mid-
    // drag even though the drag itself (bound to `window`, not the root)
    // keeps working. `resizing` pins it visible for the whole gesture so it
    // doesn't flicker away while still actively grabbed.
    setResizing(true)

    win.innerSize().then((size) => {
      if (!dragging) return
      const startX = e.screenX * dpr
      const startY = e.screenY * dpr
      const startW = size.width
      const startH = size.height

      const apply = () => {
        rafId = null
        if (!pending) return
        const aspect = aspectRef.current
        if (!aspect) return
        const dx = pending.x - startX
        const dy = pending.y - startY
        let w: number
        let h: number
        // Whichever axis the cursor has moved further along drives the
        // resize; the other follows the image's own aspect ratio — so a
        // mostly-horizontal drag reads as "resize by width" and vice versa,
        // instead of one axis always winning regardless of gesture.
        if (Math.abs(dx) >= Math.abs(dy)) {
          w = Math.max(MIN_W, startW + dx)
          h = Math.max(MIN_H, Math.round(w / aspect))
        } else {
          h = Math.max(MIN_H, startH + dy)
          w = Math.max(MIN_W, Math.round(h * aspect))
        }
        win.setSize(new PhysicalSize(Math.round(w), Math.round(h))).catch(() => {})
      }

      const onMove = (ev: MouseEvent) => {
        pending = { x: ev.screenX * dpr, y: ev.screenY * dpr }
        if (rafId == null) rafId = requestAnimationFrame(apply)
      }
      const onUp = () => {
        dragging = false
        if (rafId != null) cancelAnimationFrame(rafId)
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        setResizing(false)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    })
  }, [])

  return (
    <div
      ref={rootRef}
      className={`${styles.root} ${panningActive ? styles.panningActive : ''}`}
      data-tauri-drag-region
      onMouseDown={handleMiddleDown}
    >
      {imgUrl && (
        <img
          src={imgUrl}
          alt=""
          className={styles.image}
          draggable={false}
          data-tauri-drag-region
          onLoad={handleImageLoad}
          onError={handleImageError}
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}
        />
      )}
      <div className={styles.toolbar}>
        <button
          className={styles.toolBtn}
          title="Fit"
          disabled={zoom === MIN_ZOOM}
          onClick={handleFit}
        >
          <Maximize size={12} strokeWidth={1.5} />
        </button>
        <button className={styles.toolBtn} title="Copy image" onClick={handleCopy}>
          <Copy size={12} strokeWidth={1.5} />
        </button>
        <button
          className={styles.toolBtn}
          title="Close (Esc)"
          onClick={() => getCurrentWebviewWindow().close()}
        >
          <X size={12} strokeWidth={2} />
        </button>
      </div>
      <div
        className={`${styles.resizeHandle} ${resizing ? styles.resizeHandleActive : ''}`}
        onMouseDown={handleResizeStart}
        title="Drag to resize"
      >
        <MoveDiagonal2 size={12} strokeWidth={2} />
      </div>
      <ToastContainer toasts={toasts} />
    </div>
  )
}
