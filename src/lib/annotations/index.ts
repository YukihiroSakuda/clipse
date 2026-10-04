// The annotation model, split by concern. This file is the module's whole
// public surface: it re-exports exactly what `annotations.ts` exported before
// the split, so every `from '../lib/annotations'` import keeps working and the
// helpers that are only shared *between* these files stay internal.
//
// The files are strictly layered — each imports only from the ones above it —
// so there are no cycles to reason about:
//
//   types -> palette -> style -> images -> mask -> text -> geometry
//         -> connections -> draw

export { SHADOW_CAPABLE, blurStrengthPct, formatMarkerLabel, makeId, parseMarkerLabel } from './types'
export type {
  AnnotationBase, ArrowHead, BubbleTailAnchor, ConnectAnchor, ArrowConnection, ArrowAnn,
  LineAnn, PenAnn, RectAnn, EllipseAnn, TextShape, TextBgFill, TextAnn, NumberAnn, NumberFormat, BlurStrength,
  BlurAnn, HighlightAnn, SpotlightAnn, MagnifierAnn, ImageAnn, EraseAnn, Annotation,
} from './types'
export { PALETTE, TAILWIND_SHADE_NAMES, TAILWIND_PALETTE, TAILWIND_HEX_SET, isPaletteColor } from './palette'
export { getShadowStyle, getShadowAngle, getShadowSize, getShadowBlur, getShadowOpacity, glowMaxBlur, dropMaxDistance, resolveOutline } from './style'
export { onEmbeddedImageLoad, getEmbeddedImage, loadEmbeddedImage, decodeEmbeddedImages } from './images'
export { floodFillColorMask, traceMaskContour } from './mask'
export type { ContourLoop } from './mask'
export {
  BUBBLE_TAIL_ANCHORS, bubbleCornerRadius, bubbleTailPoints, textPadding, bubbleTailHeight,
  resolveTextColors, fontSizeAndOriginForBounds, getBubbleBodyBox,
} from './text'
export {
  getElbowSegments, getMagnifierBoxes, magnifierHitPart, getAnnotationBounds,
  getAnnotationLocalBounds, getAnnotationCoreBounds, isRotatable, annotationRotation,
  annotationPivot, rotateAnnotationForImageTurn, rotatePoint, hitTest, getBubbleTailAnchors,
} from './geometry'
export type { ElbowSegment, RotatableAnnotation } from './geometry'
export {
  isConnectable, getConnectAnchors, resolveArrowConnections, clearDanglingConnections,
  remapArrowConnections,
} from './connections'
export type { ConnectableAnnotation } from './connections'
export { drawAnnotation } from './draw'
