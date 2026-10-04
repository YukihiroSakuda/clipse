import { Fragment, useRef, useState } from 'react'
import {
  ArrowUpRight,
  Circle,
  Crop,
  Droplets,
  Focus,
  Highlighter,
  MousePointer2,
  Pencil,
  Square,
  Type,
  Wand2,
  ZoomIn,
} from 'lucide-react'
import type { AnnotationTool } from '../lib/store'
import styles from './Toolbar.module.css'

interface Props {
  activeTool: AnnotationTool
  onTool: (t: AnnotationTool) => void
}

/** A tool's semantic group, purely for the separators between them — draw
 *  shapes, label/annotate, draw attention, hide/select content, whole-image
 *  edit. Adjacent entries sharing a `group` render with no separator between
 *  them; a group change draws one, so the toolbox reads as five clusters
 *  instead of one flat list of 12 icons. */
type ToolGroup = 'select' | 'shape' | 'note' | 'emphasis' | 'privacy' | 'image'

const TOOLS: { id: AnnotationTool; icon: React.ReactNode; label: string; group: ToolGroup; key?: string; keyLabel?: string }[] = [
  // `key` is the literal `e.key` value FKEY_TO_TOOL matches against (a plain
  // space for the spacebar); `keyLabel` is only the on-button badge text —
  // rendering a raw space there would show up as an empty-looking badge.
  { id: 'select',    icon: <MousePointer2 size={16} strokeWidth={1.5} />, label: 'Select (Space)',   key: ' ', keyLabel: 'Spc', group: 'select' },
  { id: 'arrow',     icon: <ArrowUpRight  size={16} strokeWidth={2} />,   label: 'Arrow (F1)',       key: 'F1',  group: 'shape' },
  { id: 'pen',       icon: <Pencil        size={16} strokeWidth={1.5} />, label: 'Pen (F2)',         key: 'F2',  group: 'shape' },
  { id: 'rect',      icon: <Square        size={16} strokeWidth={1.5} />, label: 'Rect (F3)',        key: 'F3',  group: 'shape' },
  { id: 'ellipse',   icon: <Circle        size={16} strokeWidth={1.5} />, label: 'Ellipse (F4)',     key: 'F4',  group: 'shape' },
  { id: 'text',      icon: <Type          size={16} strokeWidth={1.5} />, label: 'Text (F5)',        key: 'F5',  group: 'note' },
  { id: 'number',    icon: <span className={styles.numIcon}>1</span>,     label: 'Number (F6)',      key: 'F6',  group: 'note' },
  { id: 'highlight', icon: <Highlighter   size={16} strokeWidth={1.5} />, label: 'Highlight (F7)',   key: 'F7',  group: 'emphasis' },
  { id: 'spotlight', icon: <Focus         size={16} strokeWidth={1.5} />, label: 'Spotlight (F8)',   key: 'F8',  group: 'emphasis' },
  { id: 'magnifier', icon: <ZoomIn        size={16} strokeWidth={1.5} />, label: 'Magnifier (F9)',   key: 'F9',  group: 'emphasis' },
  { id: 'blur',      icon: <Droplets      size={16} strokeWidth={1.5} />, label: 'Blur / Redact (F10)', key: 'F10', group: 'privacy' },
  { id: 'erase',     icon: <Wand2         size={16} strokeWidth={1.5} />, label: 'Magic Wand (F11) — click to select a color range, fade with Opacity', key: 'F11', group: 'privacy' },
  { id: 'crop',      icon: <Crop          size={16} strokeWidth={1.5} />, label: 'Crop (F12)',       key: 'F12', group: 'image' },
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
 * Exported: `ToolOptionsPanel`'s several sliders (opacity, stroke width,
 * font size, blur strength, …) all share it.
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

/**
 * Left-edge vertical toolbox: the tools themselves, grouped. Whole-image
 * rotate and undo/redo live in the editor header instead (see `Editor.tsx`)
 * — they apply the same way regardless of which tool is active, so they
 * aren't part of the per-tool toolbox. Color, opacity, stroke width and
 * every per-tool option (fill mode, arrow head, text shape, …) live in
 * `ToolOptionsPanel`, docked to the editor's *right* edge, so a tool's own
 * settings are never more than one glance away from the tool button itself
 * (a "current tool" header pins to the top of that panel) instead of
 * requiring the user to already know an unrelated always-visible control
 * elsewhere affects whatever's currently selected.
 *
 * Vertical rather than a horizontal row: a row's width is a hard ceiling —
 * this toolbox now covers 13 tools, which a single row either crams or
 * wraps unpredictably. A column just grows, and the window is almost always
 * wider than it is short on vertical room for a screenshot editor.
 * Selection-deleting used to live here too (an eraser icon next to
 * Undo/Redo, back when they were here); it's gone — Del and the canvas's
 * own right-click menu already cover it.
 */
export default function Toolbar({ activeTool, onTool }: Props) {
  // Keep clicks from focusing toolbar buttons: a later keyboard shortcut
  // flips the browser to keyboard-modality, which would paint the global
  // :focus-visible ring on the last-clicked (now stale) button.
  const preventFocusSteal = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) e.preventDefault()
  }

  return (
    <div className={styles.root} onMouseDown={preventFocusSteal}>
      <div className={styles.toolColumn}>
        {/* ── Tools, grouped (see ToolGroup) ── */}
        {TOOLS.map(({ id, icon, label, key, keyLabel, group }, i) => (
          <Fragment key={id}>
            {i > 0 && group !== TOOLS[i - 1].group && <div className={styles.sepH} />}
            <button
              className={`${styles.toolBtn} ${styles.toolIconBtn} ${activeTool === id ? styles.active : ''}`}
              onClick={() => onTool(id)}
              title={label}
            >
              {key && <span className={styles.toolKey}>{keyLabel ?? key}</span>}
              {icon}
            </button>
          </Fragment>
        ))}
      </div>
    </div>
  )
}
