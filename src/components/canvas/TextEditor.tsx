import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { bubbleTailHeight, makeId, textPadding } from '../../lib/annotations'
import type { Annotation, BubbleTailAnchor, TextAnn, TextBgFill, TextShape } from '../../lib/annotations'
import { bubblePivotOrigin } from './geometry'
import styles from '../AnnotationCanvas.module.css'

/** Where an open text editor sits, in both coordinate spaces. */
interface TextPos { imgX: number; imgY: number; cssX: number; cssY: number }

/** The tool defaults a *new* text annotation is created with. An existing one
 *  being re-edited uses its own values instead — see `resolved` below. */
export interface TextDefaults {
  activeColor: string
  strokeWidth: number
  activeOpacity: number
  fontSize: number
  textShape: TextShape
  bgFill: TextBgFill
  textBgAuto: boolean
  tailAnchor: BubbleTailAnchor
  textAlign: 'left' | 'center' | 'right'
  shadowStyle: 'none' | 'drop' | 'glow'
  shadowAngle: number
  shadowSize: number
  shadowBlur: number
  shadowOpacity: number
  shadowColor: string | null
}

export interface TextEditorOptions extends TextDefaults {
  /** Every annotation in the document, to look up the one being re-edited. */
  annotations: Annotation[]
  /** Image-to-screen scale, so the textarea's glyphs match the canvas's. */
  viewScale: number
  onAnnotationAdded: (ann: Annotation) => void
  onUpdateText: (id: string, text: string) => void
}

/**
 * Typing a text annotation, new or re-edited.
 *
 * **The visible text is drawn on the canvas, not by the textarea.** While an
 * edit is open the hook publishes a live `preview` annotation, which the
 * canvas renders through the very `drawAnnotation` call a commit would make —
 * so the box, border, bubble tail and glyphs are the same function's output,
 * not a second, independently-positioned CSS approximation of it. That
 * approximation is what repeatedly drifted out of sync (text baseline, then
 * padding, then border centering), because Canvas2D and the CSS box model do
 * not agree on where a border or a line of text sits.
 *
 * The textarea still owns typing, caret, selection and IME; every one of its
 * own pixels is made transparent, so nothing is drawn twice.
 */
export function useTextEditor(opts: TextEditorOptions) {
  const { annotations, viewScale, onAnnotationAdded, onUpdateText } = opts

  const [pos, setPos] = useState<TextPos | null>(null)
  /** Id of an existing text annotation being re-edited (null = creating one). */
  const [editingId, setEditingId] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  // Set on Escape so the textarea's blur handler skips committing (cancel edit).
  const cancelRef = useRef(false)
  // The editing textarea's width, recomputed on every keystroke from the
  // hidden measurer (see `onInput` below). Kept in state and fed back through
  // the `style` prop — rather than only writing `el.style.width` imperatively
  // — so it's part of what React actually renders instead of a side-channel
  // DOM mutation a later re-render could silently overwrite.
  const [editWidth, setEditWidth] = useState<number | null>(null)
  // Same reasoning as editWidth — kept in state (not just imperative
  // el.style.height) so the bubble-tail preview can compute its triangle from
  // the textarea's actual current CSS box.
  const [editHeight, setEditHeight] = useState<number | null>(null)
  // The textarea's current value, mirrored into state on every keystroke so
  // the *canvas* can render it (see `preview`).
  const [text, setText] = useState('')

  const open = useCallback((next: TextPos, existingId: string | null = null) => {
    setEditingId(existingId)
    setPos(next)
  }, [])

  const close = useCallback(() => {
    setEditingId(null)
    setPos(null)
  }, [])

  const cancel = useCallback(() => {
    cancelRef.current = true
    close()
  }, [close])

  /** Re-measures the textarea into `editWidth`/`editHeight`. */
  const resize = useCallback((el: HTMLTextAreaElement) => {
    const measure = measureRef.current
    if (measure) {
      const longest = el.value.split('\n').reduce((a, b) => (a.length >= b.length ? a : b), '')
      measure.textContent = longest || ' '
      setEditWidth(measure.offsetWidth + 2)
    }
    // Reset to auto first so scrollHeight reflects the *new* content height
    // (it only ever grows to fit — resetting lets it shrink back too).
    el.style.height = 'auto'
    const h = el.scrollHeight
    // Re-apply the measured height to the DOM directly, not just via
    // setEditHeight: when the new value equals the current state (typing
    // within an existing line count), React bails out of the no-op update and
    // never re-renders `style.height`, which would leave the box stuck at the
    // 'auto' (1-row) size just set above.
    el.style.height = `${h}px`
    setEditHeight(h)
  }, [])

  // Size the textarea when an edit opens. A layout effect (not a plain
  // effect) so the width is committed to state and re-rendered before the
  // browser paints — otherwise the box flashes at whatever width it had from
  // a previous edit session before snapping to the correct one.
  useLayoutEffect(() => {
    if (!pos) return
    const el = inputRef.current
    if (!el || !measureRef.current) return
    setText(el.value)
    resize(el)
    // Defer focus past the opening click's native focus handling — focusing
    // synchronously lets the click's mouseup blur the textarea, firing onBlur
    // which immediately commits/closes the still-empty editor.
    const id = setTimeout(() => {
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }, 0)
    return () => clearTimeout(id)
  }, [pos, resize])

  const editingAnn = editingId
    ? (annotations.find((a) => a.id === editingId) as TextAnn | undefined)
    : undefined

  // Not memoized: it reads most of the tool defaults, so a dependency list
  // would name fifteen props and be recreated on almost every render anyway.
  // Nothing holds onto it across renders — it only ever reaches the
  // textarea's own event handlers.
  const commit = (value: string) => {
    if (!pos) return
    const editing = editingId
    close()
    // Re-editing an existing annotation: update (empty text deletes it).
    if (editing) {
      onUpdateText(editing, value)
      return
    }
    const trimmed = value.replace(/^\n+|\n+$/g, '')
    if (!trimmed) return
    // Inverted (`textBgAuto`), `'solid'`-fill only: `activeColor` is what the
    // shared swatch has been editing, which under invert means the text color
    // — the background is left to auto-contrast against it (see
    // `resolveTextColors`), so `color` itself is never read.
    const inverted = opts.textBgAuto && opts.bgFill === 'solid'
    onAnnotationAdded({
      id: makeId(),
      type: 'text',
      color: opts.activeColor,
      sw: opts.strokeWidth,
      opacity: opts.activeOpacity,
      x: pos.imgX,
      y: pos.imgY,
      text: trimmed,
      fontSize: opts.fontSize,
      shape: opts.textShape,
      bgFill: opts.bgFill,
      ...(inverted ? { bgAuto: true, textColor: opts.activeColor } : {}),
      shadowStyle: opts.shadowStyle,
      shadowAngle: opts.shadowAngle,
      shadowSize: opts.shadowSize,
      shadowBlur: opts.shadowBlur,
      shadowOpacity: opts.shadowOpacity,
      shadowColor: opts.shadowColor ?? undefined,
      tailAnchor: opts.tailAnchor,
      align: opts.textAlign,
    })
  }

  // What the annotation being typed will actually look like: an existing one
  // keeps its own properties, a new one takes the tool defaults. A brand-new
  // text mirrors `commit`'s inverted case above — `activeColor` is the text
  // color, not the background.
  const bgFill = editingAnn?.bgFill ?? opts.bgFill
  const bgAuto = editingAnn ? editingAnn.bgAuto ?? false : opts.textBgAuto && bgFill === 'solid'
  const resolved = {
    font: editingAnn?.fontSize ?? opts.fontSize,
    color: editingAnn?.color ?? opts.activeColor,
    bgFill,
    bgAuto,
    textColor: editingAnn ? editingAnn.textColor : (bgAuto ? opts.activeColor : undefined),
    sw: editingAnn?.sw ?? opts.strokeWidth,
    shape: editingAnn?.shape ?? opts.textShape,
    align: editingAnn?.align ?? opts.textAlign,
    tailAnchor: editingAnn?.tailAnchor ?? opts.tailAnchor,
    // A brand-new text is always placed unrotated; only re-editing an existing
    // one can be rotated (there's no rotation tool default).
    rotation: editingAnn?.rotation ?? 0,
    opacity: editingAnn?.opacity ?? opts.activeOpacity,
    shadowStyle: editingAnn?.shadowStyle ?? opts.shadowStyle,
    shadowAngle: editingAnn?.shadowAngle ?? opts.shadowAngle,
    shadowSize: editingAnn?.shadowSize ?? opts.shadowSize,
    shadowBlur: editingAnn?.shadowBlur ?? opts.shadowBlur,
    shadowOpacity: editingAnn?.shadowOpacity ?? opts.shadowOpacity,
    shadowColor: editingAnn?.shadowColor ?? opts.shadowColor ?? undefined,
  }

  /** The live annotation the canvas paints while this editor is open. */
  const preview: TextAnn | null = pos ? {
    id: editingAnn?.id ?? 'text-edit-preview',
    type: 'text',
    color: resolved.color,
    sw: resolved.sw,
    opacity: resolved.opacity,
    x: pos.imgX,
    y: pos.imgY,
    text,
    fontSize: resolved.font,
    shape: resolved.shape,
    bgFill: resolved.bgFill,
    ...(resolved.bgAuto ? { bgAuto: true as const, textColor: resolved.textColor } : {}),
    shadowStyle: resolved.shadowStyle,
    shadowAngle: resolved.shadowAngle,
    shadowSize: resolved.shadowSize,
    shadowBlur: resolved.shadowBlur,
    shadowOpacity: resolved.shadowOpacity,
    shadowColor: resolved.shadowColor,
    tailAnchor: resolved.tailAnchor,
    align: resolved.align,
    rotation: resolved.rotation,
  } : null

  const styleProps = buildStyles(resolved, viewScale, editWidth, editHeight)

  return {
    pos, editingId, editingAnn, text, preview,
    inputRef, measureRef, cancelRef,
    open, close, cancel, commit, resize, setText,
    ...styleProps,
  }
}

export type TextEditorState = ReturnType<typeof useTextEditor>

function buildStyles(
  r: { font: number; shape: TextShape; align: 'left' | 'center' | 'right'; tailAnchor: BubbleTailAnchor; rotation: number },
  viewScale: number,
  editWidth: number | null,
  editHeight: number | null,
) {
  const fsCss = Math.max(8, r.font * viewScale)
  const boxed = r.shape !== 'none'
  const padCss = boxed ? textPadding(r.font) * viewScale : 0

  const font: React.CSSProperties = {
    fontSize: fsCss,
    lineHeight: 1.25,
    padding: boxed ? padCss : undefined,
    // Harmless on the hidden measurer too: it holds one line in a
    // shrink-to-fit box, which has no slack for alignment to act on.
    textAlign: r.align,
  }

  const textarea: React.CSSProperties = {
    ...font,
    // Positioning lives on the wrapper div — the textarea itself stays in
    // flow inside it.
    position: 'relative',
    transform: 'none',
    // Driven from state (see editWidth) rather than left for the CSS class's
    // auto/min-width to resolve, so the box's rendered width is always
    // exactly what React just committed — never a stale value a later
    // re-render could leave behind.
    ...(editWidth != null ? { width: editWidth } : {}),
    ...(editHeight != null ? { height: editHeight } : {}),
    // The *visible* box (fill, border, bubble tail) and the glyphs themselves
    // are drawn on the canvas (see `preview`) — the one renderer a commit
    // also uses. What's left here exists purely to host a real caret/
    // selection/IME at the right spot, so every one of its own pixels —
    // text, and for boxed text also the `.textInput` class's own dashed
    // editing chrome — is made invisible; `caret-color` (that same class) is
    // deliberately left alone so the blinking cursor still shows. Plain text
    // keeps the class's dashed indicator: there's no canvas box for it to
    // visually conflict with, so it's still a harmless, useful "an editor is
    // open here" cue.
    color: 'transparent',
    textShadow: 'none',
    ...(boxed
      ? {
          // `border: 'none'` isn't just cosmetic here: this box's width/
          // height and the wrap transform's `-padCss` offset both assume zero
          // border width — a dashed 1px border left in place would silently
          // reintroduce the exact box-model mismatch this design removed.
          border: 'none',
          background: 'transparent',
          boxShadow: 'none',
        }
      : {}),
  }

  // Keep the *box* anchored on the annotation's (x, y): shift back by the
  // padding. Boxed text's padding (`padCss`) is applied inline, equal on
  // every side, so a single symmetric offset cancels it — there's no border
  // to also cancel any more (see above). Plain text's offset is the
  // `.textInput` CSS class's own fixed `padding: 2px 4px` (asymmetric, and
  // deliberately *not* scaled by viewScale, since it's pure editing-UI chrome
  // with no canvas counterpart to match), so it needs matching asymmetric
  // numbers here instead of one shared constant.
  //
  // A rotated annotation then spins that placed box around its own center, so
  // the caret sits exactly where the committed text renders. Ordering
  // `translate rotate` (rotation applied first, about transform-origin, then
  // the translation) is equivalent to rotating the already-placed box,
  // because the origin is offset by the same translation the box gets.
  const tailH = bubbleTailHeight(r.font) * viewScale
  const wrap: React.CSSProperties = {
    position: 'absolute',
    zIndex: 10,
    transform: (boxed ? `translate(${-padCss}px, ${-padCss}px)` : 'translate(-5px, -3px)')
      + (r.rotation ? ` rotate(${r.rotation}deg)` : ''),
    // The committed annotation pivots on its *bounds* center. For plain and
    // boxed text that's the textarea's own center (the default origin); a
    // bubble's bounds also include the tail, pushing the pivot half a
    // tail-height toward whichever edge the tail hangs off.
    ...(r.rotation && r.shape === 'bubble'
      ? { transformOrigin: bubblePivotOrigin(r.tailAnchor, tailH) }
      : {}),
  }

  return { fontStyle: font, textareaStyle: textarea, wrapStyle: wrap }
}

/** The hidden one-line measurer the textarea's width is derived from. */
export function TextMeasurer({ state }: { state: TextEditorState }) {
  return <div ref={state.measureRef} className={styles.textMeasure} style={state.fontStyle} aria-hidden />
}

/** The editing textarea itself — invisible, over the canvas-drawn text. */
export function TextEditor({ state }: { state: TextEditorState }) {
  const { pos, editingId, editingAnn, inputRef, cancelRef, cancel, commit, resize, setText } = state
  if (!pos) return null
  return (
    <div style={{ left: pos.cssX, top: pos.cssY, ...state.wrapStyle }}>
      <textarea
        ref={inputRef}
        key={editingId ?? 'new'}
        defaultValue={editingAnn?.text ?? ''}
        className={styles.textInput}
        style={state.textareaStyle}
        rows={1}
        onInput={(e) => {
          setText(e.currentTarget.value)
          resize(e.currentTarget)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            cancel()
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            commit(e.currentTarget.value)
          }
        }}
        onBlur={(e) => {
          if (cancelRef.current) { cancelRef.current = false; return }
          commit(e.currentTarget.value)
        }}
      />
    </div>
  )
}
