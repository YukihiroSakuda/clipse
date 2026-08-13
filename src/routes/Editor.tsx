import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, HelpCircle, Link2, Loader2, Pencil, Pin as PinIcon, Save, ScanText, Trash2, X } from 'lucide-react'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { ipc } from '../lib/ipc'
import { usePrintScreenKey } from '../lib/usePrintScreenKey'
import { ANNOTATION_CLIPBOARD_VERSION, useStore } from '../lib/store'
import type { AnnotationClipboardPayload, FillMode } from '../lib/store'
import { blurStrengthPct } from '../lib/annotations'
import type { Annotation, ArrowHead, BubbleTailAnchor, TextShape } from '../lib/annotations'
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
    numberRadius, setNumberRadius,
    arrowHead, setArrowHead,
    doubleEndedArrow, setDoubleEndedArrow,
    arrowStyle, setArrowStyle,
    textShape, setTextShape,
    textAlign, setTextAlign,
    tailAnchor, setTailAnchor,
    blurStrength, setBlurStrength,
    spotlightDim, setSpotlightDim,
    spotlightShape, setSpotlightShape,
    magnifierZoom, magnifierShape, setMagnifierShape,
    annotations, addAnnotation, restoreAnnotations, duplicateAnnotations, undoAnnotation, redoAnnotation,
    deleteAnnotations, beginDrag, moveAnnotations, updateAnnotationColor, updateNumberValue, updateText, updateStrokeWidth, updateOpacity,
    mutateAnnotations, bringToFront, sendToBack,
    resizeAnnotation, resizeEndpoint, resizeThickness, resizeMarker, resizeMagnifierBox, moveMagnifierBox, resizeBend, resizeTail, setArrowConnection, rotateAnnotation, applyCrop,
    annotationHistory, redoStack,
    nextNumber,
    selectedIds, setSelection, toggleSelection,
    buildClipboardPayload, pasteAnnotations,
    zoom, panX, panY, setZoom, setPan, resetView,
    ocrText, setOcrText, ocrLoading, setOcrLoading,
  } = useStore()

  const canvasHandle = useRef<AnnotationCanvasHandle>(null)
  const { toasts, showToast, dismissToast } = useToast()
  // Timestamp of the last arrow-key nudge: bursts within this window share
  // one undo snapshot, so undo reverts the whole reposition, not 1px per press.
  const lastNudgeRef = useRef(0)
  const [showOcr, setShowOcr] = useState(false)
  // Transient "Copied" badge over the OCR panel — see handleCopyOcr.
  const [ocrCopied, setOcrCopied] = useState(false)
  const ocrCopiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (ocrCopiedTimer.current) clearTimeout(ocrCopiedTimer.current) }, [])
  const [showHelp, setShowHelp] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [copying, setCopying] = useState(false)
  const [pinning, setPinning] = useState(false)
  const [confirmDeleteImage, setConfirmDeleteImage] = useState(false)
  const [showPinConfirm, setShowPinConfirm] = useState(false)

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
    // Adopt as the shared default too (same reasoning as handleOpacity below).
    setFontSize(size)
    if (uniformType === 'text') {
      mutateAnnotations(selectedIds, (a) => (a.type === 'text' ? { ...a, fontSize: size } : a))
    }
  }, [uniformType, selectedIds, mutateAnnotations, setFontSize])

  const handleStrokeWidth = useCallback((w: number) => {
    // Adopt as the shared default too (same reasoning as handleOpacity below).
    setStrokeWidth(w)
    if (selectedIds.length > 0) updateStrokeWidth(selectedIds, w)
  }, [selectedIds, updateStrokeWidth, setStrokeWidth])

  const handleOpacity = useCallback((o: number) => {
    // Adopt the value as the shared default even while editing a selection —
    // otherwise the default is left behind and the slider appears to "reset"
    // (to the stale default) the moment the selection clears, e.g. on a tool
    // switch right after drawing (new annotations stay selected).
    setActiveOpacity(o)
    if (selectedIds.length > 0) updateOpacity(selectedIds, o)
  }, [selectedIds, updateOpacity, setActiveOpacity])

  const handleNumberShape = useCallback((shape: 'circle' | 'square') => {
    setNumberShape(shape)
    if (uniformType === 'number') {
      mutateAnnotations(selectedIds, (a) => (a.type === 'number' ? { ...a, shape } : a))
    }
  }, [uniformType, selectedIds, mutateAnnotations, setNumberShape])

  const handleNumberRadius = useCallback((r: number) => {
    // Adopt as the shared default too (same reasoning as handleOpacity).
    setNumberRadius(r)
    if (uniformType === 'number') {
      mutateAnnotations(selectedIds, (a) => (a.type === 'number' ? { ...a, r } : a))
    }
  }, [uniformType, selectedIds, mutateAnnotations, setNumberRadius])

  const handleArrowHead = useCallback((head: ArrowHead) => {
    setArrowHead(head)
    if (uniformType === 'arrow') {
      mutateAnnotations(selectedIds, (a) => (a.type === 'arrow' ? { ...a, head } : a))
    }
  }, [uniformType, selectedIds, mutateAnnotations, setArrowHead])

  const handleDoubleEndedArrow = useCallback((doubleEnded: boolean) => {
    setDoubleEndedArrow(doubleEnded)
    if (uniformType === 'arrow') {
      mutateAnnotations(selectedIds, (a) => (a.type === 'arrow' ? { ...a, doubleEnded } : a))
    }
  }, [uniformType, selectedIds, mutateAnnotations, setDoubleEndedArrow])

  const handleArrowStyle = useCallback((style: 'straight' | 'elbow') => {
    setArrowStyle(style)
    if (uniformType === 'arrow') {
      mutateAnnotations(selectedIds, (a) => (a.type === 'arrow' ? { ...a, style } : a))
    }
  }, [uniformType, selectedIds, mutateAnnotations, setArrowStyle])

  const handleTextShape = useCallback((shape: TextShape) => {
    setTextShape(shape)
    if (uniformType === 'text') {
      mutateAnnotations(selectedIds, (a) => (a.type === 'text' ? { ...a, shape } : a))
    }
  }, [uniformType, selectedIds, mutateAnnotations, setTextShape])

  const handleTextAlign = useCallback((align: 'left' | 'center' | 'right') => {
    setTextAlign(align)
    if (uniformType === 'text') {
      mutateAnnotations(selectedIds, (a) => (a.type === 'text' ? { ...a, align } : a))
    }
  }, [uniformType, selectedIds, mutateAnnotations, setTextAlign])

  const handleTailAnchor = useCallback((tailAnchor: BubbleTailAnchor) => {
    setTailAnchor(tailAnchor)
    if (uniformType === 'text') {
      mutateAnnotations(selectedIds, (a) => (a.type === 'text' ? { ...a, tailAnchor } : a))
    }
  }, [uniformType, selectedIds, mutateAnnotations, setTailAnchor])

  const handleFillMode = useCallback((mode: FillMode) => {
    // Adopt as the shared default too (same reasoning as handleOpacity below).
    setFillMode(mode)
    if (uniformType === 'rect' || uniformType === 'ellipse') {
      mutateAnnotations(selectedIds, (a) =>
        a.type === 'rect' || a.type === 'ellipse' ? { ...a, fill: mode } : a,
      )
    }
  }, [uniformType, selectedIds, mutateAnnotations, setFillMode])

  const handleBlurStrength = useCallback((strength: number) => {
    setBlurStrength(strength)
    if (uniformType === 'blur') {
      mutateAnnotations(selectedIds, (a) => (a.type === 'blur' ? { ...a, strength } : a))
    }
  }, [uniformType, selectedIds, mutateAnnotations, setBlurStrength])

  const handleSpotlightDim = useCallback((dim: number) => {
    setSpotlightDim(dim)
    if (uniformType === 'spotlight') {
      mutateAnnotations(selectedIds, (a) => (a.type === 'spotlight' ? { ...a, dim } : a))
    }
  }, [uniformType, selectedIds, mutateAnnotations, setSpotlightDim])

  const handleSpotlightShape = useCallback((shape: 'circle' | 'square') => {
    setSpotlightShape(shape)
    if (uniformType === 'spotlight') {
      mutateAnnotations(selectedIds, (a) => (a.type === 'spotlight' ? { ...a, shape } : a))
    }
  }, [uniformType, selectedIds, mutateAnnotations, setSpotlightShape])

  const handleMagnifierShape = useCallback((shape: 'circle' | 'square') => {
    setMagnifierShape(shape)
    if (uniformType === 'magnifier') {
      mutateAnnotations(selectedIds, (a) => (a.type === 'magnifier' ? { ...a, shape } : a))
    }
  }, [uniformType, selectedIds, mutateAnnotations, setMagnifierShape])

  // Blob object URL of the currently displayed image, revoked on replacement.
  const imageUrlRef = useRef<string | null>(null)
  // Whether the on-disk sidecar's `orig.png` already matches the current base
  // image — true right after loading a capture whose sidecar we just restored
  // from (that orig is what we loaded), false for a fresh capture (no sidecar
  // yet) or right after a crop (the base image changed). Lets handleSave skip
  // resending the (potentially large) original on every save.
  const origStashedRef = useRef(false)

  // Fetch this window's document (raw PNG bytes over binary IPC), its on-disk
  // path, and any annotation sidecar from Rust. Runs on mount; the backend keys
  // all three on this window's own label, so an editor keeps the capture it was
  // opened on no matter how many captures happen afterwards.
  // A sidecar (re-editable capture reopened from the gallery) means the
  // fetched bytes are the pristine original, not flattened pixels — its
  // annotations are restored into the store right after the image loads.
  const loadPendingImage = useCallback(() => {
    Promise.all([ipc.getPendingImage(), ipc.getPendingPath(), ipc.getPendingAnnotations()])
      .then(([buf, path, annotationsJson]) => {
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
          if (annotationsJson) {
            try {
              const sidecar = JSON.parse(annotationsJson) as {
                version: number
                annotations: Annotation[]
                nextNumber: number
              }
              // A `frame` field from a sidecar written before the rounded-corner
              // feature was dropped is simply ignored.
              restoreAnnotations(sidecar.annotations, sidecar.nextNumber)
              origStashedRef.current = true
            } catch (e) {
              console.error('[sidecar] parse failed', e)
              origStashedRef.current = false
            }
          } else {
            origStashedRef.current = false
          }
        }
        img.onerror = () => URL.revokeObjectURL(url)
        img.src = url
      })
      .catch(console.error)
  }, [setCapturedImage, restoreAnnotations])

  useEffect(() => { loadPendingImage() }, [loadPendingImage])

  // Name this window after the file it's editing. With several editors open at
  // once (each capture gets its own — see `window::open_editor`) the taskbar and
  // Alt+Tab are the only places they're distinguishable, and they'd otherwise
  // all read "Clipse". Untitled until the first save for an unsaved capture.
  useEffect(() => {
    const title = savedName ? `${savedName} — Clipse` : 'Clipse'
    getCurrentWebviewWindow().setTitle(title).catch(() => {})
  }, [savedName])

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

  // Copy the selected elements onto the backend's annotation clipboard, so they
  // can be pasted into this editor or any other open one. A toast confirms it:
  // unlike an in-window duplicate, nothing on screen changes, and the whole
  // point is that the paste may happen in a different window.
  const copySelection = useCallback(async (ids: string[]) => {
    const payload = buildClipboardPayload(ids)
    if (!payload) return
    try {
      await ipc.setAnnotationClipboard(JSON.stringify(payload))
      const n = payload.annotations.length
      showToast(`${n} element${n === 1 ? '' : 's'} copied`)
    } catch (e) {
      showToast(String(e), 'err')
    }
  }, [buildClipboardPayload, showToast])

  const pasteFromClipboard = useCallback(async () => {
    try {
      const entry = await ipc.getAnnotationClipboard()
      if (!entry) return
      const payload = JSON.parse(entry.json) as AnnotationClipboardPayload
      // A payload written by a newer build may hold annotation shapes this one
      // can't render — skip it rather than pasting something broken.
      if (payload.version !== ANNOTATION_CLIPBOARD_VERSION) {
        showToast('Clipboard content is not supported', 'err')
        return
      }
      pasteAnnotations(payload, entry.seq)
    } catch (e) {
      showToast(String(e), 'err')
    }
  }, [pasteAnnotations, showToast])

  // PrintScreen must keep working while this window is focused — see the hook.
  const reportCaptureError = useCallback(
    (message: string) => showToast(message, 'err'),
    [showToast],
  )
  usePrintScreenKey('editor', reportCaptureError)

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey
      const typing = isTextEntry(e.target)

      // Shortcuts match on e.code (physical key): with the Japanese IME
      // active e.key reports 'Process', and CapsLock changes the letter case.
      // Undo/redo fall through to the browser while a text field has focus, so
      // typing in the OCR panel (or an annotation's text) is undone a keystroke
      // at a time instead of throwing away the last annotation.
      if (ctrl && !e.shiftKey && e.code === 'KeyZ') {
        if (!typing) { e.preventDefault(); undoAnnotation() }
        return
      }
      if (ctrl && (e.code === 'KeyY' || (e.shiftKey && e.code === 'KeyZ'))) {
        if (!typing) { e.preventDefault(); redoAnnotation() }
        return
      }
      // Ctrl+Shift+C copies the file path — the binding Windows Explorer uses
      // for exactly this — leaving plain Ctrl+C to copy the image. Tested
      // before the Ctrl+C branch below, which doesn't look at Shift and would
      // otherwise swallow it.
      if (ctrl && e.shiftKey && e.code === 'KeyC') {
        if (!typing) { e.preventDefault(); handleCopyPath() }
        return
      }
      // Ctrl+Shift+O runs OCR on the image, same as the OCR button.
      if (ctrl && e.shiftKey && e.code === 'KeyO') {
        if (!typing) { e.preventDefault(); void handleOcr() }
        return
      }
      // Ctrl+P opens the pin confirm, exactly as the Pin button does — pinning
      // closes this editor, so it never happens on a single keystroke. Enter
      // and Escape then answer the popup (handled further down). Same key as
      // the gallery's pin shortcut.
      if (ctrl && e.code === 'KeyP') {
        if (!typing && capturedImage && !pinning) { e.preventDefault(); handlePinClick() }
        return
      }
      if (ctrl && e.code === 'KeyC') {
        // In a text field this is a plain text copy — falling through to
        // handleCopy() would put the whole image on the clipboard instead of
        // the OCR text the user just selected.
        if (typing) return
        // With elements selected, copy those; otherwise copy the whole image.
        if (selectedIds.length > 0) { e.preventDefault(); void copySelection(selectedIds) }
        else void handleCopy()
        return
      }
      if (ctrl && e.code === 'KeyV') {
        if (!typing) { e.preventDefault(); void pasteFromClipboard() }
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
      if (e.key === 'Enter' && showPinConfirm) { e.preventDefault(); void handleConfirmPin(); return }
      if (e.key === 'Escape' && showPinConfirm) { e.preventDefault(); setShowPinConfirm(false); return }

      if (e.key === 'Escape') {
        // Escape cascades outward and only closes the window once there is
        // nothing left to cancel — the same shape the gallery uses. The two
        // confirms above already took their turn.
        //
        // `defaultPrevented` is how the canvas's own Escape handling is
        // detected (a pending crop rect, an in-progress drag, a live
        // selection): it marks every branch it consumes, and this listener is
        // registered without a dependency array, so it is re-added on each
        // render and ends up last in the window's keydown chain.
        if (showHelp) return          // HelpModal closes itself on Escape
        if (typing) return            // the text/number editor cancels its own
        if (e.defaultPrevented) return
        // Belt and braces: this one is knowable here, so it doesn't have to
        // rest on the listener ordering above.
        if (selectedIds.length > 0) return
        if (activeTool === 'crop') {
          // In crop mode with no rect drawn yet. Leaving the mode is the
          // expected escape, not throwing away the whole document.
          e.preventDefault()
          setActiveTool('select')
          return
        }
        e.preventDefault()
        getCurrentWebviewWindow().close()
        return
      }

      // `?` opens the shortcut list — the Help button has advertised this key
      // in its tooltip all along without anything implementing it. Matched on
      // the character as well as Shift+Slash, so it works on layouts that put
      // `?` elsewhere.
      if (!ctrl && !typing && (e.key === '?' || (e.shiftKey && e.code === 'Slash'))) {
        e.preventDefault()
        setShowHelp((v) => !v)
        return
      }

      if (!ctrl && !e.altKey && !typing) {
        // Tools are bound to Space + F1–F11 (see FKEY_TO_TOOL / the toolbar labels).
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

  // Pinning hands the image off to its own floating window and closes this
  // editor — closing outright would silently drop any unsaved annotation
  // edits, so the button only opens a confirm popup; the actual work runs
  // in handleConfirmPin below once the user clicks OK.
  const handlePinClick = useCallback(() => {
    if (pinning) return
    setShowPinConfirm(true)
  }, [pinning])

  const handleConfirmPin = useCallback(async () => {
    if (pinning) return
    setPinning(true)
    try {
      // Same export precedence as handleCopy: the current (possibly
      // annotated) canvas state first, falling back to the untouched
      // original if the canvas isn't mounted for some reason.
      const blob = (await canvasHandle.current?.exportBlob()) ?? null
      if (blob) {
        await ipc.pinImageBytes(new Uint8Array(await blob.arrayBuffer()))
      } else if (capturedImage?.pngBytes) {
        await ipc.pinImageBytes(capturedImage.pngBytes)
      } else {
        setShowPinConfirm(false)
        return
      }
      getCurrentWebviewWindow().close()
    } catch {
      setShowPinConfirm(false)
      showToast('Pin failed', 'err')
    } finally {
      setPinning(false)
    }
  }, [pinning, capturedImage, showToast])

  const handleSave = useCallback(async () => {
    const b64 = getAnnotatedB64() ?? (await getOriginalB64())
    if (!b64) return
    try {
      if (capturedImage?.savedPath) {
        const savedPath = capturedImage.savedPath
        await ipc.overwriteImage(savedPath, b64)
        // Keep the re-editable sidecar in sync with the flattened file: write
        // it when there's something to restore, drop it when the user has
        // cleared every annotation (otherwise a later reopen would resurrect
        // annotations they already removed).
        if (annotations.length > 0) {
          const needsOrig = !origStashedRef.current
          const origB64 = needsOrig ? await getOriginalB64() : null
          if (!needsOrig || origB64) {
            const sidecarJson = JSON.stringify({ version: 1, annotations, nextNumber })
            await ipc.saveSidecar(savedPath, sidecarJson, origB64 ?? undefined)
            if (origB64) origStashedRef.current = true
          }
        } else {
          await ipc.deleteSidecar(savedPath).catch(() => {})
        }
      } else {
        await ipc.saveImage(b64)
      }
      showToast('Saved')
    } catch {
      showToast('Save failed', 'err')
    }
  }, [getAnnotatedB64, getOriginalB64, capturedImage, annotations, nextNumber, showToast])

  // Crop replaces the base image, so any already-stashed sidecar original no
  // longer matches — the next sidecar save must resend it.
  const handleApplyCrop = useCallback(
    (dataUrl: string, width: number, height: number, dx: number, dy: number) => {
      origStashedRef.current = false
      applyCrop(dataUrl, width, height, dx, dy)
    },
    [applyCrop],
  )

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

  // Awaited, unlike handleCopyPath's fire-and-forget: this is the only
  // confirmation that the click did anything, so it must not claim success for
  // a write that failed.
  //
  // Confirmed inside the OCR panel rather than with the editor's usual toast:
  // the button sits at the far right of a 1100px window, and a badge in the
  // middle of the canvas reads as unrelated to what was just clicked. Failures
  // still take the toast — an error message doesn't fit a 260px badge.
  const handleCopyOcr = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(ocrText)
      setOcrCopied(true)
      if (ocrCopiedTimer.current) clearTimeout(ocrCopiedTimer.current)
      ocrCopiedTimer.current = setTimeout(() => setOcrCopied(false), 1400)
    } catch (e) {
      showToast(String(e), 'err')
    }
  }, [ocrText, showToast])

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
            title="Copy file path (Ctrl+Shift+C)"
          >
            <Link2 size={13} strokeWidth={1.5} />
            Path
          </button>
          <button
            className={styles.actionBtn}
            onClick={handlePinClick}
            disabled={!capturedImage || pinning}
            title="Pin to screen (Ctrl+P) — always-on-top floating copy, then close this editor"
          >
            {pinning ? (
              <Loader2 size={13} strokeWidth={1.5} style={{ animation: 'spin 1s linear infinite' }} />
            ) : (
              <PinIcon size={13} strokeWidth={1.5} />
            )}
            Pin
          </button>
          <button
            className={`${styles.actionBtn} ${showOcr ? styles.actionBtnActive : ''}`}
            onClick={handleOcr}
            disabled={!capturedImage}
            title="Extract text from the image (Ctrl+Shift+O)"
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
            title="Close (Esc)"
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

      {/* ── Pin confirmation popup ── */}
      {showPinConfirm && (
        <div className={styles.pinConfirmBackdrop} onPointerDown={() => setShowPinConfirm(false)}>
          <div className={styles.pinConfirmModal} onPointerDown={(e) => e.stopPropagation()}>
            <PinIcon size={20} strokeWidth={1.5} style={{ color: 'var(--color-accent)' }} />
            <span className={styles.pinConfirmText}>
              Pin this image to the screen and close the editor?
            </span>
            <div className={styles.pinConfirmActions}>
              <button
                className={`${styles.iconBtn} ${styles.iconBtnCancel}`}
                onClick={() => setShowPinConfirm(false)}
                title="Cancel (Esc)"
                disabled={pinning}
              >
                <X size={12} strokeWidth={2} />
                <span>Cancel</span>
              </button>
              <button
                className={`${styles.iconBtn} ${styles.iconBtnConfirmClose}`}
                onClick={handleConfirmPin}
                title="Pin and close (Enter)"
                disabled={pinning}
              >
                {pinning ? (
                  <Loader2 size={12} strokeWidth={1.5} style={{ animation: 'spin 1s linear infinite' }} />
                ) : (
                  <PinIcon size={12} strokeWidth={1.5} />
                )}
                <span>OK</span>
              </button>
            </div>
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
        numberRadius={uniformType === 'number' && firstSelected?.type === 'number' ? firstSelected.r : numberRadius}
        arrowHead={uniformType === 'arrow' && firstSelected?.type === 'arrow' ? firstSelected.head : arrowHead}
        doubleEndedArrow={uniformType === 'arrow' && firstSelected?.type === 'arrow' ? firstSelected.doubleEnded ?? false : doubleEndedArrow}
        arrowStyle={uniformType === 'arrow' && firstSelected?.type === 'arrow' ? firstSelected.style ?? 'straight' : arrowStyle}
        textShape={uniformType === 'text' && firstSelected?.type === 'text' ? firstSelected.shape : textShape}
        tailAnchor={uniformType === 'text' && firstSelected?.type === 'text' ? firstSelected.tailAnchor ?? 's3' : tailAnchor}
        textAlign={uniformType === 'text' && firstSelected?.type === 'text' ? firstSelected.align ?? 'left' : textAlign}
        blurStrength={uniformType === 'blur' && firstSelected?.type === 'blur' ? blurStrengthPct(firstSelected.strength) : blurStrength}
        spotlightDim={uniformType === 'spotlight' && firstSelected?.type === 'spotlight' ? firstSelected.dim ?? 0.55 : spotlightDim}
        spotlightShape={uniformType === 'spotlight' && firstSelected?.type === 'spotlight' ? firstSelected.shape ?? 'square' : spotlightShape}
        magnifierShape={uniformType === 'magnifier' && firstSelected?.type === 'magnifier' ? firstSelected.shape ?? 'square' : magnifierShape}
        selectedAnnotationType={uniformType}
        onTool={setActiveTool}
        onColor={handleColor}
        onStrokeWidth={handleStrokeWidth}
        onOpacity={handleOpacity}
        onFontSize={handleFontSize}
        onFillMode={handleFillMode}
        onNumberShape={handleNumberShape}
        onNumberRadius={handleNumberRadius}
        onArrowHead={handleArrowHead}
        onDoubleEndedArrow={handleDoubleEndedArrow}
        onArrowStyle={handleArrowStyle}
        onTextShape={handleTextShape}
        onTailAnchor={handleTailAnchor}
        onTextAlign={handleTextAlign}
        onBlurStrength={handleBlurStrength}
        onSpotlightDim={handleSpotlightDim}
        onSpotlightShape={handleSpotlightShape}
        onMagnifierShape={handleMagnifierShape}
        onUndo={undoAnnotation}
        onRedo={redoAnnotation}
        onDeleteSelection={() => deleteAnnotations(selectedIds)}
        canUndo={annotationHistory.length > 0}
        canRedo={redoStack.length > 0}
        canDelete={selectedIds.length > 0}
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
              numberRadius={numberRadius}
              arrowHead={arrowHead}
              doubleEndedArrow={doubleEndedArrow}
              arrowStyle={arrowStyle}
              textShape={textShape}
              tailAnchor={tailAnchor}
              textAlign={textAlign}
              blurStrength={blurStrength}
              spotlightDim={spotlightDim}
              spotlightShape={spotlightShape}
              magnifierZoom={magnifierZoom}
              magnifierShape={magnifierShape}
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
              onResizeMarker={resizeMarker}
              onResizeMagnifierBox={resizeMagnifierBox}
              onMoveMagnifierBox={moveMagnifierBox}
              onResizeBend={resizeBend}
              onResizeTail={resizeTail}
              onSetArrowConnection={setArrowConnection}
              onRotateAnnotation={rotateAnnotation}
              onUpdateText={updateText}
              onUpdateNumber={updateNumberValue}
              onCancelTransform={undoAnnotation}
              onDuplicateSelection={() => duplicateAnnotations(selectedIds)}
              onBringToFront={() => bringToFront(selectedIds)}
              onSendToBack={() => sendToBack(selectedIds)}
              onDeleteSelection={() => deleteAnnotations(selectedIds)}
              onApplyCrop={handleApplyCrop}
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
                <Loader2
                  className={styles.ocrSpinner}
                  size={28}
                  strokeWidth={2}
                  style={{ animation: 'spin 1s linear infinite' }}
                />
              ) : (
                // Editable: no OCR is perfect, and fixing a misread character
                // here beats pasting the text out and correcting it elsewhere.
                // Copy below sends whatever is in the box, edits included.
                <textarea
                  className={styles.ocrText}
                  value={ocrText}
                  onChange={(e) => setOcrText(e.target.value)}
                  placeholder="Run OCR to extract text"
                  spellCheck={false}
                />
              )}
            </div>
            {ocrText && !ocrLoading && (
              <button
                className={styles.ocrCopyBtn}
                onClick={() => void handleCopyOcr()}
                title="Copy text"
              >
                <Copy size={12} strokeWidth={1.5} />
              </button>
            )}
            {ocrCopied && (
              <div className={styles.ocrCopied}>
                <Check size={12} strokeWidth={2.5} />
                <span>Copied</span>
              </div>
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
