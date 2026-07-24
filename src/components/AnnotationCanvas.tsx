import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Check, X } from 'lucide-react'
import { bubbleCornerRadius, bubbleTailHeight, bubbleTailPoints, contrastTextColor, drawAnnotation, getAnnotationBounds, getAnnotationCoreBounds, getAnnotationLocalBounds, getBubbleBodyBox, getBubbleTailAnchors, getConnectAnchors, getElbowSegments, hitTest, isConnectable, makeId, rotatePoint, textPadding } from '../lib/annotations'
import type { Annotation, ArrowConnection, ArrowHead, BubbleTailAnchor, ConnectAnchor, TextAnn, TextShape, NumberAnn } from '../lib/annotations'
import type { AnnotationTool, FillMode } from '../lib/store'
import type { FrameConfig } from '../lib/frame'
import { drawFramedImage } from '../lib/frame'
import styles from './AnnotationCanvas.module.css'

export interface AnnotationCanvasHandle {
  exportPng: () => string | null
  exportBlob: () => Promise<Blob | null>
}

type HandleId = 'tl' | 'tc' | 'tr' | 'ml' | 'mr' | 'bl' | 'bc' | 'br' | 'p1' | 'p2' | 'thick' | 'thick2' | 'rot' | 'bend' | 'tail'
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
  rotationDeg?: number    // shape's current rotation — resize math happens in its local (unrotated) frame
  isArrow?: boolean       // p1/p2 on an arrow can glue to another shape's connection point
  startSw?: number        // stroke width at drag start (marker edge drags need the original thickness)
}
interface RotateState {
  id: string
  cx: number
  cy: number
  startAngleDeg: number   // ann.rotation at drag start
  startMouseAngle: number // radians, atan2 of the initial mouse position around (cx, cy)
}

const MIN_RESIZE = 10
const SEL_PAD = 6
const HANDLE_SIZE = 7
const HANDLE_HIT = 8
const MIN_CROP = 20
// CSS px, constant regardless of zoom: distance from a rect/ellipse's top
// edge to its rotate handle (Excel/PowerPoint-style stalk).
const ROT_HANDLE_DIST = 26
// CSS px snap radius for gluing an arrow endpoint to another shape's connection point.
const CONNECT_SNAP_DIST = 14

// Contextual hints shown while drawing with each tool (bottom center).
const DRAW_HINTS: Partial<Record<AnnotationTool, string>> = {
  arrow:     'Drag onto a shape to connect · Shift: 45° snap · Esc: cancel',
  line:      'Shift: 45° snap · Esc: cancel',
  highlight: 'Shift: 45° snap · Esc: cancel',
  rect:      'Shift: 1:1 · Esc: cancel',
  ellipse:   'Shift: 1:1 · Esc: cancel',
  blur:      'Esc: cancel',
  spotlight: 'Shift: 1:1 · Esc: cancel',
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
  activeOpacity: number
  strokeWidth: number
  fontSize: number
  fillMode: FillMode
  numberShape: 'circle' | 'square'
  numberRadius: number
  arrowHead: ArrowHead
  doubleEndedArrow: boolean
  arrowStyle: 'straight' | 'elbow'
  textShape: TextShape
  tailAnchor: BubbleTailAnchor
  textAlign: 'left' | 'center' | 'right'
  blurStrength: number
  spotlightDim: number
  spotlightShape: 'circle' | 'square'
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
  onSetArrowConnection: (id: string, which: 'p1' | 'p2', connect: ArrowConnection | null) => void
  onResizeThickness: (id: string, sw: number) => void
  /** Marker edge drag: new centerline + stroke width in one go. */
  onResizeMarker: (id: string, x1: number, y1: number, x2: number, y2: number, sw: number) => void
  /** Elbow arrow bend-handle drag: new position (0..1) along the dominant axis. */
  onResizeBend: (id: string, bendRatio: number) => void
  /** Bubble tail-handle drag: new anchor (nearest of the 16 compass points). */
  onResizeTail: (id: string, anchor: BubbleTailAnchor) => void
  onRotateAnnotation: (id: string, rotationDeg: number) => void
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
      annotations, activeTool, activeColor, activeOpacity, strokeWidth, fontSize, fillMode, numberShape, numberRadius, arrowHead, doubleEndedArrow, arrowStyle, textShape, tailAnchor, textAlign,
      blurStrength, spotlightDim, spotlightShape,
      frame,
      nextNumber, selectedIds,
      zoom, panX, panY,
      onAnnotationAdded, onBeginDrag, onSetSelection, onToggleSelection, onMoveAnnotations,
      onResizeAnnotation, onResizeEndpoint, onResizeThickness, onResizeMarker, onResizeBend, onResizeTail, onSetArrowConnection, onRotateAnnotation, onUpdateText, onUpdateNumber,
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
    const rotateStateRef = useRef<RotateState | null>(null)
    const handlePosRef = useRef<HandlePos[]>([])
    // Arrow endpoint → shape connections (Excel-style connectors).
    // Set once at mousedown when drawing a brand-new arrow whose start point
    // snapped to a target; consumed at mouseup.
    const newArrowStartConnectRef = useRef<ArrowConnection | null>(null)
    // Continuously updated while an arrow endpoint (new or existing) is being
    // dragged near a connectable shape — the currently "would connect here"
    // target, or null when not close enough to snap. Drives both the live
    // snapped position and the highlighted anchor dot.
    const activeSnapRef = useRef<{ targetId: string; anchor: ConnectAnchor; x: number; y: number } | null>(null)
    const [activeHandle, setActiveHandle] = useState<HandleId | null>(null)
    const [preview, setPreview] = useState<Annotation | null>(null)
    // Pen tool: points accumulated for the in-progress freehand stroke
    const penPointsRef = useRef<{ x: number; y: number }[]>([])

    // Panning state
    const panning = useRef(false)
    const panStart = useRef({ cssX: 0, cssY: 0, panX: 0, panY: 0 })

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
    // The editing textarea's width, recomputed on every keystroke from the
    // hidden measurer (see the onInput handler below). Kept in state and fed
    // back through the `style` prop — rather than only writing
    // `el.style.width` imperatively — so it's part of what React actually
    // renders instead of a side-channel DOM mutation a later re-render could
    // silently overwrite.
    const [editWidth, setEditWidth] = useState<number | null>(null)
    // Same reasoning as editWidth — kept in state (not just imperative
    // el.style.height) so the live bubble-tail preview below can compute its
    // triangle from the textarea's actual current CSS box.
    const [editHeight, setEditHeight] = useState<number | null>(null)

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

    // Set initial textarea size to minimum when text tool activates. A
    // layout effect (not a plain effect) so the width is committed to state
    // and re-rendered before the browser paints — otherwise the box would
    // flash at whatever width it happened to have from a previous edit
    // session before snapping to the correct one.
    useLayoutEffect(() => {
      if (!textPos) return
      const el = textInputRef.current
      const measure = textMeasureRef.current
      if (!el || !measure) return
      const longest = el.value.split('\n').reduce((a, b) => (a.length >= b.length ? a : b), '')
      measure.textContent = longest || ' '
      setEditWidth(measure.offsetWidth + 2)
      // Reset to auto first so scrollHeight reflects the *new* content height
      // (it only ever grows to fit — resetting lets it shrink back too).
      el.style.height = 'auto'
      setEditHeight(el.scrollHeight)
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
          newArrowStartConnectRef.current = null
          activeSnapRef.current = null
          setPreview(null)
          setHint(null)
          return
        }
        // Moving/resizing/rotating an existing one → abort and revert: the
        // drag pushed an undo snapshot when it began, so one undo restores
        // the exact pre-drag state.
        if (movingRef.current || resizeState.current || rotateStateRef.current) {
          movingRef.current = false
          dragging.current = false
          resizeState.current = null
          rotateStateRef.current = null
          activeSnapRef.current = null
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
      rotateStateRef.current = null
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
      newArrowStartConnectRef.current = null
      activeSnapRef.current = null
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
        if (!dragging.current && !rubberbanding.current && !panning.current && !resizeState.current && !rotateStateRef.current && !cropDragRef.current) return
        dragging.current = false
        movingRef.current = false
        rubberbanding.current = false
        rubberBandRef.current = null
        resizeState.current = null
        rotateStateRef.current = null
        panning.current = false
        cropDragRef.current = null
        penPointsRef.current = []
        newArrowStartConnectRef.current = null
        activeSnapRef.current = null
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
      const previewBounds = preview ? getAnnotationCoreBounds(preview) : null
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
          // Arrows/lines/markers don't get a dashed box: their handles (and
          // the stroke itself) already show the selection — for arrows the
          // box is padded far past the ink, and the marker band is its own
          // clearly visible outline.
          if (ann.type === 'arrow' || ann.type === 'line' || ann.type === 'highlight') continue
          if ((ann.type === 'rect' || ann.type === 'ellipse') && (ann.rotation ?? 0) !== 0) {
            // Oriented box hugging the shape's actual (rotated) outline,
            // instead of a loose axis-aligned box around its silhouette.
            const local = getAnnotationLocalBounds(ann)!
            const cx = local.x + local.w / 2
            const cy = local.y + local.h / 2
            const hw = local.w / 2 + SEL_PAD
            const hh = local.h / 2 + SEL_PAD
            const corners: [number, number][] = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]
            ctx.beginPath()
            corners.forEach(([lx, ly], i) => {
              const p = rotatePoint(cx + lx, cy + ly, cx, cy, ann.rotation ?? 0)
              const sxp = ox + p.x * scale
              const syp = oy + p.y * scale
              if (i === 0) ctx.moveTo(sxp, syp)
              else ctx.lineTo(sxp, syp)
            })
            ctx.closePath()
            ctx.stroke()
            continue
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
            // Rotation-handle stalk: a short connecting line from the shape's
            // top edge to its rotate handle (rect/ellipse only).
            if (selAnn.type === 'rect' || selAnn.type === 'ellipse') {
              const tc = handles.find((h) => h.id === 'tc')
              const rotH = handles.find((h) => h.id === 'rot')
              if (tc && rotH) {
                ctx.save()
                ctx.strokeStyle = '#60A5FA'
                ctx.lineWidth = 1.5
                ctx.beginPath()
                ctx.moveTo(tc.cx, tc.cy)
                ctx.lineTo(rotH.cx, rotH.cy)
                ctx.stroke()
                ctx.restore()
              }
            }
            ctx.fillStyle = '#FFFFFF'
            ctx.strokeStyle = '#60A5FA'
            ctx.lineWidth = 1.5
            for (const h of handles) {
              if (h.id === 'rot') {
                ctx.beginPath()
                ctx.arc(h.cx, h.cy, HS / 2 + 1, 0, Math.PI * 2)
                ctx.fill()
                ctx.stroke()
              } else if ((h.id === 'thick' || h.id === 'thick2') && selAnn.type === 'highlight') {
                // Rotate the handle to match the marker's angle, so it reads
                // as part of the band's edge rather than a generic square.
                const angle = Math.atan2(selAnn.y2 - selAnn.y1, selAnn.x2 - selAnn.x1)
                ctx.save()
                ctx.translate(h.cx, h.cy)
                ctx.rotate(angle)
                ctx.fillRect(-HS / 2, -HS / 2, HS, HS)
                ctx.strokeRect(-HS / 2, -HS / 2, HS, HS)
                ctx.restore()
              } else if (
                (h.id === 'p1' || h.id === 'p2') && selAnn.type === 'arrow' && selAnn.head === 'dot' &&
                (h.id === 'p2' || selAnn.doubleEnded)
              ) {
                // A dot arrowhead is centered exactly on the endpoint handle —
                // a filled handle there would completely hide it. Draw a
                // hollow ring around the dot instead, so the actual arrowhead
                // stays visible while the handle is still marked as grabbable.
                // (Applies to p2 always, and to p1 when double-ended.)
                const dotR = Math.max(4, selAnn.sw * 1.2) * scale
                ctx.beginPath()
                ctx.arc(h.cx, h.cy, dotR + 3, 0, Math.PI * 2)
                ctx.stroke()
              } else if (h.id === 'p1' || h.id === 'p2') {
                // Every other endpoint gets a small filled dot — round, so a
                // thin stroke's tip stays clearly marked without the visual
                // weight of a square box.
                ctx.beginPath()
                ctx.arc(h.cx, h.cy, HS / 2, 0, Math.PI * 2)
                ctx.fill()
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
        // Arrows/lines skip the oversized dashed box, but their endpoints
        // still need to be discoverable — faint endpoint dots show where a
        // grab would land once the click selects it.
        if (ha && (ha.type === 'arrow' || ha.type === 'line' || ha.type === 'highlight')) {
          ctx.save()
          ctx.globalAlpha = 0.55
          ctx.fillStyle = '#FFFFFF'
          ctx.strokeStyle = '#60A5FA'
          ctx.lineWidth = 1.5
          for (const [px, py] of [[ha.x1, ha.y1], [ha.x2, ha.y2]]) {
            ctx.beginPath()
            ctx.arc(ox + px * scale, oy + py * scale, HANDLE_SIZE / 2, 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()
          }
          ctx.restore()
        }
        const hb = ha && ha.type !== 'arrow' && ha.type !== 'line' && ha.type !== 'highlight' ? getAnnotationBounds(ha) : null
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

      // ── Connection points (Excel-style connectors): shown on every
      // connectable shape while an arrow endpoint (new or existing) is
      // being dragged, with the one in snap range highlighted. ────────────
      const draggingArrowEndpoint =
        (dragging.current && activeTool === 'arrow' && !movingRef.current) ||
        !!(resizeState.current?.isArrow && (resizeState.current.handle === 'p1' || resizeState.current.handle === 'p2'))
      if (draggingArrowEndpoint) {
        const excludeId = resizeState.current?.isArrow ? selectedId : null
        ctx.save()
        for (const cand of annotations) {
          if (cand.id === excludeId || !isConnectable(cand)) continue
          // 16 points per shape crowd a small one — shrink the dots to fit.
          const cb = getAnnotationBounds(cand)
          const dotR = cb ? Math.max(2, Math.min(4, (Math.min(cb.w, cb.h) * scale) / 12)) : 4
          // One shape whose anchors can't be computed (e.g. unmeasurable text)
          // must not cost every other shape its dots.
          let pts: ReturnType<typeof getConnectAnchors> = []
          try {
            pts = getConnectAnchors(cand)
          } catch (e) {
            console.error('[connect] anchors failed, skipping', cand.id, cand.type, e)
          }
          for (const pt of pts) {
            const sxp = ox + pt.x * scale
            const syp = oy + pt.y * scale
            const isActive = activeSnapRef.current?.targetId === cand.id && activeSnapRef.current.anchor === pt.anchor
            ctx.beginPath()
            ctx.arc(sxp, syp, isActive ? dotR + 2 : dotR, 0, Math.PI * 2)
            ctx.fillStyle = isActive ? '#22C55E' : 'rgba(96, 165, 250, 0.9)'
            ctx.fill()
            // Every dot gets a white ring — over a screenshot (or on top of
            // text) a plain blue dot can vanish into the pixels behind it.
            ctx.strokeStyle = isActive ? '#FFFFFF' : 'rgba(255, 255, 255, 0.9)'
            ctx.lineWidth = isActive ? 1.5 : 1
            ctx.stroke()
          }
        }
        ctx.restore()
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

    // Starts a resize or rotate drag for `ann` from a hit-tested handle.
    // Shared by the Select tool and a drawing tool grabbing its own
    // just-placed selection, so both paths stay in sync.
    const beginHandleDrag = useCallback((hit: HandleId, imgX: number, imgY: number, ann: Annotation) => {
      onBeginDrag()
      if (hit === 'rot') {
        const local = getAnnotationLocalBounds(ann)
        if (!local) return
        const cx = local.x + local.w / 2
        const cy = local.y + local.h / 2
        const startAngleDeg = (ann.type === 'rect' || ann.type === 'ellipse') ? (ann.rotation ?? 0) : 0
        rotateStateRef.current = {
          id: ann.id, cx, cy, startAngleDeg,
          startMouseAngle: Math.atan2(imgY - cy, imgX - cx),
        }
        setActiveHandle('rot')
        setHint('Shift: 15° snap · Esc: cancel')
        return
      }
      const b = getAnnotationLocalBounds(ann)
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
        rotationDeg: (ann.type === 'rect' || ann.type === 'ellipse') ? (ann.rotation ?? 0) : 0,
        isArrow: ann.type === 'arrow',
        startSw: ann.sw,
      }
      setActiveHandle(hit)
      setHint(resizeHint(ann, hit))
    }, [onBeginDrag])

    // ── Mouse handlers ─────────────────────────────────────────────────────
    const onMouseDown = useCallback(
      (e: React.MouseEvent<HTMLCanvasElement>) => {
        // Middle-drag = pan (Adobe-style).
        if (e.button === 1) {
          e.preventDefault()
          panning.current = true
          panStart.current = { cssX: e.clientX, cssY: e.clientY, panX, panY }
          return
        }
        if (e.button !== 0) return

        const { imgX, imgY, cssX, cssY } = toImgCoords(e)

        if (activeTool === 'text') {
          // Grab-after-create, same as the shape tools below: clicking the
          // just-committed (selected) text's handles or body moves/resizes
          // it — only a click elsewhere opens a fresh text editor.
          if (selectedId) {
            const hit = findHandleHit(cssX, cssY, handlePosRef.current)
            if (hit) {
              const ann = annotations.find((a) => a.id === selectedId)
              if (ann) { beginHandleDrag(hit, imgX, imgY, ann); return }
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
              const ann = annotations.find((a) => a.id === selectedId)!
              beginHandleDrag(hit, imgX, imgY, ann)
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
              const ann = annotations.find((a) => a.id === selectedId)!
              beginHandleDrag(hit, imgX, imgY, ann)
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
          setPreview({ id: makeId(), type: 'pen', color: activeColor, sw: strokeWidth, opacity: activeOpacity, points: [...penPointsRef.current] })
          setHint(DRAW_HINTS[activeTool] ?? null)
          return
        }

        // Arrow tool: starting the drag on top of another shape's connection
        // point glues the new arrow's start to it (Excel-style connectors).
        let startX = imgX
        let startY = imgY
        newArrowStartConnectRef.current = null
        if (activeTool === 'arrow') {
          const scale = baseTxRef.current.scale * zoom
          const snap = findNearestConnectAnchor(imgX, imgY, annotations, null, CONNECT_SNAP_DIST / scale)
          if (snap) {
            startX = snap.x; startY = snap.y
            newArrowStartConnectRef.current = { targetId: snap.targetId, anchor: snap.anchor }
          }
        }

        dragging.current = true
        dragStart.current = { imgX: startX, imgY: startY }
        setHint(DRAW_HINTS[activeTool] ?? null)
        setPreview(buildAnnotation(activeTool, startX, startY, startX, startY, activeColor, strokeWidth, activeOpacity, fillMode, nextNumber, false, numberShape, arrowHead, doubleEndedArrow, blurStrength, spotlightDim, numberRadius, arrowStyle, spotlightShape))
      },
      [activeTool, activeColor, strokeWidth, activeOpacity, fontSize, fillMode, numberShape, numberRadius, arrowHead, doubleEndedArrow, arrowStyle, blurStrength, spotlightDim, spotlightShape, nextNumber,
       toImgCoords, annotations, selectedId, selectedIds, onSetSelection, onToggleSelection, onBeginDrag, panX, panY, zoom, cropRect,
       samplePickColor, onPickColor, beginHandleDrag],
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

        // Active rotate drag (rect/ellipse rotate handle)
        if (rotateStateRef.current && selectedId) {
          const { cx, cy, startAngleDeg, startMouseAngle } = rotateStateRef.current
          const mouseAngle = Math.atan2(imgY - cy, imgX - cx)
          let deg = startAngleDeg + ((mouseAngle - startMouseAngle) * 180) / Math.PI
          if (e.shiftKey) deg = Math.round(deg / 15) * 15  // Excel/PowerPoint-style 15° snap
          const normalized = ((deg % 360) + 360) % 360
          onRotateAnnotation(selectedId, normalized)
          setHint(`${Math.round(normalized)}° · Shift: 15° snap · Esc: cancel`)
          return
        }

        // Active resize drag
        if (resizeState.current && selectedId) {
          const { handle, startImgX, startImgY, startBounds, startLine, lockEligible, lockAlways, lockCenter, rotationDeg, isArrow } = resizeState.current
          const dix = imgX - startImgX
          const diy = imgY - startImgY
          if ((handle === 'p1' || handle === 'p2') && startLine) {
            let nx = (handle === 'p1' ? startLine.x1 : startLine.x2) + dix
            let ny = (handle === 'p1' ? startLine.y1 : startLine.y2) + diy
            activeSnapRef.current = null
            if (isArrow) {
              const scale = baseTxRef.current.scale * zoom
              activeSnapRef.current = findNearestConnectAnchor(imgX, imgY, annotations, selectedId, CONNECT_SNAP_DIST / scale)
              if (activeSnapRef.current) { nx = activeSnapRef.current.x; ny = activeSnapRef.current.y }
            }
            if (!activeSnapRef.current && e.shiftKey) {
              // Snap the dragged endpoint to a 45° angle from the fixed endpoint.
              const fx = handle === 'p1' ? startLine.x2 : startLine.x1
              const fy = handle === 'p1' ? startLine.y2 : startLine.y1
              const s = snapAngle(fx, fy, nx, ny)
              nx = s.x; ny = s.y
            }
            onResizeEndpoint(selectedId, handle, nx, ny)
          } else if (handle === 'bend' && startLine) {
            // The handle only moves along the dominant axis — project the
            // cursor onto it to get the new bend ratio (see getElbowSegments).
            const ldx = startLine.x2 - startLine.x1
            const ldy = startLine.y2 - startLine.y1
            const ratio = Math.abs(ldx) >= Math.abs(ldy)
              ? (ldx !== 0 ? (imgX - startLine.x1) / ldx : 0.5)
              : (ldy !== 0 ? (imgY - startLine.y1) / ldy : 0.5)
            onResizeBend(selectedId, ratio)
          } else if (handle === 'tail') {
            // Snap to whichever of the bubble's own 16 tail anchors (4 per
            // straight edge, no corners) the cursor is currently nearest.
            const ann = annotations.find((a) => a.id === selectedId)
            if (ann && ann.type === 'text' && ann.shape === 'bubble') {
              let best: { anchor: BubbleTailAnchor; dist: number } | null = null
              for (const pt of getBubbleTailAnchors(ann)) {
                const dist = Math.hypot(imgX - pt.x, imgY - pt.y)
                if (!best || dist < best.dist) best = { anchor: pt.anchor, dist }
              }
              if (best) onResizeTail(selectedId, best.anchor)
            }
          } else if ((handle === 'thick' || handle === 'thick2') && startLine) {
            // Each side handle drags its own edge; the opposite edge stays
            // fixed, so the centerline shifts by half the thickness change
            // (instead of the old symmetric grow-about-the-center).
            const ldx = startLine.x2 - startLine.x1
            const ldy = startLine.y2 - startLine.y1
            const len = Math.hypot(ldx, ldy)
            if (len >= 1) {
              const nx = -ldy / len
              const ny = ldx / len
              const t0 = (resizeState.current.startSw ?? 1) * 6
              const s = handle === 'thick' ? 1 : -1
              // Signed distance of the cursor from the original centerline,
              // along the normal the 'thick' handle sits on.
              const d = (imgX - startLine.x1) * nx + (imgY - startLine.y1) * ny
              const t = Math.max(3, s * d + t0 / 2)
              const o = s * (t - t0) / 2
              onResizeMarker(
                selectedId,
                startLine.x1 + nx * o, startLine.y1 + ny * o,
                startLine.x2 + nx * o, startLine.y2 + ny * o,
                t / 6,
              )
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
              if (rotationDeg) {
                // Resize happens in the shape's own (unrotated) local frame:
                // rotate both the drag-start and current mouse position back
                // by -rotationDeg around the shape's center, so a corner
                // drag follows the shape's own axes instead of the screen's
                // — matching Excel/PowerPoint's rotated-shape resize.
                const cx0 = startBounds.x + startBounds.w / 2
                const cy0 = startBounds.y + startBounds.h / 2
                const cur = rotatePoint(imgX, imgY, cx0, cy0, -rotationDeg)
                const start = rotatePoint(startImgX, startImgY, cx0, cy0, -rotationDeg)
                nb = applyHandleResize(startBounds, handle, cur.x - start.x, cur.y - start.y, lock)
                // The resize shifted the box's center within the local frame,
                // but the shape *renders* rotated around its own (new) center
                // — reusing nb as-is would pivot the box around a different
                // point and make the anchored corner drift across the screen
                // during the drag. Map the new center back to world through
                // the ORIGINAL pivot, then place the box around it: the
                // grabbed corner tracks the mouse and the opposite corner
                // stays truly fixed, Excel/PowerPoint-style.
                const c1 = rotatePoint(nb.x + nb.w / 2, nb.y + nb.h / 2, cx0, cy0, rotationDeg)
                nb = { x: c1.x - nb.w / 2, y: c1.y - nb.h / 2, w: nb.w, h: nb.h }
              } else {
                nb = applyHandleResize(startBounds, handle, dix, diy, lock)
              }
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
          } else if (activeTool === 'text' && selectedId) {
            // Text tool: hovering the selected text's body means a click
            // grabs (moves) it, not "insert new text" — track it so the
            // cursor can switch off the I-beam there.
            const selAnn = annotations.find((a) => a.id === selectedId)
            setHoverId(selAnn && hitTest(selAnn, imgX, imgY) ? selectedId : null)
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
          setPreview({ id: makeId(), type: 'pen', color: activeColor, sw: strokeWidth, opacity: activeOpacity, points: [...pts] })
          return
        }

        // Arrow tool: the end being dragged out snaps to a nearby shape's
        // connection point, same as the start point at mousedown.
        let ex = imgX
        let ey = imgY
        activeSnapRef.current = null
        if (activeTool === 'arrow') {
          const scale = baseTxRef.current.scale * zoom
          activeSnapRef.current = findNearestConnectAnchor(imgX, imgY, annotations, null, CONNECT_SNAP_DIST / scale)
          if (activeSnapRef.current) { ex = activeSnapRef.current.x; ey = activeSnapRef.current.y }
        }
        const { imgX: sx, imgY: sy } = dragStart.current
        setPreview(buildAnnotation(activeTool, sx, sy, ex, ey, activeColor, strokeWidth, activeOpacity, fillMode, nextNumber, activeSnapRef.current ? false : e.shiftKey, numberShape, arrowHead, doubleEndedArrow, blurStrength, spotlightDim, numberRadius, arrowStyle, spotlightShape))
      },
      [activeTool, activeColor, strokeWidth, activeOpacity, fontSize, fillMode, numberShape, numberRadius, arrowHead, doubleEndedArrow, arrowStyle, blurStrength, spotlightDim, spotlightShape, nextNumber,
       toImgCoords, selectedId, selectedIds, annotations, onMoveAnnotations, onResizeAnnotation, onResizeEndpoint, onResizeThickness, onResizeMarker, onResizeBend, onResizeTail, onRotateAnnotation, onPanChange,
       zoom, cropRect, imageWidth, imageHeight, samplePickColor],
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
        if (rotateStateRef.current) {
          rotateStateRef.current = null
          setActiveHandle(null)
          setHint(null)
          return
        }
        if (resizeState.current) {
          const { handle, isArrow } = resizeState.current
          if (isArrow && selectedId && activeSnapRef.current && (handle === 'p1' || handle === 'p2')) {
            onSetArrowConnection(selectedId, handle, {
              targetId: activeSnapRef.current.targetId,
              anchor: activeSnapRef.current.anchor,
            })
          }
          activeSnapRef.current = null
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
            onAnnotationAdded({ id: makeId(), type: 'pen', color: activeColor, sw: strokeWidth, opacity: activeOpacity, points: pts })
          }
          return
        }

        const { imgX, imgY } = toImgCoords(e)
        // Arrow tool: the release point glues to a nearby connection point,
        // same as the drag preview.
        let ex = imgX
        let ey = imgY
        let endConnect: ArrowConnection | undefined
        if (activeTool === 'arrow') {
          const scale = baseTxRef.current.scale * zoom
          const snap = findNearestConnectAnchor(imgX, imgY, annotations, null, CONNECT_SNAP_DIST / scale)
          if (snap) {
            ex = snap.x; ey = snap.y
            endConnect = { targetId: snap.targetId, anchor: snap.anchor }
          }
        }
        const { imgX: sx, imgY: sy } = dragStart.current
        const ann = buildAnnotation(activeTool, sx, sy, ex, ey, activeColor, strokeWidth, activeOpacity, fillMode, nextNumber, endConnect ? false : e.shiftKey, numberShape, arrowHead, doubleEndedArrow, blurStrength, spotlightDim, numberRadius, arrowStyle, spotlightShape)
        setPreview(null)
        activeSnapRef.current = null
        const startConnect = newArrowStartConnectRef.current ?? undefined
        newArrowStartConnectRef.current = null
        if (ann) {
          // A click without a real drag creates nothing for drag-shaped
          // tools — a zero-size arrow/rect is invisible junk that still
          // lands in the undo stack and selection. Numbers are
          // click-to-place by design and stay exempt.
          if (ann.type !== 'number') {
            const b = getAnnotationCoreBounds(ann)
            if (!b || (b.w < 4 && b.h < 4)) return
          }
          onAnnotationAdded(ann.type === 'arrow' ? { ...ann, startConnect, endConnect } : ann)
        }
      },
      [activeTool, activeColor, strokeWidth, activeOpacity, fontSize, fillMode, numberShape, numberRadius, arrowHead, doubleEndedArrow, arrowStyle, blurStrength, spotlightDim, spotlightShape, nextNumber,
       toImgCoords, onAnnotationAdded, annotations, zoom, cropRect],
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
          opacity: activeOpacity,
          x: textPos.imgX,
          y: textPos.imgY,
          text: trimmed,
          fontSize,
          shape: textShape,
          tailAnchor,
          align: textAlign,
        }
        onAnnotationAdded(ann)
      },
      [textPos, editingTextId, activeColor, strokeWidth, activeOpacity, fontSize, textShape, tailAnchor, textAlign, onAnnotationAdded, onUpdateText],
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

    // Resize cursors follow the selected shape's rotation, so a handle on a
    // tilted rect/ellipse points along the shape's own axis, not the screen's.
    const selForCursor = selectedId ? annotations.find((a) => a.id === selectedId) : undefined
    const selRotation = (selForCursor && (selForCursor.type === 'rect' || selForCursor.type === 'ellipse'))
      ? (selForCursor.rotation ?? 0)
      : 0
    const cursor = panning.current
      ? 'grabbing'
      : activeHandle === 'rot'
        ? (rotateStateRef.current ? 'grabbing' : 'grab')
        : activeTool === 'text'
          // Text tool can still grab its selection (grab-after-create) — the
          // cursor must say so: resize over a handle, move over the selected
          // body, and the I-beam only where a click would open the editor.
          ? activeHandle
            ? handleCursorStyle(activeHandle, selRotation)
            : (hoverId && hoverId === selectedId ? 'move' : 'text')
          : activeTool === 'crop'
            ? activeHandle ? handleCursorStyle(activeHandle) : (cropHover ? 'move' : 'crosshair')
            : activeTool === 'select'
              ? activeHandle ? handleCursorStyle(activeHandle, selRotation) : (hoverId ? 'move' : 'default')
              : activeHandle
                ? handleCursorStyle(activeHandle, selRotation)
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
    const tAlign = editingTextAnn?.align ?? textAlign
    const tTailAnchor = editingTextAnn?.tailAnchor ?? tailAnchor
    const viewScale = baseTxRef.current.scale * zoom
    const tFsCss = Math.max(8, tFont * viewScale)
    const tBoxed = tShape !== 'none'
    const tPadCss = tBoxed ? textPadding(tFont) * viewScale : 0
    const textEditFont: React.CSSProperties = {
      fontSize: tFsCss,
      lineHeight: 1.25,
      padding: tBoxed ? tPadCss : undefined,
      // Harmless on the hidden measurer too: it holds one line in a
      // shrink-to-fit box, which has no slack for alignment to act on.
      textAlign: tAlign,
    }
    const textEditStyle: React.CSSProperties = {
      ...textEditFont,
      // Positioning lives on the wrapper div (which also hosts the bubble
      // tail preview) — the textarea itself stays in flow inside it.
      position: 'relative',
      transform: 'none',
      // Driven from state (see editWidth) rather than left for the CSS
      // class's auto/min-width to resolve, so the box's rendered width is
      // always exactly what React just committed — never a stale value a
      // later re-render could leave behind.
      ...(editWidth != null ? { width: editWidth } : {}),
      ...(editHeight != null ? { height: editHeight } : {}),
      ...(tBoxed
        ? {
            background: tColor,
            color: contrastTextColor(tColor),
            textShadow: 'none',
            borderRadius: Math.min(tFsCss * 0.4, tFsCss),
          }
        : { color: tColor }),
    }
    // Keep the *text* anchored on the annotation's (x, y): shift back by the
    // padding plus the 1px border (boxed), or the class's small 2px nudge.
    const textEditWrapStyle: React.CSSProperties = {
      position: 'absolute',
      zIndex: 10,
      transform: tBoxed
        ? `translate(${-(tPadCss + 1)}px, ${-(tPadCss + 1)}px)`
        : 'translate(-2px, -2px)',
    }
    // Bubble-tail preview while typing — built from the exact same geometry
    // (bubbleTailPoints/bubbleCornerRadius) the committed annotation renders
    // with, at whichever of the 16 anchors is currently selected, so the
    // shape and position never jump on commit. viewScale converts the
    // image-pixel formulas to the editor's on-screen CSS pixels.
    const tTailH = bubbleTailHeight(tFont) * viewScale
    const tRadius = bubbleCornerRadius(tFsCss, editWidth ?? 0, editHeight ?? 0)
    const tTailPts = (editWidth != null && editHeight != null)
      ? bubbleTailPoints(tTailAnchor, 0, 0, editWidth, editHeight, tTailH, tRadius)
      : null

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
            // A drawing drag that leaves the canvas commits what's drawn so
            // far — pinned where the cursor exited — instead of silently
            // discarding it (losing a whole pen stroke to a 1px overshoot
            // is much worse than keeping a slightly short one).
            if (dragging.current) {
              dragging.current = false
              if (activeTool === 'pen' && penPointsRef.current.length >= 2) {
                onAnnotationAdded({ id: makeId(), type: 'pen', color: activeColor, sw: strokeWidth, opacity: activeOpacity, points: [...penPointsRef.current] })
              } else if (preview && preview.type !== 'pen') {
                const b = getAnnotationCoreBounds(preview)
                // Skip degenerate shapes (a click-sized drag that happened
                // to end on the edge) — same spirit as the draw thresholds.
                if (b && (b.w >= 4 || b.h >= 4)) {
                  const startConnect = newArrowStartConnectRef.current ?? undefined
                  const snap = activeSnapRef.current
                  const endConnect = snap ? { targetId: snap.targetId, anchor: snap.anchor } : undefined
                  onAnnotationAdded(preview.type === 'arrow' ? { ...preview, startConnect, endConnect } : preview)
                }
              }
              setPreview(null)
            }
            movingRef.current = false
            if (panning.current) panning.current = false
            if (resizeState.current) resizeState.current = null
            if (rotateStateRef.current) rotateStateRef.current = null
            if (cropDragRef.current) cropDragRef.current = null
            penPointsRef.current = []
            newArrowStartConnectRef.current = null
            activeSnapRef.current = null
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
          <div style={{ left: textPos.cssX, top: textPos.cssY, ...textEditWrapStyle }}>
          <textarea
            ref={textInputRef}
            key={editingTextId ?? 'new'}
            defaultValue={editingTextAnn?.text ?? ''}
            className={styles.textInput}
            style={textEditStyle}
            rows={1}
            onInput={(e) => {
              const el = e.currentTarget
              const measure = textMeasureRef.current
              if (measure) {
                const longest = el.value.split('\n').reduce((a, b) => a.length >= b.length ? a : b, '')
                measure.textContent = longest || ' '
                setEditWidth(measure.offsetWidth + 2)
              }
              el.style.height = 'auto'
              setEditHeight(el.scrollHeight)
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
          {tShape === 'bubble' && tTailPts && (
            // Live tail preview while typing — the committed annotation is
            // hidden (or doesn't exist yet) until the text is confirmed, so
            // without this the bubble reads as a plain box mid-edit. Points
            // come straight from bubbleTailPoints, so this is pixel-for-pixel
            // the same triangle (and anchor) the final render commits.
            <svg
              width={editWidth ?? 0}
              height={editHeight ?? 0}
              style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}
              aria-hidden
            >
              <polygon
                points={tTailPts.map((p) => `${p.x},${p.y}`).join(' ')}
                fill={tColor}
              />
            </svg>
          )}
          </div>
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
    const handles: HandlePos[] = [
      { id: 'tl', cx: sx,      cy: sy },
      { id: 'tr', cx: sx + sw, cy: sy },
      { id: 'bl', cx: sx,      cy: sy + sh },
      { id: 'br', cx: sx + sw, cy: sy + sh },
    ]
    if (ann.shape === 'bubble') {
      // The handle sits on the tail's tip (apex) — the part that's actually
      // furthest from the box and reads most directly as "grab the tail".
      const body = getBubbleBodyBox(ann)
      if (body) {
        const radius = bubbleCornerRadius(ann.fontSize, body.w, body.h)
        const tailH = bubbleTailHeight(ann.fontSize)
        const apex = bubbleTailPoints(ann.tailAnchor ?? 's3', body.x, body.y, body.w, body.h, tailH, radius)[1]
        handles.push({ id: 'tail', cx: ox + apex.x * scale, cy: oy + apex.y * scale })
      }
    }
    return handles
  }
  if (ann.type === 'arrow' || ann.type === 'line') {
    const handles: HandlePos[] = [
      { id: 'p1', cx: ox + ann.x1 * scale, cy: oy + ann.y1 * scale },
      { id: 'p2', cx: ox + ann.x2 * scale, cy: oy + ann.y2 * scale },
    ]
    if (ann.type === 'arrow' && ann.style === 'elbow') {
      // Midpoint of the elbow's middle (jog) segment — dragging it slides
      // the bend along the dominant axis (see resizeBend / getElbowSegments).
      const segs = getElbowSegments(ann.x1, ann.y1, ann.x2, ann.y2, ann.bendRatio ?? 0.5)
      const mid = segs[1]
      handles.push({
        id: 'bend',
        cx: ox + ((mid.x1 + mid.x2) / 2) * scale,
        cy: oy + ((mid.y1 + mid.y2) / 2) * scale,
      })
    }
    return handles
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
      // One handle on each of the band's edges, perpendicular to the stroke —
      // dragging one pulls that edge only (the opposite edge stays fixed),
      // with no upper bound (unlike the toolbar slider).
      const nx = -dy / len
      const ny = dx / len
      const ht = (sw * 6) / 2
      const mcx = (x1 + x2) / 2
      const mcy = (y1 + y2) / 2
      handles.push({ id: 'thick',  cx: ox + (mcx + nx * ht) * scale, cy: oy + (mcy + ny * ht) * scale })
      handles.push({ id: 'thick2', cx: ox + (mcx - nx * ht) * scale, cy: oy + (mcy - ny * ht) * scale })
    }
    return handles
  }
  if (ann.type === 'pen') return []  // move/delete only, no resize
  if (ann.type === 'rect' || ann.type === 'ellipse') {
    const local = getAnnotationLocalBounds(ann)
    if (!local) return []
    return rotatedBoxHandlePositions(local, ann.rotation ?? 0, ox, oy, scale, pad)
  }
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

/**
 * 8-point resize handles plus a rotate handle, for a rect/ellipse's own
 * (possibly rotated) local frame — each point is placed in the shape's
 * unrotated local space, rotated around its center, then projected to
 * screen space. At rotation 0 this matches `boxHandlePositions`.
 */
function rotatedBoxHandlePositions(
  local: { x: number; y: number; w: number; h: number },
  rotationDeg: number,
  ox: number, oy: number, scale: number, pad: number,
): HandlePos[] {
  const cx = local.x + local.w / 2
  const cy = local.y + local.h / 2
  const hw = local.w / 2 + pad
  const hh = local.h / 2 + pad
  const toScreen = (lx: number, ly: number): { cx: number; cy: number } => {
    const p = rotatePoint(cx + lx, cy + ly, cx, cy, rotationDeg)
    return { cx: ox + p.x * scale, cy: oy + p.y * scale }
  }
  const pts: [HandleId, number, number][] = [
    ['tl', -hw, -hh], ['tc', 0, -hh], ['tr', hw, -hh],
    ['ml', -hw, 0],                   ['mr', hw, 0],
    ['bl', -hw, hh],  ['bc', 0, hh],  ['br', hw, hh],
  ]
  const handles: HandlePos[] = pts.map(([id, lx, ly]) => ({ id, ...toScreen(lx, ly) }))
  // Rotate handle: a fixed screen-pixel distance above the top edge.
  handles.push({ id: 'rot', ...toScreen(0, -hh - ROT_HANDLE_DIST / scale) })
  return handles
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/**
 * Union of the original image rect and every annotation's bounds, in
 * image-pixel space. Annotations dragged outside the image grow this box
 * (x/y can go negative), so the exported canvas can expand to include them.
 *
 * Deliberately uses *core* bounds — geometry without the stroke halo — so only
 * where the user puts an annotation grows the export, never how thick they
 * make it. Padding by stroke width here meant nudging the marker-width slider
 * up on a stroke near an edge enlarged the saved PNG (sw 12 → 36px of padding
 * per side) with transparent margin.
 */
function computeContentBounds(
  annotations: Annotation[],
  imageWidth: number,
  imageHeight: number,
): { x: number; y: number; w: number; h: number } {
  let minX = 0, minY = 0, maxX = imageWidth, maxY = imageHeight
  for (const ann of annotations) {
    const b = getAnnotationCoreBounds(ann)
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

/** Nearest connection point (of any connectable shape, `excludeId` skipped)
 *  within `maxDistImg` image px of (imgX, imgY), or null if none are close enough. */
function findNearestConnectAnchor(
  imgX: number, imgY: number,
  annotations: Annotation[],
  excludeId: string | null,
  maxDistImg: number,
): { targetId: string; anchor: ConnectAnchor; x: number; y: number } | null {
  let best: { targetId: string; anchor: ConnectAnchor; x: number; y: number; dist: number } | null = null
  for (const a of annotations) {
    if (a.id === excludeId || !isConnectable(a)) continue
    for (const pt of getConnectAnchors(a)) {
      const dist = Math.hypot(imgX - pt.x, imgY - pt.y)
      if (dist <= maxDistImg && (!best || dist < best.dist)) best = { targetId: a.id, anchor: pt.anchor, x: pt.x, y: pt.y, dist }
    }
  }
  return best ? { targetId: best.targetId, anchor: best.anchor, x: best.x, y: best.y } : null
}

/** Contextual hint for an in-progress resize of `ann` via `handle`. */
function resizeHint(ann: Annotation, handle: HandleId): string {
  if (handle === 'p1' || handle === 'p2') {
    return ann.type === 'arrow'
      ? 'Drag onto a shape to connect · Shift: 45° snap · Esc: cancel'
      : 'Shift: 45° snap · Esc: cancel'
  }
  if (handle === 'bend') return 'Drag to reposition the bend · Esc: cancel'
  if (handle === 'tail') return 'Drag to snap the tail to a compass point · Esc: cancel'
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


// Rotated resize cursors are generated as data-URI SVGs (Figma-style): CSS
// only ships 4 fixed resize cursors, so a handle on a rotated shape would
// otherwise point along the screen axes instead of the shape's own axes.
const rotatedCursorCache = new Map<number, string>()
function rotatedResizeCursor(angleDeg: number, fallback: string): string {
  const key = Math.round(angleDeg * 10)
  let url = rotatedCursorCache.get(key)
  if (!url) {
    const arrow = 'M3 12 L8 7 M3 12 L8 17 M3 12 H21 M21 12 L16 7 M21 12 L16 17'
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">` +
      `<g transform="rotate(${angleDeg} 12 12)" fill="none" stroke-linecap="round" stroke-linejoin="round">` +
      `<path d="${arrow}" stroke="white" stroke-width="4.5"/>` +
      `<path d="${arrow}" stroke="black" stroke-width="2"/>` +
      `</g></svg>`
    url = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12`
    rotatedCursorCache.set(key, url)
  }
  return `${url}, ${fallback}`
}

function handleCursorStyle(h: HandleId, rotationDeg = 0): string {
  // Axis each handle resizes along, unrotated, as an angle mod 180°
  // (y-down screen coords: 0 = ↔, 45 = ↘, 90 = ↕, 135 = ↙).
  const base = h === 'ml' || h === 'mr' ? 0
    : h === 'tl' || h === 'br' ? 45
    : h === 'tc' || h === 'bc' ? 90
    : h === 'tr' || h === 'bl' ? 135
    : null
  if (base === null) return 'crosshair'
  const angle = (((base + rotationDeg) % 180) + 180) % 180
  const native = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][Math.round(angle / 45) % 4]
  // On a 45° step the native cursor is exact — skip the custom image.
  if (Math.abs(angle - Math.round(angle / 45) * 45) < 0.5) return native
  return rotatedResizeCursor(angle, native)
}

// ── Annotation builder ─────────────────────────────────────────────────────

function buildAnnotation(
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
): Annotation | null {
  const id = makeId()
  const base = { id, color, sw, opacity }
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
    default:
      return null
  }
}
