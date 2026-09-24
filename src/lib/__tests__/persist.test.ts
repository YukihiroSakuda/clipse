import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installPersistence, loadPersistedDefaults } from '../store/persist'
import { PALETTE } from '../annotations'

const KEY = 'clipse-editor-defaults'

/** An in-memory localStorage — node has none. */
function stubStorage() {
  const map = new Map<string, string>()
  return {
    store: map,
    api: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => { map.set(k, v) },
      removeItem: (k: string) => { map.delete(k) },
      clear: () => map.clear(),
      key: () => null,
      length: 0,
    } as unknown as Storage,
  }
}

let storage: ReturnType<typeof stubStorage>

beforeEach(() => {
  storage = stubStorage()
  ;(globalThis as Record<string, unknown>).localStorage = storage.api
})
afterEach(() => {
  delete (globalThis as Record<string, unknown>).localStorage
})

const write = (v: unknown) => storage.store.set(KEY, JSON.stringify(v))

describe('loadPersistedDefaults', () => {
  it('is empty when nothing was stored', () => {
    expect(loadPersistedDefaults()).toEqual({})
  })

  it('is empty rather than throwing on corrupt JSON', () => {
    storage.store.set(KEY, '{not json')
    expect(loadPersistedDefaults()).toEqual({})
  })

  it('is empty rather than throwing when storage is unavailable', () => {
    delete (globalThis as Record<string, unknown>).localStorage
    expect(loadPersistedDefaults()).toEqual({})
  })

  it('restores the values it recognizes', () => {
    write({ strokeWidth: 6, fontSize: 28, fillMode: 'solid', textAlign: 'center' })
    expect(loadPersistedDefaults()).toEqual({
      strokeWidth: 6, fontSize: 28, fillMode: 'solid', textAlign: 'center',
    })
  })

  it('drops a value outside its allowed range', () => {
    write({ rectRadius: 9999, numberRadius: 1, magnifierZoom: 99, shadowOpacity: -5 })
    expect(loadPersistedDefaults()).toEqual({})
  })

  it('keeps a value at the edge of its range', () => {
    write({ rectRadius: 200, numberRadius: 6, shadowOpacity: 0 })
    expect(loadPersistedDefaults()).toEqual({ rectRadius: 200, numberRadius: 6, shadowOpacity: 0 })
  })

  it('drops a value of the wrong type', () => {
    write({ strokeWidth: '6', doubleEndedArrow: 'yes', textShape: 42 })
    expect(loadPersistedDefaults()).toEqual({})
  })

  it('drops a string outside its allowed set', () => {
    write({ fillMode: 'gradient', arrowHead: 'chevron', tailAnchor: 'q9' })
    expect(loadPersistedDefaults()).toEqual({})
  })

  it('drops NaN, which would otherwise render as nothing at all', () => {
    // The hand-written checks this replaced tested only `typeof === 'number'`,
    // which NaN passes.
    write({ strokeWidth: Number.NaN, fontSize: Number.NaN })
    expect(loadPersistedDefaults()).toEqual({})
  })

  it('remembers a palette color but not an eyedropper pick', () => {
    write({ activeColor: PALETTE.red })
    expect(loadPersistedDefaults()).toEqual({ activeColor: PALETTE.red })
    write({ activeColor: '#123456' })
    expect(loadPersistedDefaults()).toEqual({})
  })

  it('normalizes a legacy blur preset to a percentage', () => {
    write({ blurStrength: 'high' })
    expect(loadPersistedDefaults()).toEqual({ blurStrength: 33 })
    write({ blurStrength: 25 })
    expect(loadPersistedDefaults()).toEqual({ blurStrength: 25 })
  })

  it('keeps the valid keys of a partly corrupt record', () => {
    write({ strokeWidth: 6, fillMode: 'nonsense', textBgAuto: true })
    expect(loadPersistedDefaults()).toEqual({ strokeWidth: 6, textBgAuto: true })
  })
})

describe('installPersistence', () => {
  /** Captures the listener so a test can drive it directly. */
  function capture() {
    let listener: ((s: object, prev: object) => void) | null = null
    installPersistence((l: (s: object, prev: object) => void) => { listener = l })
    return (s: object, prev: object) => listener!(s, prev)
  }

  const state = (over: Record<string, unknown> = {}) => ({
    lastPaletteColor: PALETTE.red,
    strokeWidth: 4, fontSize: 20, fillMode: 'stroke', lineDash: 'solid', rectRadius: 0,
    numberShape: 'circle', spotlightShape: 'circle', numberRadius: 15, arrowHead: 'triangle',
    doubleEndedArrow: false, arrowStyle: 'straight', textShape: 'none', textBgFill: 'solid',
    textBgAuto: false, textAlign: 'left', tailAnchor: 's3', blurStrength: 17,
    eraseTolerance: 30, eraseEffect: 'erase', eraseFillColor: PALETTE.red, spotlightDim: 0.55,
    magnifierZoom: 2.5, magnifierShape: 'square', imageBorder: false, shadowStyle: 'drop',
    shadowAngle: 45, shadowSize: 10, shadowBlur: 0, shadowOpacity: 45, shadowColor: null,
    // Not persisted — the document, the view, the selection.
    annotations: [], zoom: 1, selectedIds: [],
    ...over,
  })

  it('writes nothing when no remembered default changed', () => {
    const fire = capture()
    const s = state()
    fire({ ...s, annotations: [1], zoom: 3 }, s)
    expect(storage.store.has(KEY)).toBe(false)
  })

  it('writes through when one changes', () => {
    const fire = capture()
    const prev = state()
    fire(state({ strokeWidth: 9 }), prev)
    expect(JSON.parse(storage.store.get(KEY)!)).toMatchObject({ strokeWidth: 9 })
  })

  it('remembers the last palette color, not the current (possibly picked) one', () => {
    // An eyedropper pick must not survive the session.
    const fire = capture()
    fire(state({ lastPaletteColor: PALETTE.blue, activeColor: '#123456', strokeWidth: 9 }), state())
    expect(JSON.parse(storage.store.get(KEY)!).activeColor).toBe(PALETTE.blue)
  })

  it('omits a null shadow color rather than storing null', () => {
    const fire = capture()
    fire(state({ strokeWidth: 9 }), state())
    expect('shadowColor' in JSON.parse(storage.store.get(KEY)!)).toBe(false)
  })

  it('stores `false` rather than dropping it', () => {
    const fire = capture()
    fire(state({ textBgAuto: false, strokeWidth: 9 }), state())
    expect(JSON.parse(storage.store.get(KEY)!).textBgAuto).toBe(false)
  })

  it('survives storage throwing on write', () => {
    ;(globalThis as Record<string, unknown>).localStorage = {
      ...storage.api,
      setItem: () => { throw new Error('QuotaExceeded') },
    }
    const fire = capture()
    expect(() => fire(state({ strokeWidth: 9 }), state())).not.toThrow()
  })

  it('round-trips every default it writes', () => {
    // The real contract: what a save writes is exactly what a load restores.
    const fire = capture()
    const next = state({
      strokeWidth: 9, fontSize: 33, fillMode: 'semi', lineDash: 'dashed', rectRadius: 12,
      textShape: 'bubble', tailAnchor: 'n2', blurStrength: 25, shadowColor: PALETTE.blue,
    })
    fire(next, state())
    const back = loadPersistedDefaults() as Record<string, unknown>
    for (const [k, v] of Object.entries(back)) {
      const source = k === 'activeColor' ? 'lastPaletteColor' : k
      expect(v, k).toEqual(next[source as keyof typeof next])
    }
    expect(back.strokeWidth).toBe(9)
    expect(back.tailAnchor).toBe('n2')
    expect(back.shadowColor).toBe(PALETTE.blue)
  })
})
