import { Fragment, useEffect, useRef, useState } from 'react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
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
} from 'lucide-react'
import type { AnnotationTool, FillMode } from '../lib/store'
import { PALETTE, TAILWIND_PALETTE, TAILWIND_SHADE_NAMES, BUBBLE_TAIL_ANCHORS, BUBBLE_TAIL_UNITS } from '../lib/annotations'
import type { ArrowHead, BubbleTailAnchor, TextShape } from '../lib/annotations'
import type { FrameConfig } from '../lib/frame'
import styles from './Toolbar.module.css'

interface Props {
  activeTool: AnnotationTool
  activeColor: string
  recentColors: string[]
  strokeWidth: number
  opacity: number
  fontSize: number
  fillMode: FillMode
  numberShape: 'circle' | 'square'
  numberRadius: number
  arrowHead: ArrowHead
  doubleEndedArrow: boolean
  arrowStyle: 'straight' | 'elbow'
  textShape: TextShape
  tailAnchor: BubbleTailAnchor
  textAlign: 'left' | 'center' | 'right'
  blurStrength: number
  spotlightDim: number
  spotlightShape: 'circle' | 'square'
  magnifierShape: 'circle' | 'square'
  frame: FrameConfig
  selectedAnnotationType?: string | null
  onTool: (t: AnnotationTool) => void
  onColor: (hex: string) => void
  onStrokeWidth: (w: number) => void
  onOpacity: (o: number) => void
  onFontSize: (s: number) => void
  onFillMode: (m: FillMode) => void
  onNumberShape: (s: 'circle' | 'square') => void
  onNumberRadius: (r: number) => void
  onArrowHead: (h: ArrowHead) => void
  onDoubleEndedArrow: (d: boolean) => void
  onArrowStyle: (s: 'straight' | 'elbow') => void
  onTextShape: (s: TextShape) => void
  onTailAnchor: (a: BubbleTailAnchor) => void
  onTextAlign: (a: 'left' | 'center' | 'right') => void
  onBlurStrength: (s: number) => void
  onSpotlightDim: (d: number) => void
  onSpotlightShape: (s: 'circle' | 'square') => void
  onMagnifierShape: (s: 'circle' | 'square') => void
  onFrame: (patch: Partial<FrameConfig>) => void
  onUndo: () => void
  onRedo: () => void
  onDeleteSelection: () => void
  canUndo: boolean
  canRedo: boolean
  canDelete: boolean
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
 */
function NumField({ value, min, max, onCommit, suffix }: {
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

// Thin bar left of the slider, thick bar right of it — the pair brackets the
// control so "drag right = thicker" is read directly off the layout.
const ThinLineIcon = () => (
  <svg width="12" height="14" viewBox="0 0 12 14" fill="none">
    <line x1="1.5" y1="7" x2="10.5" y2="7" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
  </svg>
)
const ThickLineIcon = () => (
  <svg width="12" height="14" viewBox="0 0 12 14" fill="none">
    <line x1="1.5" y1="7" x2="10.5" y2="7" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"/>
  </svg>
)

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

const StrokeOnlyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <rect x="1.5" y="1.5" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
  </svg>
)
const SemiFillIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14">
    <rect x="1.5" y="1.5" width="11" height="11" rx="1.5" fill="currentColor" fillOpacity="0.35" stroke="currentColor" strokeWidth="1.5"/>
  </svg>
)
const SolidFillIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14">
    <rect x="1.5" y="1.5" width="11" height="11" rx="1.5" fill="currentColor" stroke="currentColor" strokeWidth="1.5"/>
  </svg>
)

const FILL_MODES: { id: FillMode; icon: React.ReactNode; label: string }[] = [
  { id: 'stroke', icon: <StrokeOnlyIcon />,  label: 'Stroke only' },
  { id: 'semi',   icon: <SemiFillIcon />,    label: 'Semi-transparent fill' },
  { id: 'solid',  icon: <SolidFillIcon />,   label: 'Solid fill' },
]

const TriangleHeadIcon = () => (
  <svg width="16" height="14" viewBox="0 0 16 14" fill="none">
    <line x1="1" y1="7" x2="9" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M8 2.5 L14 7 L8 11.5 Z" fill="currentColor"/>
  </svg>
)
const LineHeadIcon = () => (
  <svg width="16" height="14" viewBox="0 0 16 14" fill="none">
    <line x1="1" y1="7" x2="14" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M9 3 L14 7 L9 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
  </svg>
)
const DotHeadIcon = () => (
  <svg width="16" height="14" viewBox="0 0 16 14" fill="none">
    <line x1="1" y1="7" x2="11" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <circle cx="13" cy="7" r="2.5" fill="currentColor"/>
  </svg>
)
const NoHeadIcon = () => (
  <svg width="16" height="14" viewBox="0 0 16 14" fill="none">
    <line x1="1" y1="7" x2="15" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
)

const ARROW_HEADS: { id: ArrowHead; icon: React.ReactNode; label: string }[] = [
  { id: 'triangle', icon: <TriangleHeadIcon />, label: 'Triangle head' },
  { id: 'line',     icon: <LineHeadIcon />,     label: 'Line head' },
  { id: 'dot',      icon: <DotHeadIcon />,      label: 'Dot head' },
  { id: 'none',     icon: <NoHeadIcon />,       label: 'No head (plain line)' },
]

// One head on the right vs. a head on both ends ("↔") — the two triangles
// must sit at opposite ends with the shaft visible between them, or the
// double variant collapses into a bowtie shape that reads as neither.
const SingleEndIcon = () => (
  <svg width="16" height="14" viewBox="0 0 16 14" fill="none">
    <line x1="2" y1="7" x2="10" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M9 3.5 L14.5 7 L9 10.5 Z" fill="currentColor"/>
  </svg>
)
const DoubleEndIcon = () => (
  <svg width="16" height="14" viewBox="0 0 16 14" fill="none">
    <line x1="5" y1="7" x2="11" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M10 3.5 L15.5 7 L10 10.5 Z" fill="currentColor"/>
    <path d="M6 3.5 L0.5 7 L6 10.5 Z" fill="currentColor"/>
  </svg>
)

const ARROW_ENDS: { id: boolean; icon: React.ReactNode; label: string }[] = [
  { id: false, icon: <SingleEndIcon />, label: 'Single-ended' },
  { id: true,  icon: <DoubleEndIcon />, label: 'Double-ended' },
]

// Diagonal shaft vs. a right-angle jog — reads directly as "straight" vs.
// "elbow" without needing the word spelled out.
const StraightPathIcon = () => (
  <svg width="16" height="14" viewBox="0 0 16 14" fill="none">
    <line x1="1.5" y1="11" x2="14.5" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
)
const ElbowPathIcon = () => (
  <svg width="16" height="14" viewBox="0 0 16 14" fill="none">
    <path d="M1.5 11 H9.5 V3 H14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const ARROW_STYLES: { id: 'straight' | 'elbow'; icon: React.ReactNode; label: string }[] = [
  { id: 'straight', icon: <StraightPathIcon />, label: 'Straight line' },
  { id: 'elbow',     icon: <ElbowPathIcon />,    label: 'Elbow connector (Excel-style, right-angle bend)' },
]

const TextPlainIcon = () => (
  <svg width="16" height="14" viewBox="0 0 16 14" fill="none">
    <text x="8" y="11" textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor">T</text>
  </svg>
)
const TextBoxIcon = () => (
  <svg width="16" height="14" viewBox="0 0 16 14" fill="none">
    <rect x="1" y="1.5" width="14" height="11" rx="2.5" fill="currentColor" fillOpacity="0.18" stroke="currentColor" strokeWidth="1.3"/>
    <text x="8" y="10.3" textAnchor="middle" fontSize="8" fontWeight="700" fill="currentColor">T</text>
  </svg>
)
const TextBubbleIcon = () => (
  <svg width="16" height="15" viewBox="0 0 16 15" fill="none">
    <path
      d="M1.5 2.5 h13 a1 1 0 0 1 1 1 v7 a1 1 0 0 1 -1 1 H6.5 L3.5 14.5 V11.5 H2.5 a1 1 0 0 1 -1-1 v-7 a1 1 0 0 1 1-1 Z"
      fill="currentColor" fillOpacity="0.18" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"
    />
    <text x="7.5" y="9" textAnchor="middle" fontSize="8" fontWeight="700" fill="currentColor">T</text>
  </svg>
)

const TEXT_SHAPES: { id: TextShape; icon: React.ReactNode; label: string }[] = [
  { id: 'none',   icon: <TextPlainIcon />,  label: 'Plain text' },
  { id: 'box',    icon: <TextBoxIcon />,    label: 'Text box' },
  { id: 'bubble', icon: <TextBubbleIcon />, label: 'Speech bubble' },
]

const TEXT_ALIGNS: { id: 'left' | 'center' | 'right'; icon: React.ReactNode; label: string }[] = [
  { id: 'left',   icon: <AlignLeft size={14} strokeWidth={1.5} />,   label: 'Align left' },
  { id: 'center', icon: <AlignCenter size={14} strokeWidth={1.5} />, label: 'Align center' },
  { id: 'right',  icon: <AlignRight size={14} strokeWidth={1.5} />,  label: 'Align right' },
]

const DimIcon = ({ opacity }: { opacity: number }) => (
  <svg width="14" height="14" viewBox="0 0 14 14">
    <rect x="1" y="1" width="12" height="12" rx="2" fill="currentColor" fillOpacity={opacity} stroke="currentColor" strokeWidth="1" strokeOpacity="0.6"/>
    <rect x="4.5" y="4.5" width="5" height="5" rx="1" fill="var(--color-panel)" />
  </svg>
)

const SPOTLIGHT_DIMS: { id: number; icon: React.ReactNode; label: string }[] = [
  { id: 0.35, icon: <DimIcon opacity={0.35} />, label: 'Light dim' },
  { id: 0.55, icon: <DimIcon opacity={0.6} />,  label: 'Medium dim' },
  { id: 0.75, icon: <DimIcon opacity={0.9} />,  label: 'Dark dim' },
]

// Gray families (0-4) merged to index 1 (gray); colorful families 5-21
const DISPLAY_FAMILIES = [
  { name: 'gray',    shades: TAILWIND_PALETTE[1]  },
  { name: 'red',     shades: TAILWIND_PALETTE[5]  },
  { name: 'orange',  shades: TAILWIND_PALETTE[6]  },
  { name: 'amber',   shades: TAILWIND_PALETTE[7]  },
  { name: 'yellow',  shades: TAILWIND_PALETTE[8]  },
  { name: 'lime',    shades: TAILWIND_PALETTE[9]  },
  { name: 'green',   shades: TAILWIND_PALETTE[10] },
  { name: 'emerald', shades: TAILWIND_PALETTE[11] },
  { name: 'teal',    shades: TAILWIND_PALETTE[12] },
  { name: 'cyan',    shades: TAILWIND_PALETTE[13] },
  { name: 'sky',     shades: TAILWIND_PALETTE[14] },
  { name: 'blue',    shades: TAILWIND_PALETTE[15] },
  { name: 'indigo',  shades: TAILWIND_PALETTE[16] },
  { name: 'violet',  shades: TAILWIND_PALETTE[17] },
  { name: 'purple',  shades: TAILWIND_PALETTE[18] },
  { name: 'fuchsia', shades: TAILWIND_PALETTE[19] },
  { name: 'pink',    shades: TAILWIND_PALETTE[20] },
  { name: 'rose',    shades: TAILWIND_PALETTE[21] },
]

// White has no lightness/saturation to pick — a single fixed swatch,
// selected directly instead of opening a shade row like the families above.
const WHITE = PALETTE.white

export default function Toolbar({
  activeTool, activeColor, recentColors, strokeWidth, opacity, fontSize, fillMode, numberShape, numberRadius, arrowHead, doubleEndedArrow, arrowStyle, textShape, tailAnchor, textAlign,
  blurStrength, spotlightDim, spotlightShape, magnifierShape,
  selectedAnnotationType,
  onTool, onColor, onStrokeWidth, onOpacity, onFontSize, onFillMode, onNumberShape, onNumberRadius, onArrowHead, onDoubleEndedArrow, onArrowStyle, onTextShape, onTailAnchor, onTextAlign,
  onBlurStrength, onSpotlightDim, onSpotlightShape, onMagnifierShape,
  onUndo, onRedo, onDeleteSelection, canUndo, canRedo, canDelete,
}: Props) {
  const shadePickerRef = useRef<HTMLDivElement>(null)
  const familyRowRef = useRef<HTMLDivElement>(null)
  const colorTriggerRef = useRef<HTMLButtonElement>(null)
  const [picker, setPicker] = useState<{ familyIdx: number; top: number; left: number } | null>(null)
  // Brief "copied" checkmark on the popup's hex row after a click-to-copy.
  const [hexCopied, setHexCopied] = useState(false)
  const hexCopiedTimer = useRef<number | undefined>(undefined)

  const tailPanelRef = useRef<HTMLDivElement>(null)
  const tailTriggerRef = useRef<HTMLButtonElement>(null)
  const [tailPickerOpen, setTailPickerOpen] = useState<{ top: number; left: number } | null>(null)

  const copyActiveHex = () => {
    navigator.clipboard.writeText(activeColor.toUpperCase()).catch(() => {})
    setHexCopied(true)
    window.clearTimeout(hexCopiedTimer.current)
    hexCopiedTimer.current = window.setTimeout(() => setHexCopied(false), 1200)
  }
  useEffect(() => () => window.clearTimeout(hexCopiedTimer.current), [])

  // Options show for the active drawing tool OR whenever the selection is of
  // that type — a selection can exist under any tool now (grab-after-create),
  // so gating on the Select tool would hide the very options the user is
  // trying to adjust on the shape they just placed.
  const showFillMode = activeTool === 'rect' || activeTool === 'ellipse'
    || selectedAnnotationType === 'rect' || selectedAnnotationType === 'ellipse'
  const showFontSize = activeTool === 'text' || selectedAnnotationType === 'text'
  const showNumberShape = activeTool === 'number' || selectedAnnotationType === 'number'
  const showArrowHead = activeTool === 'arrow' || selectedAnnotationType === 'arrow'
  const showBlurStrength = activeTool === 'blur' || selectedAnnotationType === 'blur'
  const showSpotlightDim = activeTool === 'spotlight' || selectedAnnotationType === 'spotlight'
  const showMagnifierShape = activeTool === 'magnifier' || selectedAnnotationType === 'magnifier'
  const isMarker = activeTool === 'highlight' || selectedAnnotationType === 'highlight'
  const isMagnifier = activeTool === 'magnifier' || selectedAnnotationType === 'magnifier'
  // Stroke width only matters for tools that actually stroke a path — for
  // text/number/blur/spotlight the slider is dead weight, so it lives in the
  // per-tool options row instead of the always-visible main row.
  const STROKED_TOOLS = ['arrow', 'pen', 'line', 'rect', 'ellipse', 'highlight', 'magnifier']
  const showStroke = STROKED_TOOLS.includes(activeTool)
    || STROKED_TOOLS.includes(selectedAnnotationType ?? '')

  useEffect(() => {
    if (!picker) return
    const onPointerDown = (e: PointerEvent) => {
      if (
        !shadePickerRef.current?.contains(e.target as Node) &&
        !familyRowRef.current?.contains(e.target as Node)
      ) setPicker(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [picker])

  useEffect(() => {
    if (!tailPickerOpen) return
    const onPointerDown = (e: PointerEvent) => {
      if (
        !tailPanelRef.current?.contains(e.target as Node) &&
        !tailTriggerRef.current?.contains(e.target as Node)
      ) setTailPickerOpen(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [tailPickerOpen])

  const toggleTailPicker = () => {
    if (tailPickerOpen) { setTailPickerOpen(null); return }
    const btn = tailTriggerRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    setTailPickerOpen({ top: rect.bottom + 4, left: Math.max(4, rect.left) })
  }

  // Toggle the palette popup, opened to the family that owns the current color.
  const toggleColorPopup = () => {
    if (picker) { setPicker(null); return }
    const btn = colorTriggerRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const found = DISPLAY_FAMILIES.findIndex((f) => f.shades.includes(activeColor))
    setPicker({ familyIdx: found >= 0 ? found : 0, top: rect.bottom + 4, left: Math.max(4, rect.left) })
  }

  // Keep clicks from focusing toolbar buttons: a later keyboard shortcut
  // flips the browser to keyboard-modality, which would paint the global
  // :focus-visible ring on the last-clicked (now stale) button.
  const preventFocusSteal = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) e.preventDefault()
  }

  // Row 2 shows only controls specific to the active tool (or the selected
  // annotation's type, when using Select). Built as a list rather than
  // inline-conditional JSX so separators between the *present* blocks only
  // land between them, regardless of which subset of tools qualifies.
  const optionBlocks: { key: string; node: React.ReactNode }[] = []
  if (showFillMode) {
    optionBlocks.push({
      key: 'fill',
      node: (
        <div className={styles.group}>
          {FILL_MODES.map(({ id, icon, label }) => (
            <button
              key={id}
              className={`${styles.fillBtn} ${fillMode === id ? styles.active : ''}`}
              onClick={() => onFillMode(id)}
              title={label}
            >
              {icon}
            </button>
          ))}
        </div>
      ),
    })
  }
  if (showArrowHead) {
    optionBlocks.push({
      key: 'arrow',
      node: (
        <div className={styles.group}>
          {ARROW_HEADS.map(({ id, icon, label }) => (
            <button
              key={id}
              className={`${styles.fillBtn} ${arrowHead === id ? styles.active : ''}`}
              onClick={() => onArrowHead(id)}
              title={label}
            >
              {icon}
            </button>
          ))}
        </div>
      ),
    })
    optionBlocks.push({
      key: 'arrowends',
      node: (
        <div className={styles.group}>
          {ARROW_ENDS.map(({ id, icon, label }) => (
            <button
              key={String(id)}
              className={`${styles.fillBtn} ${doubleEndedArrow === id ? styles.active : ''}`}
              onClick={() => onDoubleEndedArrow(id)}
              title={label}
            >
              {icon}
            </button>
          ))}
        </div>
      ),
    })
    optionBlocks.push({
      key: 'arrowstyle',
      node: (
        <div className={styles.group}>
          {ARROW_STYLES.map(({ id, icon, label }) => (
            <button
              key={id}
              className={`${styles.fillBtn} ${arrowStyle === id ? styles.active : ''}`}
              onClick={() => onArrowStyle(id)}
              title={label}
            >
              {icon}
            </button>
          ))}
        </div>
      ),
    })
  }
  if (showNumberShape) {
    optionBlocks.push({
      key: 'numshape',
      node: (
        <div className={styles.group}>
          <button
            className={`${styles.fillBtn} ${numberShape === 'circle' ? styles.active : ''}`}
            onClick={() => onNumberShape('circle')}
            title="Circle marker"
          >
            <Circle size={14} strokeWidth={2} />
          </button>
          <button
            className={`${styles.fillBtn} ${numberShape === 'square' ? styles.active : ''}`}
            onClick={() => onNumberShape('square')}
            title="Square marker"
          >
            <Square size={14} strokeWidth={2} />
          </button>
        </div>
      ),
    })
    optionBlocks.push({
      key: 'numsize',
      node: (
        <div className={styles.group}>
          {/* Small shape left, big shape right — brackets the slider the same
              way as the stroke-width control (drag right = bigger). */}
          <label className={styles.fontSizeLabel} title="Marker size">
            <Circle size={8} strokeWidth={2} />
            <input
              type="range"
              min={8}
              max={60}
              step={1}
              value={Math.round(numberRadius)}
              onChange={(e) => onNumberRadius(Number(e.target.value))}
              className={styles.fontSizeRange}
            />
            <Circle size={14} strokeWidth={2} />
            <NumField value={Math.round(numberRadius)} min={8} max={60} onCommit={onNumberRadius} />
          </label>
        </div>
      ),
    })
  }
  if (showBlurStrength) {
    optionBlocks.push({
      key: 'blur',
      node: (
        <div className={styles.group}>
          {/* Weak droplet left, strong right — brackets the slider like the
              stroke-width control (drag right = stronger). */}
          <label className={styles.fontSizeLabel} title="Blur strength">
            <Droplets size={10} strokeWidth={1.5} />
            <input
              type="range"
              min={2}
              max={50}
              step={1}
              value={Math.round(blurStrength)}
              onChange={(e) => onBlurStrength(Number(e.target.value))}
              className={styles.fontSizeRange}
            />
            <Droplets size={16} strokeWidth={1.5} />
            <NumField value={Math.round(blurStrength)} min={2} max={50} onCommit={onBlurStrength} />
          </label>
        </div>
      ),
    })
  }
  if (showSpotlightDim) {
    optionBlocks.push({
      key: 'spotlightshape',
      node: (
        <div className={styles.group}>
          <button
            className={`${styles.fillBtn} ${spotlightShape === 'circle' ? styles.active : ''}`}
            onClick={() => onSpotlightShape('circle')}
            title="Circle spotlight"
          >
            <Circle size={14} strokeWidth={2} />
          </button>
          <button
            className={`${styles.fillBtn} ${spotlightShape === 'square' ? styles.active : ''}`}
            onClick={() => onSpotlightShape('square')}
            title="Square spotlight"
          >
            <Square size={14} strokeWidth={2} />
          </button>
        </div>
      ),
    })
    optionBlocks.push({
      key: 'spotlight',
      node: (
        <div className={styles.group}>
          {SPOTLIGHT_DIMS.map(({ id, icon, label }) => (
            <button
              key={id}
              className={`${styles.fillBtn} ${Math.abs(spotlightDim - id) < 0.01 ? styles.active : ''}`}
              onClick={() => onSpotlightDim(id)}
              title={label}
            >
              {icon}
            </button>
          ))}
        </div>
      ),
    })
  }
  if (showMagnifierShape) {
    optionBlocks.push({
      key: 'magnifiershape',
      node: (
        <div className={styles.group}>
          <button
            className={`${styles.fillBtn} ${magnifierShape === 'circle' ? styles.active : ''}`}
            onClick={() => onMagnifierShape('circle')}
            title="Circle magnifier"
          >
            <Circle size={14} strokeWidth={2} />
          </button>
          <button
            className={`${styles.fillBtn} ${magnifierShape === 'square' ? styles.active : ''}`}
            onClick={() => onMagnifierShape('square')}
            title="Square magnifier"
          >
            <Square size={14} strokeWidth={2} />
          </button>
        </div>
      ),
    })
  }
  if (showStroke) {
    optionBlocks.push({
      key: 'stroke',
      node: (
        <div className={styles.group}>
          <label className={styles.fontSizeLabel} title={isMarker ? 'Marker width' : isMagnifier ? 'Frame width' : 'Stroke width'}>
            <ThinLineIcon />
            <input
              type="range"
              min={1}
              max={30}
              step={1}
              value={strokeWidth}
              onChange={(e) => onStrokeWidth(Number(e.target.value))}
              className={styles.fontSizeRange}
            />
            <ThickLineIcon />
            <NumField
              value={isMarker ? Math.round(strokeWidth * 6) : strokeWidth}
              min={isMarker ? 6 : 1}
              max={isMarker ? 180 : 30}
              onCommit={(v) => onStrokeWidth(isMarker ? v / 6 : v)}
            />
          </label>
        </div>
      ),
    })
  }
  if (showFontSize) {
    optionBlocks.push({
      key: 'textshape',
      node: (
        <div className={styles.group}>
          {TEXT_SHAPES.map(({ id, icon, label }) => (
            <button
              key={id}
              className={`${styles.fillBtn} ${textShape === id ? styles.active : ''}`}
              onClick={() => onTextShape(id)}
              title={label}
            >
              {icon}
            </button>
          ))}
        </div>
      ),
    })
    optionBlocks.push({
      key: 'textalign',
      node: (
        <div className={styles.group}>
          {TEXT_ALIGNS.map(({ id, icon, label }) => (
            <button
              key={id}
              className={`${styles.fillBtn} ${textAlign === id ? styles.active : ''}`}
              onClick={() => onTextAlign(id)}
              title={label}
            >
              {icon}
            </button>
          ))}
        </div>
      ),
    })
    if (textShape === 'bubble') {
      optionBlocks.push({
        key: 'tailpos',
        node: (
          <div className={styles.group}>
            <button
              ref={tailTriggerRef}
              className={`${styles.toolBtn} ${styles.toolIconBtn} ${tailPickerOpen ? styles.active : ''}`}
              onClick={toggleTailPicker}
              title="Tail position"
            >
              <TextBubbleIcon />
            </button>
            {tailPickerOpen && (
              <div
                ref={tailPanelRef}
                className={styles.tailPanel}
                style={{ top: tailPickerOpen.top, left: tailPickerOpen.left }}
              >
                <div className={styles.tailCompass}>
                  <div className={styles.tailBody} />
                  {BUBBLE_TAIL_ANCHORS.map((anchor) => {
                    const [u, v] = BUBBLE_TAIL_UNITS[anchor]
                    return (
                      <button
                        key={anchor}
                        className={`${styles.tailDot} ${tailAnchor === anchor ? styles.tailDotActive : ''}`}
                        style={{ left: `${50 + u * 42}%`, top: `${50 + v * 42}%` }}
                        onClick={() => { onTailAnchor(anchor); setTailPickerOpen(null) }}
                        title={anchor}
                      />
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        ),
      })
    }
    optionBlocks.push({
      key: 'fontsize',
      node: (
        <div className={styles.group}>
          <label className={styles.fontSizeLabel}>
            <Type size={12} strokeWidth={1.5} />
            <input
              type="range"
              min={10}
              max={200}
              step={1}
              value={fontSize}
              onChange={(e) => onFontSize(Number(e.target.value))}
              className={styles.fontSizeRange}
            />
            <NumField value={fontSize} min={10} max={200} onCommit={onFontSize} />
          </label>
        </div>
      ),
    })
  }

  return (
    <div className={styles.root} onMouseDown={preventFocusSteal}>
      {/* ── Row 1: tools + global controls (color, stroke, corner radius, undo/redo) ── */}
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
        <div className={styles.group} ref={familyRowRef}>
          <button
            ref={colorTriggerRef}
            className={`${styles.colorTrigger} ${picker ? styles.colorTriggerOpen : ''}`}
            style={{ '--swatch': activeColor } as React.CSSProperties}
            onClick={toggleColorPopup}
            title="Color"
          />
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

        {/* ── Color palette popup: family grid + shade row ── */}
        {picker && (
          <div
            ref={shadePickerRef}
            className={styles.colorPopup}
            style={{ top: picker.top, left: picker.left }}
          >
            <div className={styles.familyGrid}>
              {DISPLAY_FAMILIES.map(({ name, shades }, fi) => (
                <button
                  key={name}
                  className={`${styles.familySwatch} ${picker.familyIdx === fi ? styles.familySelected : ''}`}
                  style={{ '--swatch': shades[5] } as React.CSSProperties}
                  onClick={() => { onColor(shades[5]); setPicker({ ...picker, familyIdx: fi }) }}
                  title={name}
                />
              ))}
              {/* White: no shade row to open, just select it directly. */}
              <button
                className={`${styles.familySwatch} ${styles.whiteSwatch} ${activeColor === WHITE ? styles.familySelected : ''}`}
                style={{ '--swatch': WHITE } as React.CSSProperties}
                onClick={() => { onColor(WHITE); setPicker(null) }}
                title="White"
              />
            </div>
            <div className={styles.shadePickerLabel}>{DISPLAY_FAMILIES[picker.familyIdx].name}</div>
            <div className={styles.shadeSwatches}>
              {DISPLAY_FAMILIES[picker.familyIdx].shades.map((hex, si) => (
                <button
                  key={si}
                  className={`${styles.shadeSwatch} ${activeColor === hex ? styles.shadeActive : ''}`}
                  style={{ '--swatch': hex } as React.CSSProperties}
                  onClick={() => { onColor(hex); setPicker(null) }}
                  title={`${DISPLAY_FAMILIES[picker.familyIdx].name}-${TAILWIND_SHADE_NAMES[si]}`}
                />
              ))}
            </div>
            {/* Picked (eyedropper) colors — pipette icon marks the section. */}
            {recentColors.length > 0 && (
              <div className={styles.popupPickedRow}>
                <span className={styles.pickedDivider} title="Picked colors">
                  <Pipette size={12} strokeWidth={2} />
                </span>
                {recentColors.map((hex) => (
                  <button
                    key={hex}
                    className={`${styles.shadeSwatch} ${activeColor === hex ? styles.shadeActive : ''}`}
                    style={{ '--swatch': hex } as React.CSSProperties}
                    onClick={() => { onColor(hex); setPicker(null) }}
                    title={`Picked ${hex}`}
                  />
                ))}
              </div>
            )}
          </div>
        )}

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

      {/* ── Row 2: options for the active tool (or selected annotation's type) ── */}
      <div className={styles.rowOptions}>
        {optionBlocks.length > 0 ? (
          optionBlocks.map(({ key, node }, i) => (
            <Fragment key={key}>
              {i > 0 && <div className={styles.sep} />}
              {node}
            </Fragment>
          ))
        ) : (
          <span className={styles.rowOptionsEmpty}>No options for this tool</span>
        )}
      </div>
    </div>
  )
}
