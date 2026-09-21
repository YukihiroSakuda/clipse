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
  Eraser,
  Focus,
  Highlighter,
  Image as ImageIcon,
  Minus,
  MousePointer2,
  PaintBucket,
  Pencil,
  Pipette,
  RefreshCw,
  RotateCw,
  Square,
  Type,
  Wand2,
  ZoomIn,
} from 'lucide-react'
import type { AnnotationTool, FillMode } from '../lib/store'
import type { ArrowHead, TextBgFill, TextShape } from '../lib/annotations'
import { NumField } from './Toolbar'
import ColorSwatchPicker from './ColorSwatchPicker'
import styles from './Toolbar.module.css'

/** Icon + display name for the panel's own "current tool" header (see the
 *  doc comment above the component) — a separate, presentation-only map
 *  rather than reusing Toolbar's `TOOLS` array, since that array's `label`
 *  strings are tooltips ("Arrow (F1)") and it has no entry for `'image'`
 *  (a pasted picture has no tool of its own, only a selected type) or for
 *  `'line'` (removed as a tool, but an old document can still have one
 *  selected). */
const TOOL_INFO: Partial<Record<string, { icon: React.ReactNode; label: string }>> = {
  select: { icon: <MousePointer2 size={13} strokeWidth={1.5} />, label: 'Select' },
  arrow: { icon: <ArrowUpRight size={13} strokeWidth={2} />, label: 'Arrow' },
  line: { icon: <Minus size={13} strokeWidth={2} />, label: 'Line' },
  pen: { icon: <Pencil size={13} strokeWidth={1.5} />, label: 'Pen' },
  rect: { icon: <Square size={13} strokeWidth={1.5} />, label: 'Rectangle' },
  ellipse: { icon: <Circle size={13} strokeWidth={1.5} />, label: 'Ellipse' },
  text: { icon: <Type size={13} strokeWidth={1.5} />, label: 'Text' },
  number: { icon: <span className={styles.numIcon}>1</span>, label: 'Number marker' },
  highlight: { icon: <Highlighter size={13} strokeWidth={1.5} />, label: 'Highlight' },
  blur: { icon: <Droplets size={13} strokeWidth={1.5} />, label: 'Blur / Redact' },
  spotlight: { icon: <Focus size={13} strokeWidth={1.5} />, label: 'Spotlight' },
  crop: { icon: <Crop size={13} strokeWidth={1.5} />, label: 'Crop' },
  magnifier: { icon: <ZoomIn size={13} strokeWidth={1.5} />, label: 'Magnifier' },
  erase: { icon: <Wand2 size={13} strokeWidth={1.5} />, label: 'Magic Wand' },
  picker: { icon: <Pipette size={13} strokeWidth={1.5} />, label: 'Color Picker' },
  image: { icon: <ImageIcon size={13} strokeWidth={1.5} />, label: 'Picture' },
}

interface Props {
  activeTool: AnnotationTool
  /** Only used as the glow-color swatch's preview while its color is "auto"
   *  (glow's auto falls back to the ink color, unlike drop's fixed black). */
  activeColor: string
  /** Custom colors added via the picker (max 5) — passed straight through to
   *  the Style block's `ColorSwatchPicker`, same as Toolbar used to. */
  recentColors: string[]
  /** Shared ink opacity 0..1 — see the doc comment above `showOpacity`
   *  below for why this lives here instead of the always-visible toolbar. */
  opacity: number
  strokeWidth: number
  fontSize: number
  fillMode: FillMode
  /** Stroke pattern for arrow/pen/line, or rect/ellipse when `fillMode` is
   *  `'stroke'` — see `AnnotationBase.dash`. */
  lineDash: 'solid' | 'dashed' | 'dotted'
  /** Corner radius (image px) for a rect — see `RectAnn.radius`. */
  rectRadius: number
  numberShape: 'circle' | 'square'
  numberRadius: number
  arrowHead: ArrowHead
  doubleEndedArrow: boolean
  arrowStyle: 'straight' | 'elbow'
  textShape: TextShape
  /** How the box/bubble background currently paints — see `TextBgFill`.
   *  Ignored while `textShape === 'none'`. */
  bgFill: TextBgFill
  /** Resolved background/text colors for a `bgFill === 'solid'` box/bubble
   *  text — shown as two separate swatches (Background + Text Color)
   *  instead of the plain shared `activeColor` one. `null` whenever that
   *  doesn't apply (any other fill, tool, or selection), in which case the
   *  Text Color swatch isn't shown at all and Background falls back to
   *  `activeColor`. See `Editor.tsx`'s computation of these for exactly
   *  which cases qualify (a uniform 'solid' text selection, or nothing
   *  selected while Text/'solid' are the active tool/default). */
  textBoxBg: string | null
  textBoxBgAuto: boolean
  textBoxFontColor: string | null
  textAlign: 'left' | 'center' | 'right'
  blurStrength: number
  eraseTolerance: number
  /** True while the selected `erase` annotation predates the tool's
   *  simplification down to Erase/Fill and was built by combining more than
   *  one color match (see `EraseAnn.compound`) — its mask is no longer a
   *  pure function of tolerance, so Tolerance is hidden rather than shown
   *  re-deriving (and silently discarding) something it can't actually
   *  change. False (never hides it) while nothing `erase`-typed is
   *  selected, since it still steers the *next* click. */
  eraseCompound: boolean
  /** Wider than the tool actually offers (see `onEraseEffect`'s doc
   *  comment) so an old document's `'blur'`/`'pixelate'` value still
   *  displays correctly if selected. */
  eraseEffect: 'erase' | 'fill' | 'blur' | 'pixelate'
  eraseFillColor: string
  spotlightDim: number
  spotlightShape: 'circle' | 'square'
  magnifierShape: 'circle' | 'square'
  imageBorder: boolean
  /** The active tool/selection's current shadow/glow style — see
   *  `getShadowStyle`. Shown only for `SHADOW_CAPABLE` types. */
  shadowStyle: 'none' | 'drop' | 'glow'
  /** Drop-shadow direction, degrees — see `AnnotationBase.shadowAngle`. Only
   *  meaningful (and only shown) for `shadowStyle === 'drop'` — `'glow'` has
   *  no direction to cast a distance along. */
  shadowAngle: number
  /** Drop-shadow offset distance, 0-100 — see `AnnotationBase.shadowSize`.
   *  Only meaningful (and only shown) for `shadowStyle === 'drop'`, same as
   *  `shadowAngle` — `'glow'` has no direction to cast a distance along. */
  shadowSize: number
  /** Shadow/glow blur radius, 0-100 — see `AnnotationBase.shadowBlur`.
   *  Independent of `shadowSize`, and shown for both styles. */
  shadowBlur: number
  /** Shadow/glow opacity, 0-100 — see `AnnotationBase.shadowOpacity`.
   *  Independent of `shadowSize`/`shadowBlur`, and shown for both styles. */
  shadowOpacity: number
  /** Shadow/glow color override; `null` = auto (black for drop, the ink
   *  color for glow) — see `AnnotationBase.shadowColor`. */
  shadowColor: string | null
  selectedAnnotationType?: string | null
  /** Switches the active tool — only used by the Style block's eyedropper
   *  button (`onTool('picker')`), the same "lives next to the palette it
   *  feeds" reasoning Toolbar used before Color moved here. */
  onTool: (t: AnnotationTool) => void
  onColor: (hex: string) => void
  onOpacity: (o: number) => void
  onStrokeWidth: (w: number) => void
  onFontSize: (s: number) => void
  onFillMode: (m: FillMode) => void
  onLineDash: (d: 'solid' | 'dashed' | 'dotted') => void
  onRectRadius: (r: number) => void
  onNumberShape: (s: 'circle' | 'square') => void
  onNumberRadius: (r: number) => void
  onArrowHead: (h: ArrowHead) => void
  onDoubleEndedArrow: (d: boolean) => void
  onArrowStyle: (s: 'straight' | 'elbow') => void
  onTextShape: (s: TextShape) => void
  onBgFill: (f: TextBgFill) => void
  /** Background swatch's own Auto entry — see `TextAnn.bgAuto`. */
  onBgAuto: () => void
  /** Text Color swatch: picks an explicit color. */
  onTextColorPick: (hex: string) => void
  /** Text Color swatch's own Auto entry. */
  onTextColorAuto: () => void
  onTextAlign: (a: 'left' | 'center' | 'right') => void
  onBlurStrength: (s: number) => void
  onEraseTolerance: (t: number) => void
  /** Wider than the two buttons that call it (Erase/Fill only — see the
   *  Effect block) so the type still matches `EraseAnn.effect` for reading
   *  an old document's value; nothing in this component ever invokes it
   *  with `'blur'`/`'pixelate'`. */
  onEraseEffect: (e: 'erase' | 'fill' | 'blur' | 'pixelate') => void
  onEraseFillColor: (hex: string) => void
  onSpotlightDim: (d: number) => void
  onSpotlightShape: (s: 'circle' | 'square') => void
  onMagnifierShape: (s: 'circle' | 'square') => void
  onImageBorder: (b: boolean) => void
  onShadowStyle: (s: 'none' | 'drop' | 'glow') => void
  onShadowAngle: (deg: number) => void
  onShadowSize: (s: number) => void
  onShadowBlur: (b: number) => void
  onShadowOpacity: (o: number) => void
  onShadowColor: (hex: string | null) => void
  /** Applies a whole preset atomically (one undo step, not five) — see
   *  `SHADOW_PRESETS`. */
  onShadowPreset: (style: 'drop' | 'glow', angle: number, size: number, blur: number, opacity: number) => void
  onImageResetAspect: () => void
}

// A circle whose fill fades out left → right — "the ink getting more
// transparent" read directly, which survives 14px better than the classic
// checkerboard glyph (whose tiny squares just read as noise at this size).
// Moved here from Toolbar.tsx along with the slider itself — see
// `showOpacity` below.
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

// Sharp square left, rounded square right — brackets the Corner Radius
// slider the same "drag right = more" way ThinLineIcon/ThickLineIcon do.
const SharpCornerIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <rect x="1.5" y="1.5" width="11" height="11" strokeWidth="1.5" stroke="currentColor"/>
  </svg>
)
const RoundCornerIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <rect x="1.5" y="1.5" width="11" height="11" rx="4.5" strokeWidth="1.5" stroke="currentColor"/>
  </svg>
)

// Line-style quick-pick icons — a straight, dashed, and dotted segment,
// each literally showing the pattern it picks rather than needing a label.
const SolidLineDashIcon = () => (
  <svg width="16" height="14" viewBox="0 0 16 14" fill="none">
    <line x1="1.5" y1="7" x2="14.5" y2="7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
  </svg>
)
const DashedLineIcon = () => (
  <svg width="16" height="14" viewBox="0 0 16 14" fill="none">
    <line x1="1.5" y1="7" x2="14.5" y2="7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeDasharray="4 3"/>
  </svg>
)
const DottedLineIcon = () => (
  <svg width="16" height="14" viewBox="0 0 16 14" fill="none">
    <line x1="1.5" y1="7" x2="14.5" y2="7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeDasharray="0.1 3.2"/>
  </svg>
)

const StrokeOnlyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <rect x="1.5" y="1.5" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
  </svg>
)
const SolidFillIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14">
    <rect x="1.5" y="1.5" width="11" height="11" rx="1.5" fill="currentColor" stroke="currentColor" strokeWidth="1.5"/>
  </svg>
)

// 'semi' dropped from the UI — it was just `fillRect`/`fill()` at
// `opacity * 0.35` (see the 'rect'/'ellipse' cases in drawAnnotationInner),
// a fixed preset entirely downstream of the Opacity slider that's already
// right there and freely adjustable; 'solid' at 35% opacity reaches the
// exact same pixels. The type/rendering stay so an old document saved with
// `fill: 'semi'` keeps rendering as it did — see FillMode's own comment.
const FILL_MODES: { id: FillMode; icon: React.ReactNode; label: string }[] = [
  { id: 'stroke', icon: <StrokeOnlyIcon />,  label: 'Stroke only' },
  { id: 'solid',  icon: <SolidFillIcon />,   label: 'Solid fill' },
]

const LINE_DASHES: { id: 'solid' | 'dashed' | 'dotted'; icon: React.ReactNode; label: string }[] = [
  { id: 'solid',  icon: <SolidLineDashIcon />, label: 'Solid line' },
  { id: 'dashed', icon: <DashedLineIcon />,    label: 'Dashed line' },
  { id: 'dotted', icon: <DottedLineIcon />,    label: 'Dotted line' },
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

// Same offset-copy trick as `ShadowDropIcon`, but with `dx`/`dy`/`opacity`
// as knobs so each drop preset's icon actually looks like what it sets —
// closer/fainter for Soft, further/fainter for Long, and so on — rather
// than every preset button showing the same fixed glyph.
const ShadowPresetIcon = ({ dx, dy, opacity }: { dx: number; dy: number; opacity: number }) => (
  <svg width="16" height="14" viewBox="0 0 16 14">
    <rect x={2 + dx} y={1.5 + dy} width="11" height="10" rx="1.5" fill="currentColor" fillOpacity={opacity}/>
    <rect x="2" y="1.5" width="11" height="10" rx="1.5" fill="var(--color-panel)" stroke="currentColor" strokeWidth="1.3"/>
  </svg>
)
// Same radial-halo trick as `ShadowGlowIcon`, parametrized the same way —
// `gradId` has to be unique per instance since several of these render at
// once (an SVG `<radialGradient id>` colliding with another on the same
// page resolves to whichever the browser saw first, not the one each
// `url(#…)` actually meant).
const GlowPresetIcon = ({ gradId, opacity }: { gradId: string; opacity: number }) => (
  <svg width="16" height="14" viewBox="0 0 16 14">
    <defs>
      <radialGradient id={gradId} cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="currentColor" stopOpacity={opacity}/>
        <stop offset="100%" stopColor="currentColor" stopOpacity="0"/>
      </radialGradient>
    </defs>
    <rect x="0.5" y="0" width="15" height="14" rx="3" fill={`url(#${gradId})`}/>
    <rect x="3.5" y="2.5" width="9" height="9" rx="1.5" fill="var(--color-panel)" stroke="currentColor" strokeWidth="1.3"/>
  </svg>
)

interface ShadowPreset {
  id: string
  label: string
  icon: React.ReactNode
  style: 'drop' | 'glow'
  angle: number
  size: number
  blur: number
  opacity: number
}
// A handful of one-click "looks" spanning the range Blur/Opacity cover —
// Soft/Hard/Sharp for drop (a plain-English "how soft vs. crisp the edge
// is" progression, low-to-no blur as it goes), Soft/Bright for glow (dim
// halo, strong halo) — rather than making every user find their own way to
// a decent-looking result by hand across five independent sliders. Only
// the preset matching the currently-selected Style is shown (filtered
// below), since one meant for the other style would just look wrong the
// instant it's applied. Color is deliberately left alone (Auto — see
// `onShadowPreset`) since a preset is about shape, not picking an accent.
const SHADOW_PRESETS: ShadowPreset[] = [
  { id: 'soft',  label: 'Soft',  icon: <ShadowPresetIcon dx={1} dy={1} opacity={0.3} />, style: 'drop', angle: 45, size: 12, blur: 65, opacity: 30 },
  { id: 'hard',  label: 'Hard',  icon: <ShadowPresetIcon dx={2} dy={2} opacity={0.55} />, style: 'drop', angle: 45, size: 15, blur: 15, opacity: 55 },
  { id: 'sharp', label: 'Sharp', icon: <ShadowPresetIcon dx={2} dy={2} opacity={0.65} />, style: 'drop', angle: 45, size: 20, blur: 0, opacity: 65 },
  { id: 'softglow',   label: 'Soft Glow',   icon: <GlowPresetIcon gradId="presetSoftGlow" opacity={0.4} />, style: 'glow', angle: 45, size: 10, blur: 45, opacity: 55 },
  { id: 'brightglow', label: 'Bright Glow', icon: <GlowPresetIcon gradId="presetBrightGlow" opacity={0.7} />, style: 'glow', angle: 45, size: 10, blur: 75, opacity: 90 },
]

/**
 * Vertical panel docked to the editor's right edge, holding Color/Opacity
 * (for whichever tools actually read them — see `showColor`/`showOpacity`)
 * plus every option specific to the active tool (or the selected
 * annotation's type, when using Select) — everything Toolbar's left-edge
 * toolbox doesn't. A sticky header pinned to the top (see `TOOL_INFO`) names
 * which tool/selection the panel below it belongs to — without it, nothing
 * on screen said that a slider here reads off whatever the *left* toolbox
 * has selected, two edges of the window apart. Used to be a second toolbar
 * row instead: horizontal groups packed edge to edge got cramped as more
 * per-tool controls (shadow/glow, text background fill, …) were added, and a
 * row's height is a hard ceiling a vertical list doesn't have — it just
 * scrolls. Always docked, even for a tool with nothing to show (e.g. Crop —
 * the header alone still names it) — a panel that only sometimes exists
 * would shift the canvas width every time the tool changes, more disruptive
 * than the fixed width it costs.
 */
export default function ToolOptionsPanel({
  activeTool, activeColor, recentColors, opacity, strokeWidth, fontSize, fillMode, lineDash, rectRadius, numberShape, numberRadius, arrowHead, doubleEndedArrow, arrowStyle, textShape, bgFill,
  textBoxBg, textBoxBgAuto, textBoxFontColor, textAlign,
  blurStrength, eraseTolerance, eraseCompound, eraseEffect, eraseFillColor, spotlightDim, spotlightShape, magnifierShape, imageBorder, shadowStyle, shadowAngle, shadowSize, shadowBlur, shadowOpacity, shadowColor,
  selectedAnnotationType,
  onTool, onColor, onOpacity, onStrokeWidth, onFontSize, onFillMode, onLineDash, onRectRadius, onNumberShape, onNumberRadius, onArrowHead, onDoubleEndedArrow, onArrowStyle, onTextShape, onBgFill,
  onBgAuto, onTextColorPick, onTextColorAuto, onTextAlign,
  onBlurStrength, onEraseTolerance, onEraseEffect, onEraseFillColor, onSpotlightDim, onSpotlightShape, onMagnifierShape, onImageBorder, onShadowStyle, onShadowAngle, onShadowSize, onShadowBlur, onShadowOpacity, onShadowColor, onShadowPreset, onImageResetAspect,
}: Props) {
  // Brief "copied" checkmark on the hex row after a click-to-copy — moved
  // here from Toolbar.tsx along with the Color swatch itself.
  const [hexCopied, setHexCopied] = useState(false)
  const hexCopiedTimer = useRef<number | undefined>(undefined)
  const copyHex = (hex: string) => {
    navigator.clipboard.writeText(hex.toUpperCase()).catch(() => {})
    setHexCopied(true)
    window.clearTimeout(hexCopiedTimer.current)
    hexCopiedTimer.current = window.setTimeout(() => setHexCopied(false), 1200)
  }
  useEffect(() => () => window.clearTimeout(hexCopiedTimer.current), [])

  // Options/Shadow tab — persists across tool switches like a normal tab
  // control (not reset every time the selection changes), so flipping
  // through several shapes to compare their shadows doesn't reset to
  // Options after each click. Only ever read through `activeTab` below,
  // which falls back to 'options' while the current tool/selection has no
  // Shadow tab to be on.
  const [tab, setTab] = useState<'options' | 'shadow'>('options')

  // Only a boxed/bubbled text has a background to auto-track — plain text's
  // "color" is the font color directly.
  const isBoxedText = (activeTool === 'text' || selectedAnnotationType === 'text') && textShape !== 'none'

  // Options show for the active drawing tool OR whenever the selection is of
  // that type — a selection can exist under any tool now (grab-after-create),
  // so gating on the Select tool would hide the very options the user is
  // trying to adjust on the shape they just placed.
  const showFillMode = activeTool === 'rect' || activeTool === 'ellipse'
    || selectedAnnotationType === 'rect' || selectedAnnotationType === 'ellipse'
  // Rect only — an ellipse has no corners to round.
  const showRectRadius = activeTool === 'rect' || selectedAnnotationType === 'rect'
  const showFontSize = activeTool === 'text' || selectedAnnotationType === 'text'
  const showNumberShape = activeTool === 'number' || selectedAnnotationType === 'number'
  const showArrowHead = activeTool === 'arrow' || selectedAnnotationType === 'arrow'
  const showBlurStrength = activeTool === 'blur' || selectedAnnotationType === 'blur'
  // Gates every Erase-tool block: Pick Mode, Tolerance, Effect, and (only
  // while Effect is Fill/Blur/Pixelate) Fill Color / strength. Same "adjust
  // after the fact" convention as blur/spotlight: showing while an erase
  // annotation is selected re-runs its color match from its own seed point
  // at the new tolerance/pick mode (see recomputeErase) instead of just
  // steering the next click — Effect/Fill Color/strength don't touch the
  // mask, so they skip that round trip (see Editor.tsx's handleEraseEffect).
  const showEraseOptions = activeTool === 'erase' || selectedAnnotationType === 'erase'
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
  const INK_TOOLS = ['arrow', 'line', 'pen', 'rect', 'ellipse', 'text', 'number', 'highlight']
  // A highlighter is a flat, translucent wash — a shadow/glow behind it
  // reads as an odd halo around a rectangle, not a lift-off-the-page effect,
  // so it's excluded here even though it's still a full INK_TOOLS member for
  // Opacity/Color below.
  const SHADOW_TOOLS = INK_TOOLS.filter((t) => t !== 'highlight')
  // A picture's shadow is only ever cast by its *border* stroke (see the
  // 'image' case in drawAnnotationInner) — the picture itself never casts
  // one — so, like Stroke Width below, this stays hidden until there's
  // actually a border to cast it.
  const showShadow = SHADOW_TOOLS.includes(activeTool) || SHADOW_TOOLS.includes(selectedAnnotationType ?? '') || (isImage && imageBorder)
  // Opacity used to sit in the always-visible top toolbar, which gave no
  // hint that it was a no-op for some tools — a slider that visibly does
  // nothing reads as broken, not as "not applicable here". It covers every
  // INK_TOOLS member (including highlight, unlike Shadow above), plus
  // magnifier (its frame/leader line) and erase (its whole point, once
  // selected) — but not blur/spotlight, which always paint at full strength
  // (`ctx.globalAlpha = 1` in `drawAnnotationInner`) since dimming *their*
  // effect isn't what "ink opacity" means for them.
  const OPACITY_TOOLS = [...INK_TOOLS, 'magnifier', 'erase']
  const showOpacity = OPACITY_TOOLS.includes(activeTool) || OPACITY_TOOLS.includes(selectedAnnotationType ?? '') || isImage
  // Same no-op-for-blur/spotlight reasoning as Opacity just above — neither
  // reads `ann.color` at all (blur samples the image, spotlight's dim is a
  // hardcoded `rgba(0,0,0,…)`), so showing a swatch that visibly changes
  // nothing is worse than not showing one. Kept for Select/Picker beyond
  // what Opacity allows, though: unlike Opacity, Color is still meaningful
  // with nothing selected — it's what the *next* shape will be drawn in,
  // the same role it had pinned in the always-visible top toolbar before
  // Color moved here.
  //
  // Erase is excluded even though it's in OPACITY_TOOLS: its `color` isn't
  // an ink choice at all, just the sampled seed color a re-click matches
  // against (see AnnotationCanvas's click handler) plus a legacy fallback
  // fill for documents predating `fillColor`. Editing it here doesn't
  // change anything on screen — the mask never reads `color` — it just
  // overwrites that identity, quietly breaking "click the same region again
  // to reselect it." Effect === 'fill' already has its own, real Fill Color
  // swatch further down for the paint color that *does* do something.
  // A picture's `color` is the same story as its shadow just above — read
  // only for the border stroke, so it's dead weight until `imageBorder` is
  // actually on.
  const COLOR_TOOLS = OPACITY_TOOLS.filter((t) => t !== 'erase')
  const showColor = COLOR_TOOLS.includes(activeTool) || COLOR_TOOLS.includes(selectedAnnotationType ?? '') || (isImage && imageBorder)
    || activeTool === 'select' || activeTool === 'picker'
  // Stroke width only matters for tools that actually stroke a path — for
  // text/number/blur/spotlight the slider is dead weight, so it lives in the
  // per-tool options row instead of the always-visible main row.
  const STROKED_TOOLS = ['arrow', 'pen', 'line', 'highlight', 'magnifier']
  // rect/ellipse only call `ctx.stroke()` for fillMode 'stroke' (outline
  // only) — 'solid'/'semi' each call `fillRect`/`fill()` alone with no
  // separate stroke at all (see their cases in drawAnnotationInner), so the
  // width slider is dead weight in either of those fill modes. `fillMode`
  // already reflects the *actual* selected shape's fill (or, with nothing
  // selected, what the next one will use — see its own prop wiring), so
  // this reads the same live value the Fill buttons above do.
  const isFillShape = activeTool === 'rect' || activeTool === 'ellipse'
    || selectedAnnotationType === 'rect' || selectedAnnotationType === 'ellipse'
  const showStroke = STROKED_TOOLS.includes(activeTool)
    || STROKED_TOOLS.includes(selectedAnnotationType ?? '')
    || (isFillShape && fillMode === 'stroke')
    // A picture's only stroke is its border, so the width slider is dead
    // weight until that border is actually on.
    || (isImage && imageBorder)
  // Dash pattern only makes sense for an actual drawn line — highlight (a
  // translucent marker bar) and magnifier (a UI frame) stay a plain solid
  // stroke on purpose, and an image's border reads as a card outline, not
  // a "line," so neither joins `STROKED_TOOLS` here the way they do for
  // Stroke Width above.
  const DASH_TOOLS = ['arrow', 'pen', 'line']
  const showDash = DASH_TOOLS.includes(activeTool) || DASH_TOOLS.includes(selectedAnnotationType ?? '')
    || (isFillShape && fillMode === 'stroke')
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
  // Shadow/Glow gets its own tab (see `tab` below) rather than sharing this
  // list — it's identical across every SHADOW_CAPABLE type and can run to
  // half a dozen sections on its own, which read as unrelated sliders piled
  // onto whichever tool happened to be active rather than one feature with
  // its own place.
  const shadowBlocks: { key: string; heading: string; node: React.ReactNode }[] = []
  // Text Shape goes first, ahead of even Color — it's what the rest of the
  // text options *mean*: 'none' leaves Color a single plain swatch; 'box'/
  // 'bubble' turn it into the Background/Text Color pair (see `showColor`
  // below) and unlock Background fill, Align and the border-width slider.
  // Deciding the container before its contents avoids showing a
  // Background/Text Color pair the user hasn't been told why they have yet.
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
  }
  // Fill Mode goes right after Text Shape, same reasoning — 'stroke' is the
  // one fill that unlocks a Stroke Width slider below, so the shape's fill
  // gets decided before the ink controls that depend on it.
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
  if (showRectRadius) {
    optionBlocks.push({
      key: 'rectradius',
      heading: 'Corner Radius',
      node: (
        <div className={styles.group}>
          {/* Sharp square left, rounded right — same "drag right = more"
              bracketing as the stroke-width/blur-strength sliders. */}
          <label className={styles.fontSizeLabel} title="Corner radius">
            <SharpCornerIcon />
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(rectRadius)}
              onChange={(e) => onRectRadius(Number(e.target.value))}
              className={styles.fontSizeRange}
            />
            <RoundCornerIcon />
            <NumField value={Math.round(rectRadius)} min={0} max={100} onCommit={onRectRadius} />
          </label>
        </div>
      ),
    })
  }
  // Same again for a pasted picture's Border toggle — it gates both Color
  // (a picture's own color is read only for the border stroke) and Stroke
  // Width below, so it needs to be decided before either of them, not sit
  // below both like it used to.
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
  // Color: shown for the same tools as Opacity (see showColor above), plus
  // Select/Picker so it still works as "the color the next shape will use"
  // with nothing selected — the role it had pinned in the always-visible
  // top toolbar before Color moved here. The eyedropper sits right next to
  // it, same reasoning as Toolbar's old comment: picking a color is a color
  // action, not a shape.
  if (showColor) {
    // A boxed/bubble text's 'solid' fill is the one case with two colors,
    // Background and Text Color — always mutually exclusive, exactly one
    // explicit and the other auto-following it (see `TextAnn.bgAuto`'s doc
    // comment), so one swatch plus a toggle naming which one it currently
    // edits is enough: switching the toggle *is* switching which side is
    // explicit (`onTextColorAuto`/`onBgAuto` — same handlers the swatch's
    // own picks route through elsewhere). Every other tool/fill only ever
    // has the one color, so no toggle for them, same as always.
    const invertibleText = isBoxedText && bgFill === 'solid' && textBoxBg != null && textBoxFontColor != null
    const textMode = invertibleText && textBoxBgAuto
    const value = invertibleText ? (textMode ? textBoxFontColor! : textBoxBg!) : activeColor
    const onChange = invertibleText && textMode ? onTextColorPick : onColor
    const label = invertibleText ? (textMode ? 'Text Color' : 'Background') : 'Color'
    optionBlocks.push({
      key: 'color',
      heading: label,
      node: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {invertibleText && (
            <div className={`${styles.group} ${styles.groupWrap}`}>
              <button
                className={`${styles.fillBtn} ${!textMode ? styles.active : ''}`}
                onClick={() => { if (textMode) onTextColorAuto() }}
                title="Background — Text Color auto-contrasts against it"
              >
                <PaintBucket size={13} strokeWidth={1.5} />
                <span className={styles.fillLabel}>Background</span>
              </button>
              <button
                className={`${styles.fillBtn} ${textMode ? styles.active : ''}`}
                onClick={() => { if (!textMode) onBgAuto() }}
                title="Text Color — Background auto-contrasts against it"
              >
                <Type size={13} strokeWidth={2} />
                <span className={styles.fillLabel}>Text</span>
              </button>
            </div>
          )}
          <div className={styles.group}>
            <ColorSwatchPicker value={value} onChange={onChange} recentColors={recentColors} title={label} />
            <button className={styles.hexRow} onClick={() => copyHex(value)} title="Copy color code">
              <span className={styles.hexCode}>{value.toUpperCase()}</span>
              {hexCopied
                ? <Check size={11} strokeWidth={2} className={styles.hexCopied} />
                : <Copy size={11} strokeWidth={1.5} />}
            </button>
            <button
              className={`${styles.toolBtn} ${styles.toolIconBtn} ${activeTool === 'picker' ? styles.active : ''}`}
              onClick={() => onTool('picker')}
              title="Color picker"
            >
              <Pipette size={16} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      ),
    })
  }
  // Shared by both push sites — this one (the universal "ink cluster"
  // position, every tool but Erase) and Erase's own, at the end of its
  // section below.
  const pushOpacityBlock = () => {
    optionBlocks.push({
      key: 'opacity',
      heading: 'Opacity',
      node: (
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
      ),
    })
  }
  // Erase doesn't get the universal top-of-panel Opacity at all now — its
  // own 'erase' effect always punches to full transparency (see the
  // 'erase' case in drawAnnotationInner), and 'fill' is the one erase
  // effect that still uses it normally, pushed conditionally at the end of
  // Erase's own section below instead, after the choices it actually
  // depends on (Effect).
  if (showOpacity && !showEraseOptions) pushOpacityBlock()
  // Stroke Width groups with Color/Opacity right above it — the three read
  // as one "ink" cluster (what color, how see-through, how thick) that's
  // touched on nearly every shape, unlike the tool-specific structural
  // choices below it (Arrow Head, Marker Shape, …) which are usually set
  // once per session and rarely revisited. Shared by both push sites below
  // (this one, and text's own border-width call further down) — same
  // control either way, just a different heading/title and a different
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
  // Groups with Stroke Width right above it — "how thick" and "what
  // pattern" read as one "what the stroke looks like" question.
  if (showDash) {
    optionBlocks.push({
      key: 'linedash',
      heading: 'Line Style',
      node: (
        <div className={`${styles.group} ${styles.groupWrap}`}>
          {LINE_DASHES.map(({ id, icon, label }) => (
            <button
              key={id}
              className={`${styles.fillBtn} ${lineDash === id ? styles.active : ''}`}
              onClick={() => onLineDash(id)}
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
              max={40}
              step={1}
              value={Math.round(blurStrength)}
              onChange={(e) => onBlurStrength(Number(e.target.value))}
              className={styles.fontSizeRange}
            />
            <Droplets size={16} strokeWidth={1.5} />
            <NumField value={Math.round(blurStrength)} min={2} max={40} onCommit={onBlurStrength} />
          </label>
        </div>
      ),
    })
  }
  if (showEraseOptions) {
    // Effect first, same "mode before its details" reasoning as Text
    // Shape/Fill/Border above — Erase vs. Fill decides what the rest of
    // this tool even does (and unlocks Fill Color right below it), so it
    // comes before Tolerance, which only steers *how* a click selects, not
    // what happens to the selection once made.
    optionBlocks.push({
      key: 'eraseeffect',
      heading: 'Effect',
      node: (
        <div className={`${styles.group} ${styles.groupWrap}`}>
          <button
            className={`${styles.fillBtn} ${eraseEffect === 'erase' ? styles.active : ''}`}
            onClick={() => onEraseEffect('erase')}
            title="Erase — punch the selection to transparent"
          >
            <Eraser size={14} strokeWidth={1.5} />
            <span className={styles.fillLabel}>Erase</span>
          </button>
          <button
            className={`${styles.fillBtn} ${eraseEffect === 'fill' ? styles.active : ''}`}
            onClick={() => onEraseEffect('fill')}
            title="Fill — paint a solid color over the selection"
          >
            <PaintBucket size={14} strokeWidth={1.5} />
            <span className={styles.fillLabel}>Fill</span>
          </button>
        </div>
      ),
    })
    if (eraseEffect === 'fill') {
      optionBlocks.push({
        key: 'erasefillcolor',
        heading: 'Fill Color',
        node: (
          <div className={styles.group}>
            <ColorSwatchPicker value={eraseFillColor} onChange={onEraseFillColor} recentColors={recentColors} title="Fill color" />
          </div>
        ),
      })
    }
    // Simplified down to Erase/Fill only — Pick Mode (Connected/Anywhere)
    // and Shift/Alt-combining were removed along with the Blur/Pixelate
    // effects below, so Tolerance is the only thing left that a `compound`
    // selection (an old document's — see EraseAnn.compound's doc comment)
    // can't re-derive. Still shown with nothing `erase`-typed selected
    // (eraseCompound is always false then): it still steers the next click.
    if (!eraseCompound) {
      optionBlocks.push({
        key: 'erase',
        heading: 'Tolerance',
        node: (
          <div className={styles.group}>
            {/* Small swatch left, large right — brackets the slider like the
                stroke-width control (drag right = looser match, more selected). */}
            <label className={styles.fontSizeLabel} title="Color match tolerance">
              <Wand2 size={10} />
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(eraseTolerance)}
                onChange={(e) => onEraseTolerance(Number(e.target.value))}
                className={styles.fontSizeRange}
              />
              <Wand2 size={16} />
              <NumField value={Math.round(eraseTolerance)} min={0} max={100} onCommit={onEraseTolerance} suffix="%" />
            </label>
          </div>
        ),
      })
    }
    // 'erase' itself always punches to full transparency now (see the
    // 'erase' case in drawAnnotationInner) — no partial-opacity erase, so
    // the slider has nothing left to control there. 'fill' (and legacy
    // 'blur'/'pixelate') still paint new content at the normal "how opaque
    // it looks" strength, so they keep it — pushed here, last, instead of
    // the universal top-of-panel spot (see pushOpacityBlock's own comment
    // above).
    if (eraseEffect !== 'erase') pushOpacityBlock()
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
  if (showFontSize) {
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
  // Its own tab (`shadowBlocks`, not `optionBlocks`) rather than one more
  // block tacked onto every tool's list — shadow/glow applies uniformly
  // across tools (SHADOW_TOOLS) and can run to half a dozen sections on its
  // own, which used to read as a pile of unrelated sliders rather than one
  // coherent feature. See the `tab` state and the render below.
  if (showShadow) {
    shadowBlocks.push({
      key: 'shadow',
      heading: 'Style',
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
      // Only the presets matching the style just picked above — a drop
      // preset applied while on Glow (or vice versa) would silently switch
      // Style out from under the user, which reads as the click having
      // done the wrong thing even though it did exactly what its icon/label
      // said.
      const presetsForStyle = SHADOW_PRESETS.filter((p) => p.style === shadowStyle)
      shadowBlocks.push({
        key: 'shadowpresets',
        heading: 'Presets',
        node: (
          <div className={`${styles.group} ${styles.groupWrap}`}>
            {presetsForStyle.map((p) => {
              const isActive = shadowBlur === p.blur && shadowOpacity === p.opacity
                && (p.style !== 'drop' || (shadowAngle === p.angle && shadowSize === p.size))
              return (
                <button
                  key={p.id}
                  className={`${styles.fillBtn} ${isActive ? styles.active : ''}`}
                  onClick={() => onShadowPreset(p.style, p.angle, p.size, p.blur, p.opacity)}
                  title={`${p.label} ${p.style === 'glow' ? 'glow' : 'drop shadow'}`}
                >
                  {p.icon}
                  <span className={styles.fillLabel}>{p.label}</span>
                </button>
              )
            })}
          </div>
        ),
      })
      // Angle and Size have no meaning for glow (it's centered, no direction
      // to cast a distance along) — only drop shows either.
      if (shadowStyle === 'drop') {
        shadowBlocks.push({
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
                  step={45}
                  value={shadowAngle}
                  onChange={(e) => onShadowAngle(Number(e.target.value))}
                  className={styles.fontSizeRange}
                />
                <NumField value={Math.round(shadowAngle)} min={0} max={360} onCommit={(v) => onShadowAngle(Math.round(v / 45) * 45)} suffix="°" />
              </label>
            </div>
          ),
        })
        shadowBlocks.push({
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
      shadowBlocks.push({
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
      shadowBlocks.push({
        key: 'shadowopacity',
        heading: 'Opacity',
        node: (
          <div className={styles.group}>
            <label className={styles.fontSizeLabel} title={shadowStyle === 'glow' ? 'Glow opacity' : 'Shadow opacity'}>
              <OpacityIcon />
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={shadowOpacity}
                onChange={(e) => onShadowOpacity(Number(e.target.value))}
                className={styles.fontSizeRange}
              />
              <NumField value={Math.round(shadowOpacity)} min={0} max={100} onCommit={onShadowOpacity} />
            </label>
          </div>
        ),
      })
      shadowBlocks.push({
        key: 'shadowcolor',
        heading: 'Color',
        node: (
          <div className={styles.group}>
            <ColorSwatchPicker
              value={shadowColor ?? (shadowStyle === 'glow' ? activeColor : '#000000')}
              onChange={onShadowColor}
              recentColors={recentColors}
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

  // What the panel is currently showing options *for* — the selected
  // annotation's type takes priority over the active tool (matches every
  // `show*`/value gate above: a selection can exist under any tool via
  // grab-after-create). Every `AnnotationTool` value has an entry in
  // `TOOL_INFO`, so this only comes back empty for a `selectedAnnotationType`
  // this panel has never heard of — shouldn't happen, but the header just
  // omits itself rather than showing nothing useful.
  const currentTool = TOOL_INFO[selectedAnnotationType ?? activeTool]
  // Falls back to 'options' rather than trusting `tab` directly whenever
  // there's no Shadow tab to be on (most tools/fills) — switching to a tool
  // without shadow support while `tab` happens to be 'shadow' from an
  // earlier selection would otherwise render an empty panel instead of
  // silently landing back on Options.
  const activeTab = showShadow ? tab : 'options'
  const visibleBlocks = activeTab === 'shadow' ? shadowBlocks : optionBlocks

  return (
    <aside className={styles.optionsPanel}>
      {currentTool && (
        <div className={styles.panelHeader}>
          {currentTool.icon}
          <span>{currentTool.label}</span>
        </div>
      )}
      {showShadow && (
        <div className={styles.tabRow}>
          <button
            className={`${styles.tabBtn} ${activeTab === 'options' ? styles.tabBtnActive : ''}`}
            onClick={() => setTab('options')}
          >
            Options
          </button>
          <button
            className={`${styles.tabBtn} ${activeTab === 'shadow' ? styles.tabBtnActive : ''}`}
            onClick={() => setTab('shadow')}
          >
            Shadow
          </button>
        </div>
      )}
      {visibleBlocks.map(({ key, heading, node }, i) => (
        <Fragment key={key}>
          {i > 0 && <div className={styles.sepH} />}
          <div className={styles.panelSection}>
            <div className={styles.panelSectionHeading}>{heading}</div>
            {node}
          </div>
        </Fragment>
      ))}
    </aside>
  )
}
