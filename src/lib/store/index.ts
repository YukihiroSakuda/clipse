import { create } from 'zustand'
import { installPersistence } from './persist'
import { createToolDefaults } from './defaults'
import { createDocument } from './document'
import type { DocumentSlice } from './document'
import type { ToolDefaultsSlice } from './defaults'
import type { CaptureEntry } from '../ipc'
import type { CapturedImage } from './types'

// Re-exported so every consumer keeps importing them from `lib/store`.
export type { CapturedImage, AnnotationTool, FillMode, AnnotationClipboardPayload } from './types'
export { ANNOTATION_CLIPBOARD_VERSION } from './types'
import { isPaletteColor } from '../annotations'

export interface AppState extends ToolDefaultsSlice, DocumentSlice {
  // Current capture being edited
  capturedImage: CapturedImage | null
  setCapturedImage: (img: CapturedImage | null) => void
  /** Updates only the saved-file path (rename) — unlike setCapturedImage it
   *  must NOT reset annotations/history/picked colors: the image is unchanged. */
  setSavedPath: (path: string) => void

  // Corner radius for the exported PNG

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
export const useStore = create<AppState>((set, get, api) => ({
  ...createToolDefaults(set, get, api),
  ...createDocument(set, get, api),

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

// Remembered tool defaults are written through on every change — see
// `installPersistence` for the one table that drives both directions.
installPersistence(useStore.subscribe)
