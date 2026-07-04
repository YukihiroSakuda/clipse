import { create } from 'zustand'
import type { CaptureEntry } from './ipc'
import type { Annotation, NumberAnn } from './annotations'
import { PALETTE, TAILWIND_HEX_SET, getAnnotationBounds, makeId } from './annotations'
import type { FrameConfig } from './frame'
import { DEFAULT_FRAME } from './frame'

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
  | 'arrow' | 'line' | 'rect' | 'ellipse' | 'text' | 'number'
  | 'blur' | 'highlight' | 'spotlight' | 'select' | 'crop' | 'pan'

export type FillMode = 'stroke' | 'solid' | 'semi'

export interface AppState {
  // Current capture being edited
  capturedImage: CapturedImage | null
  setCapturedImage: (img: CapturedImage | null) => void

  // Active annotation tool
  activeTool: AnnotationTool
  setActiveTool: (tool: AnnotationTool) => void

  // Active annotation color (hex)
  activeColor: string
  setActiveColor: (hex: string) => void
  recentColors: string[]  // custom colors added via picker (max 5)

  // Stroke width
  strokeWidth: number
  setStrokeWidth: (w: number) => void

  // Font size (for Text tool)
  fontSize: number
  setFontSize: (s: number) => void

  // Fill mode (for Rect / Ellipse)
  fillMode: FillMode
  setFillMode: (m: FillMode) => void

  // Number marker shape
  numberShape: 'circle' | 'square'
  setNumberShape: (s: 'circle' | 'square') => void

  // Corner radius for the exported PNG
  frame: FrameConfig
  setFrame: (patch: Partial<FrameConfig>) => void

  // Annotations + undo/redo history
  annotations: Annotation[]
  annotationHistory: Annotation[][]  // stack for undo
  redoStack: Annotation[][]          // stack for redo
  nextNumber: number
  addAnnotation: (ann: Annotation) => void
  undoAnnotation: () => void
  redoAnnotation: () => void
  clearAnnotations: () => void
  deleteAnnotations: (ids: string[]) => void
  beginDrag: () => void
  moveAnnotations: (ids: string[], dx: number, dy: number) => void
  updateAnnotationColor: (ids: string[], color: string) => void
  updateAnnotationFontSize: (id: string, fontSize: number) => void
  updateNumberShape: (id: string, shape: 'circle' | 'square') => void
  updateNumberValue: (id: string, n: number) => void
  updateText: (id: string, text: string) => void
  updateStrokeWidth: (ids: string[], w: number) => void
  resizeAnnotation: (id: string, bounds: { x: number; y: number; w: number; h: number }) => void
  resizeEndpoint: (id: string, which: 'p1' | 'p2', imgX: number, imgY: number) => void
  applyCrop: (dataUrl: string, width: number, height: number, dx: number, dy: number) => void

  // Selected annotation ids (select tool; multi-select via Ctrl)
  selectedIds: string[]
  setSelection: (ids: string[]) => void
  toggleSelection: (id: string) => void

  // Copy / paste of annotation elements (internal clipboard, not the OS clipboard)
  clipboard: Annotation[]
  clipboardPastes: number
  copyAnnotations: (ids: string[]) => void
  pasteAnnotations: () => void

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

export const useStore = create<AppState>((set) => ({
  capturedImage: null,
  setCapturedImage: (img) => set({
    capturedImage: img,
    annotations: [], annotationHistory: [], redoStack: [],
    nextNumber: 1, selectedIds: [], zoom: 1, panX: 0, panY: 0,
  }),

  activeTool: 'arrow',
  setActiveTool: (tool) => set({ activeTool: tool, selectedIds: [] }),

  activeColor: PALETTE.red,
  setActiveColor: (hex) => set((s) => {
    const isKnown = Object.values(PALETTE).includes(hex) || TAILWIND_HEX_SET.has(hex)
    if (isKnown) return { activeColor: hex }
    const recent = [hex, ...s.recentColors.filter((c) => c !== hex)].slice(0, 5)
    return { activeColor: hex, recentColors: recent }
  }),
  recentColors: [],

  strokeWidth: 3,
  setStrokeWidth: (w) => set({ strokeWidth: w }),

  fontSize: 20,
  setFontSize: (s) => set({ fontSize: s }),

  fillMode: 'stroke',
  setFillMode: (m) => set({ fillMode: m }),

  numberShape: 'circle',
  setNumberShape: (s) => set({ numberShape: s }),

  frame: DEFAULT_FRAME,
  setFrame: (patch) => set((s) => ({ frame: { ...s.frame, ...patch } })),

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
    })),
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
      const remaining = s.annotations.filter((a) => !idSet.has(a.id))
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
      return {
        annotations: s.annotations.map((a) => (idSet.has(a.id) ? shiftAnnotation(a, dx, dy) : a)),
      }
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
      return {
        annotationHistory: [...s.annotationHistory, s.annotations],
        redoStack: [],
        // Empty text removes the annotation
        annotations: trimmed
          ? s.annotations.map((a) => (a.id === id && a.type === 'text' ? { ...a, text: trimmed } : a))
          : s.annotations.filter((a) => a.id !== id),
        selectedIds: trimmed ? s.selectedIds : [],
      }
    }),
  updateStrokeWidth: (ids, w) =>
    set((s) => {
      const idSet = new Set(ids)
      return {
        annotationHistory: [...s.annotationHistory, s.annotations],
        redoStack: [],
        annotations: s.annotations.map((a) => {
          if (!idSet.has(a.id)) return a
          // Number markers size off stroke width (r = sw*5 at creation) — keep them in sync.
          if (a.type === 'number') return { ...a, sw: w, r: Math.max(10, w * 5) }
          return { ...a, sw: w }
        }),
      }
    }),
  resizeAnnotation: (id, bounds) =>
    set((s) => ({
      annotations: s.annotations.map((a) => a.id !== id ? a : boundsToAnnotation(a, bounds)),
    })),
  resizeEndpoint: (id, which, imgX, imgY) =>
    set((s) => ({
      annotations: s.annotations.map((a) => {
        if (a.id !== id) return a
        if (a.type === 'arrow' || a.type === 'line') {
          return which === 'p1' ? { ...a, x1: imgX, y1: imgY } : { ...a, x2: imgX, y2: imgY }
        }
        return a
      }),
    })),
  applyCrop: (dataUrl, width, height, dx, dy) =>
    set((s) => {
      if (!s.capturedImage) return {}
      const shifted = s.annotations
        .map((a) => shiftAnnotation(a, dx, dy))
        .filter((a) => {
          const b = getAnnotationBounds(a)
          if (!b) return true
          return b.x < width && b.x + b.w > 0 && b.y < height && b.y + b.h > 0
        })
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

  clipboard: [],
  clipboardPastes: 0,
  copyAnnotations: (ids) =>
    set((s) => {
      const idSet = new Set(ids)
      // Preserve original z-order; shallow copy is enough (annotations are plain data).
      const items = s.annotations.filter((a) => idSet.has(a.id)).map((a) => ({ ...a }))
      return { clipboard: items, clipboardPastes: 0 }
    }),
  pasteAnnotations: () =>
    set((s) => {
      if (s.clipboard.length === 0) return {}
      const off = s.clipboardPastes * 16 + 16  // grow the offset so repeats don't stack
      const clones = s.clipboard.map((a) => shiftAnnotation({ ...a, id: makeId() }, off, off))
      return {
        annotationHistory: [...s.annotationHistory, s.annotations],
        redoStack: [],
        annotations: [...s.annotations, ...clones],
        selectedIds: clones.map((c) => c.id),
        clipboardPastes: s.clipboardPastes + 1,
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

function boundsToAnnotation(a: Annotation, b: { x: number; y: number; w: number; h: number }): Annotation {
  switch (a.type) {
    case 'rect':
    case 'blur':
    case 'highlight':
    case 'spotlight':
      return { ...a, x: b.x, y: b.y, w: b.w, h: b.h }
    case 'ellipse':
      return { ...a, cx: b.x + b.w / 2, cy: b.y + b.h / 2, rx: b.w / 2, ry: b.h / 2 }
    case 'number':
      return { ...a, cx: b.x + b.w / 2, cy: b.y + b.h / 2, r: Math.min(b.w, b.h) / 2 }
    case 'text': {
      const lines = a.text.split('\n')
      const newFontSize = Math.max(8, Math.round(b.h / (1.25 * lines.length)))
      return { ...a, x: b.x, y: b.y, fontSize: newFontSize }
    }
    default:
      return a
  }
}

function shiftAnnotation(a: Annotation, dx: number, dy: number): Annotation {
  switch (a.type) {
    case 'arrow':
    case 'line':
      return { ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy }
    case 'rect':
    case 'blur':
    case 'highlight':
    case 'spotlight':
      return { ...a, x: a.x + dx, y: a.y + dy }
    case 'ellipse':
      return { ...a, cx: a.cx + dx, cy: a.cy + dy }
    case 'text':
      return { ...a, x: a.x + dx, y: a.y + dy }
    case 'number':
      return { ...a, cx: a.cx + dx, cy: a.cy + dy }
    default:
      return a
  }
}
