import { useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  Circle,
  Droplets,
  Focus,
  Highlighter,
  Minus,
  MousePointer2,
  Square,
  Eraser,
  Type,
  Undo2,
  Redo2,
} from 'lucide-react'
import type { AnnotationTool, FillMode } from '../lib/store'
import { TAILWIND_PALETTE, TAILWIND_SHADE_NAMES } from '../lib/annotations'
import type { FrameConfig } from '../lib/frame'
import styles from './Toolbar.module.css'

interface Props {
  activeTool: AnnotationTool
  activeColor: string
  recentColors: string[]
  strokeWidth: number
  fontSize: number
  fillMode: FillMode
  numberShape: 'circle' | 'square'
  frame: FrameConfig
  selectedAnnotationType?: string | null
  onTool: (t: AnnotationTool) => void
  onColor: (hex: string) => void
  onStrokeWidth: (w: number) => void
  onFontSize: (s: number) => void
  onFillMode: (m: FillMode) => void
  onNumberShape: (s: 'circle' | 'square') => void
  onFrame: (patch: Partial<FrameConfig>) => void
  onUndo: () => void
  onRedo: () => void
  onClear: () => void
  canUndo: boolean
  canRedo: boolean
}

const TOOLS: { id: AnnotationTool; icon: React.ReactNode; label: string }[] = [
  { id: 'arrow',     icon: <ArrowUpRight  size={16} strokeWidth={2} />,   label: 'Arrow (A)' },
  { id: 'line',      icon: <Minus         size={16} strokeWidth={2} />,   label: 'Line (L)' },
  { id: 'rect',      icon: <Square        size={16} strokeWidth={1.5} />, label: 'Rect (R)' },
  { id: 'ellipse',   icon: <Circle        size={16} strokeWidth={1.5} />, label: 'Ellipse (E)' },
  { id: 'text',      icon: <Type          size={16} strokeWidth={1.5} />, label: 'Text (T)' },
  { id: 'number',    icon: <span className={styles.numIcon}>1</span>,     label: 'Number (N)' },
  { id: 'highlight', icon: <Highlighter   size={16} strokeWidth={1.5} />, label: 'Highlight (H)' },
  { id: 'blur',      icon: <Droplets      size={16} strokeWidth={1.5} />, label: 'Blur / Redact (B)' },
  { id: 'spotlight', icon: <Focus         size={16} strokeWidth={1.5} />, label: 'Spotlight (S)' },
  { id: 'select',    icon: <MousePointer2 size={16} strokeWidth={1.5} />, label: 'Select (V)' },
]

const STROKE_WIDTHS = [2, 4, 6, 8]

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

export default function Toolbar({
  activeTool, activeColor, recentColors, strokeWidth, fontSize, fillMode, numberShape,
  frame, selectedAnnotationType,
  onTool, onColor, onStrokeWidth, onFontSize, onFillMode, onNumberShape, onFrame,
  onUndo, onRedo, onClear, canUndo, canRedo,
}: Props) {
  const shadePickerRef = useRef<HTMLDivElement>(null)
  const familyRowRef = useRef<HTMLDivElement>(null)
  const [shadePickerState, setShadePickerState] = useState<{ familyIdx: number; top: number; left: number } | null>(null)

  const showFillMode = activeTool === 'rect' || activeTool === 'ellipse'
  const showFontSize = activeTool === 'text' || (activeTool === 'select' && selectedAnnotationType === 'text')
  const showNumberShape = activeTool === 'number' || (activeTool === 'select' && selectedAnnotationType === 'number')

  useEffect(() => {
    if (!shadePickerState) return
    const onPointerDown = (e: PointerEvent) => {
      if (
        !shadePickerRef.current?.contains(e.target as Node) &&
        !familyRowRef.current?.contains(e.target as Node)
      ) setShadePickerState(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [shadePickerState])

  const toggleShadePicker = (fi: number, btn: HTMLButtonElement) => {
    if (shadePickerState?.familyIdx === fi) { setShadePickerState(null); return }
    const rect = btn.getBoundingClientRect()
    // Align the standard-color swatch (index 5) inside the popup with the clicked family swatch.
    // Popup layout: padding-left 7px, swatch 20px, gap 3px → center of swatch 5 = 7 + 5*(20+3) + 10 = 132px
    const STANDARD_SWATCH_CENTER = 132
    const left = Math.max(4, rect.left + rect.width / 2 - STANDARD_SWATCH_CENTER)
    setShadePickerState({ familyIdx: fi, top: rect.bottom + 4, left })
  }

  return (
    <div className={styles.root}>
      {/* ── Tool group ── */}
      <div className={styles.group}>
        {TOOLS.map(({ id, icon, label }) => (
          <button
            key={id}
            className={`${styles.toolBtn} ${activeTool === id ? styles.active : ''}`}
            onClick={() => onTool(id)}
            title={label}
          >
            {icon}
          </button>
        ))}
      </div>

      <div className={styles.sep} />

      {/* ── Color: active indicator + family row (always visible) ── */}
      <div className={styles.group} ref={familyRowRef}>
        <div
          className={styles.activeColorDot}
          style={{ '--swatch': activeColor } as React.CSSProperties}
        />
        {DISPLAY_FAMILIES.map(({ name, shades }, fi) => (
          <button
            key={name}
            className={`${styles.familySwatch} ${shadePickerState?.familyIdx === fi ? styles.familySelected : ''}`}
            style={{ '--swatch': shades[5] } as React.CSSProperties}
            onClick={(e) => { onColor(shades[5]); toggleShadePicker(fi, e.currentTarget) }}
            title={name}
          />
        ))}
        {recentColors.map((hex) => (
          <button
            key={hex}
            className={`${styles.colorSwatch} ${activeColor === hex ? styles.activeColor : ''}`}
            style={{ '--swatch': hex } as React.CSSProperties}
            onClick={() => onColor(hex)}
            title={hex}
          />
        ))}
      </div>

      {/* ── Shade picker popup ── */}
      {shadePickerState && (
        <div
          ref={shadePickerRef}
          className={styles.shadePicker}
          style={{ top: shadePickerState.top, left: shadePickerState.left }}
        >
          <div className={styles.shadePickerLabel}>{DISPLAY_FAMILIES[shadePickerState.familyIdx].name}</div>
          <div className={styles.shadeSwatches}>
            {DISPLAY_FAMILIES[shadePickerState.familyIdx].shades.map((hex, si) => (
              <button
                key={si}
                className={`${styles.shadeSwatch} ${activeColor === hex ? styles.shadeActive : ''}`}
                style={{ '--swatch': hex } as React.CSSProperties}
                onClick={() => { onColor(hex); setShadePickerState(null) }}
                title={`${DISPLAY_FAMILIES[shadePickerState.familyIdx].name}-${TAILWIND_SHADE_NAMES[si]}`}
              />
            ))}
          </div>
        </div>
      )}

      <div className={styles.sep} />

      {/* ── Stroke width ── */}
      <div className={styles.group}>
        {STROKE_WIDTHS.map((w) => (
          <button
            key={w}
            className={`${styles.strokeBtn} ${strokeWidth === w ? styles.active : ''}`}
            onClick={() => onStrokeWidth(w)}
            title={`Stroke ${w}px`}
          >
            <svg width="20" height="16" viewBox="0 0 20 16" fill="none" aria-hidden>
              <line x1="3" y1="8" x2="17" y2="8" stroke="currentColor" strokeWidth={w} strokeLinecap="round" />
            </svg>
          </button>
        ))}
      </div>

      {/* ── Fill mode (rect / ellipse only) ── */}
      {showFillMode && (
        <>
          <div className={styles.sep} />
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
        </>
      )}

      {/* ── Number marker shape (number tool only) ── */}
      {showNumberShape && (
        <>
          <div className={styles.sep} />
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
        </>
      )}

      {/* ── Font size (text only) ── */}
      {showFontSize && (
        <>
          <div className={styles.sep} />
          <div className={styles.group}>
            <label className={styles.fontSizeLabel}>
              <Type size={12} strokeWidth={1.5} />
              <input
                type="range"
                min={10}
                max={80}
                step={2}
                value={fontSize}
                onChange={(e) => onFontSize(Number(e.target.value))}
                className={styles.fontSizeRange}
              />
              <span className={styles.fontSizeVal}>{fontSize}</span>
            </label>
          </div>
        </>
      )}

      <div className={styles.sep} />

      {/* ── Corner radius ── */}
      <div className={styles.group}>
        <label className={styles.fontSizeLabel} title="Corner radius">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
            <rect x="1.5" y="1.5" width="10" height="10" rx="3.5" stroke="currentColor" strokeWidth="1.5"/>
          </svg>
          <input
            type="range" min={0} max={60} step={2}
            value={frame.radius}
            onChange={(e) => onFrame({ radius: Number(e.target.value) })}
            className={styles.radiusRange}
          />
          <span className={styles.fontSizeVal}>{frame.radius}</span>
        </label>
      </div>

      <div className={styles.sep} />

      {/* ── Undo / Redo / Clear ── */}
      <div className={styles.group}>
        <button
          className={styles.toolBtn}
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
        >
          <Undo2 size={14} strokeWidth={1.5} />
        </button>
        <button
          className={styles.toolBtn}
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (Ctrl+Y)"
        >
          <Redo2 size={14} strokeWidth={1.5} />
        </button>
        <button
          className={`${styles.toolBtn} ${styles.danger}`}
          onClick={onClear}
          title="Clear all"
        >
          <Eraser size={14} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  )
}
