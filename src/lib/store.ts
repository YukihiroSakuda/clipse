import { create } from 'zustand'
import type { CaptureEntry } from './ipc'
import type { Annotation, ArrowConnection, ArrowHead, BlurStrength, BubbleTailAnchor, ImageAnn, NumberAnn, TextShape } from './annotations'
import { PALETTE, TAILWIND_HEX_SET, BUBBLE_TAIL_ANCHORS, blurStrengthPct, getAnnotationBounds, isRotatable, makeId, fontSizeAndOriginForBounds, resolveArrowConnections, clearDanglingConnections, remapArrowConnections } from './annotations'

export interface CapturedImage {
  dataUrl: string       // image URL for display: a blob: object URL (fresh load) or data: URL (after crop)
  width: number
  height: number
  savedPath?: string    // set after auto-save
  /** Original PNG bytes as received from the backend (pre-crop). Lets
   *  OCR / copy / save fall back to the source image without fetching or
   *  re-encoding; cleared by applyCrop once the image no longer matches. */
  pngBytes?: Uint8Array<ArrayBuffer>
}

export type AnnotationTool =
  | 'arrow' | 'line' | 'pen' | 'rect' | 'ellipse' | 'text' | 'number'
  | 'blur' | 'highlight' | 'spotlight' | 'magnifier' | 'select' | 'crop' | 'picker'

export type FillMode = 'stroke' | 'solid' | 'semi'

/**
 * What a "copy elements" puts on the backend's annotation clipboard
 * (`AppState.annotation_clipboard`), and what a paste in any editor window
 * reads back. Versioned because the payload crosses a window boundary and can
 * outlive the copying window — a future annotation-shape change needs a way to
 * recognize (and skip) a payload it can't read.
 */
export interface AnnotationClipboardPayload {
  version: number
  annotations: Annotation[]
}
export const ANNOTATION_CLIPBOARD_VERSION = 1

export interface AppState {
  // Current capture being edited
  capturedImage: CapturedImage | null
  setCapturedImage: (img: CapturedImage | null) => void
  /** Updates only the saved-file path (rename) — unlike setCapturedImage it
   *  must NOT reset annotations/history/picked colors: the image is unchanged. */
  setSavedPath: (path: string) => void

  // Active annotation tool
  activeTool: AnnotationTool
  setActiveTool: (tool: AnnotationTool) => void

  // Active annotation color (hex)
  activeColor: string
  setActiveColor: (hex: string) => void
  recentColors: string[]  // custom colors added via picker (max 5)
  /** Last palette-chosen color — what activeColor falls back to when a new
   *  image clears the picked colors it may currently point at. */
  lastPaletteColor: string

  // Stroke width
  strokeWidth: number
  setStrokeWidth: (w: number) => void

  // Ink opacity (0..1), shared across the whole color palette
  activeOpacity: number
  setActiveOpacity: (o: number) => void

  // Font size (for Text tool)
  fontSize: number
  setFontSize: (s: number) => void

  // Text background shape (for Text tool)
  textShape: TextShape
  setTextShape: (s: TextShape) => void

  // Multi-line text horizontal alignment
  textAlign: 'left' | 'center' | 'right'
  setTextAlign: (a: 'left' | 'center' | 'right') => void

  // Bubble tail position (one of 16 compass points around the box)
  tailAnchor: BubbleTailAnchor
  setTailAnchor: (a: BubbleTailAnchor) => void

  // Blur strength (for Blur tool) — % of the region's short side, see
  // `blurStrengthPct`.
  blurStrength: number
  setBlurStrength: (s: number) => void

  // Spotlight outside-dim opacity (for Spotlight tool)
  spotlightDim: number
  setSpotlightDim: (d: number) => void

  // Spotlight lit-region shape
  spotlightShape: 'circle' | 'square'
  setSpotlightShape: (s: 'circle' | 'square') => void

  // Magnifier default zoom (target box size / source box size) — remembered
  // from the last target-box resize, same convention as numberRadius.
  magnifierZoom: number
  setMagnifierZoom: (z: number) => void

  // Magnifier box shape (both source and target) — same convention as spotlightShape.
  magnifierShape: 'circle' | 'square'
  setMagnifierShape: (s: 'circle' | 'square') => void

  /** Whether a pasted picture gets a border (drawn in `activeColor` at
   *  `strokeWidth`) — the default new pastes start with. */
  imageBorder: boolean
  setImageBorder: (b: boolean) => void

  // Fill mode (for Rect / Ellipse)
  fillMode: FillMode
  setFillMode: (m: FillMode) => void

  // Number marker shape
  numberShape: 'circle' | 'square'
  setNumberShape: (s: 'circle' | 'square') => void

  // Number marker radius (image px) — remembered from the last resize so the
  // next marker comes out the same size.
  numberRadius: number
  setNumberRadius: (r: number) => void

  // Arrowhead style
  arrowHead: ArrowHead
  setArrowHead: (h: ArrowHead) => void

  // Arrow: head on both ends vs. just the tip
  doubleEndedArrow: boolean
  setDoubleEndedArrow: (d: boolean) => void

  // Arrow: straight line vs. Excel-style right-angle elbow connector
  arrowStyle: 'straight' | 'elbow'
  setArrowStyle: (s: 'straight' | 'elbow') => void

  // Corner radius for the exported PNG

  // Annotations + undo/redo history
  annotations: Annotation[]
  annotationHistory: Annotation[][]  // stack for undo
  redoStack: Annotation[][]          // stack for redo
  nextNumber: number
  addAnnotation: (ann: Annotation) => void
  /** Replaces the annotation set wholesale with no history entry — for
   *  restoring a re-editable capture's sidecar right after its image loads,
   *  not a user edit that should be undoable. */
  restoreAnnotations: (annotations: Annotation[], nextNumber: number) => void
  /** Drops a picture pasted from the system clipboard into the document:
   *  adds it, switches to Select and leaves it selected, so it can be sized or
   *  rotated straight away. Not expressible as `addAnnotation` +
   *  `setActiveTool` — switching tools clears the selection. */
  addPastedImage: (ann: ImageAnn) => void
  duplicateAnnotations: (ids: string[]) => void
  undoAnnotation: () => void
  redoAnnotation: () => void
  clearAnnotations: () => void
  deleteAnnotations: (ids: string[]) => void
  beginDrag: () => void
  moveAnnotations: (ids: string[], dx: number, dy: number) => void
  updateAnnotationColor: (ids: string[], color: string) => void
  updateAnnotationFontSize: (id: string, fontSize: number) => void
  updateTextShape: (id: string, shape: TextShape) => void
  updateNumberShape: (id: string, shape: 'circle' | 'square') => void
  updateArrowHead: (id: string, head: ArrowHead) => void
  updateFillMode: (id: string, mode: FillMode) => void
  updateNumberValue: (id: string, n: number) => void
  updateText: (id: string, text: string) => void
  updateStrokeWidth: (ids: string[], w: number) => void
  updateOpacity: (ids: string[], opacity: number) => void
  /** Generic history-pushing bulk edit: applies `fn` to every annotation in
   *  `ids` (fn returns the annotation unchanged to skip non-matching types). */
  mutateAnnotations: (ids: string[], fn: (a: Annotation) => Annotation) => void
  bringToFront: (ids: string[]) => void
  sendToBack: (ids: string[]) => void
  resizeAnnotation: (id: string, bounds: { x: number; y: number; w: number; h: number }) => void
  resizeEndpoint: (id: string, which: 'p1' | 'p2', imgX: number, imgY: number) => void
  resizeThickness: (id: string, sw: number) => void
  /** Elbow arrow only: sets where along the dominant axis the bend sits (see
   *  `getElbowSegments`). Called continuously during a bend-handle drag —
   *  same one-history-entry-per-drag convention as resizeThickness. */
  resizeBend: (id: string, bendRatio: number) => void
  /** Bubble tail-handle drag: snaps to whichever of the 16 compass anchors
   *  the drag is nearest — same one-history-entry-per-drag convention as
   *  resizeBend/resizeThickness. */
  resizeTail: (id: string, anchor: BubbleTailAnchor) => void
  /** Marker (highlight) edge drag — moves the centerline and re-thickens in
   *  one update so one edge stays visually fixed. */
  resizeMarker: (id: string, x1: number, y1: number, x2: number, y2: number, sw: number) => void
  /** Magnifier only: resizes just the source or just the target box (the two
   *  are independent, unlike every other type's single bounding box). Resizing
   *  the target also adopts its new zoom (tw/w) as the default for future
   *  magnifiers, mirroring resizeAnnotation's numberRadius behavior. */
  resizeMagnifierBox: (id: string, part: 'source' | 'target', bounds: { x: number; y: number; w: number; h: number }) => void
  /** Magnifier only: moves just the source or just the target box — a body
   *  drag inside one box repositions that box alone, leaving the other in
   *  place. Whole-annotation moves (multi-select drag, arrow-key nudge,
   *  duplicate/paste) go through the regular moveAnnotations instead. */
  moveMagnifierBox: (id: string, part: 'source' | 'target', dx: number, dy: number) => void
  /** Glues (or, with `null`, un-glues) an arrow endpoint to another
   *  annotation's connection point — see `ArrowConnection`. */
  setArrowConnection: (id: string, which: 'p1' | 'p2', connect: ArrowConnection | null) => void
  rotateAnnotation: (id: string, rotationDeg: number) => void
  applyCrop: (dataUrl: string, width: number, height: number, dx: number, dy: number) => void

  // Selected annotation ids (select tool; multi-select via Ctrl)
  selectedIds: string[]
  setSelection: (ids: string[]) => void
  toggleSelection: (id: string) => void

  // Copy / paste of annotation elements. The payload itself lives in the Rust
  // backend (`AppState.annotation_clipboard`), not here, so a copy in one
  // editor window can be pasted in another — each editor window is a separate
  // webview with its own copy of this store. Only the paste bookkeeping below
  // is per-window: which payload (`clipboardSeq`) the current offset cascade
  // (`clipboardPastes`) belongs to.
  clipboardSeq: number
  clipboardPastes: number
  /** Serializable payload for the backend clipboard; `null` if nothing matched. */
  buildClipboardPayload: (ids: string[]) => AnnotationClipboardPayload | null
  pasteAnnotations: (payload: AnnotationClipboardPayload, seq: number) => void

  // Zoom / pan
  zoom: number
  panX: number
  panY: number
  setZoom: (z: number) => void
  setPan: (x: number, y: number) => void
  resetView: () => void

  // Gallery entries
  captures: CaptureEntry[]
  setCaptures: (entries: CaptureEntry[]) => void

  // OCR result
  ocrText: string
  setOcrText: (text: string) => void
  ocrLoading: boolean
  setOcrLoading: (loading: boolean) => void
}

// ── Tool-default persistence ────────────────────────────────────────────────
// Color / stroke / font / shape preferences survive editor restarts via
// localStorage. Only plain tool defaults are stored — never annotations or
// image state, which belong to a single capture session.
const PERSIST_KEY = 'clipse-editor-defaults'

/** True for colors offered by the palettes (as opposed to eyedropper picks). */
const isPaletteColor = (hex: string) =>
  Object.values(PALETTE).includes(hex) || TAILWIND_HEX_SET.has(hex)

interface PersistedDefaults {
  activeColor?: string
  strokeWidth?: number
  activeOpacity?: number
  fontSize?: number
  fillMode?: FillMode
  numberShape?: 'circle' | 'square'
  spotlightShape?: 'circle' | 'square'
  numberRadius?: number
  arrowHead?: ArrowHead
  doubleEndedArrow?: boolean
  arrowStyle?: 'straight' | 'elbow'
  textShape?: TextShape
  textAlign?: 'left' | 'center' | 'right'
  tailAnchor?: BubbleTailAnchor
  /** Number (%) since the slider; legacy installs may still hold a preset string. */
  blurStrength?: number | BlurStrength
  spotlightDim?: number
  magnifierZoom?: number
  magnifierShape?: 'circle' | 'square'
  imageBorder?: boolean
}

function loadPersistedDefaults(): PersistedDefaults {
  try {
    const raw = localStorage.getItem(PERSIST_KEY)
    if (!raw) return {}
    const p = JSON.parse(raw) as PersistedDefaults
    // Shallow sanity checks: a corrupt/hand-edited value falls back silently.
    return {
      activeColor: typeof p.activeColor === 'string' && isPaletteColor(p.activeColor) ? p.activeColor : undefined,
      strokeWidth: typeof p.strokeWidth === 'number' ? p.strokeWidth : undefined,
      activeOpacity: typeof p.activeOpacity === 'number' && p.activeOpacity >= 0 && p.activeOpacity <= 1 ? p.activeOpacity : undefined,
      fontSize: typeof p.fontSize === 'number' ? p.fontSize : undefined,
      fillMode: p.fillMode === 'stroke' || p.fillMode === 'solid' || p.fillMode === 'semi' ? p.fillMode : undefined,
      numberShape: p.numberShape === 'circle' || p.numberShape === 'square' ? p.numberShape : undefined,
      spotlightShape: p.spotlightShape === 'circle' || p.spotlightShape === 'square' ? p.spotlightShape : undefined,
      numberRadius: typeof p.numberRadius === 'number' && p.numberRadius >= 6 && p.numberRadius <= 200 ? p.numberRadius : undefined,
      arrowHead: p.arrowHead === 'triangle' || p.arrowHead === 'line' || p.arrowHead === 'dot' || p.arrowHead === 'none' ? p.arrowHead : undefined,
      doubleEndedArrow: typeof p.doubleEndedArrow === 'boolean' ? p.doubleEndedArrow : undefined,
      arrowStyle: p.arrowStyle === 'straight' || p.arrowStyle === 'elbow' ? p.arrowStyle : undefined,
      textShape: p.textShape === 'none' || p.textShape === 'box' || p.textShape === 'bubble' ? p.textShape : undefined,
      textAlign: p.textAlign === 'left' || p.textAlign === 'center' || p.textAlign === 'right' ? p.textAlign : undefined,
      tailAnchor: (BUBBLE_TAIL_ANCHORS as string[]).includes(p.tailAnchor ?? '') ? p.tailAnchor : undefined,
      blurStrength: typeof p.blurStrength === 'number' || p.blurStrength === 'low' || p.blurStrength === 'medium' || p.blurStrength === 'high'
        ? blurStrengthPct(p.blurStrength)
        : undefined,
      spotlightDim: typeof p.spotlightDim === 'number' ? p.spotlightDim : undefined,
      magnifierZoom: typeof p.magnifierZoom === 'number' && p.magnifierZoom >= 1.1 && p.magnifierZoom <= 10 ? p.magnifierZoom : undefined,
      magnifierShape: p.magnifierShape === 'circle' || p.magnifierShape === 'square' ? p.magnifierShape : undefined,
      imageBorder: typeof p.imageBorder === 'boolean' ? p.imageBorder : undefined,
    }
  } catch {
    return {}
  }
}

const persisted = loadPersistedDefaults()

export const useStore = create<AppState>((set, get) => ({
  capturedImage: null,
  setCapturedImage: (img) => set((s) => ({
    capturedImage: img,
    annotations: [], annotationHistory: [], redoStack: [],
    nextNumber: 1, selectedIds: [], zoom: 1, panX: 0, panY: 0,
    // Picked (eyedropper) colors belong to the image they were sampled
    // from — a new capture starts with a clean row, and an active color
    // that pointed at a pick falls back to the last palette choice.
    recentColors: [],
    activeColor: isPaletteColor(s.activeColor) ? s.activeColor : s.lastPaletteColor,
  })),
  setSavedPath: (path) => set((s) =>
    s.capturedImage ? { capturedImage: { ...s.capturedImage, savedPath: path } } : {},
  ),

  activeTool: 'arrow',
  setActiveTool: (tool) => set({ activeTool: tool, selectedIds: [] }),

  activeColor: persisted.activeColor ?? PALETTE.red,
  setActiveColor: (hex) => set((s) => {
    if (isPaletteColor(hex)) return { activeColor: hex, lastPaletteColor: hex }
    // Picked colors keep their position (pick order, oldest first) — no
    // MRU reshuffling, so a swatch stays where the user's muscle memory
    // expects it. The oldest is dropped once the cap is hit.
    if (s.recentColors.includes(hex)) return { activeColor: hex }
    const recent = [...s.recentColors, hex].slice(-5)
    return { activeColor: hex, recentColors: recent }
  }),
  // Picked (eyedropper) colors are per-editor-session on purpose — they come
  // from one specific image, so carrying them across restarts isn't useful.
  recentColors: [],
  lastPaletteColor: persisted.activeColor ?? PALETTE.red,

  strokeWidth: persisted.strokeWidth ?? 3,
  setStrokeWidth: (w) => set({ strokeWidth: w }),

  activeOpacity: persisted.activeOpacity ?? 1,
  setActiveOpacity: (o) => set({ activeOpacity: Math.max(0.1, Math.min(1, o)) }),

  fontSize: persisted.fontSize ?? 20,
  setFontSize: (s) => set({ fontSize: s }),

  textShape: persisted.textShape ?? 'none',
  setTextShape: (s) => set({ textShape: s }),

  textAlign: persisted.textAlign ?? 'left',
  setTextAlign: (a) => set({ textAlign: a }),

  tailAnchor: persisted.tailAnchor ?? 's3',
  setTailAnchor: (a) => set({ tailAnchor: a }),

  blurStrength: blurStrengthPct(persisted.blurStrength),
  setBlurStrength: (s) => set({ blurStrength: Math.max(1, Math.min(60, s)) }),

  spotlightDim: persisted.spotlightDim ?? 0.55,
  setSpotlightDim: (d) => set({ spotlightDim: d }),

  spotlightShape: persisted.spotlightShape ?? 'circle',
  setSpotlightShape: (s) => set({ spotlightShape: s }),

  magnifierZoom: persisted.magnifierZoom ?? 2.5,
  setMagnifierZoom: (z) => set({ magnifierZoom: Math.max(1.1, Math.min(10, z)) }),

  magnifierShape: persisted.magnifierShape ?? 'square',
  setMagnifierShape: (s) => set({ magnifierShape: s }),

  imageBorder: persisted.imageBorder ?? false,
  setImageBorder: (b) => set({ imageBorder: b }),

  fillMode: persisted.fillMode ?? 'stroke',
  setFillMode: (m) => set({ fillMode: m }),

  numberShape: persisted.numberShape ?? 'circle',
  setNumberShape: (s) => set({ numberShape: s }),

  // Default matches the old sw-derived size at the default stroke width
  // (max(10, 3*5) = 15).
  numberRadius: persisted.numberRadius ?? 15,
  setNumberRadius: (r) => set({ numberRadius: Math.max(6, Math.min(200, r)) }),

  arrowHead: persisted.arrowHead ?? 'triangle',
  setArrowHead: (h) => set({ arrowHead: h }),

  doubleEndedArrow: persisted.doubleEndedArrow ?? false,
  setDoubleEndedArrow: (d) => set({ doubleEndedArrow: d }),

  arrowStyle: persisted.arrowStyle ?? 'straight',
  setArrowStyle: (s) => set({ arrowStyle: s }),


  annotations: [],
  annotationHistory: [],
  redoStack: [],
  nextNumber: 1,
  addAnnotation: (ann) =>
    set((s) => ({
      annotationHistory: [...s.annotationHistory, s.annotations],
      redoStack: [],  // new action clears redo
      annotations: [...s.annotations, ann],
      nextNumber: ann.type === 'number' ? s.nextNumber + 1 : s.nextNumber,
      // Select the just-drawn shape (but leave activeTool as-is, unlike the
      // Select tool's own click-to-select): AnnotationCanvas lets the
      // active drawing tool grab/resize/move *this* selection without
      // switching tools first, so stamping several shapes back-to-back and
      // fine-tuning the last one both work without an extra tool-switch step.
      selectedIds: [ann.id],
    })),
  addPastedImage: (ann) =>
    set((s) => ({
      annotationHistory: [...s.annotationHistory, s.annotations],
      redoStack: [],
      annotations: [...s.annotations, ann],
      activeTool: 'select',
      selectedIds: [ann.id],
    })),
  restoreAnnotations: (annotations, nextNumber) =>
    set({
      annotations,
      annotationHistory: [],
      redoStack: [],
      nextNumber,
      selectedIds: [],
    }),
  duplicateAnnotations: (ids) =>
    set((s) => {
      const idSet = new Set(ids)
      const selected = s.annotations.filter((a) => idSet.has(a.id))
      const clones = selected.map((a) => shiftAnnotation({ ...a, id: makeId() }, 8, 8))
      if (clones.length === 0) return {}
      // A connector duplicated together with its target should point at the
      // *new* target, not the original — everything else keeps pointing at
      // whatever it was already glued to.
      const idMap = new Map(selected.map((a, i) => [a.id, clones[i].id]))
      const remapped = remapArrowConnections(clones, idMap)
      return {
        annotationHistory: [...s.annotationHistory, s.annotations],
        redoStack: [],
        annotations: resolveArrowConnections([...s.annotations, ...remapped]),
        selectedIds: remapped.map((c) => c.id),
      }
    }),
  undoAnnotation: () =>
    set((s) => {
      if (s.annotationHistory.length === 0) return {}
      const prev = s.annotationHistory[s.annotationHistory.length - 1]
      const nextNumber = prev.filter((a) => a.type === 'number').length + 1
      return {
        annotations: prev,
        annotationHistory: s.annotationHistory.slice(0, -1),
        redoStack: [s.annotations, ...s.redoStack],
        nextNumber,
        selectedIds: [],
      }
    }),
  redoAnnotation: () =>
    set((s) => {
      if (s.redoStack.length === 0) return {}
      const next = s.redoStack[0]
      const nextNumber = next.filter((a) => a.type === 'number').length + 1
      return {
        annotations: next,
        annotationHistory: [...s.annotationHistory, s.annotations],
        redoStack: s.redoStack.slice(1),
        nextNumber,
        selectedIds: [],
      }
    }),
  clearAnnotations: () =>
    set((s) => ({
      annotationHistory: [...s.annotationHistory, s.annotations],
      redoStack: [],
      annotations: [],
      nextNumber: 1,
      selectedIds: [],
    })),
  deleteAnnotations: (ids) =>
    set((s) => {
      const idSet = new Set(ids)
      const remaining = clearDanglingConnections(s.annotations.filter((a) => !idSet.has(a.id)))
      const nums = remaining.filter((a) => a.type === 'number').map((a) => (a as NumberAnn).n)
      const nextNumber = nums.length > 0 ? Math.max(...nums) + 1 : 1
      return {
        annotationHistory: [...s.annotationHistory, s.annotations],
        redoStack: [],
        annotations: remaining,
        selectedIds: [],
        nextNumber,
      }
    }),
  beginDrag: () =>
    set((s) => ({
      annotationHistory: [...s.annotationHistory, s.annotations],
      redoStack: [],
    })),
  moveAnnotations: (ids, dx, dy) =>
    set((s) => {
      const idSet = new Set(ids)
      const next = s.annotations.map((a) => (idSet.has(a.id) ? shiftAnnotation(a, dx, dy) : a))
      // Re-glue any arrow connected to a shape that just moved (including an
      // arrow moved directly by its own body — a connected end snaps back to
      // its target instead of dragging free, matching Excel connectors).
      return { annotations: resolveArrowConnections(next) }
    }),

  updateAnnotationColor: (ids, color) =>
    set((s) => {
      const idSet = new Set(ids)
      return {
        annotationHistory: [...s.annotationHistory, s.annotations],
        redoStack: [],
        annotations: s.annotations.map((a) => idSet.has(a.id) ? { ...a, color } : a),
      }
    }),
  updateAnnotationFontSize: (id, fontSize) =>
    set((s) => ({
      annotationHistory: [...s.annotationHistory, s.annotations],
      redoStack: [],
      annotations: s.annotations.map((a) =>
        a.id === id && a.type === 'text' ? { ...a, fontSize } : a
      ),
    })),
  updateNumberShape: (id, shape) =>
    set((s) => ({
      annotationHistory: [...s.annotationHistory, s.annotations],
      redoStack: [],
      annotations: s.annotations.map((a) =>
        a.id === id && a.type === 'number' ? { ...a, shape } : a
      ),
    })),
  updateTextShape: (id, shape) =>
    set((s) => ({
      annotationHistory: [...s.annotationHistory, s.annotations],
      redoStack: [],
      annotations: s.annotations.map((a) =>
        a.id === id && a.type === 'text' ? { ...a, shape } : a
      ),
    })),
  updateArrowHead: (id, head) =>
    set((s) => ({
      annotationHistory: [...s.annotationHistory, s.annotations],
      redoStack: [],
      annotations: s.annotations.map((a) =>
        a.id === id && a.type === 'arrow' ? { ...a, head } : a
      ),
    })),
  updateFillMode: (id, mode) =>
    set((s) => ({
      annotationHistory: [...s.annotationHistory, s.annotations],
      redoStack: [],
      annotations: s.annotations.map((a) =>
        a.id === id && (a.type === 'rect' || a.type === 'ellipse') ? { ...a, fill: mode } : a
      ),
    })),
  updateNumberValue: (id, n) =>
    set((s) => ({
      annotationHistory: [...s.annotationHistory, s.annotations],
      redoStack: [],
      annotations: s.annotations.map((a) =>
        a.id === id && a.type === 'number' ? { ...a, n } : a
      ),
    })),
  updateText: (id, text) =>
    set((s) => {
      const trimmed = text.replace(/^\n+|\n+$/g, '')
      // Empty text removes the annotation; otherwise the edited text can
      // resize the box, moving its connection points either way.
      const annotations = trimmed
        ? resolveArrowConnections(s.annotations.map((a) => (a.id === id && a.type === 'text' ? { ...a, text: trimmed } : a)))
        : clearDanglingConnections(s.annotations.filter((a) => a.id !== id))
      return {
        annotationHistory: [...s.annotationHistory, s.annotations],
        redoStack: [],
        annotations,
        selectedIds: trimmed ? s.selectedIds : [],
      }
    }),
  updateStrokeWidth: (ids, w) =>
    set((s) => {
      const idSet = new Set(ids)
      const next = s.annotations.map((a) => {
        if (!idSet.has(a.id)) return a
        // Number markers size off stroke width (r = sw*5 at creation) — keep them in sync.
        if (a.type === 'number') return { ...a, sw: w, r: Math.max(10, w * 5) }
        return { ...a, sw: w }
      })
      return {
        annotationHistory: [...s.annotationHistory, s.annotations],
        redoStack: [],
        // A number marker's radius change moves its connection points.
        annotations: resolveArrowConnections(next),
      }
    }),
  updateOpacity: (ids, opacity) =>
    set((s) => {
      const idSet = new Set(ids)
      return {
        annotationHistory: [...s.annotationHistory, s.annotations],
        redoStack: [],
        annotations: s.annotations.map((a) => (idSet.has(a.id) ? { ...a, opacity } : a)),
      }
    }),
  mutateAnnotations: (ids, fn) =>
    set((s) => {
      const idSet = new Set(ids)
      const next = s.annotations.map((a) => (idSet.has(a.id) ? fn(a) : a))
      // No-op edits (fn returned everything unchanged) shouldn't pollute undo.
      if (next.every((a, i) => a === s.annotations[i])) return {}
      return {
        annotationHistory: [...s.annotationHistory, s.annotations],
        redoStack: [],
        // Some edits (text font size / shape) resize a connection target.
        annotations: resolveArrowConnections(next),
      }
    }),
  bringToFront: (ids) =>
    set((s) => {
      const idSet = new Set(ids)
      const moved = s.annotations.filter((a) => idSet.has(a.id))
      if (moved.length === 0) return {}
      return {
        annotationHistory: [...s.annotationHistory, s.annotations],
        redoStack: [],
        annotations: [...s.annotations.filter((a) => !idSet.has(a.id)), ...moved],
      }
    }),
  sendToBack: (ids) =>
    set((s) => {
      const idSet = new Set(ids)
      const moved = s.annotations.filter((a) => idSet.has(a.id))
      if (moved.length === 0) return {}
      return {
        annotationHistory: [...s.annotationHistory, s.annotations],
        redoStack: [],
        annotations: [...moved, ...s.annotations.filter((a) => !idSet.has(a.id))],
      }
    }),
  resizeAnnotation: (id, bounds) =>
    set((s) => {
      const target = s.annotations.find((a) => a.id === id)
      return {
        annotations: resolveArrowConnections(
          s.annotations.map((a) => a.id !== id ? a : boundsToAnnotation(a, bounds)),
        ),
        // Resizing a number marker also adopts its new size as the default,
        // so the next marker comes out matching (mirrors boundsToAnnotation's
        // r math).
        ...(target?.type === 'number'
          ? { numberRadius: Math.max(6, Math.min(200, Math.min(bounds.w, bounds.h) / 2)) }
          : {}),
      }
    }),
  resizeEndpoint: (id, which, imgX, imgY) =>
    set((s) => ({
      annotations: s.annotations.map((a) => {
        if (a.id !== id) return a
        if (a.type === 'arrow') {
          // Manually placing an endpoint disconnects it — reconnecting (if the
          // drop lands on another shape's connection point) goes through
          // setArrowConnection instead, called separately on mouseup.
          return which === 'p1'
            ? { ...a, x1: imgX, y1: imgY, startConnect: undefined }
            : { ...a, x2: imgX, y2: imgY, endConnect: undefined }
        }
        if (a.type === 'line' || a.type === 'highlight') {
          return which === 'p1' ? { ...a, x1: imgX, y1: imgY } : { ...a, x2: imgX, y2: imgY }
        }
        return a
      }),
    })),
  setArrowConnection: (id, which, connect) =>
    set((s) => {
      const next = s.annotations.map((a) => {
        if (a.id !== id || a.type !== 'arrow') return a
        return which === 'p1' ? { ...a, startConnect: connect ?? undefined } : { ...a, endConnect: connect ?? undefined }
      })
      return { annotations: resolveArrowConnections(next) }
    }),
  resizeThickness: (id, sw) =>
    set((s) => ({
      annotations: s.annotations.map((a) => (a.id === id ? { ...a, sw } : a)),
    })),
  resizeBend: (id, bendRatio) =>
    set((s) => ({
      annotations: s.annotations.map((a) =>
        a.id === id && a.type === 'arrow' ? { ...a, bendRatio: Math.max(0, Math.min(1, bendRatio)) } : a,
      ),
    })),
  resizeTail: (id, anchor) =>
    set((s) => ({
      annotations: s.annotations.map((a) =>
        a.id === id && a.type === 'text' ? { ...a, tailAnchor: anchor } : a,
      ),
    })),
  resizeMarker: (id, x1, y1, x2, y2, sw) =>
    set((s) => ({
      annotations: s.annotations.map((a) =>
        a.id === id && a.type === 'highlight' ? { ...a, x1, y1, x2, y2, sw } : a,
      ),
    })),
  resizeMagnifierBox: (id, part, bounds) =>
    set((s) => {
      const existing = s.annotations.find((a) => a.id === id)
      if (!existing || existing.type !== 'magnifier') return {}
      if (part === 'source') {
        // The target always shows the source undistorted, so resizing the
        // source keeps the target's *zoom* (not its raw size) constant —
        // both axes rescale together, which keeps their aspect ratios
        // matched without touching the target's on-canvas position.
        const zoomW = Math.abs(existing.tw) / (Math.abs(existing.w) || 1)
        const zoomH = Math.abs(existing.th) / (Math.abs(existing.h) || 1)
        const zoom = (zoomW + zoomH) / 2
        const patch = { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h, tw: bounds.w * zoom, th: bounds.h * zoom }
        return { annotations: s.annotations.map((a) => (a.id === id ? { ...a, ...patch } : a)) }
      }
      return {
        annotations: s.annotations.map((a) =>
          a.id === id && a.type === 'magnifier' ? { ...a, tx: bounds.x, ty: bounds.y, tw: bounds.w, th: bounds.h } : a,
        ),
        // A target-box resize adopts its new zoom as the default, so the
        // next magnifier comes out with a matching zoom (mirrors
        // resizeAnnotation's numberRadius behavior).
        ...(Math.abs(existing.w) > 0.01
          ? { magnifierZoom: Math.max(1.1, Math.min(10, bounds.w / Math.abs(existing.w))) }
          : {}),
      }
    }),
  moveMagnifierBox: (id, part, dx, dy) =>
    set((s) => ({
      annotations: s.annotations.map((a) => {
        if (a.id !== id || a.type !== 'magnifier') return a
        return part === 'source'
          ? { ...a, x: a.x + dx, y: a.y + dy }
          : { ...a, tx: a.tx + dx, ty: a.ty + dy }
      }),
    })),
  rotateAnnotation: (id, rotationDeg) =>
    set((s) => ({
      annotations: resolveArrowConnections(
        s.annotations.map((a) =>
          a.id === id && isRotatable(a) ? { ...a, rotation: rotationDeg } : a
        ),
      ),
    })),
  applyCrop: (dataUrl, width, height, dx, dy) =>
    set((s) => {
      if (!s.capturedImage) return {}
      const shifted = clearDanglingConnections(
        s.annotations
          .map((a) => shiftAnnotation(a, dx, dy))
          .filter((a) => {
            const b = getAnnotationBounds(a)
            if (!b) return true
            return b.x < width && b.x + b.w > 0 && b.y < height && b.y + b.h > 0
          }),
      )
      const nums = shifted.filter((a) => a.type === 'number').map((a) => (a as NumberAnn).n)
      return {
        // The crop replaces the image, so the original bytes no longer describe it.
        capturedImage: { ...s.capturedImage, dataUrl, width, height, pngBytes: undefined },
        annotations: shifted,
        annotationHistory: [],
        redoStack: [],
        selectedIds: [],
        nextNumber: nums.length > 0 ? Math.max(...nums) + 1 : 1,
        zoom: 1, panX: 0, panY: 0,
      }
    }),

  selectedIds: [],
  setSelection: (ids) => set({ selectedIds: ids }),
  toggleSelection: (id) =>
    set((s) => ({
      selectedIds: s.selectedIds.includes(id)
        ? s.selectedIds.filter((x) => x !== id)
        : [...s.selectedIds, id],
    })),

  clipboardSeq: 0,
  clipboardPastes: 0,
  buildClipboardPayload: (ids) => {
    const idSet = new Set(ids)
    // Preserve original z-order; shallow copy is enough (annotations are plain data).
    const items = get().annotations.filter((a) => idSet.has(a.id)).map((a) => ({ ...a }))
    return items.length > 0
      ? { version: ANNOTATION_CLIPBOARD_VERSION, annotations: items }
      : null
  },
  pasteAnnotations: (payload, seq) =>
    set((s) => {
      const items = payload.annotations
      if (!items || items.length === 0) return {}
      // A payload the last paste didn't come from (copied since, or copied in
      // another editor window) starts its own offset cascade from scratch —
      // otherwise a fresh copy would land at however far the previous one had
      // already walked.
      const pastes = seq === s.clipboardSeq ? s.clipboardPastes : 0
      const off = pastes * 16 + 16  // grow the offset so repeats don't stack
      let clones = items.map((a) => shiftAnnotation({ ...a, id: makeId() }, off, off))
      // Pasting between editors means the source image can be much larger than
      // this one, which would drop the pasted elements entirely outside the
      // canvas — visibly "nothing happened". Pull them back in as a group
      // (keeping their relative layout) when they miss the image completely.
      clones = nudgeIntoView(clones, s.capturedImage?.width ?? 0, s.capturedImage?.height ?? 0)
      // A connector copied together with its target re-glues to the pasted
      // target instead of the original (same reasoning as duplicate).
      const idMap = new Map(items.map((a, i) => [a.id, clones[i].id]))
      const remapped = remapArrowConnections(clones, idMap)
      // Pasted number markers keep their original numbers (same as duplicate),
      // but the counter still has to clear them so the *next* new marker in
      // this document doesn't collide with one that just arrived.
      const pastedNums = remapped.filter((a) => a.type === 'number').map((a) => (a as NumberAnn).n)
      return {
        annotationHistory: [...s.annotationHistory, s.annotations],
        redoStack: [],
        annotations: resolveArrowConnections([...s.annotations, ...remapped]),
        activeTool: 'select',
        selectedIds: remapped.map((c) => c.id),
        clipboardSeq: seq,
        clipboardPastes: pastes + 1,
        nextNumber: pastedNums.length > 0
          ? Math.max(s.nextNumber, Math.max(...pastedNums) + 1)
          : s.nextNumber,
      }
    }),

  zoom: 1,
  panX: 0,
  panY: 0,
  setZoom: (z) => set({ zoom: Math.max(0.1, Math.min(8, z)) }),
  setPan: (x, y) => set({ panX: x, panY: y }),
  resetView: () => set({ zoom: 1, panX: 0, panY: 0 }),

  captures: [],
  setCaptures: (entries) => set({ captures: entries }),

  ocrText: '',
  setOcrText: (text) => set({ ocrText: text }),
  ocrLoading: false,
  setOcrLoading: (loading) => set({ ocrLoading: loading }),
}))

// Write tool defaults through to localStorage whenever any of them change.
useStore.subscribe((s, prev) => {
  if (
    s.lastPaletteColor === prev.lastPaletteColor &&
    s.strokeWidth === prev.strokeWidth &&
    s.activeOpacity === prev.activeOpacity &&
    s.fontSize === prev.fontSize &&
    s.fillMode === prev.fillMode &&
    s.numberShape === prev.numberShape &&
    s.spotlightShape === prev.spotlightShape &&
    s.numberRadius === prev.numberRadius &&
    s.arrowHead === prev.arrowHead &&
    s.doubleEndedArrow === prev.doubleEndedArrow &&
    s.arrowStyle === prev.arrowStyle &&
    s.textShape === prev.textShape &&
    s.textAlign === prev.textAlign &&
    s.tailAnchor === prev.tailAnchor &&
    s.blurStrength === prev.blurStrength &&
    s.spotlightDim === prev.spotlightDim &&
    s.magnifierZoom === prev.magnifierZoom &&
    s.magnifierShape === prev.magnifierShape &&
    s.imageBorder === prev.imageBorder
  ) {
    return
  }
  try {
    const out: PersistedDefaults = {
      // A picked color must not survive the session, so the palette-chosen
      // color is what gets remembered as the startup default.
      activeColor: s.lastPaletteColor,
      strokeWidth: s.strokeWidth,
      activeOpacity: s.activeOpacity,
      fontSize: s.fontSize,
      fillMode: s.fillMode,
      numberShape: s.numberShape,
      spotlightShape: s.spotlightShape,
      numberRadius: s.numberRadius,
      arrowHead: s.arrowHead,
      doubleEndedArrow: s.doubleEndedArrow,
      arrowStyle: s.arrowStyle,
      textShape: s.textShape,
      textAlign: s.textAlign,
      tailAnchor: s.tailAnchor,
      blurStrength: s.blurStrength,
      spotlightDim: s.spotlightDim,
      magnifierZoom: s.magnifierZoom,
      magnifierShape: s.magnifierShape,
      imageBorder: s.imageBorder,
    }
    localStorage.setItem(PERSIST_KEY, JSON.stringify(out))
  } catch {
    // Storage unavailable/full — the defaults just won't persist.
  }
})

function boundsToAnnotation(a: Annotation, b: { x: number; y: number; w: number; h: number }): Annotation {
  switch (a.type) {
    case 'rect':
    case 'blur':
    case 'spotlight':
    case 'image':
      return { ...a, x: b.x, y: b.y, w: b.w, h: b.h }
    case 'ellipse':
      return { ...a, cx: b.x + b.w / 2, cy: b.y + b.h / 2, rx: b.w / 2, ry: b.h / 2 }
    case 'number':
      return { ...a, cx: b.x + b.w / 2, cy: b.y + b.h / 2, r: Math.min(b.w, b.h) / 2 }
    case 'text': {
      const lineCount = a.text.split('\n').length
      const { fontSize, x, y } = fontSizeAndOriginForBounds(a.shape, lineCount, b)
      return { ...a, x, y, fontSize }
    }
    default:
      return a
  }
}

/**
 * Translates `items` as one group so their combined bounding box overlaps the
 * `width` × `height` image, if it currently doesn't at all. Only for pasting
 * between editor windows: within one document the source coordinates are
 * already on-image, but a copy from a 4K capture pasted into a small one can
 * land entirely off-canvas, where it reads as a paste that silently did
 * nothing. Shifts by the smallest amount that brings the group back inside
 * (with a small margin), so its internal layout is untouched.
 */
function nudgeIntoView(items: Annotation[], width: number, height: number): Annotation[] {
  if (items.length === 0 || width <= 0 || height <= 0) return items
  type Box = { x: number; y: number; w: number; h: number }
  const boxes = items
    .map((a) => getAnnotationBounds(a))
    .filter((b): b is Box => b !== null)
  if (boxes.length === 0) return items
  const minX = Math.min(...boxes.map((b) => b.x))
  const minY = Math.min(...boxes.map((b) => b.y))
  const maxX = Math.max(...boxes.map((b) => b.x + b.w))
  const maxY = Math.max(...boxes.map((b) => b.y + b.h))
  if (maxX > 0 && minX < width && maxY > 0 && minY < height) return items // already overlaps
  const MARGIN = 16
  // Clamp the group's box into the image on whichever axes it missed.
  const dx = minX >= width ? width - MARGIN - minX : maxX <= 0 ? MARGIN - maxX : 0
  const dy = minY >= height ? height - MARGIN - minY : maxY <= 0 ? MARGIN - maxY : 0
  if (dx === 0 && dy === 0) return items
  return items.map((a) => shiftAnnotation(a, dx, dy))
}

function shiftAnnotation(a: Annotation, dx: number, dy: number): Annotation {
  switch (a.type) {
    case 'arrow':
    case 'line':
    case 'highlight':
      return { ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy }
    case 'pen':
      return { ...a, points: a.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
    case 'rect':
    case 'blur':
    case 'spotlight':
    case 'image':
      return { ...a, x: a.x + dx, y: a.y + dy }
    case 'ellipse':
      return { ...a, cx: a.cx + dx, cy: a.cy + dy }
    case 'text':
      return { ...a, x: a.x + dx, y: a.y + dy }
    case 'number':
      return { ...a, cx: a.cx + dx, cy: a.cy + dy }
    case 'magnifier':
      return { ...a, x: a.x + dx, y: a.y + dy, tx: a.tx + dx, ty: a.ty + dy }
    default:
      return a
  }
}
