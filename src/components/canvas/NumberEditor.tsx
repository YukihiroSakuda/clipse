import { useCallback, useEffect, useRef, useState } from 'react'
import type { NumberAnn } from '../../lib/annotations'
import styles from '../AnnotationCanvas.module.css'

interface OpenNumberEdit {
  id: string
  cssX: number
  cssY: number
  /** The marker's on-screen diameter, so the input can sit exactly on it. */
  size: number
}

/**
 * Editing a number marker's value in place.
 *
 * Self-contained: the only thing the canvas does with it is open it on a
 * double-click, skip drawing the marker while it is open (the input sits on
 * top of where it would be), and render the input.
 */
export function useNumberEditor(onUpdateNumber: (id: string, n: number) => void) {
  const [edit, setEdit] = useState<OpenNumberEdit | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // Set on Escape so the input's blur handler skips committing (cancel edit).
  const cancelRef = useRef(false)

  // Focus & select the input when it opens.
  useEffect(() => {
    if (!edit) return
    const el = inputRef.current
    if (!el) return
    const id = setTimeout(() => { el.focus(); el.select() }, 0)
    return () => clearTimeout(id)
  }, [edit])

  const open = useCallback((next: OpenNumberEdit) => setEdit(next), [])

  const commit = useCallback((value: string) => {
    if (!edit) return
    const { id } = edit
    setEdit(null)
    const n = parseInt(value, 10)
    if (Number.isFinite(n)) onUpdateNumber(id, n)
  }, [edit, onUpdateNumber])

  const cancel = useCallback(() => {
    cancelRef.current = true
    setEdit(null)
  }, [])

  return { edit, inputRef, cancelRef, open, commit, cancel }
}

export type NumberEditorState = ReturnType<typeof useNumberEditor>

/** The marker's value input, laid over the marker it belongs to. */
export function NumberEditor({ state, ann }: { state: NumberEditorState; ann: NumberAnn }) {
  const { edit, inputRef, cancelRef, commit, cancel } = state
  if (!edit) return null
  return (
    <input
      ref={inputRef}
      type="number"
      className={styles.numberInput}
      defaultValue={ann.n}
      style={{
        left: edit.cssX,
        top: edit.cssY,
        width: edit.size,
        height: edit.size,
        borderRadius: ann.shape === 'circle' ? '50%' : `${edit.size * 0.14}px`,
        fontSize: edit.size * 0.45,
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          cancel()
        }
        if (e.key === 'Enter') {
          e.preventDefault()
          commit(e.currentTarget.value)
        }
      }}
      onBlur={(e) => {
        if (cancelRef.current) { cancelRef.current = false; return }
        commit(e.currentTarget.value)
      }}
    />
  )
}
