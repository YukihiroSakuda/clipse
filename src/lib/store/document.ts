// The document a single editor window holds: its annotations, the undo/redo
// history over them, the selection, and copy/paste.
//
// This is the slice whose invariants matter most. Two of them are load-bearing
// and commented where they live:
//
//  - **Array identity.** Every action that edits the document replaces the
//    `annotations` array, and undo pushes the *same* array reference onto its
//    history stack, so the editor's unsaved-changes flag can be plain
//    reference equality against the snapshot taken at load/save. A copy
//    anywhere on these paths marks every document permanently dirty.
//  - **No-op edits do not reach undo.** Every options-panel handler runs
//    through `mutateAnnotations`, including when the picked value is what the
//    selection already had.

import type { StateCreator } from 'zustand'
import {
  SHADOW_CAPABLE, clearDanglingConnections, getAnnotationBounds, isRotatable, makeId,
  remapArrowConnections, resolveArrowConnections, rotateAnnotationForImageTurn,
} from '../annotations'
import type {
  Annotation, ArrowConnection, BubbleTailAnchor, ImageAnn, NumberAnn,
} from '../annotations'
import type { AppState } from './index'
import { ANNOTATION_CLIPBOARD_VERSION } from './types'
import type { AnnotationClipboardPayload } from './types'
import { boundsToAnnotation, nudgeIntoView, shiftAnnotation } from './mutations'

export interface DocumentSlice {
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
  updateAnnotationShadowStyle: (ids: string[], style: 'none' | 'drop' | 'glow' | 'outline') => void
  updateNumberValue: (id: string, n: number) => void
  updateText: (id: string, text: string) => void
  /** Live during a slider drag — does not push history itself. The caller
   *  wraps a burst of these in one `beginDrag()` (see Editor.tsx's
   *  beginSliderAdjust), same one-history-entry-per-gesture convention as
   *  resizeThickness. Without this, every onChange tick of a range input
   *  pushed its own snapshot — a single slider drag needed dozens of Ctrl+Z
   *  to undo. */
  updateStrokeWidth: (ids: string[], w: number) => void
  updateOpacity: (ids: string[], opacity: number) => void
  /** Generic history-pushing bulk edit: applies `fn` to every annotation in
   *  `ids` (fn returns the annotation unchanged to skip non-matching types). */
  mutateAnnotations: (ids: string[], fn: (a: Annotation) => Annotation) => void
  /** Non-history-pushing counterpart to mutateAnnotations — same
   *  beginSliderAdjust convention as updateStrokeWidth/updateOpacity above,
   *  used for the other continuous sliders (font size, marker size, blur
   *  strength) that go through the generic mutate path instead of their own
   *  dedicated action. */
  mutateAnnotationsLive: (ids: string[], fn: (a: Annotation) => Annotation) => void
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
  /** Replaces the base image with a 90°-turned render of it (`dataUrl`/`width`/
   *  `height` already computed by the caller, same division of labor as
   *  `applyCrop`) and carries every annotation through the same turn so
   *  nothing drifts off what it was pointing at. */
  rotateImage: (dataUrl: string, width: number, height: number, dir: 'cw' | 'ccw') => void

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
}

export const createDocument: StateCreator<AppState, [], [], DocumentSlice> = (set, get) => ({
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
        // Background and Text Color toggle between which one is explicit
        // for a 'solid' fill (see `TextAnn.bgAuto`'s doc comment) — this is
        // the Background side's pick, so it makes Background explicit
        // (`bgAuto: false`). Deliberately does *not* touch `textColor`: an
        // old value sitting there stays inert (see `resolveTextColors`)
        // rather than getting wiped, so switching the toggle back to Text
        // restores it instead of losing it to every subsequent background
        // pick in between.
        annotations: s.annotations.map((a) => idSet.has(a.id)
          ? (a.type === 'text' && (a.bgFill ?? 'solid') === 'solid' ? { ...a, color, bgAuto: false } : { ...a, color })
          : a),
      }
    }),
  updateAnnotationShadowStyle: (ids, style) =>
    set((s) => {
      const idSet = new Set(ids)
      return {
        annotationHistory: [...s.annotationHistory, s.annotations],
        redoStack: [],
        annotations: s.annotations.map((a) =>
          idSet.has(a.id) && SHADOW_CAPABLE.has(a.type) ? { ...a, shadowStyle: style } : a
        ),
      }
    }),
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
      // A number marker's radius change moves its connection points. No
      // history push here — the caller wraps a drag's worth of calls in one
      // beginDrag() (see the interface comment).
      return { annotations: resolveArrowConnections(next) }
    }),
  updateOpacity: (ids, opacity) =>
    set((s) => {
      const idSet = new Set(ids)
      const clamped = Math.max(0.1, Math.min(1, opacity))
      return {
        annotations: s.annotations.map((a) => (idSet.has(a.id) ? { ...a, opacity: clamped } : a)),
      }
    }),
  mutateAnnotationsLive: (ids, fn) =>
    set((s) => {
      const idSet = new Set(ids)
      const next = s.annotations.map((a) => (idSet.has(a.id) ? fn(a) : a))
      return { annotations: resolveArrowConnections(next) }
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
  rotateImage: (dataUrl, width, height, dir) =>
    set((s) => {
      if (!s.capturedImage) return {}
      const { width: oldW, height: oldH } = s.capturedImage
      const turned = resolveArrowConnections(
        s.annotations.map((a) => rotateAnnotationForImageTurn(a, oldW, oldH, dir)),
      )
      return {
        // Same reasoning as applyCrop: the base image is replaced wholesale,
        // so the original bytes and undo history (which doesn't track the
        // image, only `annotations`) no longer describe anything real.
        capturedImage: { ...s.capturedImage, dataUrl, width, height, pngBytes: undefined },
        annotations: turned,
        annotationHistory: [],
        redoStack: [],
        selectedIds: [],
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
})
