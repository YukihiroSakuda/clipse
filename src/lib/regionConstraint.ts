import type { FixedRegionSpec, LastRegion } from './ipc'

/**
 * A selection constraint on the region overlay. Two sources can set one:
 * the Fixed Capture window (`FixedRegionSpec`, fixed for the whole session)
 * and the overlay's own keys during a plain PrintScreen session (R cycles a
 * ratio, L recalls the last size, Shift+L the last position).
 *
 * - `ratio`: the drag is locked to w:h.
 * - `size`: a w×h rect follows the cursor; a click captures it.
 * - `position`: a fixed rect in global physical px; Enter or a click inside
 *   captures it.
 */
export type RegionConstraint =
  | { kind: 'ratio'; w: number; h: number }
  | { kind: 'size'; w: number; h: number }
  | { kind: 'position'; x: number; y: number; w: number; h: number }

/** What R steps through, after "free". Landscape first, then portrait. */
export const OVERLAY_RATIOS: ReadonlyArray<{ w: number; h: number }> = [
  { w: 1, h: 1 },
  { w: 4, h: 3 },
  { w: 16, h: 9 },
  { w: 3, h: 2 },
  { w: 3, h: 4 },
  { w: 9, h: 16 },
]

/**
 * The next ratio in `OVERLAY_RATIOS` (`dir` 1 = R, -1 = Shift+R), with
 * "free" (`null`) as the slot between the last entry and the first. Anything
 * that isn't one of the listed ratios — no constraint, a size or position
 * recall — counts as "free", so R always starts from the top of the list.
 */
export function cycleRatio(current: RegionConstraint | null, dir: 1 | -1): RegionConstraint | null {
  const n = OVERLAY_RATIOS.length
  const idx = current?.kind === 'ratio'
    ? OVERLAY_RATIOS.findIndex((r) => r.w === current.w && r.h === current.h)
    : -1
  // Slots 0..n-1 are ratios, slot n is "free".
  const slot = idx < 0 ? n : idx
  const next = (slot + dir + n + 1) % (n + 1)
  return next === n ? null : { kind: 'ratio', ...OVERLAY_RATIOS[next] }
}

/**
 * The constraint in force. Scroll mode takes none (it selects a scrollable
 * area, not a picture), and a Fixed Capture session outranks the keys — it
 * was chosen in a window dedicated to it, and the keys are disabled there.
 */
export function effectiveConstraint(
  scrollMode: boolean,
  fixed: FixedRegionSpec | null,
  session: RegionConstraint | null,
): RegionConstraint | null {
  if (scrollMode) return null
  if (fixed) return { kind: fixed.is_ratio ? 'ratio' : 'size', w: fixed.w, h: fixed.h }
  return session
}

/**
 * Moves a drag's free corner so the rect has the ratio `ratio` (w/h). The
 * axis that moved further, relative to the ratio, stays as dragged and the
 * other is derived from it — the editor's Shift-constrain convention.
 */
export function lockToRatio(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  ratio: number,
): { x: number; y: number } {
  const dx = endX - startX
  const dy = endY - startY
  if (Math.abs(dx) >= Math.abs(dy) * ratio) {
    return { x: endX, y: startY + (dy < 0 ? -1 : 1) * Math.abs(dx) / ratio }
  }
  return { x: startX + (dx < 0 ? -1 : 1) * Math.abs(dy) * ratio, y: endY }
}

/** The last region as a position recall. */
export function positionFrom(r: LastRegion): RegionConstraint {
  return { kind: 'position', x: r.x, y: r.y, w: r.w, h: r.h }
}

/** Whether a global physical point lies inside a physical rect. */
export function containsPoint(
  r: { x: number; y: number; w: number; h: number },
  px: number,
  py: number,
): boolean {
  return px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h
}

/** The `{value}` shown in the overlay hint: `16:9` or `1280×720`. */
export function constraintValue(c: RegionConstraint): string {
  return c.kind === 'ratio' ? `${c.w}:${c.h}` : `${c.w}×${c.h}`
}
