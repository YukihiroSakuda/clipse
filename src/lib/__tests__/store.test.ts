import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '../store'
import { stepZOrder } from '../store/document'
import type { ArrowAnn, NumberAnn, RectAnn } from '../annotations'
import { arrow, num, rect } from './fixtures'

const s = () => useStore.getState()

beforeEach(() => {
  // restoreAnnotations is the load path — it also clears history, redo and
  // the selection, which is exactly the reset each test wants.
  s().restoreAnnotations([], 1)
})

describe('addAnnotation', () => {
  it('appends, selects, and pushes the previous list onto history', () => {
    const before = s().annotations
    s().addAnnotation(rect({ id: 'r' }))
    expect(s().annotations.map((a) => a.id)).toEqual(['r'])
    expect(s().selectedIds).toEqual(['r'])
    expect(s().annotationHistory).toEqual([before])
  })

  it('leaves the active tool alone so shapes can be stamped back to back', () => {
    s().setActiveTool('rect')
    s().addAnnotation(rect({ id: 'r' }))
    expect(s().activeTool).toBe('rect')
  })

  it('advances nextNumber only for a number marker', () => {
    s().addAnnotation(rect({ id: 'r' }))
    expect(s().nextNumber).toBe(1)
    s().addAnnotation(num({ id: 'n', n: 1 }))
    expect(s().nextNumber).toBe(2)
  })

  it('clears the redo stack', () => {
    s().addAnnotation(rect({ id: 'a' }))
    s().undoAnnotation()
    expect(s().redoStack).toHaveLength(1)
    s().addAnnotation(rect({ id: 'b' }))
    expect(s().redoStack).toHaveLength(0)
  })
})

describe('undo / redo', () => {
  it('restores the EXACT array reference that was saved', () => {
    // Load-bearing: the editor's dirty flag compares `annotations` by
    // reference against the snapshot taken at load/save (see CLAUDE.md,
    // "Closing an editor with unsaved changes asks first"). Undoing back to
    // the saved state has to go clean again, which only works if the history
    // stack holds the same array object rather than a copy.
    const saved = s().annotations
    s().addAnnotation(rect({ id: 'r' }))
    expect(s().annotations).not.toBe(saved)
    s().undoAnnotation()
    expect(s().annotations).toBe(saved)
  })

  it('is a no-op on an empty history', () => {
    const before = s().annotations
    s().undoAnnotation()
    expect(s().annotations).toBe(before)
    expect(s().redoStack).toHaveLength(0)
  })

  it('round-trips through redo', () => {
    s().addAnnotation(rect({ id: 'r' }))
    const afterAdd = s().annotations
    s().undoAnnotation()
    s().redoAnnotation()
    expect(s().annotations).toBe(afterAdd)
  })

  it('recomputes nextNumber from the restored list', () => {
    s().addAnnotation(num({ id: 'n1', n: 1 }))
    s().addAnnotation(num({ id: 'n2', n: 2 }))
    expect(s().nextNumber).toBe(3)
    s().undoAnnotation()
    expect(s().nextNumber).toBe(2)
  })

  it('clears the selection', () => {
    s().addAnnotation(rect({ id: 'r' }))
    expect(s().selectedIds).toEqual(['r'])
    s().undoAnnotation()
    expect(s().selectedIds).toEqual([])
  })
})

describe('mutateAnnotations', () => {
  it('pushes one history entry for a real edit', () => {
    s().restoreAnnotations([rect({ id: 'r' })], 1)
    s().mutateAnnotations(['r'], (a) => ({ ...a, color: '#00FF00' }))
    expect((s().annotations[0] as RectAnn).color).toBe('#00FF00')
    expect(s().annotationHistory).toHaveLength(1)
  })

  it('does not pollute undo with a no-op edit', () => {
    // Every ToolOptionsPanel handler runs through here, including when the
    // picked value equals what the selection already had.
    s().restoreAnnotations([rect({ id: 'r' })], 1)
    const before = s().annotations
    s().mutateAnnotations(['r'], (a) => a)
    expect(s().annotations).toBe(before)
    expect(s().annotationHistory).toHaveLength(0)
  })

  it('leaves unselected annotations untouched by identity', () => {
    s().restoreAnnotations([rect({ id: 'a' }), rect({ id: 'b' })], 1)
    const untouched = s().annotations[1]
    s().mutateAnnotations(['a'], (a) => ({ ...a, sw: 9 }))
    expect(s().annotations[1]).toBe(untouched)
  })
})

describe('mutateAnnotationsLive', () => {
  it('edits without pushing history — the slider pushes once, up front', () => {
    s().restoreAnnotations([rect({ id: 'r' })], 1)
    s().mutateAnnotationsLive(['r'], (a) => ({ ...a, sw: 9 }))
    expect((s().annotations[0] as RectAnn).sw).toBe(9)
    expect(s().annotationHistory).toHaveLength(0)
  })
})

describe('beginDrag', () => {
  it('snapshots history without changing the document', () => {
    s().restoreAnnotations([rect({ id: 'r' })], 1)
    const before = s().annotations
    s().beginDrag()
    expect(s().annotations).toBe(before)
    expect(s().annotationHistory).toEqual([before])
  })
})

describe('moveAnnotations', () => {
  it('shifts the selection', () => {
    s().restoreAnnotations([rect({ id: 'r', x: 10, y: 20 })], 1)
    s().moveAnnotations(['r'], 5, 7)
    expect(s().annotations[0]).toMatchObject({ x: 15, y: 27 })
  })

  it('re-glues a connected arrow when its target moves', () => {
    s().restoreAnnotations([
      rect({ id: 'r', x: 0, y: 0, w: 100, h: 50 }),
      arrow({ id: 'a', endConnect: { targetId: 'r', anchor: 'n' } }),
    ], 1)
    s().moveAnnotations(['r'], 200, 0)
    expect((s().annotations[1] as ArrowAnn).x2).toBe(250)
  })
})

describe('deleteAnnotations', () => {
  it('un-glues arrows pointing at what was removed', () => {
    s().restoreAnnotations([
      rect({ id: 'r' }),
      arrow({ id: 'a', endConnect: { targetId: 'r', anchor: 'n' } }),
    ], 1)
    s().deleteAnnotations(['r'])
    expect((s().annotations[0] as ArrowAnn).endConnect).toBeUndefined()
  })

  it('recomputes nextNumber from the highest remaining marker', () => {
    s().restoreAnnotations([num({ id: 'n1', n: 1 }), num({ id: 'n2', n: 5 })], 6)
    s().deleteAnnotations(['n2'])
    expect(s().nextNumber).toBe(2)
  })

  it('resets nextNumber to 1 once every marker is gone', () => {
    s().restoreAnnotations([num({ id: 'n1', n: 3 })], 4)
    s().deleteAnnotations(['n1'])
    expect(s().nextNumber).toBe(1)
  })
})

describe('duplicateAnnotations', () => {
  it('offsets the clone and selects it', () => {
    s().restoreAnnotations([rect({ id: 'r', x: 10, y: 20 })], 1)
    s().duplicateAnnotations(['r'])
    expect(s().annotations).toHaveLength(2)
    expect(s().annotations[1]).toMatchObject({ x: 18, y: 28 })
    expect(s().selectedIds).toEqual([s().annotations[1].id])
  })

  it('re-points a connector duplicated together with its target', () => {
    s().restoreAnnotations([
      rect({ id: 'r', x: 0, y: 0, w: 100, h: 50 }),
      arrow({ id: 'a', endConnect: { targetId: 'r', anchor: 'n' } }),
    ], 1)
    s().duplicateAnnotations(['r', 'a'])
    const clonedArrow = s().annotations[3] as ArrowAnn
    expect(clonedArrow.endConnect!.targetId).toBe(s().annotations[2].id)
    expect(clonedArrow.endConnect!.targetId).not.toBe('r')
  })

  it('keeps a connector pointing at an external target it was not copied with', () => {
    s().restoreAnnotations([
      rect({ id: 'r', x: 0, y: 0, w: 100, h: 50 }),
      arrow({ id: 'a', endConnect: { targetId: 'r', anchor: 'n' } }),
    ], 1)
    s().duplicateAnnotations(['a'])
    expect((s().annotations[2] as ArrowAnn).endConnect!.targetId).toBe('r')
  })
})

describe('z-order', () => {
  it('moves the selection to the end on bringToFront', () => {
    s().restoreAnnotations([rect({ id: 'a' }), rect({ id: 'b' }), rect({ id: 'c' })], 1)
    s().bringToFront(['a'])
    expect(s().annotations.map((x) => x.id)).toEqual(['b', 'c', 'a'])
  })

  it('moves the selection to the front on sendToBack', () => {
    s().restoreAnnotations([rect({ id: 'a' }), rect({ id: 'b' }), rect({ id: 'c' })], 1)
    s().sendToBack(['c'])
    expect(s().annotations.map((x) => x.id)).toEqual(['c', 'a', 'b'])
  })

  it('is a no-op when nothing matches', () => {
    s().restoreAnnotations([rect({ id: 'a' })], 1)
    const before = s().annotations
    s().bringToFront(['missing'])
    expect(s().annotations).toBe(before)
    expect(s().annotationHistory).toHaveLength(0)
  })
})

describe('resizeAnnotation', () => {
  it('adopts a resized marker size as the default for the next one', () => {
    s().restoreAnnotations([num({ id: 'n', cx: 50, cy: 50, r: 20 })], 1)
    s().resizeAnnotation('n', { x: 0, y: 0, w: 80, h: 80 })
    expect((s().annotations[0] as NumberAnn).r).toBe(40)
    expect(s().numberRadius).toBe(40)
  })

  it('does not touch numberRadius when resizing anything else', () => {
    s().restoreAnnotations([rect({ id: 'r' })], 1)
    const before = s().numberRadius
    s().resizeAnnotation('r', { x: 0, y: 0, w: 200, h: 100 })
    expect(s().numberRadius).toBe(before)
  })
})

describe('updateOpacity', () => {
  it('clamps to 0.1..1 so ink can never become fully invisible', () => {
    s().restoreAnnotations([rect({ id: 'r' })], 1)
    s().updateOpacity(['r'], 0)
    expect((s().annotations[0] as RectAnn).opacity).toBe(0.1)
    s().updateOpacity(['r'], 5)
    expect((s().annotations[0] as RectAnn).opacity).toBe(1)
  })
})

describe('stepZOrder (bring forward / send backward)', () => {
  const ids = (anns: { id: string }[]) => anns.map((a) => a.id)
  const list = () => ['a', 'b', 'c', 'd'].map((id) => rect({ id }))

  it('moves one place past the unselected neighbor', () => {
    expect(ids(stepZOrder(list(), new Set(['b']), 1))).toEqual(['a', 'c', 'b', 'd'])
    expect(ids(stepZOrder(list(), new Set(['c']), -1))).toEqual(['a', 'c', 'b', 'd'])
  })

  it('keeps a selected block together', () => {
    expect(ids(stepZOrder(list(), new Set(['a', 'b']), 1))).toEqual(['c', 'a', 'b', 'd'])
    expect(ids(stepZOrder(list(), new Set(['c', 'd']), -1))).toEqual(['a', 'c', 'd', 'b'])
  })

  it('returns the same array (no history) when already at the end', () => {
    const anns = list()
    expect(stepZOrder(anns, new Set(['d']), 1)).toBe(anns)
    expect(stepZOrder(anns, new Set(['a']), -1)).toBe(anns)
  })

  it('pushes history only when something moved', () => {
    s().restoreAnnotations(list(), 1)
    s().bringForward(['d'])
    expect(s().annotationHistory).toHaveLength(0)
    s().bringForward(['a'])
    expect(ids(s().annotations)).toEqual(['b', 'a', 'c', 'd'])
    expect(s().annotationHistory).toHaveLength(1)
  })
})
