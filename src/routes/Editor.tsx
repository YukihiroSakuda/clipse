import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, HelpCircle, Link2, Loader2, Save, ScanText, X } from 'lucide-react'
import { ipc } from '../lib/ipc'
import { useStore } from '../lib/store'
import type { AnnotationTool } from '../lib/store'
import AnnotationCanvas from '../components/AnnotationCanvas'
import type { AnnotationCanvasHandle } from '../components/AnnotationCanvas'
import Toolbar from '../components/Toolbar'
import { useToast, ToastContainer } from '../components/Toast'
import HelpModal from '../components/HelpModal'
import styles from './Editor.module.css'

export default function Editor() {
  const {
    capturedImage, setCapturedImage,
    activeTool, setActiveTool,
    activeColor, setActiveColor, recentColors,
    strokeWidth, setStrokeWidth,
    fontSize, setFontSize,
    fillMode, setFillMode,
    numberShape, setNumberShape,
    frame, setFrame,
    annotations, addAnnotation, undoAnnotation, redoAnnotation, clearAnnotations,
    deleteAnnotations, beginDrag, moveAnnotations, updateAnnotationColor, updateAnnotationFontSize, updateNumberShape, updateNumberValue, updateText, updateStrokeWidth,
    resizeAnnotation, resizeEndpoint, applyCrop,
    annotationHistory, redoStack,
    nextNumber,
    selectedIds, setSelection, toggleSelection,
    copyAnnotations, pasteAnnotations,
    zoom, panX, panY, setZoom, setPan, resetView,
    ocrText, setOcrText, ocrLoading, setOcrLoading,
  } = useStore()

  const canvasHandle = useRef<AnnotationCanvasHandle>(null)
  const { toasts, showToast } = useToast()
  const [showOcr, setShowOcr] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  const selectedAnnotation = selectedIds.length === 1
    ? annotations.find((a) => a.id === selectedIds[0]) ?? null
    : null

  const handleColor = useCallback((hex: string) => {
    setActiveColor(hex)
    if (selectedIds.length > 0) updateAnnotationColor(selectedIds, hex)
  }, [selectedIds, setActiveColor, updateAnnotationColor])

  const handleFontSize = useCallback((size: number) => {
    if (activeTool === 'select' && selectedAnnotation?.type === 'text') {
      updateAnnotationFontSize(selectedAnnotation.id, size)
    } else {
      setFontSize(size)
    }
  }, [activeTool, selectedAnnotation, updateAnnotationFontSize, setFontSize])

  const handleStrokeWidth = useCallback((w: number) => {
    // With a selection, change the selected annotations; otherwise set the default.
    if (selectedIds.length > 0) {
      updateStrokeWidth(selectedIds, w)
    } else {
      setStrokeWidth(w)
    }
  }, [selectedIds, updateStrokeWidth, setStrokeWidth])

  const handleNumberShape = useCallback((shape: 'circle' | 'square') => {
    if (activeTool === 'select' && selectedAnnotation?.type === 'number') {
      updateNumberShape(selectedAnnotation.id, shape)
    } else {
      setNumberShape(shape)
    }
  }, [activeTool, selectedAnnotation, updateNumberShape, setNumberShape])

  // Fetch the pending image (and its on-disk path) from Rust on mount
  useEffect(() => {
    Promise.all([ipc.getPendingImage(), ipc.getPendingPath()])
      .then(([b64, path]) => {
        if (!b64) return
        const img = new Image()
        img.onload = () => {
          setCapturedImage({
            dataUrl: `data:image/png;base64,${b64}`,
            width: img.naturalWidth,
            height: img.naturalHeight,
            savedPath: path ?? undefined,
          })
        }
        img.src = `data:image/png;base64,${b64}`
      })
      .catch(console.error)
  }, [setCapturedImage])

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey
      const typing = isTextEntry(e.target)

      if (ctrl && e.key === 'z') { e.preventDefault(); undoAnnotation(); return }
      if (ctrl && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); redoAnnotation(); return }
      if (ctrl && e.key === 'c') {
        // With elements selected, copy those; otherwise copy the whole image.
        if (!typing && selectedIds.length > 0) { e.preventDefault(); copyAnnotations(selectedIds) }
        else void handleCopy()
        return
      }
      if (ctrl && e.key === 'v') {
        if (!typing) { e.preventDefault(); pasteAnnotations() }
        return
      }
      if (ctrl && e.key === 's') { e.preventDefault(); void handleSave(); return }
      if (ctrl && e.key === '0') { e.preventDefault(); resetView(); return }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.length > 0 && !typing) {
          deleteAnnotations(selectedIds)
          return
        }
      }

      if (!ctrl && !e.altKey && !typing) {
        const toolMap: Record<string, AnnotationTool> = {
          a: 'arrow', l: 'line', r: 'rect', e: 'ellipse',
          t: 'text', n: 'number', h: 'highlight', b: 'blur',
          s: 'spotlight', v: 'select', c: 'crop',
        }
        const tool = toolMap[e.key.toLowerCase()]
        if (tool) setActiveTool(tool)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const getAnnotatedB64 = useCallback(() => {
    return canvasHandle.current?.exportPng() ?? null
  }, [])

  const handleCopy = useCallback(async () => {
    const b64 = getAnnotatedB64() ?? capturedImage?.dataUrl.replace('data:image/png;base64,', '') ?? null
    if (!b64) return
    try {
      await ipc.copyImageToClipboard(b64)
      showToast('Copied to clipboard')
    } catch {
      showToast('Copy failed', 'err')
    }
  }, [getAnnotatedB64, capturedImage, showToast])

  const handleSave = useCallback(async () => {
    const b64 = getAnnotatedB64() ?? capturedImage?.dataUrl.replace('data:image/png;base64,', '') ?? null
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
  }, [getAnnotatedB64, capturedImage, showToast])

  const handleOcr = useCallback(async () => {
    const b64 = capturedImage?.dataUrl.replace('data:image/png;base64,', '')
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
  }, [capturedImage, setOcrLoading, setOcrText])

  const handleCopyPath = useCallback(() => {
    if (!capturedImage?.savedPath) return
    navigator.clipboard.writeText(capturedImage.savedPath)
    showToast('Path copied')
  }, [capturedImage, showToast])

  return (
    <div className={styles.root}>
      {/* ── Header ── */}
      <header className={styles.header}>
        <span className={styles.filename}>
          {capturedImage?.savedPath
            ? capturedImage.savedPath.replace(/.*[\\/]/, '')
            : ''}
        </span>
        <div className={styles.headerActions}>
          <button
            className={styles.actionBtn}
            onClick={handleCopy}
            disabled={!capturedImage}
            title="Copy image (Ctrl+C)"
          >
            <Copy size={13} strokeWidth={1.5} />
            Copy
          </button>
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
          </button>
        </div>
      </header>

      {/* ── Annotation toolbar ── */}
      <Toolbar
        activeTool={activeTool}
        activeColor={activeColor}
        recentColors={recentColors}
        strokeWidth={selectedAnnotation ? selectedAnnotation.sw : strokeWidth}
        fontSize={selectedAnnotation?.type === 'text' ? selectedAnnotation.fontSize : fontSize}
        fillMode={fillMode}
        numberShape={selectedAnnotation?.type === 'number' ? selectedAnnotation.shape : numberShape}
        frame={frame}
        selectedAnnotationType={selectedAnnotation?.type ?? null}
        onTool={setActiveTool}
        onColor={handleColor}
        onStrokeWidth={handleStrokeWidth}
        onFontSize={handleFontSize}
        onFillMode={setFillMode}
        onNumberShape={handleNumberShape}
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
              strokeWidth={strokeWidth}
              fontSize={fontSize}
              fillMode={fillMode}
              numberShape={numberShape}
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
              onUpdateText={updateText}
              onUpdateNumber={updateNumberValue}
              onApplyCrop={applyCrop}
              onCropDone={() => setActiveTool('select')}
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
