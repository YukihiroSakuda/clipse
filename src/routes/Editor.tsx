import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, ClipboardPaste, Copy, HelpCircle, Link2, Loader2, Maximize2, Minimize2, Minus, Pencil, Pin as PinIcon, Redo2, RotateCcw, RotateCw, Save, SaveOff, ScanText, Trash2, TriangleAlert, Undo2, X } from 'lucide-react'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { ipc, OCR_CONSENT_REQUIRED } from '../lib/ipc'
import { t, Lang } from '../lib/i18n'
import { usePrintScreenKey } from '../lib/usePrintScreenKey'
import { ANNOTATION_CLIPBOARD_VERSION, useStore } from '../lib/store'
import type { AnnotationClipboardPayload, CapturedImage } from '../lib/store'
import { decodeEmbeddedImages, resolveTextColors, SHADOW_CAPABLE, loadEmbeddedImage, makeId } from '../lib/annotations'
import type { Annotation, EraseAnn, ImageAnn, TextBgFill } from '../lib/annotations'
import AnnotationCanvas from '../components/AnnotationCanvas'
import type { AnnotationCanvasHandle } from '../components/AnnotationCanvas'
import Toolbar, { FKEY_TO_TOOL } from '../components/Toolbar'
import ToolOptionsPanel from '../components/ToolOptionsPanel'
import { useToast, ToastContainer } from '../components/Toast'
import HelpModal from '../components/HelpModal'
import styles from './Editor.module.css'

/** A pasted picture is scaled to at most this fraction of the capture on
 *  either axis — see pasteImageFromClipboard. */
const PASTED_IMAGE_MAX_FRACTION = 0.6
/** Image px each repeat paste of the same picture steps down-right. */
const PASTED_IMAGE_CASCADE = 24

/** The document as it exists on disk — what "unsaved changes" is measured
 *  against. See `savedDocRef` in the editor. */
type SavedDoc = { annotations: Annotation[]; image: CapturedImage | null }

export default function Editor() {
  const {
    capturedImage, setCapturedImage, setSavedPath,
    activeTool, setActiveTool,
    activeColor, setActiveColor, addRecentColor,
    strokeWidth, setStrokeWidth,
    activeOpacity, setActiveOpacity,
    fontSize,
    fillMode,
    lineDash,
    rectRadius,
    numberShape,
    numberRadius,
    arrowHead,
    doubleEndedArrow,
    arrowStyle,
    textShape,
    textBgFill, setTextBgFill,
    textBgAuto, setTextBgAuto,
    textAlign,
    tailAnchor,
    blurStrength,
    eraseTolerance, setEraseTolerance,
    eraseEffect, setEraseEffect,
    eraseFillColor, setEraseFillColor,
    spotlightDim,
    spotlightShape,
    magnifierZoom, magnifierShape,
    imageBorder,
    shadowStyle, setShadowStyle,
    shadowAngle, setShadowAngle,
    shadowSize, setShadowSize,
    shadowBlur, setShadowBlur,
    shadowOpacity, setShadowOpacity,
    shadowColor, setShadowColor,
    annotations, addAnnotation, addPastedImage, restoreAnnotations, duplicateAnnotations, undoAnnotation, redoAnnotation,
    deleteAnnotations, beginDrag, moveAnnotations, updateAnnotationColor, updateAnnotationShadowStyle, updateNumberValue, updateText, updateStrokeWidth, updateOpacity,
    mutateAnnotations, mutateAnnotationsLive, bringToFront, sendToBack,
    resizeAnnotation, resizeEndpoint, resizeThickness, resizeMarker, resizeMagnifierBox, moveMagnifierBox, resizeBend, resizeTail, setArrowConnection, rotateAnnotation, applyCrop, rotateImage,
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
  // Same coalescing for the continuous option sliders (stroke width, opacity,
  // font size, marker size, blur strength): each onChange tick — whether from
  // a mouse drag or a held arrow key on a focused <input type="range"> —
  // shares one undo snapshot with the rest of its burst, instead of every
  // tick pushing its own (which made a single slider drag take dozens of
  // Ctrl+Z to undo).
  const lastSliderAdjustRef = useRef(0)
  const beginSliderAdjust = useCallback(() => {
    const now = Date.now()
    if (now - lastSliderAdjustRef.current > 800) beginDrag()
    lastSliderAdjustRef.current = now
  }, [beginDrag])
  // Guards handleEraseTolerance's pre-decode against out-of-order resolution
  // — a rapid drag fires many ticks, and nothing guarantees an earlier
  // tick's mask decode settles before a later one's.
  const eraseToleranceReqRef = useRef(0)
  const [showOcr, setShowOcr] = useState(false)
  // OCR is the one feature that sends capture content off the machine, so it is
  // gated on an explicit agreement the backend enforces (`run_ocr` refuses with
  // OCR_CONSENT_REQUIRED until then). Asked here rather than in Settings
  // because this is the moment the user actually wants it.
  const [showOcrConsent, setShowOcrConsent] = useState(false)
  const langRef = useRef<Lang>('en')
  useEffect(() => {
    ipc.getSettings()
      .then(s => { langRef.current = s?.language === 'ja' ? 'ja' : 'en' })
      .catch(() => {})
  }, [])
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

  // Mirrors the OS-level maximized state so the header button's icon/title
  // reflect it — checked once on mount and then kept in sync via the
  // window's own resize event, since maximizing/restoring isn't only ever
  // triggered from this button (Windows' own snap/dblclick-titlebar
  // gestures, a saved window-state restore, …). `mounted` guards the
  // initial async `isMaximized()` read landing after unmount (e.g. the
  // window closes while it's still in flight).
  const [isMaximized, setIsMaximized] = useState(false)
  useEffect(() => {
    let mounted = true
    const win = getCurrentWebviewWindow()
    win.isMaximized().then((m) => { if (mounted) setIsMaximized(m) })
    const unlisten = win.onResized(() => {
      win.isMaximized().then((m) => { if (mounted) setIsMaximized(m) })
    })
    return () => {
      mounted = false
      unlisten.then((f) => f())
    }
  }, [])
  const handleToggleMaximize = useCallback(() => {
    getCurrentWebviewWindow().toggleMaximize()
  }, [])

  const savedPath = capturedImage?.savedPath ?? ''
  const savedName = savedPath ? savedPath.replace(/.*[\\/]/, '') : ''
  const savedExt = savedName.match(/\.[^.]+$/)?.[0] ?? ''

  // ── Unsaved changes ──
  // `savedDocRef` is the document as it last existed on disk: set when the
  // capture is loaded, and again after every successful save. Every store
  // action that edits the document replaces the annotations array, and a crop
  // replaces the base image, so reference equality answers "is this dirty?"
  // without re-stringifying annotations — which carry pasted pictures inline —
  // on every render. Undo pushes the *same* array reference onto its history
  // stack, so undoing back to the saved state compares equal again and the
  // editor goes clean instead of staying dirty for the rest of the session.
  const savedDocRef = useRef<SavedDoc>({
    annotations: useStore.getState().annotations,
    image: useStore.getState().capturedImage,
  })
  const [dirty, setDirty] = useState(false)
  // The close handler below is registered once — re-registering it is an async
  // round trip a close request could slip past — so it reads the flag through
  // a ref rather than through the state it renders from.
  const dirtyRef = useRef(false)
  useEffect(() => {
    const base = savedDocRef.current
    const value = annotations !== base.annotations || capturedImage !== base.image
    dirtyRef.current = value
    setDirty(value)
  }, [annotations, capturedImage])

  // Records `doc` as what is now on disk. The caller passes the snapshot it
  // actually wrote — handleSave's export and IPC are asynchronous, and marking
  // whatever the store holds when they finish would silently swallow an edit
  // made while the save was in flight.
  const markDocumentSaved = useCallback((doc: SavedDoc) => {
    savedDocRef.current = doc
    const current = useStore.getState()
    const value = current.annotations !== doc.annotations || current.capturedImage !== doc.image
    dirtyRef.current = value
    setDirty(value)
  }, [])

  // Every way this window can go away — the X button, Escape, Alt+F4, the
  // taskbar's Close — arrives as one close request, so the unsaved-changes
  // confirm is registered once on the window instead of on each of those
  // paths. `forceCloseRef` is how the paths that have already asked (the
  // confirm itself, Pin, Delete) get through without asking twice.
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  const [savingBeforeClose, setSavingBeforeClose] = useState(false)
  const forceCloseRef = useRef(false)
  // Which of the close confirm's three buttons (0 Cancel, 1 Don't Save, 2
  // Save) Left/Right currently has selected — see the keydown handler below.
  // Starts on Save so a bare Enter keeps behaving like it did before this
  // existed, matching the default button in a native "unsaved changes" dialog.
  const [closeConfirmFocus, setCloseConfirmFocus] = useState<0 | 1 | 2>(2)
  useEffect(() => { if (showCloseConfirm) setCloseConfirmFocus(2) }, [showCloseConfirm])

  useEffect(() => {
    let unlisten: (() => void) | null = null
    let disposed = false
    getCurrentWebviewWindow()
      .onCloseRequested((event) => {
        if (forceCloseRef.current || !dirtyRef.current) return
        event.preventDefault()
        setShowCloseConfirm(true)
      })
      .then((fn) => {
        if (disposed) fn()
        else unlisten = fn
      })
      .catch(() => {})
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  const closeWithoutAsking = useCallback(() => {
    forceCloseRef.current = true
    getCurrentWebviewWindow().close()
  }, [])

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
  // Whether the Color swatch is currently editing a 'solid' box/bubble text's
  // Background or its Text — one palette with two roles (see `TextAnn.bgAuto`),
  // which `handlePickColor` below has to route an eyedropper pick through. The
  // panel derives the same condition for what it *shows*; see
  // `toolOptionValues`.
  const isSolidTextSelection = uniformType === 'text' && firstSelected?.type === 'text'
    && (firstSelected.bgFill ?? 'solid') === 'solid'

  const handleColor = useCallback((hex: string) => {
    setActiveColor(hex)
    if (selectedIds.length > 0) updateAnnotationColor(selectedIds, hex)
  }, [selectedIds, setActiveColor, updateAnnotationColor])

  // Text side of the Background/Text toggle: picks an explicit text color
  // and makes Text the active side (Background auto-follows it). Shares
  // `activeColor` with the Background pick below — it's one palette with
  // two roles (see `TextAnn.bgAuto`'s doc comment), not two independently-
  // remembered colors.
  const handleTextColorPick = useCallback((hex: string) => {
    setActiveColor(hex)
    setTextBgAuto(true)
    if (uniformType === 'text') {
      mutateAnnotations(selectedIds, (a) => (a.type === 'text' ? { ...a, textColor: hex, bgAuto: true } : a))
    }
  }, [uniformType, selectedIds, mutateAnnotations, setActiveColor, setTextBgAuto])

  // Background side of the toggle: carries the side being *left* (Text)'s
  // current color over to become the new explicit `color`, then clears
  // `textColor` so Text goes back to auto-contrasting against it — the same
  // color just picked for Text shows up as Background the moment you flip
  // back, rather than Background reverting to some earlier, unrelated pick.
  const handleTextColorAuto = useCallback(() => {
    setTextBgAuto(false)
    if (uniformType === 'text') {
      mutateAnnotations(selectedIds, (a) => (a.type === 'text'
        ? { ...a, color: a.textColor ?? resolveTextColors(a).text, textColor: undefined, bgAuto: false }
        : a))
    }
  }, [uniformType, selectedIds, mutateAnnotations, setTextBgAuto])

  // Text side of the toggle, reached via the swatch's own Auto option
  // rather than a direct pick — carries the side being *left* (Background)'s
  // current color over to become the new explicit `textColor`, same
  // reasoning as `handleTextColorAuto` above, just the other direction.
  const handleBgAuto = useCallback(() => {
    setTextBgAuto(true)
    if (uniformType === 'text') {
      mutateAnnotations(selectedIds, (a) => (a.type === 'text' ? { ...a, bgAuto: true, textColor: a.color } : a))
    }
  }, [uniformType, selectedIds, mutateAnnotations, setTextBgAuto])

  // Last non-picker tool, so a pick can return to whatever the user was doing.
  const prevToolRef = useRef(activeTool !== 'picker' ? activeTool : 'select')
  useEffect(() => {
    if (activeTool !== 'picker') prevToolRef.current = activeTool
  }, [activeTool])

  // Picker tool: adopt the sampled color (recoloring the selection like any
  // palette click), copy its hex, then hop back to the previous tool —
  // picking is a one-shot detour, not a mode to stay in. Routes through
  // whichever of Background/Text Color is currently the explicit one for a
  // 'solid' boxed text selection (same pair the Color swatch itself toggles
  // between — see ToolOptionsPanel's Color block), rather than always
  // landing on Background regardless of which one the panel is showing.
  const handlePickColor = useCallback((hex: string) => {
    if (isSolidTextSelection && firstSelected?.bgAuto) handleTextColorPick(hex)
    else handleColor(hex)
    navigator.clipboard.writeText(hex).catch(() => {})
    showToast(`${hex} copied`)
    setActiveTool(prevToolRef.current)
  }, [handleColor, handleTextColorPick, isSolidTextSelection, firstSelected, showToast, setActiveTool])

  const handleStrokeWidth = useCallback((w: number) => {
    // Adopt as the shared default too (same reasoning as handleOpacity below).
    setStrokeWidth(w)
    if (selectedIds.length > 0) {
      beginSliderAdjust()
      updateStrokeWidth(selectedIds, w)
    }
  }, [selectedIds, updateStrokeWidth, setStrokeWidth, beginSliderAdjust])

  const handleOpacity = useCallback((o: number) => {
    // Adopt the value as the shared default even while editing a selection —
    // otherwise the default is left behind and the slider appears to "reset"
    // (to the stale default) the moment the selection clears, e.g. on a tool
    // switch right after drawing (new annotations stay selected).
    setActiveOpacity(o)
    if (selectedIds.length > 0) {
      beginSliderAdjust()
      updateOpacity(selectedIds, o)
    }
  }, [selectedIds, updateOpacity, setActiveOpacity, beginSliderAdjust])

  const handleTextBgFill = useCallback((fill: TextBgFill) => {
    setTextBgFill(fill)
    if (fill !== 'solid') setTextBgAuto(false)
    if (uniformType === 'text') {
      // Background/Text Color's own Auto options (`bgAuto`/`textColor`)
      // only mean anything for `'solid'` — 'white'/'stroke' already
      // auto-match their border to `color` on their own (see
      // `resolveTextColors`), and a leftover `bgAuto`/`textColor` from
      // having used them while solid would otherwise skew *that* border
      // color instead, since `resolveTextColors`'s `bg` computation doesn't
      // itself check which fill is active.
      mutateAnnotations(selectedIds, (a) => (a.type === 'text'
        ? { ...a, bgFill: fill, ...(fill !== 'solid' ? { bgAuto: false, textColor: undefined } : {}) }
        : a))
    }
  }, [uniformType, selectedIds, mutateAnnotations, setTextBgFill, setTextBgAuto])

  // Unlike blur/spotlight's live sliders, this one only steers the *next*
  // click, and (like blur's strength) re-runs a selected erase annotation's
  // flood fill from its own stored seed point — recomputeErase needs the
  // loaded image, which only the canvas has, so this goes through its
  // imperative handle rather than a plain store field edit.
  const handleEraseTolerance = useCallback((tolerance: number) => {
    setEraseTolerance(tolerance)
    if (uniformType !== 'erase') return
    beginSliderAdjust()
    // recomputeErase's mask is a brand-new `data:` URL every tick, and
    // `drawAnnotation` can't draw an erase annotation whose mask hasn't
    // finished decoding yet (getEmbeddedImage returns null mid-decode) —
    // swapping it into the store immediately left a one-frame gap with no
    // hole drawn at all, flashing the erased area back to fully opaque
    // while dragging. Pre-decode each new mask before it ever reaches the
    // store, so the previous (already-decoded) mask keeps rendering right
    // up until its replacement is actually ready to paint.
    // A `compound` selection (an old document's — the Shift/Alt-click
    // combine that produced them has since been removed, see EraseAnn.
    // compound's own doc comment) is no longer a pure function of seedX/
    // seedY/tolerance, so re-deriving it here would silently throw the
    // combine away — skip it and leave its mask exactly as it already is.
    const targets = selectedAnnotations.filter((a): a is EraseAnn => a.type === 'erase' && !a.compound)
    const computed = targets.map((a) => ({
      id: a.id,
      region: canvasHandle.current?.recomputeErase(a.seedX, a.seedY, tolerance) ?? null,
    }))
    const reqId = ++eraseToleranceReqRef.current
    Promise.all(computed.map(({ region }) => (region ? loadEmbeddedImage(region.mask) : null))).then(() => {
      if (eraseToleranceReqRef.current !== reqId) return  // a later drag tick already superseded this one
      const byId = new Map(computed.map((c) => [c.id, c.region]))
      mutateAnnotationsLive(selectedIds, (a) => {
        if (a.type !== 'erase') return a
        const region = byId.get(a.id)
        return region ? { ...a, ...region, tolerance } : a
      })
    })
  }, [uniformType, selectedIds, selectedAnnotations, mutateAnnotationsLive, setEraseTolerance, beginSliderAdjust])

  // Effect mode (erase/fill — see EraseAnn.effect) never
  // touches the mask itself, only how it's painted, so unlike tolerance/
  // pick-mode this is a plain field edit — no imperative-handle round trip,
  // no compound guard needed.
  // The type stays wide (matching EraseAnn.effect) so an old document's
  // blur/pixelate value still round-trips correctly — but nothing in the
  // UI can ever *set* either anymore (the Effect toggle only offers these
  // two buttons now; see ToolOptionsPanel).
  const handleEraseEffect = useCallback((effect: 'erase' | 'fill' | 'blur' | 'pixelate') => {
    setEraseEffect(effect)
    // Fill's opacity is the normal "how opaque the ink looks" direction, so
    // switching to it snaps to 100% — left at whatever opacity the last
    // tool set, the switch could silently look like it did nothing (a
    // near-invisible fill at low opacity). Erase itself no longer reads
    // opacity at all (see the 'erase' case in drawAnnotationInner — always
    // a full punch now), so there's nothing to force for it.
    // 'blur'/'pixelate' are legacy and unreachable from this component's
    // own buttons, so they're left alone (forcedOpacity stays null).
    const forcedOpacity = effect === 'fill' ? 1 : null
    if (forcedOpacity !== null) setActiveOpacity(forcedOpacity)
    if (uniformType === 'erase') {
      mutateAnnotations(selectedIds, (a) => (
        a.type === 'erase' ? { ...a, effect, ...(forcedOpacity !== null ? { opacity: forcedOpacity } : {}) } : a
      ))
    }
  }, [uniformType, selectedIds, mutateAnnotations, setEraseEffect, setActiveOpacity])

  // EraseAnn.color already means "the sampled seed color", not an ink
  // choice, so fill color is a separate field with its own shared default
  // (eraseFillColor) — same "adopt as default" pattern as every other
  // tool's own option (handleEraseEffect, and every entry in TOOL_OPTIONS).
  // Without
  // this it fell back to `activeColor` while nothing was selected, which
  // could be any unrelated shade the user last drew with — picking a fill
  // color then looked like it kept reverting to that shade instead of
  // taking the pick. Still feeds the shared `recentColors` list (see
  // addRecentColor's doc comment) so a custom color picked here shows up in
  // the main Color swatch and Shadow Color too, instead of each keeping its
  // own history.
  const handleEraseFillColor = useCallback((hex: string) => {
    addRecentColor(hex)
    setEraseFillColor(hex)
    if (uniformType === 'erase') {
      mutateAnnotations(selectedIds, (a) => (a.type === 'erase' ? { ...a, fillColor: hex } : a))
    }
  }, [uniformType, selectedIds, mutateAnnotations, addRecentColor, setEraseFillColor])

  const handleShadowStyle = useCallback((style: 'none' | 'drop' | 'glow' | 'outline') => {
    setShadowStyle(style)
    if (selectedIds.length > 0) updateAnnotationShadowStyle(selectedIds, style)
  }, [selectedIds, updateAnnotationShadowStyle, setShadowStyle])

  const handleShadowColor = useCallback((hex: string | null) => {
    // See addRecentColor's doc comment — `null` (Auto) has no hex to add.
    if (hex) addRecentColor(hex)
    setShadowColor(hex)
    if (selectedIds.length > 0) {
      mutateAnnotations(selectedIds, (a) => (SHADOW_CAPABLE.has(a.type) ? { ...a, shadowColor: hex ?? undefined } : a))
    }
  }, [selectedIds, mutateAnnotations, setShadowColor, addRecentColor])

  // A ToolOptionsPanel preset button (see SHADOW_PRESETS) — sets every
  // shadow field at once, both the shared defaults (so the sliders reflect
  // the preset immediately) and, in a single `mutateAnnotations` call, the
  // selection, so applying a preset is one undo step rather than the five
  // separate ones calling each individual handler in turn would push.
  // Color is deliberately left alone (stays whatever Auto/explicit pick was
  // already set) — a preset is about shape, not choosing an accent color.
  const handleShadowPreset = useCallback((style: 'drop' | 'glow' | 'outline', angle: number, size: number, blur: number, opacity: number) => {
    setShadowStyle(style)
    setShadowAngle(angle)
    setShadowSize(size)
    setShadowBlur(blur)
    setShadowOpacity(opacity)
    if (selectedIds.length > 0) {
      mutateAnnotations(selectedIds, (a) => (SHADOW_CAPABLE.has(a.type)
        ? { ...a, shadowStyle: style, shadowAngle: angle, shadowSize: size, shadowBlur: blur, shadowOpacity: opacity }
        : a))
    }
  }, [selectedIds, mutateAnnotations, setShadowStyle, setShadowAngle, setShadowSize, setShadowBlur, setShadowOpacity])

  // Restores a stretched picture's original aspect ratio (Shift-drag distorts
  // it — see the image resize handler in AnnotationCanvas). Keeps the box's
  // center and area fixed rather than favoring width or height, so the
  // picture doesn't jump to a different footprint just from undoing a stretch.
  const handleImageResetAspect = useCallback(() => {
    if (uniformType !== 'image') return
    const targets = selectedAnnotations.filter((a): a is ImageAnn => a.type === 'image')
    if (targets.length === 0) return
    Promise.all(targets.map((a) => loadEmbeddedImage(a.src))).then((imgs) => {
      const naturalById = new Map(targets.map((a, i) => [a.id, imgs[i]]))
      mutateAnnotations(selectedIds, (a) => {
        if (a.type !== 'image') return a
        const img = naturalById.get(a.id)
        if (!img || !img.naturalWidth || !img.naturalHeight) return a
        const aspect = img.naturalWidth / img.naturalHeight
        const area = a.w * a.h
        const newW = Math.sqrt(area * aspect)
        const newH = Math.sqrt(area / aspect)
        const cx = a.x + a.w / 2
        const cy = a.y + a.h / 2
        return { ...a, x: cx - newW / 2, y: cy - newH / 2, w: newW, h: newH }
      })
    })
  }, [uniformType, selectedAnnotations, selectedIds, mutateAnnotations])

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
          // What was just loaded *is* the on-disk document: the editor starts
          // clean, and anything the user does from here counts as unsaved.
          const loaded = useStore.getState()
          markDocumentSaved({ annotations: loaded.annotations, image: loaded.capturedImage })
        }
        img.onerror = () => URL.revokeObjectURL(url)
        img.src = url
      })
      .catch(console.error)
  }, [setCapturedImage, restoreAnnotations, markDocumentSaved])

  useEffect(() => { loadPendingImage() }, [loadPendingImage])

  // Name this window after the file it's editing. With several editors open at
  // once (each capture gets its own — see `window::open_editor`) the taskbar and
  // Alt+Tab are the only places they're distinguishable, and they'd otherwise
  // all read "Clipse". Untitled until the first save for an unsaved capture.
  // A leading dot marks unsaved changes there — the only place they show
  // while the window isn't the one being looked at.
  useEffect(() => {
    const title = savedName ? `${savedName} — Clipse` : 'Clipse'
    getCurrentWebviewWindow().setTitle(dirty ? `• ${title}` : title).catch(() => {})
  }, [savedName, dirty])

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

  // Where a picture pasted from the system clipboard lands, and how repeats of
  // the same one cascade instead of stacking invisibly (mirrors the element
  // paste's own offset walk).
  const lastPastedSrcRef = useRef<string | null>(null)
  const imagePasteOffsetRef = useRef(0)

  // Pastes a picture off the system clipboard as an `image` annotation.
  // Returns false when the clipboard holds no picture, so the caller can fall
  // back to the annotation clipboard.
  const pasteImageFromClipboard = useCallback(async (): Promise<boolean> => {
    const buf = await ipc.readClipboardImage()
    if (!buf) return false
    const blob = new Blob([new Uint8Array(buf)], { type: 'image/png' })
    const src = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
    const bitmap = await loadEmbeddedImage(src)
    if (!bitmap) {
      showToast('Could not read the clipboard image', 'err')
      return true  // there *was* a picture; falling back to elements would be wrong
    }
    const canvasW = capturedImage?.width ?? bitmap.naturalWidth
    const canvasH = capturedImage?.height ?? bitmap.naturalHeight
    // Scale to fit comfortably inside the capture. Without this a phone
    // screenshot pasted onto a small capture would cover it completely (and
    // spill past every edge, growing the export), while the same picture on a
    // 4K capture would arrive as an unreadable stamp.
    const fit = Math.min(1,
      (canvasW * PASTED_IMAGE_MAX_FRACTION) / bitmap.naturalWidth,
      (canvasH * PASTED_IMAGE_MAX_FRACTION) / bitmap.naturalHeight)
    const w = Math.max(1, Math.round(bitmap.naturalWidth * fit))
    const h = Math.max(1, Math.round(bitmap.naturalHeight * fit))
    // Repeats of the same picture step down-right so the second paste is
    // visibly its own object; a different picture starts the walk over.
    imagePasteOffsetRef.current = src === lastPastedSrcRef.current
      ? imagePasteOffsetRef.current + PASTED_IMAGE_CASCADE
      : 0
    lastPastedSrcRef.current = src
    const off = imagePasteOffsetRef.current
    addPastedImage({
      id: makeId(),
      type: 'image',
      color: activeColor,
      sw: strokeWidth,
      opacity: activeOpacity,
      x: Math.round((canvasW - w) / 2) + off,
      y: Math.round((canvasH - h) / 2) + off,
      w, h, src,
      border: imageBorder,
      shadowStyle,
    })
    return true
  }, [capturedImage, activeColor, strokeWidth, activeOpacity, imageBorder, shadowStyle, addPastedImage, showToast])

  const pasteFromClipboard = useCallback(async () => {
    try {
      const entry = await ipc.getAnnotationClipboard()
      // Two clipboards can answer one Ctrl+V: Clipse's own copied elements and
      // a picture on the system clipboard. Recency decides between them —
      // `superseded` means the system clipboard was written *after* those
      // elements were copied. Without that test the choice would be a fixed
      // preference, and either order is wrong half the time: every capture
      // auto-copies its own image, so a screenshot would outrank elements
      // copied minutes later — or one element copy would outrank every
      // picture the user copies for the rest of the session.
      if ((!entry || entry.superseded) && await pasteImageFromClipboard()) return
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
  }, [pasteAnnotations, pasteImageFromClipboard, showToast])

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

      // The unsaved-changes confirm is a 3-way choice, and a fixed key per
      // button (what was here before) reads as arbitrary — "which key was
      // Don't Save again?" So instead it works like a native OS dialog:
      // Left/Right move a highlighted selection across the three buttons and
      // Enter activates whichever one is currently highlighted. Escape still
      // cancels immediately regardless of the highlight, matching every other
      // confirm in this editor. Checked before the arrow-key nudge below,
      // which would otherwise move any still-selected annotations instead.
      if (showCloseConfirm && !savingBeforeClose) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          setCloseConfirmFocus((f) => (f > 0 ? ((f - 1) as 0 | 1 | 2) : f))
          return
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault()
          setCloseConfirmFocus((f) => (f < 2 ? ((f + 1) as 0 | 1 | 2) : f))
          return
        }
        if (e.key === 'Enter') {
          e.preventDefault()
          if (closeConfirmFocus === 0) setShowCloseConfirm(false)
          else if (closeConfirmFocus === 1) closeWithoutAsking()
          else void handleSaveAndClose()
          return
        }
        if (e.key === 'Escape') { e.preventDefault(); setShowCloseConfirm(false); return }
      }

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
      if (e.key === 'Enter' && showOcrConsent) { e.preventDefault(); void handleAcceptOcrConsent(); return }
      if (e.key === 'Escape' && showOcrConsent) { e.preventDefault(); setShowOcrConsent(false); return }
      // showCloseConfirm's own Enter/Escape/arrow handling runs earlier, ahead
      // of the arrow-key nudge above — see the top of this handler.

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
        // Tools are bound to Space + F1–F12 (see FKEY_TO_TOOL / the toolbar labels).
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
      // This popup already asked, and the pinned window carries the current
      // annotations — asking again about unsaved changes would be a second
      // confirm for one decision.
      closeWithoutAsking()
    } catch {
      setShowPinConfirm(false)
      showToast('Pin failed', 'err')
    } finally {
      setPinning(false)
    }
  }, [pinning, capturedImage, showToast, closeWithoutAsking])

  /** Writes the document to disk. Returns whether it got there — the
   *  unsaved-changes confirm keeps the window open on a failed save. */
  const handleSave = useCallback(async (): Promise<boolean> => {
    // `exportPng` flattens the document in one synchronous pass, so any pasted
    // picture still decoding would be written out as an empty box.
    await decodeEmbeddedImages(annotations)
    // The state this save is about to write, captured before the first await
    // so a later edit isn't marked saved along with it.
    const doc: SavedDoc = { annotations, image: capturedImage ?? null }
    const b64 = getAnnotatedB64() ?? (await getOriginalB64())
    if (!b64) return false
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
      markDocumentSaved(doc)
      showToast('Saved')
      return true
    } catch {
      showToast('Save failed', 'err')
      return false
    }
  }, [getAnnotatedB64, getOriginalB64, capturedImage, annotations, nextNumber, showToast, markDocumentSaved])

  const handleSaveAndClose = useCallback(async () => {
    if (savingBeforeClose) return
    setSavingBeforeClose(true)
    const saved = await handleSave()
    setSavingBeforeClose(false)
    // A failed save leaves the editor (and this confirm) up: closing here
    // would throw away exactly what the user just asked to keep.
    if (saved) closeWithoutAsking()
  }, [savingBeforeClose, handleSave, closeWithoutAsking])

  // Crop replaces the base image, so any already-stashed sidecar original no
  // longer matches — the next sidecar save must resend it.
  const handleApplyCrop = useCallback(
    (dataUrl: string, width: number, height: number, dx: number, dy: number) => {
      origStashedRef.current = false
      applyCrop(dataUrl, width, height, dx, dy)
    },
    [applyCrop],
  )

  // Rotating replaces the base image just like a crop does — same reset of
  // the stashed-original flag, for the same reason (the sidecar's stashed
  // original would no longer match what's on screen).
  const handleRotateImage = useCallback(
    (dir: 'cw' | 'ccw') => {
      const turned = canvasHandle.current?.rotateBase(dir)
      if (!turned) return
      origStashedRef.current = false
      rotateImage(turned.dataUrl, turned.width, turned.height, dir)
    },
    [rotateImage],
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
      // Not a failure: the backend refused before the image went anywhere, and
      // is telling us to ask. The panel closes so the consent dialog isn't
      // competing with an empty "OCR error" readout behind it.
      if (String(e).includes(OCR_CONSENT_REQUIRED)) {
        setShowOcr(false)
        setShowOcrConsent(true)
        return
      }
      setOcrText(`OCR error: ${e}`)
    } finally {
      setOcrLoading(false)
    }
  }, [getOriginalB64, setOcrLoading, setOcrText])

  // Grant, persist, then run the OCR the user originally asked for — refusing
  // the consent leaves them back where they were, with nothing sent.
  const handleAcceptOcrConsent = useCallback(async () => {
    setShowOcrConsent(false)
    try {
      await ipc.setOcrConsent(true)
    } catch (e) {
      showToast(String(e), 'err')
      return
    }
    void handleOcr()
  }, [handleOcr, showToast])

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
      // The file this editor was editing no longer exists, so there is nothing
      // left to save and nothing to ask about.
      closeWithoutAsking()
    } catch {
      setConfirmDeleteImage(false)
      showToast('Delete failed', 'err')
    }
  }, [capturedImage, showToast, closeWithoutAsking])

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
        // Double-clicking bare header space (not a button, not the filename
        // being renamed) toggles maximize — the same gesture a native
        // title bar responds to, expected here even though this one is
        // custom-drawn.
        onDoubleClick={(e) => {
          if (!(e.target as HTMLElement).closest('button, input')) handleToggleMaximize()
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
          {/* Edit-history actions: rotate the whole image, undo/redo the
              annotation stack — apply the same way regardless of which tool
              is active, so they live here rather than in the per-tool
              Toolbar. */}
          <button
            className={styles.actionBtn}
            onClick={() => handleRotateImage('ccw')}
            disabled={!capturedImage}
            title="Rotate image left"
          >
            <RotateCcw size={13} strokeWidth={1.5} />
          </button>
          <button
            className={styles.actionBtn}
            onClick={() => handleRotateImage('cw')}
            disabled={!capturedImage}
            title="Rotate image right"
          >
            <RotateCw size={13} strokeWidth={1.5} />
          </button>
          <button
            className={styles.actionBtn}
            onClick={undoAnnotation}
            disabled={annotationHistory.length === 0}
            title="Undo (Ctrl+Z)"
          >
            <Undo2 size={13} strokeWidth={1.5} />
          </button>
          <button
            className={styles.actionBtn}
            onClick={redoAnnotation}
            disabled={redoStack.length === 0}
            title="Redo (Ctrl+Y)"
          >
            <Redo2 size={13} strokeWidth={1.5} />
          </button>

          <div className={styles.headerSep} />

          {/* Secondary actions: read the image, don't change the gallery. */}
          <button
            className={styles.actionBtn}
            onClick={() => void pasteFromClipboard()}
            disabled={!capturedImage}
            title="Paste an image from the clipboard, or copied elements (Ctrl+V)"
          >
            <ClipboardPaste size={13} strokeWidth={1.5} />
            Paste
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

          <div className={styles.headerSep} />

          {/* Primary actions: what most edits end with. */}
          <button
            className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}
            onClick={handleSave}
            disabled={!capturedImage}
            title="Save to gallery (Ctrl+S)"
          >
            <Save size={13} strokeWidth={1.5} />
            Save
          </button>
          <button
            className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}
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

          <div className={styles.headerSep} />

          <button
            className={styles.actionBtn}
            onClick={() => setShowHelp(true)}
            title="Help / shortcuts (?)"
          >
            <HelpCircle size={13} strokeWidth={1.5} />
            Help
          </button>
          {/* The one destructive, file-level action here — kept visually
              apart from (and styled unlike) the read/save actions above so
              it doesn't sit at the same weight as "Copy" or "Save". */}
          <button
            className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
            onClick={() => setConfirmDeleteImage(true)}
            disabled={!capturedImage?.savedPath}
            title="Delete this image (Delete)"
          >
            <Trash2 size={13} strokeWidth={1.5} />
            Delete
          </button>
          {/* The window is undecorated, so minimize/maximize have no OS
              button to fall back on — without these an editor could only be
              resized by dragging its edge, and never minimized at all. */}
          <button
            className={styles.minBtn}
            onClick={() => getCurrentWebviewWindow().minimize()}
            title="Minimize"
          >
            <Minus size={14} strokeWidth={2} />
          </button>
          <button
            className={styles.minBtn}
            onClick={handleToggleMaximize}
            title={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? <Minimize2 size={13} strokeWidth={2} /> : <Maximize2 size={13} strokeWidth={2} />}
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
              <kbd className={styles.btnKbd}>Esc</kbd>
            </button>
            <button
              className={`${styles.iconBtn} ${styles.iconBtnConfirmDelete}`}
              onClick={handleDeleteImage}
              title="Confirm delete (Enter)"
            >
              <Trash2 size={12} strokeWidth={1.5} />
              <span>Delete</span>
              <kbd className={styles.btnKbd}>↵</kbd>
            </button>
          </div>
        </div>
      )}

      {/* ── OCR consent dialog ── */}
      {showOcrConsent && (
        <div className={styles.confirmBackdrop} onPointerDown={() => setShowOcrConsent(false)}>
          <div
            className={`${styles.confirmModal} ${styles.ocrConsentModal}`}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <ScanText size={20} strokeWidth={1.5} style={{ color: 'var(--color-accent)' }} />
            <span className={styles.ocrConsentTitle}>Send this image for text extraction?</span>
            <span className={styles.ocrConsentBody}>{t('ocrConsentBody', langRef.current)}</span>
            <div className={styles.confirmActions}>
              <button
                className={`${styles.iconBtn} ${styles.iconBtnCancel}`}
                onClick={() => setShowOcrConsent(false)}
                title="Cancel (Esc)"
              >
                <X size={12} strokeWidth={2} />
                <span>Cancel</span>
                <kbd className={styles.btnKbd}>Esc</kbd>
              </button>
              <button
                className={`${styles.iconBtn} ${styles.iconBtnConfirmClose}`}
                onClick={handleAcceptOcrConsent}
                title="Agree and run OCR (Enter)"
              >
                <Check size={12} strokeWidth={2} />
                <span>Agree</span>
                <kbd className={styles.btnKbd}>↵</kbd>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Pin confirmation popup ── */}
      {showPinConfirm && (
        <div className={styles.confirmBackdrop} onPointerDown={() => setShowPinConfirm(false)}>
          <div className={styles.confirmModal} onPointerDown={(e) => e.stopPropagation()}>
            <PinIcon size={20} strokeWidth={1.5} style={{ color: 'var(--color-accent)' }} />
            <span className={styles.confirmText}>
              Pin this image to the screen and close the editor?
            </span>
            <div className={styles.confirmActions}>
              <button
                className={`${styles.iconBtn} ${styles.iconBtnCancel}`}
                onClick={() => setShowPinConfirm(false)}
                title="Cancel (Esc)"
                disabled={pinning}
              >
                <X size={12} strokeWidth={2} />
                <span>Cancel</span>
                <kbd className={styles.btnKbd}>Esc</kbd>
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
                <kbd className={styles.btnKbd}>↵</kbd>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Unsaved-changes confirmation popup ── */}
      {/* Raised by the window's close request, so it covers the X button,
          Escape, Alt+F4 and the taskbar's Close alike. */}
      {showCloseConfirm && (
        <div className={styles.confirmBackdrop} onPointerDown={() => setShowCloseConfirm(false)}>
          <div
            className={`${styles.confirmModal} ${styles.closeConfirmModal}`}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <TriangleAlert size={20} strokeWidth={1.5} style={{ color: 'var(--color-danger)' }} />
            <span className={styles.confirmText}>
              This image has unsaved changes. Save them before closing?
            </span>
            <div className={styles.confirmActions}>
              <button
                className={`${styles.iconBtn} ${styles.iconBtnCancel} ${closeConfirmFocus === 0 ? styles.iconBtnSelected : ''}`}
                onClick={() => setShowCloseConfirm(false)}
                onMouseEnter={() => setCloseConfirmFocus(0)}
                title="Keep editing (← →, Enter, or Esc)"
                disabled={savingBeforeClose}
              >
                <ArrowLeft size={12} strokeWidth={1.5} />
                <span>Keep Editing</span>
              </button>
              <button
                className={`${styles.iconBtn} ${styles.iconBtnConfirmDelete} ${closeConfirmFocus === 1 ? styles.iconBtnSelected : ''}`}
                onClick={closeWithoutAsking}
                onMouseEnter={() => setCloseConfirmFocus(1)}
                title="Discard the changes (← →, then Enter)"
                disabled={savingBeforeClose}
              >
                <SaveOff size={12} strokeWidth={1.5} />
                <span>Don't Save</span>
              </button>
              <button
                className={`${styles.iconBtn} ${styles.iconBtnConfirmClose} ${closeConfirmFocus === 2 ? styles.iconBtnSelected : ''}`}
                onClick={handleSaveAndClose}
                onMouseEnter={() => setCloseConfirmFocus(2)}
                title="Save and close (← →, then Enter)"
                disabled={savingBeforeClose}
              >
                {savingBeforeClose ? (
                  <Loader2 size={12} strokeWidth={1.5} style={{ animation: 'spin 1s linear infinite' }} />
                ) : (
                  <Save size={12} strokeWidth={1.5} />
                )}
                <span>Save</span>
              </button>
            </div>
            <span className={styles.confirmHint}>← → select · Enter confirm · Esc cancel</span>
          </div>
        </div>
      )}

      {/* ── Main area: left toolbox + canvas + optional OCR panel + right
          options panel. Toolbar is tools only — undo/redo/rotate live in the
          header (see below), and color, opacity, stroke width and every
          per-tool option live in ToolOptionsPanel, docked to the right edge
          (see that component's doc comment for why). ── */}
      <div className={styles.main}>
        <Toolbar
          activeTool={activeTool}
          onTool={setActiveTool}
        />
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
              lineDash={lineDash}
              rectRadius={rectRadius}
              numberShape={numberShape}
              numberRadius={numberRadius}
              arrowHead={arrowHead}
              doubleEndedArrow={doubleEndedArrow}
              arrowStyle={arrowStyle}
              textShape={textShape}
              bgFill={textBgFill}
              textBgAuto={textBgAuto}
              tailAnchor={tailAnchor}
              textAlign={textAlign}
              blurStrength={blurStrength}
              eraseTolerance={eraseTolerance}
              eraseEffect={eraseEffect}
              eraseFillColor={eraseFillColor}
              spotlightDim={spotlightDim}
              spotlightShape={spotlightShape}
              magnifierZoom={magnifierZoom}
              magnifierShape={magnifierShape}
              shadowStyle={shadowStyle}
              shadowAngle={shadowAngle}
              shadowSize={shadowSize}
              shadowBlur={shadowBlur}
              shadowOpacity={shadowOpacity}
              shadowColor={shadowColor}
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

        {/* ── Per-tool options panel — see ToolOptionsPanel's doc comment ── */}
        <ToolOptionsPanel
          selection={{ firstSelected, uniformType }}
          beginSliderAdjust={beginSliderAdjust}
          onTool={setActiveTool}
          onColor={handleColor}
          onOpacity={handleOpacity}
          onStrokeWidth={handleStrokeWidth}
          onBgFill={handleTextBgFill}
          onBgAuto={handleBgAuto}
          onTextColorPick={handleTextColorPick}
          onTextColorAuto={handleTextColorAuto}
          onEraseTolerance={handleEraseTolerance}
          onEraseEffect={handleEraseEffect}
          onEraseFillColor={handleEraseFillColor}
          onShadowStyle={handleShadowStyle}
          onShadowColor={handleShadowColor}
          onShadowPreset={handleShadowPreset}
          onImageResetAspect={handleImageResetAspect}
        />

        {/* ── OCR side panel ── */}
        {showOcr && (
          <aside className={styles.ocrPanel}>
            <div className={styles.ocrHeader}>
              <span>OCR</span>
              <button className={styles.ocrClose} onClick={() => setShowOcr(false)} title="Close OCR panel">
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
