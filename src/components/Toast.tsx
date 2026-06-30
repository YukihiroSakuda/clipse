import { useCallback, useRef, useState } from 'react'
import styles from './Toast.module.css'

export type ToastType = 'ok' | 'err'

interface ToastItem {
  id: number
  message: string
  type: ToastType
}

let _nextId = 0

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const showToast = useCallback((message: string, type: ToastType = 'ok', duration = 2000) => {
    const id = _nextId++
    setToasts((prev) => [...prev, { id, message, type }])
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
      timers.current.delete(id)
    }, duration)
    timers.current.set(id, timer)
  }, [])

  return { toasts, showToast }
}

export function ToastContainer({ toasts }: { toasts: ReturnType<typeof useToast>['toasts'] }) {
  if (toasts.length === 0) return null
  return (
    <div className={styles.container}>
      {toasts.map((t) => (
        <div key={t.id} className={`${styles.toast} ${styles[t.type]}`}>
          {t.message}
        </div>
      ))}
    </div>
  )
}
