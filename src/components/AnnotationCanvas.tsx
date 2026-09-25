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
import { annotationRotation, decodeEmbeddedImages, drawAnnotation, floodFillColorMask, getAnnotationBounds, getAnnotationCoreBounds, getAnnotationLocalBounds, getBubbleTailAnchors, getConnectAnchors, getMagnifierBoxes, hitTest, isConnectable, isRotatable, magnifierHitPart, makeId, onEmbeddedImageLoad, rotatePoint, traceMaskContour } from '../lib/annotations'
import type { Annotation, ArrowConnection, ArrowHead, BubbleTailAnchor, ConnectAnchor, TextBgFill, TextShape, NumberAnn } from '../lib/annotations'
import type { AnnotationTool, FillMode } from '../lib/store'
import { getCheckerPattern, getOffscreenCanvas } from './canvas/surface'
import { useCropSession } from './canvas/useCropSession'
import { NumberEditor, useNumberEditor } from './canvas/NumberEditor'
import { TextEditor, TextMeasurer, useTextEditor } from './canvas/TextEditor'
import { CONNECT_SNAP_DIST, computeContentBounds, findNearestConnectAnchor, isDegenerateAnnotation, snapAngle, unionBounds } from './canvas/geometry'
import { HANDLE_SIZE, MIN_RESIZE, SEL_PAD, applyHandleResize, computeHandlePositions, findHandleHit, handleCursorStyle, lockMagnifierAspect, resizeHint } from './canvas/handles'
import type { BoxHandleId, HandleId, HandlePos, ResizeState, RotateState } from './canvas/handles'
import { DRAW_HINTS, buildAnnotation } from './canvas/factory'
import styles from './AnnotationCanvas.module.css'

export interface AnnotationCanvasHandle {
  exportPng: () => string | null
  exportBlob: () => Promise<Blob | null>
  /** Renders the *base* image (annotations excluded, same as the picker's
   *  sample canvas) turned 90°, for `rotateImage`. `null` if it isn't loaded
   *  yet. */
  rotateBase: (dir: 'cw' | 'ccw') => { dataUrl: string; width: number; height: number } | null
  /** Re-runs a magic-wand erase annotation's color match from its original
   *  seed point at a new tolerance — the tolerance slider calls this for a
   *  selected `erase` annotation instead of a plain field edit, since the
   *  image it needs to resample only exists in here. Always contiguous (see
   *  the erase click handler). Null if there's no loaded image (or the seed
   *  point somehow falls outside it). */
  recomputeErase: (seedX: number, seedY: number, tolerance: number) => ReturnType<typeof floodFillColorMask>
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
  lineDash: 'solid' | 'dashed' | 'dotted'
  rectRadius: number
  numberShape: 'circle' | 'square'
  numberRadius: number
  arrowHead: ArrowHead
  doubleEndedArrow: boolean
  arrowStyle: 'straight' | 'elbow'
  textShape: TextShape
  bgFill: TextBgFill
  /** Invert toggle for a new `'solid'`-fill text — see `TextAnn.bgAuto`. */
  textBgAuto: boolean
  tailAnchor: BubbleTailAnchor
  textAlign: 'left' | 'center' | 'right'
  blurStrength: number
  eraseTolerance: number
  eraseEffect: 'erase' | 'fill' | 'blur' | 'pixelate'
  eraseFillColor: string
  spotlightDim: number
  spotlightShape: 'circle' | 'square'
  magnifierZoom: number
  magnifierShape: 'circle' | 'square'
  shadowStyle: 'none' | 'drop' | 'glow' | 'outline'
  shadowAngle: number
  shadowSize: number
  shadowBlur: number
  shadowOpacity: number
  shadowColor: string | null
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
  /** Magnifier only: resizes just the source or just the target box. */
  onResizeMagnifierBox: (id: string, part: 'source' | 'target', bounds: { x: number; y: number; w: number; h: number }) => void
  /** Magnifier only: moves just the source or just the target box. */
  onMoveMagnifierBox: (id: string, part: 'source' | 'target', dx: number, dy: number) => void
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
      annotations, activeTool, activeColor, activeOpacity, strokeWidth, fontSize, fillMode, lineDash, rectRadius, numberShape, numberRadius, arrowHead, doubleEndedArrow, arrowStyle, textShape, bgFill, textBgAuto, tailAnchor, textAlign,
      blurStrength, eraseTolerance, eraseEffect, eraseFillColor, spotlightDim, spotlightShape, magnifierZoom, magnifierShape, shadowStyle, shadowAngle, shadowSize, shadowBlur, shadowOpacity, shadowColor,
      nextNumber, selectedIds,
      zoom, panX, panY,
      onAnnotationAdded, onBeginDrag, onSetSelection, onToggleSelection, onMoveAnnotations,
      onResizeAnnotation, onResizeEndpoint, onResizeThickness, onResizeMarker, onResizeMagnifierBox, onMoveMagnifierBox, onResizeBend, onResizeTail, onSetArrowConnection, onRotateAnnotation, onUpdateText, onUpdateNumber,
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
    // Which of a magnifier's two independent boxes a single-selection body
    // drag applies to — null for every other type, and for a group drag
    // (which always moves both boxes together via onMoveAnnotations).
    const movingMagnifierPartRef = useRef<'source' | 'target' | null>(null)
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

    // Text tool — its own state machine, styles and live canvas preview.
    // See `useTextEditor`; the canvas only opens it and paints its `preview`.
    const textEditor = useTextEditor({
      annotations, viewScale: baseTxRef.current.scale * zoom,
      activeColor, strokeWidth, activeOpacity, fontSize,
      textShape, bgFill, textBgAuto, tailAnchor, textAlign,
      shadowStyle, shadowAngle, shadowSize, shadowBlur, shadowOpacity, shadowColor,
      onAnnotationAdded, onUpdateText,
    })

    // Number tool — inline editor for an existing number marker's value.
    const numberEditor = useNumberEditor(onUpdateNumber)

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

    // Crop tool — its own state machine, see `useCropSession`.
    const crop = useCropSession({
      active: activeTool === 'crop',
      imageWidth,
      imageHeight,
      imgRef,
      setActiveHandle,
      onApplyCrop,
      onCropDone,
    })

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

    // A pasted picture decodes asynchronously (see `getEmbeddedImage`), so the
    // frame that first draws it only gets a placeholder — repaint when the
    // bitmap actually lands. Routed through `redrawRef` for the same reason the
    // ResizeObserver below is: this subscription is mount-only, so calling
    // `redraw` directly would pin it to the first render's stale closure.
    useEffect(() => onEmbeddedImageLoad(() => redrawRef.current()), [])

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
        // Every branch below marks the event consumed: the editor's own Escape
        // handler closes the window when nothing was cancelled, and reads
        // `defaultPrevented` to tell the two apart.
        if (ctxMenu) { e.preventDefault(); setCtxMenu(null); return }
        if (activeTool === 'crop') return  // crop has its own Esc (cancel rect)

        // Drawing a new shape → just discard the preview.
        if (dragging.current && !movingRef.current) {
          e.preventDefault()
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
          e.preventDefault()
          movingRef.current = false
          movingMagnifierPartRef.current = null
          dragging.current = false
          resizeState.current = null
          rotateStateRef.current = null
          activeSnapRef.current = null
          setActiveHandle(null)
          setHint(null)
          onCancelTransform()
          return
        }
        if (selectedIds.length > 0) { e.preventDefault(); onSetSelection([]) }
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
      movingMagnifierPartRef.current = null
      rubberbanding.current = false
      rubberBandRef.current = null
      resizeState.current = null
      rotateStateRef.current = null
      panning.current = false
      setPreview(null)
      setActiveHandle(null)
      setRbTick(v => v + 1)
      crop.reset()
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
      if (textEditor.pos) setHint('Enter: confirm · Shift+Enter: newline · Esc: cancel')
      else if (activeTool === 'crop') setHint(crop.rect ? 'Enter: apply · Esc: cancel' : 'Drag to select the crop area')
      else if (activeTool === 'picker') setHint('Click to pick a color (copies hex)')
      else if (activeTool === 'erase') setHint('Click to select its connected color range')
      else setHint(null)
    }, [textEditor.pos, activeTool, crop.rect])

    // ── Global mouseup: clean up if mouse released outside canvas ─────────
    useEffect(() => {
      const onGlobalMouseUp = () => {
        if (!dragging.current && !rubberbanding.current && !panning.current && !resizeState.current && !rotateStateRef.current && !crop.isDragging()) return
        dragging.current = false
        movingRef.current = false
        movingMagnifierPartRef.current = null
        rubberbanding.current = false
        rubberBandRef.current = null
        resizeState.current = null
        rotateStateRef.current = null
        panning.current = false
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

      ctx.fillStyle = getCheckerPattern(ctx)
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

      // ── Image + annotations, painted in image-pixel space on a transparent
      // offscreen buffer, then composited onto the checkered canvas (see
      // `getOffscreenCanvas`'s doc comment for why it can't be painted
      // straight onto `ctx`) ──
      const off = getOffscreenCanvas(canvas.width, canvas.height)
      const offCtx = off.getContext('2d')!
      offCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
      offCtx.clearRect(0, 0, W, H)
      offCtx.save()
      offCtx.translate(ox, oy)
      offCtx.scale(scale, scale)
      offCtx.drawImage(img, 0, 0, imageWidth, imageHeight)
      for (const ann of annotations) {
        if (ann.id === textEditor.editingId) continue  // hidden while its textarea is open
        if (ann.id === numberEditor.edit?.id) continue  // hidden while its value input is open
        // A single malformed annotation must not abort the rest of the
        // frame (selection handles, crop overlay, etc. drawn below) — skip
        // it and keep going rather than let one bad draw call blank
        // everything downstream every time this redraws.
        try {
          drawAnnotation(offCtx, ann, img, scale)
        } catch (e) {
          console.error('[annotation] draw failed, skipping', ann.id, ann.type, e)
        }
      }
      // A text edit in progress publishes its own preview; no other tool's
      // drag can be running at the same time.
      const scenePreview = textEditor.preview ?? preview
      if (scenePreview) drawAnnotation(offCtx, scenePreview, img, scale)
      offCtx.restore()

      // Soft shadow lifting the screenshot off the checkerboard, like a photo
      // on a dark studio table — drawn as an opaque rect at the exact image
      // bounds so the composite right after fully covers it; only the blur
      // that spills past those bounds ends up visible.
      ctx.save()
      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'
      ctx.shadowBlur = 28
      ctx.shadowOffsetY = 10
      ctx.fillStyle = '#000'
      ctx.fillRect(ox, oy, dw, dh)
      ctx.restore()

      ctx.drawImage(off, 0, 0, W, H)

      // Frame around the screenshot — brighter than a bare hairline so the
      // image reads as matted against the dark canvas instead of just
      // floating on it.
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'
      ctx.lineWidth = 1
      ctx.strokeRect(ox, oy, dw, dh)

      // Dashed outline around the export bounds when annotations spill outside
      // the screenshot — the canvas will expand (transparent margin) to fit them.
      const previewBounds = scenePreview ? getAnnotationCoreBounds(scenePreview) : null
      const contentBounds = previewBounds ? unionBounds(baseContentBounds, previewBounds) : baseContentBounds
      if (contentBounds.x !== 0 || contentBounds.y !== 0 || contentBounds.w !== imageWidth || contentBounds.h !== imageHeight) {
        ctx.save()
        ctx.strokeStyle = 'rgba(34, 211, 238, 0.5)'
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

      // The crop overlay paints itself (and records its handle positions)
      // — see `useCropSession`.
      crop.paint(ctx, { ox, oy, scale, W, H })

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
          if (annotationRotation(ann) !== 0) {
            // Oriented box hugging the shape's actual (rotated) outline,
            // instead of a loose axis-aligned box around its silhouette.
            const local = getAnnotationLocalBounds(ann)
            if (!local) continue
            const cx = local.x + local.w / 2
            const cy = local.y + local.h / 2
            // SEL_PAD is a screen-pixel gap (as in the unrotated strokeRect
            // below and in rotatedBoxHandlePositions) — convert before mixing
            // it into image-space math, so the box keeps hugging its handles
            // at every zoom level.
            const hw = local.w / 2 + SEL_PAD / scale
            const hh = local.h / 2 + SEL_PAD / scale
            const corners: [number, number][] = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]
            ctx.beginPath()
            corners.forEach(([lx, ly], i) => {
              const p = rotatePoint(cx + lx, cy + ly, cx, cy, annotationRotation(ann))
              const sxp = ox + p.x * scale
              const syp = oy + p.y * scale
              if (i === 0) ctx.moveTo(sxp, syp)
              else ctx.lineTo(sxp, syp)
            })
            ctx.closePath()
            ctx.stroke()
            continue
          }
          // An erase annotation's bounding box is often nothing like its
          // actual (usually very irregular) erased silhouette — a loose
          // rectangle around it reads as "this whole area is selected"
          // when most of that area is untouched. Trace the mask's real
          // pixel-accurate outline instead, the same thing GIMP's marching
          // ants hug — falling back to the rectangle only for the one or
          // two frames before the mask/contour has finished decoding.
          if (ann.type === 'erase') {
            const loops = traceMaskContour(ann.mask)
            if (loops && loops.length > 0) {
              for (const loop of loops) {
                ctx.beginPath()
                loop.forEach(([lx, ly], i) => {
                  const sxp = ox + (ann.x + lx) * scale
                  const syp = oy + (ann.y + ly) * scale
                  if (i === 0) ctx.moveTo(sxp, syp)
                  else ctx.lineTo(sxp, syp)
                })
                ctx.stroke()
              }
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
            // Rotation-handle stalk: a short connecting line from the middle
            // of the shape's top edge to its rotate handle (rotatable types
            // only). Text has no 'tc' handle, so the midpoint of its two top
            // corners stands in — for rect/ellipse that's exactly 'tc'.
            if (isRotatable(selAnn)) {
              const tl = handles.find((h) => h.id === 'tl')
              const tr = handles.find((h) => h.id === 'tr')
              const rotH = handles.find((h) => h.id === 'rot')
              if (tl && tr && rotH) {
                ctx.save()
                ctx.strokeStyle = '#60A5FA'
                ctx.lineWidth = 1.5
                ctx.beginPath()
                ctx.moveTo((tl.cx + tr.cx) / 2, (tl.cy + tr.cy) / 2)
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
        ctx.strokeStyle = 'rgba(34, 211, 238, 0.8)'
        ctx.lineWidth = 1
        ctx.fillStyle = 'rgba(34, 211, 238, 0.08)'
        const rx = Math.min(x1, x2)
        const ry = Math.min(y1, y2)
        const rw = Math.abs(x2 - x1)
        const rh = Math.abs(y2 - y1)
        ctx.fillRect(rx, ry, rw, rh)
        ctx.strokeRect(rx, ry, rw, rh)
        ctx.restore()
      }

    }, [imageWidth, imageHeight, annotations, baseContentBounds, preview, selectedIds, selectedId, textEditor, numberEditor.edit, activeTool, crop, zoom, panX, panY, hoverId])
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
          textEditor.open({ imgX: a.x, imgY: a.y, cssX, cssY }, a.id)
          return
        }
        if (a.type === 'number' && hitTest(a, imgX, imgY)) {
          const { scale: baseScale } = baseTxRef.current
          const scale = baseScale * zoom
          const { cssX, cssY } = toCssCoords(a.cx, a.cy)
          onSetSelection([])
          numberEditor.open({ id: a.id, cssX, cssY, size: a.r * 2 * scale })
          return
        }
      }
    }, [annotations, toImgCoords, toCssCoords, onSetSelection, zoom, numberEditor, textEditor])

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
        const startAngleDeg = annotationRotation(ann)
        rotateStateRef.current = {
          id: ann.id, cx, cy, startAngleDeg,
          startMouseAngle: Math.atan2(imgY - cy, imgX - cx),
        }
        setActiveHandle('rot')
        setHint('Shift: 15° snap · Esc: cancel')
        return
      }
      if (ann.type === 'magnifier' && (hit.startsWith('s-') || hit.startsWith('t-'))) {
        const part = hit.startsWith('s-') ? 'source' : 'target'
        const { source, target } = getMagnifierBoxes(ann)
        resizeState.current = {
          handle: hit,
          startImgX: imgX,
          startImgY: imgY,
          startBounds: part === 'source' ? source : target,
          magnifierPart: part,
          // The target must always show the source undistorted — its aspect
          // ratio is locked to the source's, not freely resizable.
          magnifierRatio: part === 'target' ? (source.h > 0 ? source.w / source.h : 1) : undefined,
        }
        setActiveHandle(hit)
        setHint(part === 'source' ? 'Shift: 1:1 · Esc: cancel' : 'Esc: cancel')
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
        lockEligible: ann.type === 'ellipse' || ann.type === 'pen',
        lockAlways: ann.type === 'text',
        lockUnlessShift: ann.type === 'image',
        lockCenter: ann.type === 'number',
        minSize: ann.type === 'pen' ? Math.max(1, ann.sw) : MIN_RESIZE,
        rotationDeg: annotationRotation(ann),
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
          textEditor.open({ imgX, imgY, cssX, cssY })
          return
        }

        if (activeTool === 'picker') {
          const hex = samplePickColor(imgX, imgY)
          if (hex) onPickColor(hex)
          return
        }

        if (activeTool === 'erase') {
          // Magic wand: no drag, no preview — one click samples the image at
          // this point and flood-fills the connected same-color region right
          // away (see floodFillColorMask), the same instant-placement pattern
          // the Number tool uses (a click, not a shape dragged into being).
          // Selected right after (addAnnotation does that), the tolerance
          // slider can keep tuning it — see recomputeErase. Always
          // contiguous (floodFillColorMask's default `mode`) — the tool was
          // simplified down to Erase/Fill only, dropping the Pick Mode
          // toggle (and, with it, any reason to reach for 'global').
          const img = imgRef.current
          const seedX = Math.round(imgX)
          const seedY = Math.round(imgY)
          const region = img ? floodFillColorMask(img, seedX, seedY, eraseTolerance) : null
          if (!region) return

          // floodFillColorMask always samples the pristine base image, not
          // what's currently on screen — so clicking again on a spot an
          // earlier click already erased (still full-color underneath,
          // just visually punched through) produces nearly the same
          // soft-edged mask as before. Stacking two of those via
          // destination-out eats further into their shared soft boundary
          // each time, so repeated clicks made the "already transparent"
          // area visibly creep outward instead of doing nothing. A
          // matching seed color inside an existing erase's box means
          // this click landed on that same region again — select it for
          // further tolerance tuning instead of stacking a redundant copy.
          const existing = annotations.find((a) =>
            a.type === 'erase' &&
            seedX >= a.x && seedX < a.x + a.w && seedY >= a.y && seedY < a.y + a.h &&
            a.color === region.seedColor,
          )
          if (existing) {
            onSetSelection([existing.id])
            return
          }
          onAnnotationAdded({
            id: makeId(),
            type: 'erase',
            color: region.seedColor,
            sw: strokeWidth,
            opacity: activeOpacity,
            shadowStyle,
            x: region.x, y: region.y, w: region.w, h: region.h,
            mask: region.mask,
            seedX, seedY,
            tolerance: eraseTolerance,
            effect: eraseEffect,
            fillColor: eraseFillColor,
          })
          return
        }

        if (activeTool === 'crop') {
          crop.onMouseDown(imgX, imgY, cssX, cssY)
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
          // Collect every annotation under the cursor, topmost first (paint
          // order = array order). Plain click always takes the topmost, same
          // as before; Alt+click instead cycles downward through the stack —
          // repeated Alt+clicks on the same spot walk topmost → ... →
          // bottommost → wrap, so a shape buried under others is reachable
          // without having to reorder or hide anything first.
          const hits: Annotation[] = []
          for (let i = annotations.length - 1; i >= 0; i--) {
            if (hitTest(annotations[i], imgX, imgY)) hits.push(annotations[i])
          }
          let hitAnn: Annotation | null = null
          if (hits.length > 0) {
            if (e.altKey && !multi) {
              const curIdx = selectedId ? hits.findIndex((a) => a.id === selectedId) : -1
              hitAnn = hits[(curIdx + 1) % hits.length]
            } else {
              hitAnn = hits[0]
            }
          }
          const hitId: string | null = hitAnn?.id ?? null

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
            const wasAlreadySelected = selectedIds.includes(hitId)
            if (!wasAlreadySelected) onSetSelection([hitId])
            onBeginDrag()
            dragging.current = true
            movingRef.current = true
            moveDragStart.current = { imgX, imgY }
            // Only a genuine single-selection body drag on a magnifier routes
            // to the part-specific mover — a click that keeps a pre-existing
            // multi-selection always moves every selected box together.
            movingMagnifierPartRef.current = (hitAnn?.type === 'magnifier' && (wasAlreadySelected ? selectedIds.length === 1 : true))
              ? magnifierHitPart(hitAnn, imgX, imgY)
              : null
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
            movingMagnifierPartRef.current = selAnn.type === 'magnifier' ? magnifierHitPart(selAnn, imgX, imgY) : null
            setHint('Esc: cancel')
            return
          }
        }

        if (activeTool === 'pen') {
          dragging.current = true
          penPointsRef.current = [{ x: imgX, y: imgY }]
          setPreview({ id: makeId(), type: 'pen', color: activeColor, sw: strokeWidth, opacity: activeOpacity, dash: lineDash, shadowStyle, shadowAngle, shadowSize, shadowBlur, shadowOpacity, shadowColor: shadowColor ?? undefined, points: [...penPointsRef.current] })
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
        setPreview(buildAnnotation(activeTool, startX, startY, startX, startY, activeColor, strokeWidth, activeOpacity, fillMode, nextNumber, false, numberShape, arrowHead, doubleEndedArrow, blurStrength, spotlightDim, numberRadius, arrowStyle, spotlightShape, magnifierZoom, imageWidth, imageHeight, magnifierShape, shadowStyle, shadowAngle, shadowSize, shadowBlur, shadowColor ?? undefined, shadowOpacity, lineDash, rectRadius))
      },
      [activeTool, activeColor, strokeWidth, activeOpacity, fontSize, fillMode, numberShape, numberRadius, arrowHead, doubleEndedArrow, arrowStyle, blurStrength, spotlightDim, spotlightShape, magnifierZoom, magnifierShape, shadowStyle, shadowAngle, shadowSize, shadowBlur, shadowOpacity, shadowColor, lineDash, rectRadius, nextNumber,
       toImgCoords, annotations, selectedId, selectedIds, onSetSelection, onToggleSelection, onBeginDrag, panX, panY, zoom, crop, imageWidth, imageHeight,
       samplePickColor, onPickColor, beginHandleDrag, eraseTolerance, eraseEffect, eraseFillColor, onAnnotationAdded],
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
          const { handle, startImgX, startImgY, startBounds, startLine, lockEligible, lockAlways, lockUnlessShift, lockCenter, rotationDeg, isArrow } = resizeState.current
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
          } else if (startBounds && resizeState.current.magnifierPart) {
            // Magnifier source/target boxes resize independently. The
            // target's aspect ratio is always locked to the source's (see
            // lockMagnifierAspect); the source itself is a free box drag,
            // except Shift forces it to a true square (circle, when the
            // shape is set to 'circle') — same ratio=1 lock, reused.
            const baseHandle = handle.slice(2) as BoxHandleId
            const free = applyHandleResize(startBounds, baseHandle, dix, diy, false)
            const nb = resizeState.current.magnifierPart === 'target'
              ? lockMagnifierAspect(startBounds, free, baseHandle, resizeState.current.magnifierRatio ?? 1)
              : e.shiftKey
                ? lockMagnifierAspect(startBounds, free, baseHandle, 1)
                : free
            if (nb.w >= MIN_RESIZE && nb.h >= MIN_RESIZE) {
              onResizeMagnifierBox(selectedId, resizeState.current.magnifierPart, nb)
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
              const lock = !!lockAlways
                || (lockUnlessShift ? !e.shiftKey : (e.shiftKey && !!lockEligible))
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
            const minSize = resizeState.current.minSize ?? MIN_RESIZE
            if (nb.w >= minSize && nb.h >= minSize) onResizeAnnotation(selectedId, nb)
          }
          return
        }

        if (activeTool === 'crop') {
          crop.onMouseMove(imgX, imgY, cssX, cssY)
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
          // Also surface when the cursor sits over more than one annotation,
          // so the Alt+click cycling shortcut is discoverable instead of
          // hidden behind trial and error.
          if (activeTool === 'select') {
            let hid: string | null = null
            let hitCount = 0
            for (let i = annotations.length - 1; i >= 0; i--) {
              if (hitTest(annotations[i], imgX, imgY)) {
                hitCount++
                if (hid === null) hid = annotations[i].id
              }
            }
            setHoverId(hid)
            setHint(hitCount > 1 ? `Alt+click: select next below (${hitCount} here)` : null)
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
          if (movingMagnifierPartRef.current && selectedIds.length === 1) {
            onMoveMagnifierBox(selectedIds[0], movingMagnifierPartRef.current, dx, dy)
          } else {
            onMoveAnnotations(selectedIds, dx, dy)
          }
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
          setPreview({ id: makeId(), type: 'pen', color: activeColor, sw: strokeWidth, opacity: activeOpacity, dash: lineDash, shadowStyle, shadowAngle, shadowSize, shadowBlur, shadowOpacity, shadowColor: shadowColor ?? undefined, points: [...pts] })
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
        setPreview(buildAnnotation(activeTool, sx, sy, ex, ey, activeColor, strokeWidth, activeOpacity, fillMode, nextNumber, activeSnapRef.current ? false : e.shiftKey, numberShape, arrowHead, doubleEndedArrow, blurStrength, spotlightDim, numberRadius, arrowStyle, spotlightShape, magnifierZoom, imageWidth, imageHeight, magnifierShape, shadowStyle, shadowAngle, shadowSize, shadowBlur, shadowColor ?? undefined, shadowOpacity, lineDash, rectRadius))
      },
      [activeTool, activeColor, strokeWidth, activeOpacity, fontSize, fillMode, numberShape, numberRadius, arrowHead, doubleEndedArrow, arrowStyle, blurStrength, spotlightDim, spotlightShape, magnifierZoom, magnifierShape, shadowStyle, shadowAngle, shadowSize, shadowBlur, shadowOpacity, shadowColor, lineDash, rectRadius, nextNumber,
       toImgCoords, selectedId, selectedIds, annotations, onMoveAnnotations, onMoveMagnifierBox, onResizeAnnotation, onResizeMagnifierBox, onResizeEndpoint, onResizeThickness, onResizeMarker, onResizeBend, onResizeTail, onRotateAnnotation, onPanChange,
       zoom, crop, imageWidth, imageHeight, samplePickColor],
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
        if (crop.onMouseUp()) return
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
          movingMagnifierPartRef.current = null
          return
        }
        if (activeTool === 'select') return

        if (activeTool === 'pen') {
          const pts = penPointsRef.current
          penPointsRef.current = []
          setPreview(null)
          if (pts.length >= 2) {
            onAnnotationAdded({ id: makeId(), type: 'pen', color: activeColor, sw: strokeWidth, opacity: activeOpacity, dash: lineDash, shadowStyle, shadowAngle, shadowSize, shadowBlur, shadowOpacity, shadowColor: shadowColor ?? undefined, points: pts })
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
        const ann = buildAnnotation(activeTool, sx, sy, ex, ey, activeColor, strokeWidth, activeOpacity, fillMode, nextNumber, endConnect ? false : e.shiftKey, numberShape, arrowHead, doubleEndedArrow, blurStrength, spotlightDim, numberRadius, arrowStyle, spotlightShape, magnifierZoom, imageWidth, imageHeight, magnifierShape, shadowStyle, shadowAngle, shadowSize, shadowBlur, shadowColor ?? undefined, shadowOpacity, lineDash, rectRadius)
        setPreview(null)
        activeSnapRef.current = null
        const startConnect = newArrowStartConnectRef.current ?? undefined
        newArrowStartConnectRef.current = null
        if (ann) {
          // A click without a real drag creates nothing for drag-shaped
          // tools — a zero-size arrow/rect is invisible junk that still
          // lands in the undo stack and selection. Numbers are
          // click-to-place by design and stay exempt.
          if (ann.type !== 'number' && isDegenerateAnnotation(ann)) return
          onAnnotationAdded(ann.type === 'arrow' ? { ...ann, startConnect, endConnect } : ann)
        }
      },
      [activeTool, activeColor, strokeWidth, activeOpacity, fontSize, fillMode, numberShape, numberRadius, arrowHead, doubleEndedArrow, arrowStyle, blurStrength, spotlightDim, spotlightShape, magnifierZoom, magnifierShape, shadowStyle, shadowAngle, shadowSize, shadowBlur, shadowOpacity, shadowColor, lineDash, rectRadius, nextNumber,
       toImgCoords, onAnnotationAdded, annotations, zoom, crop, imageWidth, imageHeight],
    )

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
      ctx2.drawImage(img, 0, 0, imageWidth, imageHeight)
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
      // UI thread the way toDataURL does. Pasted pictures are decoded first:
      // `renderExport` draws the whole document in one synchronous pass, so
      // one still decoding would be saved as an empty box. (The synchronous
      // `exportPng` above can't wait — its callers reach it only after the
      // picture has been on screen, which is what populated the cache.)
      exportBlob: async () => {
        await decodeEmbeddedImages(annotations)
        return new Promise<Blob | null>((resolve) => {
          const c = renderExport()
          if (!c) return resolve(null)
          c.toBlob(resolve, 'image/png')
        })
      },
      rotateBase: (dir) => {
        const img = imgRef.current
        if (!img) return null
        const w = img.naturalWidth
        const h = img.naturalHeight
        const off = document.createElement('canvas')
        off.width = h
        off.height = w
        const c = off.getContext('2d')
        if (!c) return null
        // Same turn `rotateAnnotationForImageTurn` applies to annotation
        // coordinates — physical top-left has to land on the same corner here
        // as it does there, or annotations drift off what they were pointing at.
        if (dir === 'cw') {
          c.translate(h, 0)
          c.rotate(Math.PI / 2)
        } else {
          c.translate(0, w)
          c.rotate(-Math.PI / 2)
        }
        c.drawImage(img, 0, 0)
        return { dataUrl: off.toDataURL('image/png'), width: h, height: w }
      },
      recomputeErase: (seedX, seedY, tolerance) => {
        const img = imgRef.current
        return img ? floodFillColorMask(img, seedX, seedY, tolerance) : null
      },
    }))

    // Resize cursors follow the selected shape's rotation, so a handle on a
    // tilted rect/ellipse points along the shape's own axis, not the screen's.
    const selForCursor = selectedId ? annotations.find((a) => a.id === selectedId) : undefined
    const selRotation = selForCursor ? annotationRotation(selForCursor) : 0
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
            ? activeHandle ? handleCursorStyle(activeHandle) : (crop.hovered ? 'move' : 'crosshair')
            : activeTool === 'select'
              ? activeHandle ? handleCursorStyle(activeHandle, selRotation) : (hoverId ? 'move' : 'default')
              : activeHandle
                ? handleCursorStyle(activeHandle, selRotation)
                : 'crosshair'

    // ── WYSIWYG text-edit styling ─────────────────────────────────────────
    // The textarea (and its hidden measuring twin) render at the exact size,
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
                onAnnotationAdded({ id: makeId(), type: 'pen', color: activeColor, sw: strokeWidth, opacity: activeOpacity, dash: lineDash, shadowStyle, shadowAngle, shadowSize, shadowBlur, shadowOpacity, shadowColor: shadowColor ?? undefined, points: [...penPointsRef.current] })
              } else if (preview && preview.type !== 'pen') {
                // Skip degenerate shapes (a click-sized drag that happened
                // to end on the edge) — same spirit as the draw thresholds.
                if (!isDegenerateAnnotation(preview)) {
                  const startConnect = newArrowStartConnectRef.current ?? undefined
                  const snap = activeSnapRef.current
                  const endConnect = snap ? { targetId: snap.targetId, anchor: snap.anchor } : undefined
                  onAnnotationAdded(preview.type === 'arrow' ? { ...preview, startConnect, endConnect } : preview)
                }
              }
              setPreview(null)
            }
            movingRef.current = false
            movingMagnifierPartRef.current = null
            if (panning.current) panning.current = false
            if (resizeState.current) resizeState.current = null
            if (rotateStateRef.current) rotateStateRef.current = null
            penPointsRef.current = []
            newArrowStartConnectRef.current = null
            activeSnapRef.current = null
            setActiveHandle(null)
            crop.clearHover()
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
        <TextMeasurer state={textEditor} />
        <TextEditor state={textEditor} />
        {(() => {
          const ann = annotations.find((a) => a.id === numberEditor.edit?.id) as NumberAnn | undefined
          return ann ? <NumberEditor state={numberEditor} ann={ann} /> : null
        })()}
        {activeTool === 'crop' && crop.rect && (
          <div className={styles.cropActions}>
            <button
              className={styles.cropActionBtn}
              onClick={crop.cancel}
              title="Cancel crop (Esc)"
            >
              <X size={14} strokeWidth={2} />
              <span>Cancel</span>
            </button>
            <button
              className={`${styles.cropActionBtn} ${styles.cropActionPrimary}`}
              onClick={crop.apply}
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
