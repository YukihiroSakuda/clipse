import { useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  Check,
  Circle,
  Copy,
  Crop,
  Droplets,
  Focus,
  Highlighter,
  Minus,
  MousePointer2,
  Pencil,
  Pipette,
  Square,
  Eraser,
  Type,
  Undo2,
  Redo2,
  ZoomIn,
  RotateCw,
  RotateCcw,
} from 'lucide-react'
import type { AnnotationTool } from '../lib/store'
import ColorSwatchPicker from './ColorSwatchPicker'
import styles from './Toolbar.module.css'

interface Props {
  activeTool: AnnotationTool
  activeColor: string
  recentColors: string[]
  opacity: number
  onTool: (t: AnnotationTool) => void
  onColor: (hex: string) => void
  onOpacity: (o: number) => void
  onUndo: () => void
  onRedo: () => void
  onDeleteSelection: () => void
  onRotateImage: (dir: 'cw' | 'ccw') => void
  canUndo: boolean
  canRedo: boolean
  canDelete: boolean
  canRotateImage: boolean
}

const TOOLS: { id: AnnotationTool; icon: React.ReactNode; label: string; key?: string; keyLabel?: string }[] = [
  // `key` is the literal `e.key` value FKEY_TO_TOOL matches against (a plain
  // space for the spacebar); `keyLabel` is only the on-button badge text —
  // rendering a raw space there would show up as an empty-looking badge.
  { id: 'select',    icon: <MousePointer2 size={16} strokeWidth={1.5} />, label: 'Select (Space)',   key: ' ', keyLabel: 'Spc' },
  { id: 'arrow',     icon: <ArrowUpRight  size={16} strokeWidth={2} />,   label: 'Arrow (F1)',       key: 'F1' },
  { id: 'pen',       icon: <Pencil        size={16} strokeWidth={1.5} />, label: 'Pen (F2)',         key: 'F2' },
  { id: 'line',      icon: <Minus         size={16} strokeWidth={2} />,   label: 'Line (F3)',        key: 'F3' },
  { id: 'rect',      icon: <Square        size={16} strokeWidth={1.5} />, label: 'Rect (F4)',        key: 'F4' },
  { id: 'ellipse',   icon: <Circle        size={16} strokeWidth={1.5} />, label: 'Ellipse (F5)',     key: 'F5' },
  { id: 'text',      icon: <Type          size={16} strokeWidth={1.5} />, label: 'Text (F6)',        key: 'F6' },
  { id: 'number',    icon: <span className={styles.numIcon}>1</span>,     label: 'Number (F7)',      key: 'F7' },
  { id: 'highlight', icon: <Highlighter   size={16} strokeWidth={1.5} />, label: 'Highlight (F8)',   key: 'F8' },
  { id: 'blur',      icon: <Droplets      size={16} strokeWidth={1.5} />, label: 'Blur / Redact (F9)', key: 'F9' },
  { id: 'spotlight', icon: <Focus         size={16} strokeWidth={1.5} />, label: 'Spotlight (F10)',  key: 'F10' },
  { id: 'crop',      icon: <Crop          size={16} strokeWidth={1.5} />, label: 'Crop (F11)',       key: 'F11' },
  { id: 'magnifier', icon: <ZoomIn        size={16} strokeWidth={1.5} />, label: 'Magnifier (F12)',  key: 'F12' },
]

/** Maps an F-key (`e.key`) to its tool, so the editor's keyboard handler and the
 * toolbar's on-icon labels stay in sync from one source. */
export const FKEY_TO_TOOL: Record<string, AnnotationTool> = Object.fromEntries(
  TOOLS.filter((t) => t.key).map((t) => [t.key!, t.id]),
)

/**
 * Editable numeric readout for a slider: shows the current value, and typing
 * a number (commit on Enter/blur, Esc cancels) sets it directly. The draft
 * text lives locally so multi-digit typing isn't fought by the controlled
 * value; the parent only hears clamped, finite commits.
 *
 * Exported: both this file's opacity slider and `ToolOptionsPanel`'s several
 * sliders (stroke width, font size, blur strength, …) share it.
 */
export function NumField({ value, min, max, onCommit, suffix }: {
  value: number
  min: number
  max: number
  onCommit: (v: number) => void
  suffix?: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const cancelRef = useRef(false)
  return (
    <>
      <input
        type="number"
        className={styles.numInput}
        min={min}
        max={max}
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (cancelRef.current) { cancelRef.current = false; setDraft(null); return }
          if (draft !== null) {
            const n = Number(draft)
            if (draft.trim() !== '' && Number.isFinite(n)) onCommit(Math.max(min, Math.min(max, n)))
            setDraft(null)
          }
        }}
        onKeyDown={(e) => {
          // Keep editor-level shortcuts (Delete, tool F-keys, …) from firing
          // while typing in the field.
          e.stopPropagation()
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') { cancelRef.current = true; (e.target as HTMLInputElement).blur() }
        }}
      />
      {suffix && <span>{suffix}</span>}
    </>
  )
}

// A circle whose fill fades out left → right — "the ink getting more
// transparent" read directly, which survives 14px better than the classic
// checkerboard glyph (whose tiny squares just read as noise at this size).
const OpacityIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14">
    <defs>
      <linearGradient id="opacityFade" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="currentColor" stopOpacity="1"/>
        <stop offset="1" stopColor="currentColor" stopOpacity="0.1"/>
      </linearGradient>
    </defs>
    <circle cx="7" cy="7" r="5.5" fill="url(#opacityFade)" stroke="currentColor" strokeWidth="1.2"/>
  </svg>
)

/**
 * Row 1 only: tools, color, opacity, whole-image rotate, undo/redo/delete —
 * every control that applies regardless of which tool is active. Per-tool
 * options (fill mode, arrow head, text shape, …) live in `ToolOptionsPanel`,
 * a separate vertical panel docked to the editor's right edge rather than a
 * second toolbar row — see that file for why.
 */
export default function Toolbar({
  activeTool, activeColor, recentColors, opacity,
  onTool, onColor, onOpacity,
  onUndo, onRedo, onDeleteSelection, onRotateImage, canUndo, canRedo, canDelete, canRotateImage,
}: Props) {
  // Brief "copied" checkmark on the hex row after a click-to-copy.
  const [hexCopied, setHexCopied] = useState(false)
  const hexCopiedTimer = useRef<number | undefined>(undefined)

  const copyActiveHex = () => {
    navigator.clipboard.writeText(activeColor.toUpperCase()).catch(() => {})
    setHexCopied(true)
    window.clearTimeout(hexCopiedTimer.current)
    hexCopiedTimer.current = window.setTimeout(() => setHexCopied(false), 1200)
  }
  useEffect(() => () => window.clearTimeout(hexCopiedTimer.current), [])

  // Keep clicks from focusing toolbar buttons: a later keyboard shortcut
  // flips the browser to keyboard-modality, which would paint the global
  // :focus-visible ring on the last-clicked (now stale) button.
  const preventFocusSteal = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) e.preventDefault()
  }

  return (
    <div className={styles.root} onMouseDown={preventFocusSteal}>
      <div className={styles.rowMain}>
        {/* ── Tool group ── */}
        <div className={styles.group}>
          {TOOLS.map(({ id, icon, label, key, keyLabel }) => (
            <button
              key={id}
              className={`${styles.toolBtn} ${styles.toolIconBtn} ${activeTool === id ? styles.active : ''}`}
              onClick={() => onTool(id)}
              title={label}
            >
              {key && <span className={styles.toolKey}>{keyLabel ?? key}</span>}
              {icon}
            </button>
          ))}
        </div>

        <div className={styles.sep} />

        {/* ── Color: swatch opens the palette popup; hex code copies on click ── */}
        <div className={styles.group}>
          <ColorSwatchPicker value={activeColor} onChange={onColor} recentColors={recentColors} title="Color" />
          <button className={styles.hexRow} onClick={copyActiveHex} title="Copy color code">
            <span className={styles.hexCode}>{activeColor.toUpperCase()}</span>
            {hexCopied
              ? <Check size={11} strokeWidth={2} className={styles.hexCopied} />
              : <Copy size={11} strokeWidth={1.5} />}
          </button>
          {/* Eyedropper lives next to the palette it feeds, not among the
              drawing tools — picking a color is a color action, not a shape. */}
          <button
            className={`${styles.toolBtn} ${styles.toolIconBtn} ${activeTool === 'picker' ? styles.active : ''}`}
            onClick={() => onTool('picker')}
            title="Color picker"
          >
            <Pipette size={16} strokeWidth={1.5} />
          </button>
        </div>

        {/* ── Opacity: one shared slider for every tool's ink ── */}
        <div className={styles.group}>
          <label className={styles.fontSizeLabel} title="Opacity">
            <OpacityIcon />
            <input
              type="range"
              min={10}
              max={100}
              step={1}
              value={Math.round(opacity * 100)}
              onChange={(e) => onOpacity(Number(e.target.value) / 100)}
              className={styles.fontSizeRange}
            />
            <NumField
              value={Math.round(opacity * 100)}
              min={10}
              max={100}
              onCommit={(v) => onOpacity(v / 100)}
              suffix="%"
            />
          </label>
        </div>

        <div className={styles.sep} />

        {/* ── Rotate whole image ── */}
        <div className={styles.group}>
          <button
            className={`${styles.toolBtn} ${styles.toolIconBtn}`}
            onClick={() => onRotateImage('ccw')}
            disabled={!canRotateImage}
            title="Rotate image left"
          >
            <RotateCcw size={14} strokeWidth={1.5} />
          </button>
          <button
            className={`${styles.toolBtn} ${styles.toolIconBtn}`}
            onClick={() => onRotateImage('cw')}
            disabled={!canRotateImage}
            title="Rotate image right"
          >
            <RotateCw size={14} strokeWidth={1.5} />
          </button>
        </div>

        <div className={styles.sep} />

        {/* ── Undo / Redo / Clear ── */}
        <div className={styles.group}>
          <button
            className={`${styles.toolBtn} ${styles.toolIconBtn}`}
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
          >
            <span className={styles.toolKey}>^Z</span>
            <Undo2 size={14} strokeWidth={1.5} />
          </button>
          <button
            className={`${styles.toolBtn} ${styles.toolIconBtn}`}
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo (Ctrl+Y)"
          >
            <span className={styles.toolKey}>^Y</span>
            <Redo2 size={14} strokeWidth={1.5} />
          </button>
          <button
            className={`${styles.toolBtn} ${styles.toolIconBtn} ${styles.danger}`}
            onClick={onDeleteSelection}
            disabled={!canDelete}
            title="Delete selection (Del) · Select all: Ctrl+A"
          >
            <span className={styles.toolKey}>Del</span>
            <Eraser size={14} strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </div>
  )
}
