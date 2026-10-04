// What every per-type draw function is handed besides the annotation itself.

import type { Annotation } from '../types'

export interface DrawEnv {
  /** `ann.opacity ?? 1`, resolved once by the dispatcher. */
  opacity: number
  /** The base image, for the types that resample it (blur, magnifier, erase). */
  img?: HTMLImageElement | null
  /** Canvas-to-image scale, so effects sized in screen pixels stay put as the
   *  editor zooms. */
  viewScale: number
  /**
   * Re-entry into the dispatcher, for a case that renders a copy of its own
   * annotation into an offscreen canvas (the arrow's silhouette shadow).
   * Passed in rather than imported so the per-type modules stay leaves of the
   * import graph.
   */
  drawInner: (
    ctx: CanvasRenderingContext2D,
    ann: Annotation,
    img?: HTMLImageElement | null,
    viewScale?: number,
  ) => void
}
