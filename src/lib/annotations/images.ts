// Decoding and caching for the pixels an annotation carries inline (a pasted
// picture's `src`, an erase annotation's `mask`) — both travel as `data:` URLs,
// and both are decoded asynchronously while `drawAnnotation` is synchronous, so
// everything here is built around that gap. See `ImageAnn.src`.

import type { Annotation } from './types'

// ── Embedded pictures (the `image` annotation's pixels) ────────────────────
// `drawAnnotation` is synchronous, but an image annotation carries its picture
// as a `data:` URL the browser decodes asynchronously. Decoded bitmaps are
// cached here by `src` — one entry per distinct picture, shared by every copy
// of it, so duplicating a pasted image costs no second decode — and everything
// waiting to repaint is notified when one finishes. The frame right after a
// paste therefore draws a placeholder and the next draws the picture.
interface EmbeddedEntry {
  img: HTMLImageElement
  ready: boolean
  /** Settles (never rejects) once the decode has finished *or* failed. */
  done: Promise<void>
}

const embeddedImages = new Map<string, EmbeddedEntry>()

const embeddedListeners = new Set<() => void>()

/** Subscribes to "some picture finished decoding". Returns an unsubscribe fn. */
export function onEmbeddedImageLoad(listener: () => void): () => void {
  embeddedListeners.add(listener)
  return () => { embeddedListeners.delete(listener) }
}

/**
 * The decoded bitmap for `src`, or null while it is still decoding (or if it
 * turned out to be undecodable). Starts the decode on the first ask, so simply
 * drawing an image annotation is enough to get it loaded.
 */
export function getEmbeddedImage(src: string): HTMLImageElement | null {
  const hit = embeddedImages.get(src)
  if (hit) return hit.ready ? hit.img : null
  if (typeof Image === 'undefined') return null
  const img = new Image()
  let settle: () => void = () => {}
  const done = new Promise<void>((resolve) => { settle = resolve })
  const entry: EmbeddedEntry = { img, ready: false, done }
  embeddedImages.set(src, entry)
  img.onload = () => {
    entry.ready = true
    settle()
    for (const listener of embeddedListeners) listener()
  }
  img.onerror = () => {
    settle()
    for (const listener of embeddedListeners) listener()
  }
  img.src = src
  return null
}

/**
 * Decodes `src` through the shared cache and resolves with its bitmap, or null
 * if it can't be decoded. For the caller that needs a picture's natural size
 * before it can even build the annotation — going through the cache means that
 * sizing decode is the same one the first draw will use, not a throwaway.
 */
export async function loadEmbeddedImage(src: string): Promise<HTMLImageElement | null> {
  const ready = getEmbeddedImage(src)  // starts the decode if this src is new
  if (ready) return ready
  const entry = embeddedImages.get(src)
  if (!entry) return null
  await entry.done
  return entry.ready ? entry.img : null
}

/**
 * Resolves once every `image` annotation's picture and every `erase`
 * annotation's mask in `annotations` has decoded (or failed to). The export
 * paths render the whole document to an offscreen canvas in one synchronous
 * pass, so one still decoding at that moment would save as an empty box (for
 * `image`) or a no-op (for `erase`) — this is what the caller awaits first.
 */
export function decodeEmbeddedImages(annotations: Annotation[]): Promise<void> {
  const waits: Promise<void>[] = []
  for (const ann of annotations) {
    const src = ann.type === 'image' ? ann.src : ann.type === 'erase' ? ann.mask : null
    if (!src) continue
    getEmbeddedImage(src)  // starts the decode if this src is new
    const entry = embeddedImages.get(src)
    if (entry && !entry.ready) waits.push(entry.done)
  }
  return Promise.all(waits).then(() => undefined)
}
