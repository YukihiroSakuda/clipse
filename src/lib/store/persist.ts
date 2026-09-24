// The editor's tool defaults, remembered across sessions in localStorage.
//
// One table drives all four things this needs: the stored shape's type, the
// validation a load runs, which store field each key is written from, and the
// change detection that decides whether to write at all. Those four used to be
// four hand-maintained copies of the same 31-key list, which is a drift the
// type checker cannot catch — a key added to one and missed in another either
// silently stops persisting or silently stops being restored.

import { BUBBLE_TAIL_ANCHORS, blurStrengthPct, isPaletteColor } from '../annotations'
import type { BlurStrength } from '../annotations'

const PERSIST_KEY = 'clipse-editor-defaults'

/** Reads one stored value back, or `undefined` if it is missing or unusable. */
type Read<T> = (v: unknown) => T | undefined

const oneOf = <const T extends readonly string[]>(...allowed: T): Read<T[number]> =>
  (v) => (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? v as T[number] : undefined)

// `Number.isFinite` is deliberate, and the one place this is stricter than
// the hand-written checks it replaces: those tested only `typeof === 'number'`,
// which NaN passes — a NaN stroke width or font size then renders as nothing
// at all, for the rest of the session and every session after it.
const num = (min = -Infinity, max = Infinity): Read<number> =>
  (v) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined)

const bool: Read<boolean> = (v) => (typeof v === 'boolean' ? v : undefined)

const paletteColor: Read<string> = (v) =>
  (typeof v === 'string' && isPaletteColor(v) ? v : undefined)

/** Number (%) since the slider; legacy installs may still hold a preset string. */
const blurStrength: Read<number> = (v) =>
  (typeof v === 'number' || v === 'low' || v === 'medium' || v === 'high'
    ? blurStrengthPct(v as number | BlurStrength)
    : undefined)

const tailAnchor: Read<(typeof BUBBLE_TAIL_ANCHORS)[number]> = (v) =>
  ((BUBBLE_TAIL_ANCHORS as readonly string[]).includes(v as string)
    ? v as (typeof BUBBLE_TAIL_ANCHORS)[number]
    : undefined)

/**
 * Every remembered default: the stored key, how to read it back, and — when
 * they differ — which store field supplies the value on save.
 *
 * `activeColor` is the one that differs: a picked (eyedropper) color must not
 * survive the session, so what gets remembered is the last color chosen from
 * the palette.
 */
const PERSISTED = {
  activeColor: { read: paletteColor, from: 'lastPaletteColor' },
  strokeWidth: { read: num() },
  fontSize: { read: num() },
  fillMode: { read: oneOf('stroke', 'solid', 'semi') },
  lineDash: { read: oneOf('solid', 'dashed', 'dotted') },
  rectRadius: { read: num(0, 200) },
  numberShape: { read: oneOf('circle', 'square') },
  spotlightShape: { read: oneOf('circle', 'square') },
  numberRadius: { read: num(6, 200) },
  arrowHead: { read: oneOf('triangle', 'line', 'dot', 'none') },
  doubleEndedArrow: { read: bool },
  arrowStyle: { read: oneOf('straight', 'elbow') },
  textShape: { read: oneOf('none', 'box', 'bubble') },
  textBgFill: { read: oneOf('stroke', 'solid', 'white') },
  textBgAuto: { read: bool },
  textAlign: { read: oneOf('left', 'center', 'right') },
  tailAnchor: { read: tailAnchor },
  blurStrength: { read: blurStrength },
  eraseTolerance: { read: num(0, 100) },
  eraseEffect: { read: oneOf('erase', 'fill', 'blur', 'pixelate') },
  eraseFillColor: { read: paletteColor },
  spotlightDim: { read: num() },
  magnifierZoom: { read: num(1.1, 10) },
  magnifierShape: { read: oneOf('circle', 'square') },
  imageBorder: { read: bool },
  shadowStyle: { read: oneOf('none', 'drop', 'glow') },
  shadowAngle: { read: num(0, 360) },
  shadowSize: { read: num(0, 100) },
  shadowBlur: { read: num(0, 100) },
  shadowOpacity: { read: num(0, 100) },
  shadowColor: { read: paletteColor },
} as const satisfies Record<string, { read: Read<unknown>; from?: string }>

type PersistKey = keyof typeof PERSISTED
type ValueOf<K extends PersistKey> =
  (typeof PERSISTED)[K]['read'] extends Read<infer V> ? V : never

export type PersistedDefaults = { [K in PersistKey]?: ValueOf<K> }

const KEYS = Object.keys(PERSISTED) as PersistKey[]

/** The store field each key is saved from — its own name unless overridden. */
const sourceField = (k: PersistKey): string =>
  ('from' in PERSISTED[k] ? (PERSISTED[k] as { from: string }).from : k)

/**
 * The remembered defaults, with anything corrupt or hand-edited dropped.
 * Never throws: storage being unavailable just means no remembered defaults.
 */
export function loadPersistedDefaults(): PersistedDefaults {
  try {
    const raw = localStorage.getItem(PERSIST_KEY)
    if (!raw) return {}
    const stored = JSON.parse(raw) as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of KEYS) {
      const value = PERSISTED[k].read(stored[k])
      if (value !== undefined) out[k] = value
    }
    return out as PersistedDefaults
  } catch {
    return {}
  }
}

/** A store state, read by field name — see `sourceField`. */
type Source = Record<string, unknown>

/** True when no remembered default changed, so there is nothing to write. */
function unchanged(a: Source, b: Source): boolean {
  return KEYS.every((k) => a[sourceField(k)] === b[sourceField(k)])
}

/**
 * Writes the tool defaults through to localStorage whenever one of them
 * changes. Attach once, to the created store.
 */
export function installPersistence<S extends object>(
  subscribe: (listener: (state: S, prev: S) => void) => unknown,
): void {
  subscribe((state, prevState) => {
    const s = state as Source
    const prev = prevState as Source
    if (unchanged(s, prev)) return
    try {
      const out: Record<string, unknown> = {}
      for (const k of KEYS) {
        const value = s[sourceField(k)]
        // `shadowColor` is `string | null` on the store but optional here.
        out[k] = value ?? undefined
      }
      localStorage.setItem(PERSIST_KEY, JSON.stringify(out))
    } catch {
      // Storage unavailable/full — the defaults just won't persist.
    }
  })
}
