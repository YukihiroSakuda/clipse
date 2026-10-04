// Minimal annotation builders for the characterization tests.
//
// Every builder fills only the fields the type requires plus whatever the
// test overrides, so a test's fixture reads as "a rect at 10,20 sized 30x40"
// rather than as a wall of defaults — and so adding an optional field to a
// type doesn't silently change what these pin down.
import type {
  ArrowAnn, BlurAnn, EllipseAnn, EraseAnn, HighlightAnn, ImageAnn, LineAnn, MagnifierAnn,
  NumberAnn, PenAnn, RectAnn, SpotlightAnn, TextAnn,
} from '../annotations'

const base = (id: string) => ({ id, color: '#EF4444', sw: 4 })

export const rect = (o: Partial<RectAnn> & { id: string }): RectAnn => ({
  ...base(o.id), type: 'rect', x: 0, y: 0, w: 100, h: 50, fill: 'stroke', ...o,
})

export const ellipse = (o: Partial<EllipseAnn> & { id: string }): EllipseAnn => ({
  ...base(o.id), type: 'ellipse', cx: 50, cy: 50, rx: 30, ry: 20, fill: 'stroke', ...o,
})

export const arrow = (o: Partial<ArrowAnn> & { id: string }): ArrowAnn => ({
  ...base(o.id), type: 'arrow', x1: 0, y1: 0, x2: 100, y2: 100, head: 'triangle', ...o,
})

export const line = (o: Partial<LineAnn> & { id: string }): LineAnn => ({
  ...base(o.id), type: 'line', x1: 0, y1: 0, x2: 100, y2: 100, ...o,
})

export const pen = (o: Partial<PenAnn> & { id: string }): PenAnn => ({
  ...base(o.id), type: 'pen', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], ...o,
})

export const num = (o: Partial<NumberAnn> & { id: string }): NumberAnn => ({
  ...base(o.id), type: 'number', cx: 50, cy: 50, n: 1, r: 20, shape: 'circle', ...o,
})

export const highlight = (o: Partial<HighlightAnn> & { id: string }): HighlightAnn => ({
  ...base(o.id), type: 'highlight', x1: 0, y1: 0, x2: 100, y2: 0, ...o,
})

export const magnifier = (o: Partial<MagnifierAnn> & { id: string }): MagnifierAnn => ({
  ...base(o.id), type: 'magnifier', x: 0, y: 0, w: 20, h: 20, tx: 100, ty: 100, tw: 60, th: 60, ...o,
})

export const text = (o: Partial<TextAnn> & { id: string }): TextAnn => ({
  ...base(o.id), type: 'text', x: 10, y: 20, text: 'ab', fontSize: 40, shape: 'none', ...o,
})

export const image = (o: Partial<ImageAnn> & { id: string }): ImageAnn => ({
  ...base(o.id), type: 'image', x: 0, y: 0, w: 80, h: 60,
  src: 'data:image/png;base64,iVBORw0KGgo=', ...o,
})

export const blur = (o: Partial<BlurAnn> & { id: string }): BlurAnn => ({
  ...base(o.id), type: 'blur', x: 0, y: 0, w: 60, h: 40, ...o,
})

export const spotlight = (o: Partial<SpotlightAnn> & { id: string }): SpotlightAnn => ({
  ...base(o.id), type: 'spotlight', x: 10, y: 10, w: 120, h: 90, ...o,
})

export const erase = (o: Partial<EraseAnn> & { id: string }): EraseAnn => ({
  ...base(o.id), type: 'erase', x: 0, y: 0, w: 40, h: 30,
  mask: 'data:image/png;base64,iVBORw0KGgo=', seedX: 5, seedY: 5, tolerance: 20, ...o,
})
