import { Fragment } from 'react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Circle,
  Droplets,
  RefreshCw,
  RotateCw,
  Square,
  Type,
} from 'lucide-react'
import type { AnnotationTool, FillMode } from '../lib/store'
import type { ArrowHead, TextBgFill, TextShape } from '../lib/annotations'
import { NumField } from './Toolbar'
import ColorSwatchPicker from './ColorSwatchPicker'
import styles from './Toolbar.module.css'

interface Props {
  activeTool: AnnotationTool
  /** Only used as the glow-color swatch's preview while its color is "auto"
   *  (glow's auto falls back to the ink color, unlike drop's fixed black). */
  activeColor: string
  strokeWidth: number
  fontSize: number
  fillMode: FillMode
  numberShape: 'circle' | 'square'
  numberRadius: number
  arrowHead: ArrowHead
  doubleEndedArrow: boolean
  arrowStyle: 'straight' | 'elbow'
  textShape: TextShape
  /** How the box/bubble background currently paints — see `TextBgFill`.
   *  Ignored while `textShape === 'none'`. */
  bgFill: TextBgFill
  textAlign: 'left' | 'center' | 'right'
  blurStrength: number
  spotlightDim: number
  spotlightShape: 'circle' | 'square'
  magnifierShape: 'circle' | 'square'
  imageBorder: boolean
  /** The active tool/selection's current shadow/glow style — see
   *  `getShadowStyle`. Shown only for `SHADOW_CAPABLE` types. */
  shadowStyle: 'none' | 'drop' | 'glow'
  /** Drop-shadow direction, degrees — see `AnnotationBase.shadowAngle`. Only
   *  meaningful (and only shown) for `shadowStyle === 'drop'`. */
  shadowAngle: number
  /** Drop-shadow offset distance, 0-100 — see `AnnotationBase.shadowSize`.
   *  Only meaningful (and only shown) for `shadowStyle === 'drop'`, same as
   *  `shadowAngle` — `'glow'` has no direction to cast a distance along. */
  shadowSize: number
  /** Shadow/glow blur radius, 0-100 — see `AnnotationBase.shadowBlur`.
   *  Independent of `shadowSize`, and shown for both styles. */
  shadowBlur: number
  /** Shadow/glow color override; `null` = auto (black for drop, the ink
   *  color for glow) — see `AnnotationBase.shadowColor`. */
  shadowColor: string | null
  selectedAnnotationType?: string | null
  onStrokeWidth: (w: number) => void
  onFontSize: (s: number) => void
  onFillMode: (m: FillMode) => void
  onNumberShape: (s: 'circle' | 'square') => void
  onNumberRadius: (r: number) => void
  onArrowHead: (h: ArrowHead) => void
  onDoubleEndedArrow: (d: boolean) => void
  onArrowStyle: (s: 'straight' | 'elbow') => void
  onTextShape: (s: TextShape) => void
  onBgFill: (f: TextBgFill) => void
  onTextAlign: (a: 'left' | 'center' | 'right') => void
  onBlurStrength: (s: number) => void
  onSpotlightDim: (d: number) => void
  onSpotlightShape: (s: 'circle' | 'square') => void
  onMagnifierShape: (s: 'circle' | 'square') => void
  onImageBorder: (b: boolean) => void
  onShadowStyle: (s: 'none' | 'drop' | 'glow') => void
  onShadowAngle: (deg: number) => void
  onShadowSize: (s: number) => void
  onShadowBlur: (b: number) => void
  onShadowColor: (hex: string | null) => void
  onImageResetAspect: () => void
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

// White is a fixed literal fill (not `currentColor`) — this option always
// means white, regardless of the annotation's own accent color.
const WhiteFillIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14">
    <rect x="1.5" y="1.5" width="11" height="11" rx="1.5" fill="#fff" stroke="currentColor" strokeWidth="1.5"/>
  </svg>
)

const TEXT_BG_FILLS: { id: TextBgFill; icon: React.ReactNode; label: string; short: string }[] = [
  { id: 'solid',  icon: <SolidFillIcon />,  label: 'Solid fill', short: 'Solid' },
  { id: 'white',  icon: <WhiteFillIcon />,  label: 'White background with border', short: 'White' },
  { id: 'stroke', icon: <StrokeOnlyIcon />, label: 'Transparent background (outline only)', short: 'Outline' },
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

const ARROW_HEADS: { id: ArrowHead; icon: React.ReactNode; label: string; short: string }[] = [
  { id: 'triangle', icon: <TriangleHeadIcon />, label: 'Triangle head', short: 'Triangle' },
  { id: 'line',     icon: <LineHeadIcon />,     label: 'Line head', short: 'Line' },
  { id: 'dot',      icon: <DotHeadIcon />,      label: 'Dot head', short: 'Dot' },
  { id: 'none',     icon: <NoHeadIcon />,       label: 'No head (plain line)', short: 'None' },
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

// The same little picture glyph both times — only the frame around it
// changes, so the pair reads as one setting rather than two pictures.
const PictureGlyph = () => (
  <>
    <path d="M2.5 10.5 L6 6.5 L8 8.5 L10 6.5 L13.5 10.5 Z" fill="currentColor" fillOpacity="0.6"/>
    <circle cx="4.6" cy="4.4" r="1.2" fill="currentColor"/>
  </>
)
const ImagePlainIcon = () => (
  <svg width="16" height="14" viewBox="0 0 16 14" fill="none"><PictureGlyph /></svg>
)
const ImageBorderIcon = () => (
  <svg width="16" height="14" viewBox="0 0 16 14" fill="none">
    <PictureGlyph />
    <rect x="1" y="1" width="14" height="12" rx="1" stroke="currentColor" strokeWidth="1.8"/>
  </svg>
)

const IMAGE_BORDERS: { id: boolean; icon: React.ReactNode; label: string }[] = [
  { id: false, icon: <ImagePlainIcon />,  label: 'No border' },
  { id: true,  icon: <ImageBorderIcon />, label: 'Border' },
]

const ShadowOffIcon = () => (
  <svg width="16" height="14" viewBox="0 0 16 14">
    <rect x="2" y="1.5" width="11" height="10" rx="1.5" fill="currentColor" fillOpacity="0.18" stroke="currentColor" strokeWidth="1.3"/>
  </svg>
)
const ShadowDropIcon = () => (
  <svg width="16" height="14" viewBox="0 0 16 14">
    <rect x="4" y="3.5" width="11" height="10" rx="1.5" fill="currentColor" fillOpacity="0.35"/>
    <rect x="2" y="1.5" width="11" height="10" rx="1.5" fill="currentColor" fillOpacity="0.18" stroke="currentColor" strokeWidth="1.3"/>
  </svg>
)
// A soft radial halo behind the same shape, rather than an offset copy —
// reads as "glowing" instead of "lifted off the page" like the drop shadow does.
const ShadowGlowIcon = () => (
  <svg width="16" height="14" viewBox="0 0 16 14">
    <defs>
      <radialGradient id="shadowGlowFade" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="currentColor" stopOpacity="0.55"/>
        <stop offset="100%" stopColor="currentColor" stopOpacity="0"/>
      </radialGradient>
    </defs>
    <rect x="0.5" y="0" width="15" height="14" rx="3" fill="url(#shadowGlowFade)"/>
    <rect x="3.5" y="2.5" width="9" height="9" rx="1.5" fill="currentColor" fillOpacity="0.18" stroke="currentColor" strokeWidth="1.3"/>
  </svg>
)

const SHADOW_OPTIONS: { id: 'none' | 'drop' | 'glow'; icon: React.ReactNode; label: string }[] = [
  { id: 'none', icon: <ShadowOffIcon />,  label: 'No shadow' },
  { id: 'drop', icon: <ShadowDropIcon />, label: 'Drop shadow' },
  { id: 'glow', icon: <ShadowGlowIcon />, label: 'Glow' },
]

/**
 * Vertical panel docked to the editor's right edge, holding every option
 * specific to the active tool (or the selected annotation's type, when using
 * Select) — everything Toolbar's row 1 doesn't. Used to be a second toolbar
 * row instead: horizontal groups packed edge to edge got cramped as more
 * per-tool controls (shadow/glow, text background fill, …) were added, and a
 * row's height is a hard ceiling a vertical list doesn't have — it just
 * scrolls. Always docked, even with nothing to show for the active tool/
 * selection (a "No options" placeholder takes the empty slot) — a panel that
 * only sometimes exists would shift the canvas width every time the tool
 * changes, more disruptive than the fixed width it costs.
 */
export default function ToolOptionsPanel({
  activeTool, activeColor, strokeWidth, fontSize, fillMode, numberShape, numberRadius, arrowHead, doubleEndedArrow, arrowStyle, textShape, bgFill, textAlign,
  blurStrength, spotlightDim, spotlightShape, magnifierShape, imageBorder, shadowStyle, shadowAngle, shadowSize, shadowBlur, shadowColor,
  selectedAnnotationType,
  onStrokeWidth, onFontSize, onFillMode, onNumberShape, onNumberRadius, onArrowHead, onDoubleEndedArrow, onArrowStyle, onTextShape, onBgFill, onTextAlign,
  onBlurStrength, onSpotlightDim, onSpotlightShape, onMagnifierShape, onImageBorder, onShadowStyle, onShadowAngle, onShadowSize, onShadowBlur, onShadowColor, onImageResetAspect,
}: Props) {
  // Only a boxed/bubbled text has a background to auto-track — plain text's
  // "color" is the font color directly.
  const isBoxedText = (activeTool === 'text' || selectedAnnotationType === 'text') && textShape !== 'none'

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
  // Pasted pictures have no tool of their own (Ctrl+V places them), so their
  // options appear only while one is selected.
  const isImage = selectedAnnotationType === 'image'
  // Mirrors annotations.ts's SHADOW_CAPABLE — the "ink" tools a shadow reads
  // as depth on. blur/spotlight/magnifier dim or resample the image rather
  // than painting their own fill/stroke, so they're left out (like isImage,
  // a picture has no tool of its own and is reached only via selection).
  const SHADOW_TOOLS = ['arrow', 'line', 'pen', 'rect', 'ellipse', 'text', 'number', 'highlight']
  const showShadow = SHADOW_TOOLS.includes(activeTool) || SHADOW_TOOLS.includes(selectedAnnotationType ?? '') || isImage
  // Stroke width only matters for tools that actually stroke a path — for
  // text/number/blur/spotlight the slider is dead weight, so it lives in the
  // per-tool options row instead of the always-visible main row.
  const STROKED_TOOLS = ['arrow', 'pen', 'line', 'rect', 'ellipse', 'highlight', 'magnifier']
  const showStroke = STROKED_TOOLS.includes(activeTool)
    || STROKED_TOOLS.includes(selectedAnnotationType ?? '')
    // A picture's only stroke is its border, so the width slider is dead
    // weight until that border is actually on.
    || (isImage && imageBorder)
  // A text box's border only exists in the 'white'/'stroke' fills — plain
  // 'solid' paints its background with `color` alone, no separate `sw` line.
  // Pushed from inside the text section below (after Background), not here
  // with the other tools' stroke widths, since it only makes sense once
  // Background has already picked a fill that has a border to size.
  const showTextBorderWidth = isBoxedText && (bgFill === 'stroke' || bgFill === 'white')

  // Built as a list rather than inline-conditional JSX so separators between
  // the *present* groups only land between them, regardless of which subset
  // of tools qualifies. `heading` labels the section in the panel — with
  // several sections stacked vertically and no row boundary between them
  // (unlike the old horizontal row's implicit left-to-right grouping), a
  // bare row of icons read as one undifferentiated block.
  const optionBlocks: { key: string; heading: string; node: React.ReactNode }[] = []
  if (showFillMode) {
    optionBlocks.push({
      key: 'fill',
      heading: 'Fill',
      node: (
        <div className={`${styles.group} ${styles.groupWrap}`}>
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
      heading: 'Arrow Head',
      node: (
        <div className={`${styles.group} ${styles.groupWrap}`}>
          {ARROW_HEADS.map(({ id, icon, label, short }) => (
            <button
              key={id}
              className={`${styles.fillBtn} ${arrowHead === id ? styles.active : ''}`}
              onClick={() => onArrowHead(id)}
              title={label}
            >
              {icon}
              <span className={styles.fillLabel}>{short}</span>
            </button>
          ))}
        </div>
      ),
    })
    optionBlocks.push({
      key: 'arrowends',
      heading: 'Ends',
      node: (
        <div className={`${styles.group} ${styles.groupWrap}`}>
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
      heading: 'Path',
      node: (
        <div className={`${styles.group} ${styles.groupWrap}`}>
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
      heading: 'Marker Shape',
      node: (
        <div className={`${styles.group} ${styles.groupWrap}`}>
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
      heading: 'Marker Size',
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
      heading: 'Blur Strength',
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
      heading: 'Spotlight Shape',
      node: (
        <div className={`${styles.group} ${styles.groupWrap}`}>
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
      heading: 'Dim',
      node: (
        <div className={`${styles.group} ${styles.groupWrap}`}>
          {SPOTLIGHT_DIMS.map(({ id, icon, label }) => (
            <button
              key={id}
              className={`${styles.fillBtn} ${Math.abs(spotlightDim - id) < 0.01 ? styles.active : ''}`}
              onClick={() => onSpotlightDim(id)}
              title={label}
            >
              {icon}
              <span className={styles.fillLabel}>{label}</span>
            </button>
          ))}
        </div>
      ),
    })
  }
  if (showMagnifierShape) {
    optionBlocks.push({
      key: 'magnifiershape',
      heading: 'Magnifier Shape',
      node: (
        <div className={`${styles.group} ${styles.groupWrap}`}>
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
  if (isImage) {
    optionBlocks.push({
      key: 'imageborder',
      heading: 'Border',
      node: (
        <div className={`${styles.group} ${styles.groupWrap}`}>
          {IMAGE_BORDERS.map(({ id, icon, label }) => (
            <button
              key={String(id)}
              className={`${styles.fillBtn} ${imageBorder === id ? styles.active : ''}`}
              onClick={() => onImageBorder(id)}
              title={label}
            >
              {icon}
            </button>
          ))}
          <button
            className={styles.fillBtn}
            onClick={onImageResetAspect}
            title="Reset aspect ratio"
          >
            <RefreshCw size={14} strokeWidth={1.5} />
            <span className={styles.fillLabel}>Reset</span>
          </button>
        </div>
      ),
    })
  }
  // Shared by both push sites below (generic tools vs. text's border width) —
  // same control either way, just a different heading/title and a different
  // spot in the panel.
  const pushStrokeBlock = () => {
    const strokeHeading = isMarker ? 'Marker Width' : isMagnifier ? 'Frame Width' : isImage || showTextBorderWidth ? 'Border Width' : 'Stroke Width'
    optionBlocks.push({
      key: 'stroke',
      heading: strokeHeading,
      node: (
        <div className={styles.group}>
          <label className={styles.fontSizeLabel} title={strokeHeading}>
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
  if (showStroke) pushStrokeBlock()
  if (showFontSize) {
    optionBlocks.push({
      key: 'textshape',
      heading: 'Text Shape',
      node: (
        <div className={`${styles.group} ${styles.groupWrap}`}>
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
    if (textShape !== 'none') {
      optionBlocks.push({
        key: 'bgfill',
        heading: 'Background',
        node: (
          <div className={`${styles.group} ${styles.groupWrap}`}>
            {TEXT_BG_FILLS.map(({ id, icon, label, short }) => (
              <button
                key={id}
                className={`${styles.fillBtn} ${bgFill === id ? styles.active : ''}`}
                onClick={() => onBgFill(id)}
                title={label}
              >
                {icon}
                <span className={styles.fillLabel}>{short}</span>
              </button>
            ))}
          </div>
        ),
      })
    }
    // Border width for a boxed/bubbled text's 'white'/'stroke' fill — placed
    // right after Background (rather than up with the other tools' stroke
    // widths) since it only applies once Background has picked a fill that
    // actually has a border to size.
    if (showTextBorderWidth) pushStrokeBlock()
    optionBlocks.push({
      key: 'textalign',
      heading: 'Align',
      node: (
        <div className={`${styles.group} ${styles.groupWrap}`}>
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
    // No sidebar control for tail position: it's already reachable by
    // dragging the tail handle directly on the canvas (onResizeTail, snaps
    // to the nearest of the 16 compass anchors), which is more direct than
    // a separate compass popup here for something you're already looking at
    // and adjusting visually on the shape itself.
    optionBlocks.push({
      key: 'fontsize',
      heading: 'Font Size',
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
  // Pushed last, after every other tool-specific block above, so it always
  // renders as the panel's bottommost group regardless of which tool is
  // active — shadow/glow applies uniformly across tools (SHADOW_TOOLS) and
  // reads as a shared finishing touch rather than one more per-tool option.
  if (showShadow) {
    optionBlocks.push({
      key: 'shadow',
      heading: 'Shadow / Glow',
      node: (
        <div className={`${styles.group} ${styles.groupWrap}`}>
          {SHADOW_OPTIONS.map(({ id, icon, label }) => (
            <button
              key={String(id)}
              className={`${styles.fillBtn} ${shadowStyle === id ? styles.active : ''}`}
              onClick={() => onShadowStyle(id)}
              title={label}
            >
              {icon}
              <span className={styles.fillLabel}>{label}</span>
            </button>
          ))}
        </div>
      ),
    })
    if (shadowStyle !== 'none') {
      // Glow has no direction (it's centered) or a distance to cast along,
      // so angle and size only apply to — and only show for — a drop shadow.
      if (shadowStyle === 'drop') {
        optionBlocks.push({
          key: 'shadowangle',
          heading: 'Angle',
          node: (
            <div className={styles.group}>
              <label className={styles.fontSizeLabel} title="Shadow direction">
                <RotateCw size={12} strokeWidth={1.5} style={{ transform: `rotate(${shadowAngle}deg)` }} />
                <input
                  type="range"
                  min={0}
                  max={360}
                  step={15}
                  value={shadowAngle}
                  onChange={(e) => onShadowAngle(Number(e.target.value))}
                  className={styles.fontSizeRange}
                />
                <NumField value={Math.round(shadowAngle)} min={0} max={360} onCommit={(v) => onShadowAngle(Math.round(v / 15) * 15)} suffix="°" />
              </label>
            </div>
          ),
        })
        optionBlocks.push({
          key: 'shadowsize',
          heading: 'Size',
          node: (
            <div className={styles.group}>
              {/* Small circle left, big circle right — same "drag right = more"
                  bracketing as the stroke-width/blur-strength sliders. */}
              <label className={styles.fontSizeLabel} title="Shadow offset distance">
                <Circle size={8} strokeWidth={2} />
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={shadowSize}
                  onChange={(e) => onShadowSize(Number(e.target.value))}
                  className={styles.fontSizeRange}
                />
                <Circle size={14} strokeWidth={2} />
                <NumField value={Math.round(shadowSize)} min={0} max={100} onCommit={onShadowSize} />
              </label>
            </div>
          ),
        })
      }
      optionBlocks.push({
        key: 'shadowblur',
        heading: 'Blur',
        node: (
          <div className={styles.group}>
            {/* Weak droplet left, strong right — same bracketing as the
                Blur-tool's own strength slider, since this is the same
                "how soft" idea applied to a shadow instead of the image. */}
            <label className={styles.fontSizeLabel} title={shadowStyle === 'glow' ? 'Glow blur radius' : 'Shadow blur radius'}>
              <Droplets size={10} strokeWidth={1.5} />
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={shadowBlur}
                onChange={(e) => onShadowBlur(Number(e.target.value))}
                className={styles.fontSizeRange}
              />
              <Droplets size={16} strokeWidth={1.5} />
              <NumField value={Math.round(shadowBlur)} min={0} max={100} onCommit={onShadowBlur} />
            </label>
          </div>
        ),
      })
      optionBlocks.push({
        key: 'shadowcolor',
        heading: 'Color',
        node: (
          <div className={styles.group}>
            <ColorSwatchPicker
              value={shadowColor ?? (shadowStyle === 'glow' ? activeColor : '#000000')}
              onChange={onShadowColor}
              title={shadowColor == null ? `${shadowStyle === 'glow' ? 'Glow' : 'Shadow'} color (auto)` : `${shadowStyle === 'glow' ? 'Glow' : 'Shadow'} color`}
              auto={{
                active: shadowColor == null,
                onClick: () => onShadowColor(null),
                title: shadowStyle === 'glow' ? 'Auto (matches the ink color)' : 'Auto (neutral black)',
              }}
            />
          </div>
        ),
      })
    }
  }

  return (
    <aside className={styles.optionsPanel}>
      {optionBlocks.length > 0 ? (
        optionBlocks.map(({ key, heading, node }, i) => (
          <Fragment key={key}>
            {i > 0 && <div className={styles.sepH} />}
            <div className={styles.panelSection}>
              <div className={styles.panelSectionHeading}>{heading}</div>
              {node}
            </div>
          </Fragment>
        ))
      ) : (
        <span className={styles.optionsPanelEmpty}>No options for this tool</span>
      )}
    </aside>
  )
}
