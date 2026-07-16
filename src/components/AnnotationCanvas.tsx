import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Check, X } from 'lucide-react'
import { contrastTextColor, drawAnnotation, getAnnotationBounds, hitTest, makeId, textPadding } from '../lib/annotations'
import type { Annotation, ArrowHead, BlurStrength, TextAnn, TextShape, NumberAnn } from '../lib/annotations'
import type { AnnotationTool, FillMode } from '../lib/store'
import type { FrameConfig } from '../lib/frame'
import { drawFramedImage } from '../lib/frame'
import styles from './AnnotationCanvas.module.css'

export interface AnnotationCanvasHandle {
  exportPng: () => string | null
  exportBlob: () => Promise<Blob | null>
}

type HandleId = 'tl' | 'tc' | 'tr' | 'ml' | 'mr' | 'bl' | 'bc' | 'br' | 'p1' | 'p2' | 'thick'
interface HandlePos { id: HandleId; cx: number; cy: number }
interface ResizeState {
  handle: HandleId
  startImgX: number
  startImgY: number
  startBounds?: { x: number; y: number; w: number; h: number }
  startLine?: { x1: number; y1: number; x2: number; y2: number }
  lockEligible?: boolean  // aspect-lock when Shift is held (ellipse)
  lockAlways?: boolean    // always aspect-lock (text scales uniformly with font size)
  lockCenter?: boolean    // resize about the fixed center instead of the opposite corner/edge (number marker)
}

const MIN_RESIZE = 10
const SEL_PAD = 6
const HANDLE_SIZE = 7
const HANDLE_HIT = 8
const MIN_CROP = 20

// Contextual hints shown while drawing with each tool (bottom center).
const DRAW_HINTS: Partial<Record<AnnotationTool, string>> = {
  arrow:     'Shift: 45° snap · Esc: cancel',
  line:      'Shift: 45° snap · Esc: cancel',
  highlight: 'Shift: 45° snap · Esc: cancel',
  rect:      'Shift: 1:1 · Esc: cancel',
  ellipse:   'Shift: 1:1 · Esc: cancel',
  blur:      'Esc: cancel',
  spotlight: 'Esc: cancel',
  pen:       'Esc: cancel',
}

interface CropRect { x: number; y: number; w: number; h: number }
type CropDragMode = 'draw' | 'move' | HandleId
interface CropDragState {
  mode: CropDragMode
  startImgX: number
  startImgY: number
  startRect: CropRect
}

interface Props {
  imageDataUrl: string | null
  imageWidth: number
  imageHeight: number
  annotations: Annotation[]
  activeTool: AnnotationTool
  activeColor: string
  strokeWidth: number
  fontSize: number
  fillMode: FillMode
  numberShape: 'circle' | 'square'
  arrowHead: ArrowHead
  textShape: TextShape
  blurStrength: BlurStrength
  spotlightDim: number
  frame: FrameConfig
  nextNumber: number
  selectedIds: string[]
  zoom: number
  panX: number
  panY: number
  onAnnotationAdded: (ann: Annotation) => void
  onBeginDrag: () => void
  onSetSelection: (ids: string[]) => void
  onToggleSelection: (id: string) => void
  onMoveAnnotations: (ids: string[], dx: number, dy: number) => void
  onResizeAnnotation: (id: string, bounds: { x: number; y: number; w: number; h: number }) => void
  onResizeEndpoint: (id: string, which: 'p1' | 'p2', imgX: number, imgY: number) => void
  onResizeThickness: (id: string, sw: number) => void
  onUpdateText: (id: string, text: string) => void
  onUpdateNumber: (id: string, n: number) => void
  /** Called when Esc aborts an in-progress move/resize: the drag pushed an
   *  undo snapshot when it began, so one undo restores the pre-drag state. */
  onCancelTransform: () => void
  // Context-menu actions, operating on the current selection.
  onDuplicateSelection: () => void
  onBringToFront: () => void
  onSendToBack: () => void
  onDeleteSelection: () => void
  onApplyCrop: (dataUrl: string, width: number, height: number, dx: number, dy: number) => void
  onCropDone: () => void
  /** Picker tool: a pixel of the base image was clicked. `hex` is `#RRGGBB`. */
  onPickColor: (hex: string) => void
  onZoomChange: (z: number) => void
  onPanChange: (x: number, y: number) => void
}

const AnnotationCanvas = forwardRef<AnnotationCanvasHandle, Props>(
  function AnnotationCanvas(
    {
      imageDataUrl, imageWidth, imageHeight,
      annotations, activeTool, activeColor, strokeWidth, fontSize, fillMode, numberShape, arrowHead, textShape,
      blurStrength, spotlightDim,
      frame,
      nextNumber, selectedIds,
      zoom, panX, panY,
      onAnnotationAdded, onBeginDrag, onSetSelection, onToggleSelection, onMoveAnnotations,
      onResizeAnnotation, onResizeEndpoint, onResizeThickness, onUpdateText, onUpdateNumber,
      onCancelTransform,
      onDuplicateSelection, onBringToFront, onSendToBack, onDeleteSelection,
      onApplyCrop, onCropDone,
      onPickColor,
      onZoomChange, onPanChange,
    },
    ref,
  ) {
    // Resize handles & toolbar-style single-item ops only apply with exactly one selection.
    const selectedId = selectedIds.length === 1 ? selectedIds[0] : null
    const containerRef = useRef<HTMLDivElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const imgRef = useRef<HTMLImageElement | null>(null)
    // Base transform (fit-to-screen, no zoom/pan applied) stored for mouse conversion
    const baseTxRef = useRef({ scale: 1, ox: 0, oy: 0 })
    // Always-current handle to `redraw` (assigned every render, right after
    // `redraw` itself is declared below) for the mount-only ResizeObserver
    // effect, whose own closure would otherwise stay pinned to the very
    // first render's (stale) `redraw` forever — see that effect for why.
    const redrawRef = useRef<() => void>(() => {})
    const dragging = useRef(false)
    const dragStart = useRef({ imgX: 0, imgY: 0 })
    const moveDragStart = useRef({ imgX: 0, imgY: 0 })
    // True while `dragging` means "moving the selected annotation" rather
    // than "drawing a new shape" — lets a drawing tool (not just Select)
    // grab/reposition the annotation it just placed without switching tools,
    // so stamping several shapes of the same type back-to-back and
    // fine-tuning the last one can coexist. See the grab-check in
    // onMouseDown for where this gets set from a non-Select tool.
    const movingRef = useRef(false)
    const rubberbanding = useRef(false)
    const rubberBandRef = useRef<{ startImgX: number; startImgY: number; curImgX: number; curImgY: number } | null>(null)
    const [, setRbTick] = useState(0)
    const resizeState = useRef<ResizeState | null>(null)
    const handlePosRef = useRef<HandlePos[]>([])
    const [activeHandle, setActiveHandle] = useState<HandleId | null>(null)
    const [preview, setPreview] = useState<Annotation | null>(null)
    // Pen tool: points accumulated for the in-progress freehand stroke
    const penPointsRef = useRef<{ x: number; y: number }[]>([])

    // Panning state
    const panning = useRef(false)
    const panStart = useRef({ cssX: 0, cssY: 0, panX: 0, panY: 0 })
    const spaceDown = useRef(false)

    // Text tool
    const [textPos, setTextPos] = useState<{
      imgX: number; imgY: number; cssX: number; cssY: number
    } | null>(null)
    // Id of an existing text annotation being re-edited (null = creating a new one)
    const [editingTextId, setEditingTextId] = useState<string | null>(null)
    const textInputRef = useRef<HTMLTextAreaElement>(null)
    const textMeasureRef = useRef<HTMLDivElement>(null)
    // Set on Escape so the textarea's blur handler skips committing (cancel edit).
    const cancelTextRef = useRef(false)

    // Number tool — inline editor for an existing number marker's value
    const [numberEdit, setNumberEdit] = useState<{
      id: string; cssX: number; cssY: number; size: number
    } | null>(null)
    const numberInputRef = useRef<HTMLInputElement>(null)
    // Set on Escape so the input's blur handler skips committing (cancel edit).
    const cancelNumberRef = useRef(false)

    // Focus & select the number input when it opens.
    useEffect(() => {
      if (!numberEdit) return
      const el = numberInputRef.current
      if (!el) return
      const id = setTimeout(() => { el.focus(); el.select() }, 0)
      return () => clearTimeout(id)
    }, [numberEdit])

    // Right-click context menu (CSS position within the container), shown for
    // the annotation under the cursor.
    const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)

    // Annotation under the cursor with the Select tool (not yet selected):
    // drawn with a faint outline + move cursor so what a click would grab is
    // visible *before* committing to it.
    const [hoverId, setHoverId] = useState<string | null>(null)

    // One-line contextual hint (bottom center): which modifier keys do what
    // for the interaction currently in progress.
    const [hint, setHint] = useState<string | null>(null)

    // Picker tool — color under the cursor, shown as a chip following it.
    // Sampling reads a 1×1 pixel per move from an offscreen canvas holding
    // the base image at natural size (annotations excluded on purpose),
    // built lazily once per image.
    const [pickPreview, setPickPreview] = useState<{ cssX: number; cssY: number; hex: string } | null>(null)
    const pickCtxRef = useRef<CanvasRenderingContext2D | null>(null)
    const pickCtxImgRef = useRef<HTMLImageElement | null>(null)

    const samplePickColor = useCallback((imgX: number, imgY: number): string | null => {
      const img = imgRef.current
      if (!img) return null
      const x = Math.floor(imgX)
      const y = Math.floor(imgY)
      if (x < 0 || y < 0 || x >= img.naturalWidth || y >= img.naturalHeight) return null
      if (!pickCtxRef.current || pickCtxImgRef.current !== img) {
        const off = document.createElement('canvas')
        off.width = img.naturalWidth
        off.height = img.naturalHeight
        const c = off.getContext('2d', { willReadFrequently: true })
        if (!c) return null
        c.drawImage(img, 0, 0)
        pickCtxRef.current = c
        pickCtxImgRef.current = img
      }
      const d = pickCtxRef.current.getImageData(x, y, 1, 1).data
      if (d[3] === 0) return null // transparent margin (frame padding etc.) — nothing to pick
      return (
        '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()
      )
    }, [])

    // Crop tool — pending crop rectangle (image-pixel space) + its active drag/resize
    const [cropRect, setCropRect] = useState<CropRect | null>(null)
    const [cropHover, setCropHover] = useState(false)
    const cropDragRef = useRef<CropDragState | null>(null)
    const cropHandlePosRef = useRef<HandlePos[]>([])
    // Mirrors `cropRect` for handlers that need the latest value without
    // depending on it — reading state in a useCallback's deps would recreate
    // (and re-subscribe) that callback on every drag-move frame.
    const cropRectRef = useRef<CropRect | null>(null)
    cropRectRef.current = cropRect

    // Set initial textarea size to minimum when text tool activates
    useEffect(() => {
      if (!textPos) return
      const el = textInputRef.current
      const measure = textMeasureRef.current
      if (!el || !measure) return
      const longest = el.value.split('\n').reduce((a, b) => (a.length >= b.length ? a : b), '')
      measure.textContent = longest || ' '
      el.style.width = `${measure.offsetWidth + 2}px`
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
      // Defer focus past the opening click's native focus handling — focusing
      // synchronously lets the click's mouseup blur the textarea, firing onBlur
      // which immediately commits/closes the still-empty editor.
      const id = setTimeout(() => {
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      }, 0)
      return () => clearTimeout(id)
    }, [textPos])

    // ── Image loading ──────────────────────────────────────────────────────
    useEffect(() => {
      if (!imageDataUrl) return
      const img = new Image()
      img.onload = () => {
        imgRef.current = img
        redraw()
      }
      img.src = imageDataUrl
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [imageDataUrl])

    // ── Canvas resize ──────────────────────────────────────────────────────
    // The observer itself is set up once (mount-only) since re-subscribing
    // on every redraw() identity change would be wasteful, but that means
    // its callback closure is fixed at mount time too — calling `redraw()`
    // directly here would keep invoking the *first* render's redraw forever,
    // stale-closed over that render's (empty) `annotations`/`selectedIds`/etc.
    // Any later resize (e.g. the options row's height shifting by a px when
    // the selected annotation's type changes, from the two-row toolbar) would
    // then repaint the image but silently drop every annotation. Routing
    // through `redrawRef` (kept current every render, just below where
    // `redraw` itself is defined) fixes that.
    useEffect(() => {
      const container = containerRef.current
      const canvas = canvasRef.current
      if (!container || !canvas) return
      const ro = new ResizeObserver(() => {
        const dpr = window.devicePixelRatio
        canvas.width = container.offsetWidth * dpr
        canvas.height = container.offsetHeight * dpr
        redrawRef.current()
      })
      ro.observe(container)
      return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // ── Keyboard: spacebar for panning ────────────────────────────────────
    useEffect(() => {
      const onKeyDown = (e: KeyboardEvent) => {
        const t = e.target as HTMLElement | null
        const typing = !!t && (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable)
        if (e.code === 'Space' && !typing) {
          e.preventDefault()
          spaceDown.current = true
        }
      }
      const onKeyUp = (e: KeyboardEvent) => {
        if (e.code === 'Space') spaceDown.current = false
      }
      window.addEventListener('keydown', onKeyDown)
      window.addEventListener('keyup', onKeyUp)
      return () => {
        window.removeEventListener('keydown', onKeyDown)
        window.removeEventListener('keyup', onKeyUp)
      }
    }, [])

    // ── Escape: cancel the in-progress interaction, else drop selection ──
    useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return
        const t = e.target as HTMLElement | null
        const typing = !!t && (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable)
        if (typing) return  // text/number editors handle their own Esc
        if (ctxMenu) { setCtxMenu(null); return }
        if (activeTool === 'crop') return  // crop has its own Esc (cancel rect)

        // Drawing a new shape → just discard the preview.
        if (dragging.current && !movingRef.current) {
          dragging.current = false
          penPointsRef.current = []
          setPreview(null)
          setHint(null)
          return
        }
        // Moving/resizing an existing one → abort and revert: the drag
        // pushed an undo snapshot when it began, so one undo restores the
        // exact pre-drag state.
        if (movingRef.current || resizeState.current) {
          movingRef.current = false
          dragging.current = false
          resizeState.current = null
          setActiveHandle(null)
          setHint(null)
          onCancelTransform()
          return
        }
        if (selectedIds.length > 0) onSetSelection([])
      }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
    }, [activeTool, selectedIds, onSetSelection, onCancelTransform, ctxMenu])

    // Any press outside the context menu dismisses it (the menu itself stops
    // mousedown propagation, so clicks on its items still go through).
    useEffect(() => {
      if (!ctxMenu) return
      const close = () => setCtxMenu(null)
      window.addEventListener('mousedown', close)
      return () => window.removeEventListener('mousedown', close)
    }, [ctxMenu])

    // ── Reset drag state on tool change ───────────────────────────────────
    useEffect(() => {
      dragging.current = false
      movingRef.current = false
      rubberbanding.current = false
      rubberBandRef.current = null
      resizeState.current = null
      panning.current = false
      setPreview(null)
      setActiveHandle(null)
      setRbTick(v => v + 1)
      cropDragRef.current = null
      setCropRect(null)
      setCropHover(false)
      setCtxMenu(null)
      setHoverId(null)
      setPickPreview(null)
      penPointsRef.current = []
    }, [activeTool])

    // Standing hints for modal states (text editing, crop) — mouse-drag
    // hints are set imperatively in the handlers and survive this effect
    // because none of its deps change mid-drag.
    useEffect(() => {
      if (textPos) setHint('Enter: confirm · Shift+Enter: newline · Esc: cancel')
      else if (activeTool === 'crop') setHint(cropRect ? 'Enter: apply · Esc: cancel' : 'Drag to select the crop area')
      else if (activeTool === 'picker') setHint('Click to pick a color (copies hex)')
      else setHint(null)
    }, [textPos, activeTool, cropRect])

    // ── Global mouseup: clean up if mouse released outside canvas ─────────
    useEffect(() => {
      const onGlobalMouseUp = () => {
        if (!dragging.current && !rubberbanding.current && !panning.current && !resizeState.current && !cropDragRef.current) return
        dragging.current = false
        movingRef.current = false
        rubberbanding.current = false
        rubberBandRef.current = null
        resizeState.current = null
        panning.current = false
        cropDragRef.current = null
        penPointsRef.current = []
        setPreview(null)
        setActiveHandle(null)
        setHint(null)
        setRbTick(v => v + 1)
      }
      window.addEventListener('mouseup', onGlobalMouseUp)
      return () => window.removeEventListener('mouseup', onGlobalMouseUp)
    }, [])

    // Content-bounds union of the image rect + every committed annotation
    // (not `preview`, which gets a new object every drag frame — merged in
    // separately below). Memoized so dragging/panning/resizing doesn't
    // rescan every annotation on every redraw.
    const baseContentBounds = useMemo(
      () => computeContentBounds(annotations, imageWidth, imageHeight),
      [annotations, imageWidth, imageHeight],
    )

    // ── Redraw on any change ───────────────────────────────────────────────
    useEffect(() => { redraw() })

    const redraw = useCallback(() => {
      const canvas = canvasRef.current
      const img = imgRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')!
      const dpr = window.devicePixelRatio
      const W = canvas.width / dpr
      const H = canvas.height / dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      ctx.fillStyle = '#1E1E1E'
      ctx.fillRect(0, 0, W, H)

      if (!img || imageWidth === 0 || imageHeight === 0) return

      const VP = 24
      const baseScale = Math.min((W - VP * 2) / imageWidth, (H - VP * 2) / imageHeight)
      const scale = baseScale * zoom
      const dw = imageWidth * scale
      const dh = imageHeight * scale
      const ox = (W - dw) / 2 + panX
      const oy = (H - dh) / 2 + panY

      baseTxRef.current = {
        scale: baseScale,
        ox: (W - imageWidth * baseScale) / 2,
        oy: (H - imageHeight * baseScale) / 2,
      }

      // ── Image + annotations, painted in image-pixel space ──
      ctx.save()
      ctx.translate(ox, oy)
      ctx.scale(scale, scale)
      drawFramedImage(ctx, img, 0, 0, imageWidth, imageHeight, frame.radius)
      for (const ann of annotations) {
        if (ann.id === editingTextId) continue  // hidden while its textarea is open
        if (ann.id === numberEdit?.id) continue  // hidden while its value input is open
        // A single malformed annotation must not abort the rest of the
        // frame (selection handles, crop overlay, etc. drawn below) — skip
        // it and keep going rather than let one bad draw call blank
        // everything downstream every time this redraws.
        try {
          drawAnnotation(ctx, ann, img)
        } catch (e) {
          console.error('[annotation] draw failed, skipping', ann.id, ann.type, e)
        }
      }
      if (preview) drawAnnotation(ctx, preview, img)
      ctx.restore()

      // Subtle outline around the screenshot (skip when rounded — looks off).
      if (frame.radius === 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.08)'
        ctx.lineWidth = 1
        ctx.strokeRect(ox, oy, dw, dh)
      }

      // Dashed outline around the export bounds when annotations spill outside
      // the screenshot — the canvas will expand (transparent margin) to fit them.
      const previewBounds = preview ? getAnnotationBounds(preview) : null
      const contentBounds = previewBounds ? unionBounds(baseContentBounds, previewBounds) : baseContentBounds
      if (contentBounds.x !== 0 || contentBounds.y !== 0 || contentBounds.w !== imageWidth || contentBounds.h !== imageHeight) {
        ctx.save()
        ctx.strokeStyle = 'rgba(0, 200, 232, 0.5)'
        ctx.lineWidth = 1
        ctx.setLineDash([4, 3])
        ctx.strokeRect(
          ox + contentBounds.x * scale,
          oy + contentBounds.y * scale,
          contentBounds.w * scale,
          contentBounds.h * scale,
        )
        ctx.restore()
      }

      // ── Crop overlay: dim everything outside the pending crop rect ────
      if (activeTool === 'crop' && cropRect) {
        const sx = ox + cropRect.x * scale
        const sy = oy + cropRect.y * scale
        const sw = cropRect.w * scale
        const sh = cropRect.h * scale
        ctx.save()
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
        ctx.fillRect(0, 0, W, sy)                  // top
        ctx.fillRect(0, sy + sh, W, H - sy - sh)   // bottom
        ctx.fillRect(0, sy, sx, sh)                // left
        ctx.fillRect(sx + sw, sy, W - sx - sw, sh) // right
        ctx.strokeStyle = '#FFFFFF'
        ctx.lineWidth = 1.5
        ctx.setLineDash([5, 4])
        ctx.strokeRect(sx, sy, sw, sh)
        ctx.setLineDash([])
        const handles = boxHandlePositions(cropRect, ox, oy, scale, 0)
        cropHandlePosRef.current = handles
        const HS = HANDLE_SIZE
        ctx.fillStyle = '#FFFFFF'
        ctx.strokeStyle = '#60A5FA'
        ctx.lineWidth = 1.5
        for (const h of handles) {
          ctx.fillRect(h.cx - HS / 2, h.cy - HS / 2, HS, HS)
          ctx.strokeRect(h.cx - HS / 2, h.cy - HS / 2, HS, HS)
        }
        ctx.restore()
      } else {
        cropHandlePosRef.current = []
      }

      // ── Selection indicators + resize handles ─────────────────────────
      handlePosRef.current = []
      if (selectedIds.length > 0) {
        const idSet = new Set(selectedIds)
        ctx.save()
        // Dashed bounding box for every selected annotation
        ctx.strokeStyle = '#60A5FA'
        ctx.lineWidth = 1.5
        ctx.setLineDash([5, 4])
        for (const ann of annotations) {
          if (!idSet.has(ann.id)) continue
          if (ann.type === 'highlight') {
            const { x1, y1, x2, y2, sw } = ann
            const dx = x2 - x1
            const dy = y2 - y1
            const len = Math.hypot(dx, dy)
            if (len >= 1) {
              // Rotated rectangle hugging the band's actual outline, instead
              // of a loose axis-aligned box around its diagonal silhouette.
              const ux = dx / len
              const uy = dy / len
              const nx = -uy
              const ny = ux
              const halfT = (sw * 6) / 2 + SEL_PAD
              const ext = SEL_PAD
              const corners: [number, number][] = [
                [x1 - ux * ext + nx * halfT, y1 - uy * ext + ny * halfT],
                [x2 + ux * ext + nx * halfT, y2 + uy * ext + ny * halfT],
                [x2 + ux * ext - nx * halfT, y2 + uy * ext - ny * halfT],
                [x1 - ux * ext - nx * halfT, y1 - uy * ext - ny * halfT],
              ]
              ctx.beginPath()
              corners.forEach(([px, py], i) => {
                const sxp = ox + px * scale
                const syp = oy + py * scale
                if (i === 0) ctx.moveTo(sxp, syp)
                else ctx.lineTo(sxp, syp)
              })
              ctx.closePath()
              ctx.stroke()
              continue
            }
          }
          const b = getAnnotationBounds(ann)
          if (!b) continue
          ctx.strokeRect(
            ox + b.x * scale - SEL_PAD,
            oy + b.y * scale - SEL_PAD,
            b.w * scale + SEL_PAD * 2,
            b.h * scale + SEL_PAD * 2,
          )
        }
        ctx.setLineDash([])
        // Resize handles only when exactly one annotation is selected
        if (selectedId) {
          const selAnn = annotations.find((a) => a.id === selectedId)
          const b = selAnn ? getAnnotationBounds(selAnn) : null
          if (selAnn && b) {
            const handles = computeHandlePositions(selAnn, b, ox, oy, scale, SEL_PAD)
            handlePosRef.current = handles
            const HS = HANDLE_SIZE
            ctx.fillStyle = '#FFFFFF'
            ctx.strokeStyle = '#60A5FA'
            ctx.lineWidth = 1.5
            for (const h of handles) {
              if (h.id === 'thick' && selAnn.type === 'highlight') {
                // Rotate the handle to match the marker's angle, so it reads
                // as part of the band's edge rather than a generic square.
                const angle = Math.atan2(selAnn.y2 - selAnn.y1, selAnn.x2 - selAnn.x1)
                ctx.save()
                ctx.translate(h.cx, h.cy)
                ctx.rotate(angle)
                ctx.fillRect(-HS / 2, -HS / 2, HS, HS)
                ctx.strokeRect(-HS / 2, -HS / 2, HS, HS)
                ctx.restore()
              } else if (h.id === 'p2' && selAnn.type === 'arrow' && selAnn.head === 'dot') {
                // The dot arrowhead is centered exactly on the p2 handle — a
                // filled square there would completely hide it. Draw a
                // hollow ring around the dot instead, so the actual
                // arrowhead stays visible while the handle is still marked
                // as grabbable.
                const dotR = Math.max(4, selAnn.sw * 1.2) * scale
                ctx.beginPath()
                ctx.arc(h.cx, h.cy, dotR + 3, 0, Math.PI * 2)
                ctx.stroke()
              } else {
                ctx.fillRect(h.cx - HS / 2, h.cy - HS / 2, HS, HS)
                ctx.strokeRect(h.cx - HS / 2, h.cy - HS / 2, HS, HS)
              }
            }
          }
        }
        ctx.restore()
      }

      // ── Hover outline (Select tool): what a click would grab ───────────
      if (hoverId && !selectedIds.includes(hoverId) && !dragging.current) {
        const ha = annotations.find((a) => a.id === hoverId)
        const hb = ha ? getAnnotationBounds(ha) : null
        if (hb) {
          ctx.save()
          ctx.strokeStyle = 'rgba(96, 165, 250, 0.45)'
          ctx.lineWidth = 1
          ctx.setLineDash([4, 3])
          ctx.strokeRect(
            ox + hb.x * scale - SEL_PAD,
            oy + hb.y * scale - SEL_PAD,
            hb.w * scale + SEL_PAD * 2,
            hb.h * scale + SEL_PAD * 2,
          )
          ctx.restore()
        }
      }

      // ── Rubber band selection rect ────────────────────────────────────────
      const rb = rubberBandRef.current
      if (rb) {
        const x1 = rb.startImgX * scale + ox
        const y1 = rb.startImgY * scale + oy
        const x2 = rb.curImgX * scale + ox
        const y2 = rb.curImgY * scale + oy
        ctx.save()
        ctx.setLineDash([4, 3])
        ctx.strokeStyle = 'rgba(0, 200, 232, 0.8)'
        ctx.lineWidth = 1
        ctx.fillStyle = 'rgba(0, 200, 232, 0.08)'
        const rx = Math.min(x1, x2)
        const ry = Math.min(y1, y2)
        const rw = Math.abs(x2 - x1)
        const rh = Math.abs(y2 - y1)
        ctx.fillRect(rx, ry, rw, rh)
        ctx.strokeRect(rx, ry, rw, rh)
        ctx.restore()
      }

    }, [imageWidth, imageHeight, annotations, baseContentBounds, preview, selectedIds, selectedId, editingTextId, numberEdit, activeTool, cropRect, zoom, panX, panY, frame, hoverId])
    redrawRef.current = redraw

    // ── Coordinate conversion (CSS px → image px) ─────────────────────────
    const toImgCoords = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current!
      const rect = canvas.getBoundingClientRect()
      const cssX = e.clientX - rect.left
      const cssY = e.clientY - rect.top
      const { scale: baseScale, ox: baseOx, oy: baseOy } = baseTxRef.current
      const scale = baseScale * zoom
      const ox = baseOx + panX - (imageWidth * baseScale * (zoom - 1)) / 2
      const oy = baseOy + panY - (imageHeight * baseScale * (zoom - 1)) / 2
      return {
        imgX: (cssX - ox) / scale,
        imgY: (cssY - oy) / scale,
        cssX,
        cssY,
      }
    }, [zoom, panX, panY, imageWidth, imageHeight])

    // Convert image-pixel coords → CSS coords (inverse of toImgCoords).
    const toCssCoords = useCallback((imgX: number, imgY: number) => {
      const { scale: baseScale, ox: baseOx, oy: baseOy } = baseTxRef.current
      const scale = baseScale * zoom
      const ox = baseOx + panX - (imageWidth * baseScale * (zoom - 1)) / 2
      const oy = baseOy + panY - (imageHeight * baseScale * (zoom - 1)) / 2
      return { cssX: imgX * scale + ox, cssY: imgY * scale + oy }
    }, [zoom, panX, panY, imageWidth, imageHeight])

    // Double-click an existing text or number annotation to re-edit it.
    const onDoubleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
      const { imgX, imgY } = toImgCoords(e)
      for (let i = annotations.length - 1; i >= 0; i--) {
        const a = annotations[i]
        if (a.type === 'text' && hitTest(a, imgX, imgY)) {
          const { cssX, cssY } = toCssCoords(a.x, a.y)
          onSetSelection([])
          setEditingTextId(a.id)
          setTextPos({ imgX: a.x, imgY: a.y, cssX, cssY })
          return
        }
        if (a.type === 'number' && hitTest(a, imgX, imgY)) {
          const { scale: baseScale } = baseTxRef.current
          const scale = baseScale * zoom
          const { cssX, cssY } = toCssCoords(a.cx, a.cy)
          onSetSelection([])
          setNumberEdit({ id: a.id, cssX, cssY, size: a.r * 2 * scale })
          return
        }
      }
    }, [annotations, toImgCoords, toCssCoords, onSetSelection, zoom])

    // ── Right-click: context menu for the annotation under the cursor ────
    const onContextMenu = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
      e.preventDefault()
      const { imgX, imgY, cssX, cssY } = toImgCoords(e)
      let hitId: string | null = null
      for (let i = annotations.length - 1; i >= 0; i--) {
        if (hitTest(annotations[i], imgX, imgY)) { hitId = annotations[i].id; break }
      }
      if (!hitId) { setCtxMenu(null); return }
      // Right-clicking an unselected annotation selects it (keeping an
      // existing multi-selection when the target is already part of it).
      if (!selectedIds.includes(hitId)) onSetSelection([hitId])
      setCtxMenu({ x: cssX, y: cssY })
    }, [annotations, selectedIds, toImgCoords, onSetSelection])

    // ── Wheel: zoom, anchored at the cursor ───────────────────────────────
    const onWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      const newZoom = Math.max(0.1, Math.min(8, zoom * delta))
      if (newZoom === zoom) return
      // Keep the image point under the pointer stationary: solve the
      // canvas-transform equation (see redraw's ox/oy) for the pan that
      // maps the same image point back to the same CSS position at the new
      // zoom. Without this the view zooms about the canvas center, and the
      // detail being zoomed into slides away from the cursor.
      const { imgX, imgY, cssX, cssY } = toImgCoords(e)
      const { scale: baseScale, ox: baseOx, oy: baseOy } = baseTxRef.current
      const newPanX = cssX - baseOx + (imageWidth * baseScale * (newZoom - 1)) / 2 - imgX * baseScale * newZoom
      const newPanY = cssY - baseOy + (imageHeight * baseScale * (newZoom - 1)) / 2 - imgY * baseScale * newZoom
      onZoomChange(newZoom)
      onPanChange(newPanX, newPanY)
    }, [zoom, toImgCoords, imageWidth, imageHeight, onZoomChange, onPanChange])

    // ── Mouse handlers ─────────────────────────────────────────────────────
    const onMouseDown = useCallback(
      (e: React.MouseEvent<HTMLCanvasElement>) => {
        // Hand tool, Space+drag, or middle-drag = pan (Adobe-style).
        if (e.button === 1 || (e.button === 0 && spaceDown.current)) {
          e.preventDefault()
          panning.current = true
          panStart.current = { cssX: e.clientX, cssY: e.clientY, panX, panY }
          return
        }
        if (e.button !== 0) return

        const { imgX, imgY, cssX, cssY } = toImgCoords(e)

        if (activeTool === 'text') {
          setEditingTextId(null)
          setTextPos({ imgX, imgY, cssX, cssY })
          return
        }

        if (activeTool === 'picker') {
          const hex = samplePickColor(imgX, imgY)
          if (hex) onPickColor(hex)
          return
        }

        if (activeTool === 'crop') {
          if (cropRect) {
            const hit = findHandleHit(cssX, cssY, cropHandlePosRef.current)
            if (hit) {
              cropDragRef.current = { mode: hit, startImgX: imgX, startImgY: imgY, startRect: cropRect }
              setActiveHandle(hit)
              return
            }
            const inside = imgX >= cropRect.x && imgX <= cropRect.x + cropRect.w &&
                           imgY >= cropRect.y && imgY <= cropRect.y + cropRect.h
            if (inside) {
              cropDragRef.current = { mode: 'move', startImgX: imgX, startImgY: imgY, startRect: cropRect }
              return
            }
          }
          // Outside the current rect (or no rect yet): start drawing a fresh one.
          const startRect = { x: imgX, y: imgY, w: 0, h: 0 }
          cropDragRef.current = { mode: 'draw', startImgX: imgX, startImgY: imgY, startRect }
          setCropRect(startRect)
          return
        }

        if (activeTool === 'select') {
          const multi = e.ctrlKey || e.metaKey
          // Check resize handles first (single selection only, no modifier)
          if (selectedId && !multi && handlePosRef.current.length > 0) {
            const hit = findHandleHit(cssX, cssY, handlePosRef.current)
            if (hit) {
              onBeginDrag()
              const ann = annotations.find((a) => a.id === selectedId)!
              const b = getAnnotationBounds(ann)
              resizeState.current = {
                handle: hit,
                startImgX: imgX,
                startImgY: imgY,
                startBounds: b ?? undefined,
                startLine: (ann.type === 'arrow' || ann.type === 'line' || ann.type === 'highlight')
                  ? { x1: ann.x1, y1: ann.y1, x2: ann.x2, y2: ann.y2 }
                  : undefined,
                lockEligible: ann.type === 'ellipse',
                lockAlways: ann.type === 'text',
                lockCenter: ann.type === 'number',
              }
              setActiveHandle(hit)
              setHint(resizeHint(ann, hit))
              return
            }
          }
          // Find the top-most annotation under the cursor
          let hitId: string | null = null
          for (let i = annotations.length - 1; i >= 0; i--) {
            if (hitTest(annotations[i], imgX, imgY)) { hitId = annotations[i].id; break }
          }

          if (multi) {
            if (hitId) {
              onToggleSelection(hitId)
            } else {
              // Ctrl+drag: rubber band, additive
              rubberbanding.current = true
              rubberBandRef.current = { startImgX: imgX, startImgY: imgY, curImgX: imgX, curImgY: imgY }
              setRbTick(v => v + 1)
            }
            return
          }

          if (hitId) {
            // Plain click on an unselected item replaces the selection;
            // clicking an already-selected item keeps the whole set (group move).
            if (!selectedIds.includes(hitId)) onSetSelection([hitId])
            onBeginDrag()
            dragging.current = true
            movingRef.current = true
            moveDragStart.current = { imgX, imgY }
            setHint('Esc: cancel')
            return
          }

          // Empty space: start rubber band selection
          rubberbanding.current = true
          rubberBandRef.current = { startImgX: imgX, startImgY: imgY, curImgX: imgX, curImgY: imgY }
          onSetSelection([])
          setRbTick(v => v + 1)
          return
        }

        // A drawing tool can still grab/resize/move the annotation it (or a
        // prior selection) just placed, without switching to Select first —
        // so stamping several shapes back-to-back and immediately
        // fine-tuning the last one both work. Only a click that actually
        // hits that annotation's handle or body is intercepted; anywhere
        // else falls through to this tool's normal "draw a new shape" path.
        if (selectedId) {
          if (handlePosRef.current.length > 0) {
            const hit = findHandleHit(cssX, cssY, handlePosRef.current)
            if (hit) {
              onBeginDrag()
              const ann = annotations.find((a) => a.id === selectedId)!
              const b = getAnnotationBounds(ann)
              resizeState.current = {
                handle: hit,
                startImgX: imgX,
                startImgY: imgY,
                startBounds: b ?? undefined,
                startLine: (ann.type === 'arrow' || ann.type === 'line' || ann.type === 'highlight')
                  ? { x1: ann.x1, y1: ann.y1, x2: ann.x2, y2: ann.y2 }
                  : undefined,
                lockEligible: ann.type === 'ellipse',
                lockAlways: ann.type === 'text',
                lockCenter: ann.type === 'number',
              }
              setActiveHandle(hit)
              setHint(resizeHint(ann, hit))
              return
            }
          }
          const selAnn = annotations.find((a) => a.id === selectedId)
          if (selAnn && hitTest(selAnn, imgX, imgY)) {
            onBeginDrag()
            dragging.current = true
            movingRef.current = true
            moveDragStart.current = { imgX, imgY }
            setHint('Esc: cancel')
            return
          }
        }

        if (activeTool === 'pen') {
          dragging.current = true
          penPointsRef.current = [{ x: imgX, y: imgY }]
          setPreview({ id: makeId(), type: 'pen', color: activeColor, sw: strokeWidth, points: [...penPointsRef.current] })
          setHint(DRAW_HINTS[activeTool] ?? null)
          return
        }

        dragging.current = true
        dragStart.current = { imgX, imgY }
        setHint(DRAW_HINTS[activeTool] ?? null)
        setPreview(buildAnnotation(activeTool, imgX, imgY, imgX, imgY, activeColor, strokeWidth, fillMode, nextNumber, false, numberShape, arrowHead, blurStrength, spotlightDim))
      },
      [activeTool, activeColor, strokeWidth, fontSize, fillMode, numberShape, arrowHead, blurStrength, spotlightDim, nextNumber,
       toImgCoords, annotations, selectedId, selectedIds, onSetSelection, onToggleSelection, onBeginDrag, panX, panY, cropRect,
       samplePickColor, onPickColor],
    )

    const onMouseMove = useCallback(
      (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (panning.current) {
          const dx = e.clientX - panStart.current.cssX
          const dy = e.clientY - panStart.current.cssY
          onPanChange(panStart.current.panX + dx, panStart.current.panY + dy)
          return
        }

        const { imgX, imgY, cssX, cssY } = toImgCoords(e)

        // Picker tool: live color chip following the cursor, nothing else.
        if (activeTool === 'picker') {
          const hex = samplePickColor(imgX, imgY)
          setPickPreview(hex ? { cssX, cssY, hex } : null)
          return
        }

        // Rubber band drag
        if (rubberbanding.current && rubberBandRef.current) {
          rubberBandRef.current = { ...rubberBandRef.current, curImgX: imgX, curImgY: imgY }
          setRbTick(v => v + 1)
          return
        }

        // Active resize drag
        if (resizeState.current && selectedId) {
          const { handle, startImgX, startImgY, startBounds, startLine, lockEligible, lockAlways, lockCenter } = resizeState.current
          const dix = imgX - startImgX
          const diy = imgY - startImgY
          if ((handle === 'p1' || handle === 'p2') && startLine) {
            let nx = (handle === 'p1' ? startLine.x1 : startLine.x2) + dix
            let ny = (handle === 'p1' ? startLine.y1 : startLine.y2) + diy
            if (e.shiftKey) {
              // Snap the dragged endpoint to a 45° angle from the fixed endpoint.
              const fx = handle === 'p1' ? startLine.x2 : startLine.x1
              const fy = handle === 'p1' ? startLine.y2 : startLine.y1
              const s = snapAngle(fx, fy, nx, ny)
              nx = s.x; ny = s.y
            }
            onResizeEndpoint(selectedId, handle, nx, ny)
          } else if (handle === 'thick' && startLine) {
            // Perpendicular distance from the cursor to the (fixed) centerline
            // becomes the new half-thickness — no upper bound, unlike the slider.
            const ldx = startLine.x2 - startLine.x1
            const ldy = startLine.y2 - startLine.y1
            const len = Math.hypot(ldx, ldy)
            if (len >= 1) {
              const dist = Math.abs((imgX - startLine.x1) * ldy - (imgY - startLine.y1) * ldx) / len
              onResizeThickness(selectedId, Math.max(0.5, (dist * 2) / 6))
            }
          } else if (startBounds) {
            let nb: { x: number; y: number; w: number; h: number }
            if (lockCenter) {
              // Number marker: its position (cx, cy) is the point it's meant to
              // mark, so any handle drag must grow/shrink it around that fixed
              // center rather than the opposite corner/edge — otherwise the
              // marker drifts off the spot it's pointing at while "just resizing".
              const cx = startBounds.x + startBounds.w / 2
              const cy = startBounds.y + startBounds.h / 2
              const r = Math.max(MIN_RESIZE / 2, Math.hypot(imgX - cx, imgY - cy))
              nb = { x: cx - r, y: cy - r, w: r * 2, h: r * 2 }
            } else {
              const lock = !!lockAlways || (e.shiftKey && !!lockEligible)
              nb = applyHandleResize(startBounds, handle, dix, diy, lock)
            }
            if (nb.w >= MIN_RESIZE && nb.h >= MIN_RESIZE) onResizeAnnotation(selectedId, nb)
          }
          return
        }

        // Crop tool: active draw/move/resize drag, or idle hover
        if (activeTool === 'crop') {
          const drag = cropDragRef.current
          if (drag) {
            const { mode, startImgX, startImgY, startRect } = drag
            if (mode === 'draw') {
              const x0 = clamp(startRect.x, 0, imageWidth)
              const y0 = clamp(startRect.y, 0, imageHeight)
              const x1 = clamp(imgX, 0, imageWidth)
              const y1 = clamp(imgY, 0, imageHeight)
              setCropRect({
                x: Math.min(x0, x1),
                y: Math.min(y0, y1),
                w: Math.abs(x1 - x0),
                h: Math.abs(y1 - y0),
              })
            } else if (mode === 'move') {
              const nx = clamp(startRect.x + (imgX - startImgX), 0, imageWidth - startRect.w)
              const ny = clamp(startRect.y + (imgY - startImgY), 0, imageHeight - startRect.h)
              setCropRect({ ...startRect, x: nx, y: ny })
            } else {
              const nb = applyHandleResize(startRect, mode, imgX - startImgX, imgY - startImgY, false)
              let { x, y, w, h } = nb
              if (x < 0) { w += x; x = 0 }
              if (y < 0) { h += y; y = 0 }
              if (x + w > imageWidth) w = imageWidth - x
              if (y + h > imageHeight) h = imageHeight - y
              if (w >= MIN_CROP && h >= MIN_CROP) setCropRect({ x, y, w, h })
            }
            return
          }
          if (cropRect) {
            const hit = findHandleHit(cssX, cssY, cropHandlePosRef.current)
            setActiveHandle(hit)
            setCropHover(!hit && imgX >= cropRect.x && imgX <= cropRect.x + cropRect.w &&
                                 imgY >= cropRect.y && imgY <= cropRect.y + cropRect.h)
          }
          return
        }

        if (!dragging.current) {
          // Handle hover feedback also applies when a drawing tool is
          // active and something is selected — this is what visually hints
          // that its handle is grabbable without switching to Select first.
          if (activeTool === 'select' || selectedId) {
            setActiveHandle(findHandleHit(cssX, cssY, handlePosRef.current))
          }
          // Select tool: show what a click would grab, before committing.
          if (activeTool === 'select') {
            let hid: string | null = null
            for (let i = annotations.length - 1; i >= 0; i--) {
              if (hitTest(annotations[i], imgX, imgY)) { hid = annotations[i].id; break }
            }
            setHoverId(hid)
          }
          return
        }

        if (movingRef.current && selectedIds.length > 0) {
          const dx = imgX - moveDragStart.current.imgX
          const dy = imgY - moveDragStart.current.imgY
          moveDragStart.current = { imgX, imgY }
          onMoveAnnotations(selectedIds, dx, dy)
          return
        }

        if (activeTool === 'pen') {
          const pts = penPointsRef.current
          const last = pts[pts.length - 1]
          // Throttle: only record a new point once the cursor has moved a
          // meaningful distance, so slow drags don't bloat the point array.
          if (!last || Math.hypot(imgX - last.x, imgY - last.y) >= 1.5) {
            pts.push({ x: imgX, y: imgY })
          }
          setPreview({ id: makeId(), type: 'pen', color: activeColor, sw: strokeWidth, points: [...pts] })
          return
        }

        const { imgX: sx, imgY: sy } = dragStart.current
        setPreview(buildAnnotation(activeTool, sx, sy, imgX, imgY, activeColor, strokeWidth, fillMode, nextNumber, e.shiftKey, numberShape, arrowHead, blurStrength, spotlightDim))
      },
      [activeTool, activeColor, strokeWidth, fontSize, fillMode, numberShape, arrowHead, blurStrength, spotlightDim, nextNumber,
       toImgCoords, selectedId, selectedIds, annotations, onMoveAnnotations, onResizeAnnotation, onResizeEndpoint, onResizeThickness, onPanChange,
       cropRect, imageWidth, imageHeight, samplePickColor],
    )

    const onMouseUp = useCallback(
      (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (panning.current) {
          panning.current = false
          return
        }
        if (rubberbanding.current) {
          rubberbanding.current = false
          const rb = rubberBandRef.current
          rubberBandRef.current = null
          setRbTick(v => v + 1)
          if (rb) {
            const minX = Math.min(rb.startImgX, rb.curImgX)
            const maxX = Math.max(rb.startImgX, rb.curImgX)
            const minY = Math.min(rb.startImgY, rb.curImgY)
            const maxY = Math.max(rb.startImgY, rb.curImgY)
            if (maxX - minX > 4 || maxY - minY > 4) {
              const ids = annotations
                .filter(a => {
                  const b = getAnnotationBounds(a)
                  if (!b) return false
                  return b.x < maxX && b.x + b.w > minX && b.y < maxY && b.y + b.h > minY
                })
                .map(a => a.id)
              if (e.ctrlKey || e.metaKey) {
                onSetSelection([...new Set([...selectedIds, ...ids])])
              } else {
                onSetSelection(ids)
              }
            }
          }
          return
        }
        if (resizeState.current) {
          resizeState.current = null
          setActiveHandle(null)
          setHint(null)
          return
        }
        if (cropDragRef.current) {
          const wasDraw = cropDragRef.current.mode === 'draw'
          cropDragRef.current = null
          setActiveHandle(null)
          if (wasDraw && cropRect && (cropRect.w < MIN_CROP || cropRect.h < MIN_CROP)) setCropRect(null)
          return
        }
        if (!dragging.current) return
        dragging.current = false
        setHint(null)

        // Moving the already-selected annotation — started either from
        // Select or from a drawing tool grabbing its own just-placed shape
        // (see onMouseDown). Nothing further to do here, and this must NOT
        // fall through to "draw a new shape" below: dragStart.current holds
        // stale data left over from whatever shape was drawn before this drag.
        if (movingRef.current) {
          movingRef.current = false
          return
        }
        if (activeTool === 'select') return

        if (activeTool === 'pen') {
          const pts = penPointsRef.current
          penPointsRef.current = []
          setPreview(null)
          if (pts.length >= 2) {
            onAnnotationAdded({ id: makeId(), type: 'pen', color: activeColor, sw: strokeWidth, points: pts })
          }
          return
        }

        const { imgX, imgY } = toImgCoords(e)
        const { imgX: sx, imgY: sy } = dragStart.current
        const ann = buildAnnotation(activeTool, sx, sy, imgX, imgY, activeColor, strokeWidth, fillMode, nextNumber, e.shiftKey, numberShape, arrowHead, blurStrength, spotlightDim)
        setPreview(null)
        if (ann) onAnnotationAdded(ann)
      },
      [activeTool, activeColor, strokeWidth, fontSize, fillMode, numberShape, arrowHead, blurStrength, spotlightDim, nextNumber,
       toImgCoords, onAnnotationAdded, cropRect],
    )

    const commitText = useCallback(
      (text: string) => {
        if (!textPos) return
        const editing = editingTextId
        setTextPos(null)
        setEditingTextId(null)
        // Re-editing an existing annotation: update (empty text deletes it).
        if (editing) {
          onUpdateText(editing, text)
          return
        }
        const trimmed = text.replace(/^\n+|\n+$/g, '')
        if (!trimmed) return
        const ann: Annotation = {
          id: makeId(),
          type: 'text',
          color: activeColor,
          sw: strokeWidth,
          x: textPos.imgX,
          y: textPos.imgY,
          text: trimmed,
          fontSize,
          shape: textShape,
        }
        onAnnotationAdded(ann)
      },
      [textPos, editingTextId, activeColor, strokeWidth, fontSize, textShape, onAnnotationAdded, onUpdateText],
    )

    const commitNumber = useCallback(
      (value: string) => {
        if (!numberEdit) return
        const id = numberEdit.id
        setNumberEdit(null)
        const n = parseInt(value, 10)
        if (Number.isFinite(n)) onUpdateNumber(id, n)
      },
      [numberEdit, onUpdateNumber],
    )

    const handleCropApply = useCallback(() => {
      const img = imgRef.current
      const rect = cropRectRef.current
      if (!rect || !img) return
      const x = Math.round(rect.x)
      const y = Math.round(rect.y)
      const w = Math.round(rect.w)
      const h = Math.round(rect.h)
      if (w < 1 || h < 1) return
      const off = document.createElement('canvas')
      off.width = w
      off.height = h
      const c = off.getContext('2d')!
      c.drawImage(img, x, y, w, h, 0, 0, w, h)
      const dataUrl = off.toDataURL('image/png')
      setCropRect(null)
      onApplyCrop(dataUrl, w, h, -x, -y)
      onCropDone()
    }, [onApplyCrop, onCropDone])

    const handleCropCancel = useCallback(() => {
      setCropRect(null)
      onCropDone()
    }, [onCropDone])

    // Enter applies the pending crop, Escape cancels it. Reads cropRectRef
    // (rather than depending on cropRect) so this doesn't tear down and
    // re-subscribe the listener on every drag-move frame while sizing the rect.
    useEffect(() => {
      if (activeTool !== 'crop') return
      const onKey = (e: KeyboardEvent) => {
        if (!cropRectRef.current) return
        if (e.key === 'Enter') { e.preventDefault(); handleCropApply() }
        if (e.key === 'Escape') { e.preventDefault(); handleCropCancel() }
      }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
    }, [activeTool, handleCropApply, handleCropCancel])

    // ── Export ─────────────────────────────────────────────────────────────
    // Renders the image + annotations onto a fresh canvas at export size.
    const renderExport = () => {
      const img = imgRef.current
      if (!img || imageWidth === 0 || imageHeight === 0) return null
      // Elements dragged outside the screenshot grow the canvas to fit them;
      // the added margin is left transparent (no background fill).
      const bounds = baseContentBounds
      const offscreen = document.createElement('canvas')
      offscreen.width = Math.ceil(bounds.w)
      offscreen.height = Math.ceil(bounds.h)
      const ctx2 = offscreen.getContext('2d')!
      ctx2.save()
      ctx2.translate(-bounds.x, -bounds.y)
      drawFramedImage(ctx2, img, 0, 0, imageWidth, imageHeight, frame.radius)
      for (const ann of annotations) {
        try {
          drawAnnotation(ctx2, ann, img)
        } catch (e) {
          console.error('[annotation] export draw failed, skipping', ann.id, ann.type, e)
        }
      }
      ctx2.restore()
      return offscreen
    }
    useImperativeHandle(ref, () => ({
      exportPng: () =>
        renderExport()?.toDataURL('image/png').replace('data:image/png;base64,', '') ?? null,
      // PNG-encodes asynchronously (toBlob) so large exports don't block the
      // UI thread the way toDataURL does.
      exportBlob: () =>
        new Promise<Blob | null>((resolve) => {
          const c = renderExport()
          if (!c) return resolve(null)
          c.toBlob(resolve, 'image/png')
        }),
    }))

    const cursor = panning.current
      ? 'grabbing'
      : spaceDown.current
      ? 'grab'
      : activeTool === 'text'
        ? 'text'
        : activeTool === 'crop'
          ? activeHandle ? handleCursorStyle(activeHandle) : (cropHover ? 'move' : 'crosshair')
          : activeTool === 'select'
            ? activeHandle ? handleCursorStyle(activeHandle) : (hoverId ? 'move' : 'default')
            : activeHandle
              ? handleCursorStyle(activeHandle)
              : 'crosshair'

    // ── WYSIWYG text-edit styling ─────────────────────────────────────────
    // The textarea (and its hidden measuring twin) render at the exact size,
    // color, and background the committed annotation will have: annotation
    // fontSize × current view scale, the annotation's color, and the
    // box/bubble backdrop when that shape is active. Editing an existing
    // annotation uses *its* properties; a new one uses the tool defaults.
    const editingTextAnn = editingTextId
      ? (annotations.find((a) => a.id === editingTextId) as TextAnn | undefined)
      : undefined
    const tFont = editingTextAnn?.fontSize ?? fontSize
    const tColor = editingTextAnn?.color ?? activeColor
    const tShape = editingTextAnn?.shape ?? textShape
    const viewScale = baseTxRef.current.scale * zoom
    const tFsCss = Math.max(8, tFont * viewScale)
    const tBoxed = tShape !== 'none'
    const tPadCss = tBoxed ? textPadding(tFont) * viewScale : 0
    const textEditFont: React.CSSProperties = {
      fontSize: tFsCss,
      lineHeight: 1.25,
      padding: tBoxed ? tPadCss : undefined,
    }
    const textEditStyle: React.CSSProperties = {
      ...textEditFont,
      ...(tBoxed
        ? {
            background: tColor,
            color: contrastTextColor(tColor),
            textShadow: 'none',
            borderRadius: Math.min(tFsCss * 0.4, tFsCss),
            // Keep the *text* anchored on the annotation's (x, y): shift back
            // by the padding plus the 1px border.
            transform: `translate(${-(tPadCss + 1)}px, ${-(tPadCss + 1)}px)`,
          }
        : { color: tColor }),
    }

    return (
      <div ref={containerRef} className={styles.container}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          style={{ cursor }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onDoubleClick={onDoubleClick}
          onContextMenu={onContextMenu}
          onWheel={onWheel}
          onMouseLeave={() => {
            if (dragging.current) { dragging.current = false; setPreview(null) }
            movingRef.current = false
            if (panning.current) panning.current = false
            if (resizeState.current) resizeState.current = null
            if (cropDragRef.current) cropDragRef.current = null
            penPointsRef.current = []
            setActiveHandle(null)
            setCropHover(false)
            setHoverId(null)
            setPickPreview(null)
            setHint(null)
          }}
        />
        {activeTool === 'picker' && pickPreview && (
          <div
            className={styles.pickChip}
            style={{ left: pickPreview.cssX + 16, top: pickPreview.cssY + 18 }}
          >
            <span className={styles.pickSwatch} style={{ background: pickPreview.hex }} />
            {pickPreview.hex}
          </div>
        )}
        <div ref={textMeasureRef} className={styles.textMeasure} style={textEditFont} aria-hidden />
        {textPos && (
          <textarea
            ref={textInputRef}
            key={editingTextId ?? 'new'}
            defaultValue={editingTextAnn?.text ?? ''}
            className={styles.textInput}
            style={{ left: textPos.cssX, top: textPos.cssY, ...textEditStyle }}
            rows={1}
            onInput={(e) => {
              const el = e.currentTarget
              const measure = textMeasureRef.current
              if (measure) {
                const longest = el.value.split('\n').reduce((a, b) => a.length >= b.length ? a : b, '')
                measure.textContent = longest || ' '
                el.style.width = `${measure.offsetWidth + 2}px`
              }
              el.style.height = 'auto'
              el.style.height = `${el.scrollHeight}px`
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                cancelTextRef.current = true
                setEditingTextId(null)
                setTextPos(null)
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                commitText(e.currentTarget.value)
              }
            }}
            onBlur={(e) => {
              if (cancelTextRef.current) { cancelTextRef.current = false; return }
              commitText(e.currentTarget.value)
            }}
          />
        )}
        {numberEdit && (() => {
          const ann = annotations.find((a) => a.id === numberEdit.id) as NumberAnn | undefined
          if (!ann) return null
          return (
            <input
              ref={numberInputRef}
              type="number"
              className={styles.numberInput}
              defaultValue={ann.n}
              style={{
                left: numberEdit.cssX,
                top: numberEdit.cssY,
                width: numberEdit.size,
                height: numberEdit.size,
                borderRadius: ann.shape === 'circle' ? '50%' : `${numberEdit.size * 0.14}px`,
                fontSize: numberEdit.size * 0.45,
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  cancelNumberRef.current = true
                  setNumberEdit(null)
                }
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitNumber(e.currentTarget.value)
                }
              }}
              onBlur={(e) => {
                if (cancelNumberRef.current) { cancelNumberRef.current = false; return }
                commitNumber(e.currentTarget.value)
              }}
            />
          )
        })()}
        {activeTool === 'crop' && cropRect && (
          <div className={styles.cropActions}>
            <button
              className={styles.cropActionBtn}
              onClick={handleCropCancel}
              title="Cancel crop (Esc)"
            >
              <X size={14} strokeWidth={2} />
              <span>Cancel</span>
            </button>
            <button
              className={`${styles.cropActionBtn} ${styles.cropActionPrimary}`}
              onClick={handleCropApply}
              title="Apply crop (Enter)"
            >
              <Check size={14} strokeWidth={2} />
              <span>Apply</span>
            </button>
          </div>
        )}
        {ctxMenu && (
          <div
            className={styles.ctxMenu}
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button className={styles.ctxItem} onClick={() => { onDuplicateSelection(); setCtxMenu(null) }}>
              Duplicate <span className={styles.ctxKey}>Ctrl+D</span>
            </button>
            <button className={styles.ctxItem} onClick={() => { onBringToFront(); setCtxMenu(null) }}>
              Bring to Front
            </button>
            <button className={styles.ctxItem} onClick={() => { onSendToBack(); setCtxMenu(null) }}>
              Send to Back
            </button>
            <div className={styles.ctxSep} />
            <button className={`${styles.ctxItem} ${styles.ctxDanger}`} onClick={() => { onDeleteSelection(); setCtxMenu(null) }}>
              Delete <span className={styles.ctxKey}>Del</span>
            </button>
          </div>
        )}
        {hint && <div className={styles.hintBar}>{hint}</div>}
        {/* Zoom cluster: Fit (reset view), 1:1 (one image px = one CSS px),
            and the current effective scale. Always visible so the way back
            from a zoomed/panned view doesn't depend on knowing Ctrl+0. */}
        <div className={styles.zoomControls}>
          <button
            className={styles.zoomBtn}
            onClick={() => { onZoomChange(1); onPanChange(0, 0) }}
            title="Fit to window (Ctrl+0)"
          >
            Fit
          </button>
          <button
            className={styles.zoomBtn}
            onClick={() => {
              const bs = baseTxRef.current.scale
              if (bs > 0) { onZoomChange(1 / bs); onPanChange(0, 0) }
            }}
            title="Actual size (100%)"
          >
            1:1
          </button>
          <span className={styles.zoomPct}>
            {Math.round(zoom * baseTxRef.current.scale * 100)}%
          </span>
        </div>
      </div>
    )
  },
)

export default AnnotationCanvas

// ── Resize helpers ─────────────────────────────────────────────────────────

function computeHandlePositions(
  ann: Annotation,
  b: { x: number; y: number; w: number; h: number },
  ox: number, oy: number, scale: number, pad: number,
): HandlePos[] {
  if (ann.type === 'text') {
    const sx = ox + b.x * scale - pad
    const sy = oy + b.y * scale - pad
    const sw = b.w * scale + pad * 2
    const sh = b.h * scale + pad * 2
    return [
      { id: 'tl', cx: sx,      cy: sy },
      { id: 'tr', cx: sx + sw, cy: sy },
      { id: 'bl', cx: sx,      cy: sy + sh },
      { id: 'br', cx: sx + sw, cy: sy + sh },
    ]
  }
  if (ann.type === 'arrow' || ann.type === 'line') {
    return [
      { id: 'p1', cx: ox + ann.x1 * scale, cy: oy + ann.y1 * scale },
      { id: 'p2', cx: ox + ann.x2 * scale, cy: oy + ann.y2 * scale },
    ]
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
      // Handle on the band's edge, perpendicular to the stroke — dragging it
      // changes thickness directly, with no upper bound (unlike the toolbar slider).
      const nx = -dy / len
      const ny = dx / len
      const ht = (sw * 6) / 2
      const mx = (x1 + x2) / 2 + nx * ht
      const my = (y1 + y2) / 2 + ny * ht
      handles.push({ id: 'thick', cx: ox + mx * scale, cy: oy + my * scale })
    }
    return handles
  }
  if (ann.type === 'pen') return []  // move/delete only, no resize
  return boxHandlePositions(b, ox, oy, scale, pad)
}

/** 8-point resize handles for a plain box, in screen-space coordinates. */
function boxHandlePositions(
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

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/**
 * Union of the original image rect and every annotation's bounds, in
 * image-pixel space. Annotations dragged outside the image grow this box
 * (x/y can go negative), so the exported canvas can expand to include them.
 */
function computeContentBounds(
  annotations: Annotation[],
  imageWidth: number,
  imageHeight: number,
): { x: number; y: number; w: number; h: number } {
  let minX = 0, minY = 0, maxX = imageWidth, maxY = imageHeight
  for (const ann of annotations) {
    const b = getAnnotationBounds(ann)
    if (!b) continue
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.w)
    maxY = Math.max(maxY, b.y + b.h)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

type Bounds = { x: number; y: number; w: number; h: number }

/** Smallest box containing both `a` and `b`. */
function unionBounds(a: Bounds, b: Bounds): Bounds {
  const minX = Math.min(a.x, b.x)
  const minY = Math.min(a.y, b.y)
  const maxX = Math.max(a.x + a.w, b.x + b.w)
  const maxY = Math.max(a.y + a.h, b.y + b.h)
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/** Snap point (bx,by) so the segment from (ax,ay) lies on the nearest 45° angle. */
function snapAngle(ax: number, ay: number, bx: number, by: number): { x: number; y: number } {
  const dx = bx - ax
  const dy = by - ay
  const len = Math.hypot(dx, dy)
  if (len < 1) return { x: bx, y: by }
  const step = Math.PI / 4
  const angle = Math.round(Math.atan2(dy, dx) / step) * step
  return { x: ax + Math.cos(angle) * len, y: ay + Math.sin(angle) * len }
}

/** Contextual hint for an in-progress resize of `ann` via `handle`. */
function resizeHint(ann: Annotation, handle: HandleId): string {
  if (handle === 'p1' || handle === 'p2') return 'Shift: 45° snap · Esc: cancel'
  if (ann.type === 'ellipse') return 'Shift: keep ratio · Esc: cancel'
  return 'Esc: cancel'
}

function findHandleHit(cssX: number, cssY: number, handles: HandlePos[]): HandleId | null {
  for (const h of handles) {
    if (Math.abs(cssX - h.cx) <= HANDLE_HIT && Math.abs(cssY - h.cy) <= HANDLE_HIT) return h.id
  }
  return null
}

function applyHandleResize(
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


function handleCursorStyle(h: HandleId): string {
  if (h === 'tl' || h === 'br') return 'nwse-resize'
  if (h === 'tr' || h === 'bl') return 'nesw-resize'
  if (h === 'tc' || h === 'bc') return 'ns-resize'
  if (h === 'ml' || h === 'mr') return 'ew-resize'
  return 'crosshair'
}

// ── Annotation builder ─────────────────────────────────────────────────────

function buildAnnotation(
  tool: AnnotationTool,
  sx: number, sy: number,
  ex: number, ey: number,
  color: string, sw: number, fillMode: FillMode, n: number,
  shift = false,
  numberShape: 'circle' | 'square' = 'circle',
  arrowHead: ArrowHead = 'triangle',
  blurStrength: BlurStrength = 'medium',
  spotlightDim = 0.55,
): Annotation | null {
  const id = makeId()
  const base = { id, color, sw }
  switch (tool) {
    case 'arrow': {
      const end = shift ? snapAngle(sx, sy, ex, ey) : { x: ex, y: ey }
      return { ...base, type: 'arrow', x1: sx, y1: sy, x2: end.x, y2: end.y, head: arrowHead }
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
      return { ...base, type: 'rect', x: sx, y: sy, w: rdx, h: rdy, fill: fillMode }
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
    case 'spotlight':
      return { ...base, type: 'spotlight', x: sx, y: sy, w: ex - sx, h: ey - sy, dim: spotlightDim }
    case 'number': {
      const r = Math.max(10, sw * 5)
      return { ...base, type: 'number', cx: sx, cy: sy, n, r, shape: numberShape }
    }
    default:
      return null
  }
}
