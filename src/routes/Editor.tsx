import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Copy, HelpCircle, Link2, Loader2, Pencil, Save, ScanText, Trash2, X } from 'lucide-react'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { listen } from '@tauri-apps/api/event'
import { ipc } from '../lib/ipc'
import { useStore } from '../lib/store'
import type { FillMode } from '../lib/store'
import type { ArrowHead, BlurStrength, TextShape } from '../lib/annotations'
import AnnotationCanvas from '../components/AnnotationCanvas'
import type { AnnotationCanvasHandle } from '../components/AnnotationCanvas'
import Toolbar, { FKEY_TO_TOOL } from '../components/Toolbar'
import { useToast, ToastContainer } from '../components/Toast'
import HelpModal from '../components/HelpModal'
import styles from './Editor.module.css'

export default function Editor() {
  const {
    capturedImage, setCapturedImage, setSavedPath,
    activeTool, setActiveTool,
    activeColor, setActiveColor, recentColors,
    strokeWidth, setStrokeWidth,
    activeOpacity, setActiveOpacity,
    fontSize, setFontSize,
    fillMode, setFillMode,
    numberShape, setNumberShape,
    arrowHead, setArrowHead,
    textShape, setTextShape,
    blurStrength, setBlurStrength,
    spotlightDim, setSpotlightDim,
    frame, setFrame,
    annotations, addAnnotation, duplicateAnnotations, undoAnnotation, redoAnnotation, clearAnnotations,
    deleteAnnotations, beginDrag, moveAnnotations, updateAnnotationColor, updateNumberValue, updateText, updateStrokeWidth, updateOpacity,
    mutateAnnotations, bringToFront, sendToBack,
    resizeAnnotation, resizeEndpoint, resizeThickness, rotateAnnotation, applyCrop,
    annotationHistory, redoStack,
    nextNumber,
    selectedIds, setSelection, toggleSelection,
    copyAnnotations, pasteAnnotations,
    zoom, panX, panY, setZoom, setPan, resetView,
    ocrText, setOcrText, ocrLoading, setOcrLoading,
  } = useStore()

  const canvasHandle = useRef<AnnotationCanvasHandle>(null)
  const { toasts, showToast, dismissToast } = useToast()
  // Timestamp of the last arrow-key nudge: bursts within this window share
  // one undo snapshot, so undo reverts the whole reposition, not 1px per press.
  const lastNudgeRef = useRef(0)
  const [showOcr, setShowOcr] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [copying, setCopying] = useState(false)
  const [confirmDeleteImage, setConfirmDeleteImage] = useState(false)

  const savedPath = capturedImage?.savedPath ?? ''
  const savedName = savedPath ? savedPath.replace(/.*[\\/]/, '') : ''
  const savedExt = savedName.match(/\.[^.]+$/)?.[0] ?? ''

  const startRename = useCallback(() => {
    if (!savedPath) return
    setRenameValue(savedName.replace(/\.[^.]+$/, ''))
    setRenaming(true)
  }, [savedPath, savedName])

  const commitRename = useCallback(async () => {
    const stem = renameValue.trim()
    if (!savedPath || !stem || stem === savedName.replace(/\.[^.]+$/, '')) {
      setRenaming(false)
      return
    }
    try {
      const newPath = await ipc.renameCapture(savedPath, stem)
      setSavedPath(newPath)
      setRenaming(false)
    } catch (e) {
      showToast(String(e), 'err')
    }
  }, [renameValue, savedPath, savedName, setSavedPath, showToast])

  // Selected annotations, and their common type when the selection is
  // homogeneous — that's what decides which options row 2 shows and whether
  // an option change edits the selection (all of it) or the tool default.
  const selectedAnnotations = useMemo(
    () => annotations.filter((a) => selectedIds.includes(a.id)),
    [annotations, selectedIds],
  )
  const firstSelected = selectedAnnotations[0] ?? null
  const uniformType = firstSelected && selectedAnnotations.every((a) => a.type === firstSelected.type)
    ? firstSelected.type
    : null

  const handleColor = useCallback((hex: string) => {
    setActiveColor(hex)
    if (selectedIds.length > 0) updateAnnotationColor(selectedIds, hex)
  }, [selectedIds, setActiveColor, updateAnnotationColor])

  // Last non-picker tool, so a pick can return to whatever the user was doing.
  const prevToolRef = useRef(activeTool !== 'picker' ? activeTool : 'select')
  useEffect(() => {
    if (activeTool !== 'picker') prevToolRef.current = activeTool
  }, [activeTool])

  // Picker tool: adopt the sampled color (recoloring the selection like any
  // palette click), copy its hex, then hop back to the previous tool —
  // picking is a one-shot detour, not a mode to stay in.
  const handlePickColor = useCallback((hex: string) => {
    handleColor(hex)
    navigator.clipboard.writeText(hex).catch(() => {})
    showToast(`${hex} copied`)
    setActiveTool(prevToolRef.current)
  }, [handleColor, showToast, setActiveTool])

  const handleFontSize = useCallback((size: number) => {
    if (uniformType === 'text') {
      mutateAnnotations(selectedIds, (a) => (a.type === 'text' ? { ...a, fontSize: size } : a))
    } else {
      setFontSize(size)
    }
  }, [uniformType, selectedIds, mutateAnnotations, setFontSize])

  const handleStrokeWidth = useCallback((w: number) => {
    // With a selection, change the selected annotations; otherwise set the default.
    if (selectedIds.length > 0) {
      updateStrokeWidth(selectedIds, w)
    } else {
      setStrokeWidth(w)
    }
  }, [selectedIds, updateStrokeWidth, setStrokeWidth])

  const handleOpacity = useCallback((o: number) => {
    if (selectedIds.length > 0) {
      updateOpacity(selectedIds, o)
    } else {
      setActiveOpacity(o)
    }
  }, [selectedIds, updateOpacity, setActiveOpacity])

  const handleNumberShape = useCallback((shape: 'circle' | 'square') => {
    if (uniformType === 'number') {
      mutateAnnotations(selectedIds, (a) => (a.type === 'number' ? { ...a, shape } : a))
    } else {
      setNumberShape(shape)
    }
  }, [uniformType, selectedIds, mutateAnnotations, setNumberShape])

  const handleArrowHead = useCallback((head: ArrowHead) => {
    if (uniformType === 'arrow') {
      mutateAnnotations(selectedIds, (a) => (a.type === 'arrow' ? { ...a, head } : a))
    } else {
      setArrowHead(head)
    }
  }, [uniformType, selectedIds, mutateAnnotations, setArrowHead])

  const handleTextShape = useCallback((shape: TextShape) => {
    if (uniformType === 'text') {
      mutateAnnotations(selectedIds, (a) => (a.type === 'text' ? { ...a, shape } : a))
    } else {
      setTextShape(shape)
    }
  }, [uniformType, selectedIds, mutateAnnotations, setTextShape])

  const handleFillMode = useCallback((mode: FillMode) => {
    if (uniformType === 'rect' || uniformType === 'ellipse') {
      mutateAnnotations(selectedIds, (a) =>
        a.type === 'rect' || a.type === 'ellipse' ? { ...a, fill: mode } : a,
      )
    } else {
      setFillMode(mode)
    }
  }, [uniformType, selectedIds, mutateAnnotations, setFillMode])

  const handleBlurStrength = useCallback((strength: BlurStrength) => {
    if (uniformType === 'blur') {
      mutateAnnotations(selectedIds, (a) => (a.type === 'blur' ? { ...a, strength } : a))
    } else {
      setBlurStrength(strength)
    }
  }, [uniformType, selectedIds, mutateAnnotations, setBlurStrength])

  const handleSpotlightDim = useCallback((dim: number) => {
    if (uniformType === 'spotlight') {
      mutateAnnotations(selectedIds, (a) => (a.type === 'spotlight' ? { ...a, dim } : a))
    } else {
      setSpotlightDim(dim)
    }
  }, [uniformType, selectedIds, mutateAnnotations, setSpotlightDim])

  // Blob object URL of the currently displayed image, revoked on replacement.
  const imageUrlRef = useRef<string | null>(null)

  // Fetch the pending image (raw PNG bytes over binary IPC) and its on-disk
  // path from Rust. Runs on mount, and again on `editor-load` when the
  // backend reuses this window for a fresh capture.
  const loadPendingImage = useCallback(() => {
    Promise.all([ipc.getPendingImage(), ipc.getPendingPath()])
      .then(([buf, path]) => {
        if (!buf) return
        const bytes = new Uint8Array(buf)
        const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
        const img = new Image()
        img.onload = () => {
          if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current)
          imageUrlRef.current = url
          setCapturedImage({
            dataUrl: url,
            width: img.naturalWidth,
            height: img.naturalHeight,
            savedPath: path ?? undefined,
            pngBytes: bytes,
          })
        }
        img.onerror = () => URL.revokeObjectURL(url)
        img.src = url
      })
      .catch(console.error)
  }, [setCapturedImage])

  useEffect(() => { loadPendingImage() }, [loadPendingImage])

  // The backend reuses an open editor for new captures (no webview cold start):
  // reset per-image UI state, then load the new pending image. Annotation and
  // view state reset inside setCapturedImage.
  useEffect(() => {
    const un = listen('editor-load', () => {
      setShowOcr(false)
      setOcrText('')
      setRenaming(false)
      loadPendingImage()
    })
    return () => { un.then((f) => f()) }
  }, [loadPendingImage, setOcrText])

  // Base64 of the *original* image, for commands that still take base64:
  // after a crop the dataUrl is a data: URL (strip the prefix); otherwise
  // encode the raw bytes via FileReader (native speed, no 20MB string concat).
  const getOriginalB64 = useCallback(async (): Promise<string | null> => {
    const src = capturedImage?.dataUrl
    if (src?.startsWith('data:image/png;base64,')) {
      return src.slice('data:image/png;base64,'.length)
    }
    const bytes = capturedImage?.pngBytes
    if (!bytes) return null
    const dataUrl: string = await new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(r.result as string)
      r.onerror = () => reject(r.error)
      r.readAsDataURL(new Blob([bytes]))
    })
    return dataUrl.slice(dataUrl.indexOf(',') + 1)
  }, [capturedImage])

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey
      const typing = isTextEntry(e.target)

      // Shortcuts match on e.code (physical key): with the Japanese IME
      // active e.key reports 'Process', and CapsLock changes the letter case.
      if (ctrl && !e.shiftKey && e.code === 'KeyZ') { e.preventDefault(); undoAnnotation(); return }
      if (ctrl && (e.code === 'KeyY' || (e.shiftKey && e.code === 'KeyZ'))) { e.preventDefault(); redoAnnotation(); return }
      if (ctrl && e.code === 'KeyC') {
        // With elements selected, copy those; otherwise copy the whole image.
        if (!typing && selectedIds.length > 0) { e.preventDefault(); copyAnnotations(selectedIds) }
        else void handleCopy()
        return
      }
      if (ctrl && e.code === 'KeyV') {
        if (!typing) { e.preventDefault(); pasteAnnotations() }
        return
      }
      if (ctrl && e.code === 'KeyD') {
        if (!typing && selectedIds.length > 0) { e.preventDefault(); duplicateAnnotations(selectedIds) }
        return
      }
      if (ctrl && e.code === 'KeyA') {
        if (!typing) { e.preventDefault(); setSelection(annotations.map((a) => a.id)) }
        return
      }
      if (ctrl && e.code === 'KeyS') { e.preventDefault(); void handleSave(); return }
      if (ctrl && e.code === 'Digit0') { e.preventDefault(); resetView(); return }

      // Arrow keys nudge the selection by 1 image px (Shift: 10). Presses
      // within a short burst share one undo snapshot (see lastNudgeRef).
      if (!typing && selectedIds.length > 0 &&
          (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        const now = Date.now()
        if (now - lastNudgeRef.current > 800) beginDrag()
        lastNudgeRef.current = now
        moveAnnotations(selectedIds, dx, dy)
        return
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.length > 0 && !typing) {
          deleteAnnotations(selectedIds)
          return
        }
        // Nothing selected: Delete/Backspace targets the image itself, same
        // two-step confirm the gallery uses for its own Delete key.
        if (!typing && !confirmDeleteImage && capturedImage?.savedPath) {
          e.preventDefault()
          setConfirmDeleteImage(true)
          return
        }
      }
      if (e.key === 'Enter' && confirmDeleteImage) { e.preventDefault(); void handleDeleteImage(); return }
      if (e.key === 'Escape' && confirmDeleteImage) { e.preventDefault(); setConfirmDeleteImage(false); return }

      if (!ctrl && !e.altKey && !typing) {
        // Tools are bound to F1–F12 (see FKEY_TO_TOOL / the toolbar labels).
        const tool = FKEY_TO_TOOL[e.key]
        if (tool) { e.preventDefault(); setActiveTool(tool) }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const getAnnotatedB64 = useCallback(() => {
    return canvasHandle.current?.exportPng() ?? null
  }, [])

  const handleCopy = useCallback(async () => {
    if (copying) return
    setCopying(true)
    // Persistent toast while the encode + clipboard write is in flight, so
    // the wait is visibly "working" and not a frozen click.
    const busy = showToast('Copying…', 'busy', 0)
    try {
      // Preferred path: async PNG encode (UI stays responsive) + raw binary
      // IPC (no base64/JSON round-trip). Falls back to the base64 command
      // when the canvas isn't mounted.
      const blob = (await canvasHandle.current?.exportBlob()) ?? null
      if (blob) {
        await ipc.copyImageBytesToClipboard(new Uint8Array(await blob.arrayBuffer()))
      } else if (capturedImage?.pngBytes) {
        await ipc.copyImageBytesToClipboard(capturedImage.pngBytes)
      } else {
        const b64 = await getOriginalB64()
        if (!b64) return
        await ipc.copyImageToClipboard(b64)
      }
      dismissToast(busy)
      showToast('Copied to clipboard')
    } catch {
      dismissToast(busy)
      showToast('Copy failed', 'err')
    } finally {
      dismissToast(busy)
      setCopying(false)
    }
  }, [copying, capturedImage, getOriginalB64, showToast, dismissToast])

  const handleSave = useCallback(async () => {
    const b64 = getAnnotatedB64() ?? (await getOriginalB64())
    if (!b64) return
    try {
      if (capturedImage?.savedPath) {
        await ipc.overwriteImage(capturedImage.savedPath, b64)
      } else {
        await ipc.saveImage(b64)
      }
      showToast('Saved')
    } catch {
      showToast('Save failed', 'err')
    }
  }, [getAnnotatedB64, getOriginalB64, capturedImage, showToast])

  const handleOcr = useCallback(async () => {
    const b64 = await getOriginalB64()
    if (!b64) return
    setShowOcr(true)
    setOcrLoading(true)
    try {
      const text = await ipc.runOcr(b64)
      setOcrText(text)
    } catch (e) {
      setOcrText(`OCR error: ${e}`)
    } finally {
      setOcrLoading(false)
    }
  }, [getOriginalB64, setOcrLoading, setOcrText])

  const handleCopyPath = useCallback(() => {
    if (!capturedImage?.savedPath) return
    navigator.clipboard.writeText(capturedImage.savedPath)
    showToast('Path copied')
  }, [capturedImage, showToast])

  // Deletes the underlying capture file (not just an annotation) and closes
  // the editor, since there's nothing left here to edit. The gallery (if
  // open, in a separate window) refreshes on the `capture-saved` event the
  // backend emits after the file is removed.
  const handleDeleteImage = useCallback(async () => {
    const path = capturedImage?.savedPath
    if (!path) { setConfirmDeleteImage(false); return }
    try {
      await ipc.deleteCapture(path)
      getCurrentWebviewWindow().close()
    } catch {
      setConfirmDeleteImage(false)
      showToast('Delete failed', 'err')
    }
  }, [capturedImage, showToast])

  return (
    <div className={styles.root} style={copying ? { cursor: 'progress' } : undefined}>
      {/* ── Header (drag region) ── */}
      {/* Button clicks must not leave focus behind — a later keyboard
          shortcut would paint the :focus-visible ring on the stale button. */}
      <header
        className={styles.header}
        data-tauri-drag-region
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) e.preventDefault()
        }}
      >
        {renaming ? (
          <div className={styles.renameRow}>
            <input
              className={styles.renameInput}
              value={renameValue}
              autoFocus
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitRename() }
                else if (e.key === 'Escape') { e.preventDefault(); setRenaming(false) }
              }}
              onBlur={() => setRenaming(false)}
            />
            <span className={styles.renameExt}>{savedExt}</span>
          </div>
        ) : (
          <div className={styles.fileGroup}>
            <span className={styles.filename} data-tauri-drag-region>{savedName}</span>
            {savedPath && (
              <button className={styles.renameBtn} onClick={startRename} title="Rename file">
                <Pencil size={12} strokeWidth={1.5} />
              </button>
            )}
          </div>
        )}
        <div className={styles.headerActions}>
          <button
            className={styles.actionBtn}
            onClick={handleSave}
            disabled={!capturedImage}
            title="Save to gallery (Ctrl+S)"
          >
            <Save size={13} strokeWidth={1.5} />
            Save
          </button>
          <button
            className={styles.actionBtn}
            onClick={handleCopy}
            disabled={!capturedImage || copying}
            title="Copy image (Ctrl+C)"
          >
            {copying ? (
              <Loader2 size={13} strokeWidth={1.5} style={{ animation: 'spin 1s linear infinite' }} />
            ) : (
              <Copy size={13} strokeWidth={1.5} />
            )}
            Copy
          </button>
          <button
            className={styles.actionBtn}
            onClick={handleCopyPath}
            disabled={!capturedImage?.savedPath}
            title="Copy file path"
          >
            <Link2 size={13} strokeWidth={1.5} />
            Path
          </button>
          <button
            className={`${styles.actionBtn} ${showOcr ? styles.actionBtnActive : ''}`}
            onClick={handleOcr}
            disabled={!capturedImage}
          >
            <ScanText size={13} strokeWidth={1.5} />
            OCR
          </button>
          <button
            className={styles.actionBtn}
            onClick={() => setShowHelp(true)}
            title="Help / shortcuts (?)"
          >
            <HelpCircle size={13} strokeWidth={1.5} />
            Help
          </button>
          <button
            className={styles.actionBtn}
            onClick={() => setConfirmDeleteImage(true)}
            disabled={!capturedImage?.savedPath}
            title="Delete this image (Delete)"
          >
            <Trash2 size={13} strokeWidth={1.5} />
            Delete
          </button>
          <button
            className={styles.closeBtn}
            onClick={() => getCurrentWebviewWindow().close()}
            title="Close"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>
      </header>

      {/* ── Delete confirmation bar ── */}
      {confirmDeleteImage && (
        <div className={styles.deleteBar}>
          <Trash2 size={13} strokeWidth={1.5} style={{ color: 'var(--color-danger)', flexShrink: 0 }} />
          <span className={styles.deleteBarText}>Delete this image? This can't be undone.</span>
          <div className={styles.deleteBarActions}>
            <button
              className={`${styles.iconBtn} ${styles.iconBtnCancel}`}
              onClick={() => setConfirmDeleteImage(false)}
              title="Cancel (Esc)"
            >
              <X size={12} strokeWidth={2} />
              <span>Cancel</span>
            </button>
            <button
              className={`${styles.iconBtn} ${styles.iconBtnConfirmDelete}`}
              onClick={handleDeleteImage}
              title="Confirm delete (Enter)"
            >
              <Trash2 size={12} strokeWidth={1.5} />
              <span>Delete</span>
            </button>
          </div>
        </div>
      )}

      {/* ── Annotation toolbar ── */}
      <Toolbar
        activeTool={activeTool}
        activeColor={activeColor}
        recentColors={recentColors}
        strokeWidth={firstSelected ? firstSelected.sw : strokeWidth}
        opacity={firstSelected ? firstSelected.opacity ?? 1 : activeOpacity}
        fontSize={uniformType === 'text' && firstSelected?.type === 'text' ? firstSelected.fontSize : fontSize}
        fillMode={
          (uniformType === 'rect' || uniformType === 'ellipse') &&
          (firstSelected?.type === 'rect' || firstSelected?.type === 'ellipse')
            ? firstSelected.fill
            : fillMode
        }
        numberShape={uniformType === 'number' && firstSelected?.type === 'number' ? firstSelected.shape : numberShape}
        arrowHead={uniformType === 'arrow' && firstSelected?.type === 'arrow' ? firstSelected.head : arrowHead}
        textShape={uniformType === 'text' && firstSelected?.type === 'text' ? firstSelected.shape : textShape}
        blurStrength={uniformType === 'blur' && firstSelected?.type === 'blur' ? firstSelected.strength ?? 'medium' : blurStrength}
        spotlightDim={uniformType === 'spotlight' && firstSelected?.type === 'spotlight' ? firstSelected.dim ?? 0.55 : spotlightDim}
        frame={frame}
        selectedAnnotationType={uniformType}
        onTool={setActiveTool}
        onColor={handleColor}
        onStrokeWidth={handleStrokeWidth}
        onOpacity={handleOpacity}
        onFontSize={handleFontSize}
        onFillMode={handleFillMode}
        onNumberShape={handleNumberShape}
        onArrowHead={handleArrowHead}
        onTextShape={handleTextShape}
        onBlurStrength={handleBlurStrength}
        onSpotlightDim={handleSpotlightDim}
        onFrame={setFrame}
        onUndo={undoAnnotation}
        onRedo={redoAnnotation}
        onClear={clearAnnotations}
        canUndo={annotationHistory.length > 0}
        canRedo={redoStack.length > 0}
      />

      {/* ── Main area: canvas + optional OCR panel ── */}
      <div className={styles.main}>
        <div className={styles.canvasArea}>
          {capturedImage ? (
            <AnnotationCanvas
              ref={canvasHandle}
              imageDataUrl={capturedImage.dataUrl}
              imageWidth={capturedImage.width}
              imageHeight={capturedImage.height}
              annotations={annotations}
              activeTool={activeTool}
              activeColor={activeColor}
              activeOpacity={activeOpacity}
              strokeWidth={strokeWidth}
              fontSize={fontSize}
              fillMode={fillMode}
              numberShape={numberShape}
              arrowHead={arrowHead}
              textShape={textShape}
              blurStrength={blurStrength}
              spotlightDim={spotlightDim}
              frame={frame}
              nextNumber={nextNumber}
              selectedIds={selectedIds}
              zoom={zoom}
              panX={panX}
              panY={panY}
              onAnnotationAdded={addAnnotation}
              onBeginDrag={beginDrag}
              onSetSelection={setSelection}
              onToggleSelection={toggleSelection}
              onMoveAnnotations={moveAnnotations}
              onResizeAnnotation={resizeAnnotation}
              onResizeEndpoint={resizeEndpoint}
              onResizeThickness={resizeThickness}
              onRotateAnnotation={rotateAnnotation}
              onUpdateText={updateText}
              onUpdateNumber={updateNumberValue}
              onCancelTransform={undoAnnotation}
              onDuplicateSelection={() => duplicateAnnotations(selectedIds)}
              onBringToFront={() => bringToFront(selectedIds)}
              onSendToBack={() => sendToBack(selectedIds)}
              onDeleteSelection={() => deleteAnnotations(selectedIds)}
              onApplyCrop={applyCrop}
              onCropDone={() => setActiveTool('select')}
              onPickColor={handlePickColor}
              onZoomChange={setZoom}
              onPanChange={setPan}
            />
          ) : (
            <Loader2 size={20} strokeWidth={1.5} style={{ color: 'var(--color-text-faint)', animation: 'spin 1s linear infinite' }} />
          )}
        </div>

        {/* ── OCR side panel ── */}
        {showOcr && (
          <aside className={styles.ocrPanel}>
            <div className={styles.ocrHeader}>
              <span>OCR</span>
              <button className={styles.ocrClose} onClick={() => setShowOcr(false)}>
                <X size={12} strokeWidth={2} />
              </button>
            </div>
            <div className={styles.ocrContent}>
              {ocrLoading ? (
                <Loader2 size={16} strokeWidth={1.5} style={{ color: 'var(--color-text-faint)', animation: 'spin 1s linear infinite' }} />
              ) : ocrText ? (
                <pre className={styles.ocrText}>{ocrText}</pre>
              ) : (
                <span className={styles.ocrMuted}>Run OCR to extract text</span>
              )}
            </div>
            {ocrText && !ocrLoading && (
              <button
                className={styles.ocrCopyBtn}
                onClick={() => navigator.clipboard.writeText(ocrText)}
                title="Copy text"
              >
                <Copy size={12} strokeWidth={1.5} />
              </button>
            )}
          </aside>
        )}
      </div>
      <ToastContainer toasts={toasts} />
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  )
}

/** True when the event target is a text-entry element (input/textarea/contentEditable). */
function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el.isContentEditable === true
  )
}
