// Types the store's slices share.
//
// Their own module so a slice can name them without importing the file that
// composes the slices — which would be a runtime cycle for
// `ANNOTATION_CLIPBOARD_VERSION`, the one value among them.

import type { Annotation } from '../annotations'

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
  | 'blur' | 'highlight' | 'spotlight' | 'magnifier' | 'erase' | 'select' | 'crop' | 'picker'

/** `'semi'` is a legacy value only — the Fill buttons (ToolOptionsPanel)
 *  offer just 'stroke'/'solid' now, since 'semi' was nothing but 'solid' at
 *  a fixed 35% of Opacity, which the Opacity slider already reaches
 *  directly. Kept in the type so a document saved with `fill: 'semi'`
 *  still round-trips and renders correctly. */
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
