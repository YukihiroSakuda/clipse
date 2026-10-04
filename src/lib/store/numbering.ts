// Number markers as ordered sequences — one per format.
//
// With auto renumber on (the default), a marker's `n` is not a value the user
// sets but its place in its sequence: numbers stay consecutive from the
// sequence's start, and every edit — delete, retype, paste — is a change of
// *order* that the numbers then follow. The start is whatever the lowest
// marker is, so a document continuing from another ("6, 7, 8") keeps doing so.
//
// Each format is its own sequence (its "series"): 1 2 3 and A B C and I II
// count independently, so adding a lettered marker never pushes the numbered
// ones along and vice versa.
//
// Sequence order is `n` first and array order second: a stable tiebreak for
// the duplicates an old document (or auto renumber turned off) may hold.
//
// Every function here returns the *same* array when nothing changed. That is
// load-bearing: the editor's unsaved-changes flag is reference equality on
// `annotations`, and a no-op must also stay out of undo.

import type { Annotation, NumberAnn, NumberFormat } from '../annotations'

const isMarker = (a: Annotation): a is NumberAnn => a.type === 'number'

/** The sequence a marker belongs to. Markers made before formats are numbers. */
export const seriesOf = (m: NumberAnn): NumberFormat => m.format ?? 'decimal'

const SERIES: readonly NumberFormat[] = ['decimal', 'alpha', 'roman']

/** One series' markers in sequence order: by `n`, ties kept in array order. */
export function markerSequence(anns: readonly Annotation[], series: NumberFormat): NumberAnn[] {
  // Array.prototype.sort is stable, so equal `n` keep their array order.
  return anns.filter((a): a is NumberAnn => isMarker(a) && seriesOf(a) === series).sort((a, b) => a.n - b.n)
}

/**
 * One past the highest marker — of `series`, or of every marker without one
 * (what a saved sidecar records, where no single series applies).
 */
export function nextMarkerNumber(anns: readonly Annotation[], series?: NumberFormat): number {
  let max = 0
  for (const a of anns) if (isMarker(a) && (!series || seriesOf(a) === series) && a.n > max) max = a.n
  return max + 1
}

/** A series' lowest number, or `undefined` while it has no markers. */
function seriesStart(anns: readonly Annotation[], series: NumberFormat): number | undefined {
  let min = Infinity
  for (const a of anns) if (isMarker(a) && seriesOf(a) === series && a.n < min) min = a.n
  return Number.isFinite(min) ? min : undefined
}

/** Numbers the markers in `order` (ids) consecutively from `start`. */
function assign(anns: Annotation[], order: readonly string[], start: number): Annotation[] {
  const want = new Map(order.map((id, i) => [id, start + i]))
  let changed = false
  const next = anns.map((a) => {
    const n = want.get(a.id)
    if (n === undefined || !isMarker(a) || a.n === n) return a
    changed = true
    return { ...a, n }
  })
  return changed ? next : anns
}

/**
 * Closes gaps and duplicates in every series.
 *
 * - `startsFrom`: an earlier version of the document whose series starts to
 *   keep — so a delete that removed a series' first marker doesn't move its
 *   start. Without it (or for a series it has no markers of), each series
 *   starts from its own lowest number.
 * - `ids`: renumber only these markers, each series from their own lowest
 *   number — for a document holding more than one run on purpose, with auto
 *   renumber off.
 */
export function renumberMarkers(
  anns: Annotation[],
  opts: { startsFrom?: readonly Annotation[]; ids?: readonly string[] } = {},
): Annotation[] {
  const idSet = opts.ids ? new Set(opts.ids) : null
  let out = anns
  for (const series of SERIES) {
    const seq = markerSequence(out, series).filter((m) => !idSet || idSet.has(m.id))
    if (seq.length === 0) continue
    const start = (opts.startsFrom && seriesStart(opts.startsFrom, series)) ?? seq[0].n
    out = assign(out, seq.map((m) => m.id), start)
  }
  return out
}

/**
 * Retyping a marker's number moves it to that place in its sequence, the
 * others shifting to make room:
 *
 * - inside the sequence: moved there (1 2 3 4 5, set the 5 to 2 → it is 2,
 *   the old 2–4 become 3–5);
 * - below its start: moved to the front, and the sequence starts there;
 * - past its end: moved to the end — except for the first marker, where it
 *   renumbers the whole sequence from that number. That is how a lone
 *   marker, or a set continuing another image's steps, gets its start; and
 *   moving the first marker to the end is still one retype away, of its end.
 */
export function moveMarker(anns: Annotation[], id: string, target: number): Annotation[] {
  const marker = anns.find((a): a is NumberAnn => a.id === id && isMarker(a))
  if (!marker || !Number.isFinite(target)) return anns
  const seq = markerSequence(anns, seriesOf(marker))
  const idx = seq.findIndex((m) => m.id === id)
  const t = Math.max(1, Math.round(target))
  const start = seq[0].n
  const end = start + seq.length - 1
  const rest = seq.filter((m) => m.id !== id).map((m) => m.id)
  let at: number
  let from = start
  if (t < start) {
    at = 0
    from = t
  } else if (t > end) {
    if (idx === 0) {
      at = 0
      from = t
    } else {
      at = rest.length
    }
  } else {
    at = t - start
  }
  rest.splice(at, 0, id)
  return assign(anns, rest, from)
}

/**
 * Renumbers markers arriving from a paste or duplicate so each continues its
 * own series instead of repeating numbers already in it. Keeps their order.
 */
export function continueSequence(existing: readonly Annotation[], added: Annotation[]): Annotation[] {
  let out = added
  for (const series of SERIES) {
    const incoming = markerSequence(out, series)
    if (incoming.length === 0) continue
    out = assign(out, incoming.map((m) => m.id), nextMarkerNumber(existing, series))
  }
  return out
}

/**
 * After markers changed format — and so changed series — moves each onto the
 * end of its new series (in the order they had) and closes the gap it left in
 * the old one. `before` is the document ahead of the change.
 */
export function reseriesMarkers(before: readonly Annotation[], after: Annotation[]): Annotation[] {
  const was = new Map<string, NumberFormat>()
  for (const a of before) if (isMarker(a)) was.set(a.id, seriesOf(a))
  const moved = after.filter((a): a is NumberAnn => isMarker(a) && was.has(a.id) && was.get(a.id) !== seriesOf(a))
  if (moved.length === 0) return after
  const movedIds = new Set(moved.map((m) => m.id))
  let out = after
  for (const series of SERIES) {
    const arriving = moved.filter((m) => seriesOf(m) === series).sort((a, b) => a.n - b.n)
    if (arriving.length === 0) continue
    const staying = out.filter((a) => !movedIds.has(a.id))
    out = assign(out, arriving.map((m) => m.id), nextMarkerNumber(staying, series))
  }
  return renumberMarkers(out, { startsFrom: before })
}

/** Markers whose number differs between two versions of the document. */
export function renumberedIds(before: readonly Annotation[], after: readonly Annotation[]): string[] {
  if (before === after) return []
  const was = new Map<string, number>()
  for (const a of before) if (isMarker(a)) was.set(a.id, a.n)
  const out: string[] = []
  for (const a of after) {
    if (!isMarker(a)) continue
    const n = was.get(a.id)
    if (n !== undefined && n !== a.n) out.push(a.id)
  }
  return out
}
