import { useCallback, useRef, useState } from 'react'
import { AlertCircle, Check, Loader2 } from 'lucide-react'
import styles from './Toast.module.css'

export type ToastType = 'ok' | 'err' | 'busy'

interface ToastItem {
  id: number
  message: string
  type: ToastType
}

let _nextId = 0

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  /** Shows a toast; `duration: 0` keeps it until `dismissToast(id)` is called
   * (progress feedback for in-flight work). Returns the toast id. */
  const showToast = useCallback((message: string, type: ToastType = 'ok', duration = 2000): number => {
    const id = _nextId++
    setToasts((prev) => [...prev, { id, message, type }])
    if (duration > 0) {
      const timer = setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
        timers.current.delete(id)
      }, duration)
      timers.current.set(id, timer)
    }
    return id
  }, [])

  const dismissToast = useCallback((id: number) => {
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return { toasts, showToast, dismissToast }
}

export function ToastContainer({ toasts }: { toasts: ReturnType<typeof useToast>['toasts'] }) {
  if (toasts.length === 0) return null
  return (
    <div className={styles.container}>
      {toasts.map((t) => (
        <div key={t.id} className={`${styles.toast} ${styles[t.type]}`}>
          {t.type === 'ok' && <Check size={13} strokeWidth={2} />}
          {t.type === 'err' && <AlertCircle size={13} strokeWidth={2} />}
          {t.type === 'busy' && (
            <Loader2 size={13} strokeWidth={2} className={styles.busySpinner} />
          )}
          {t.message}
        </div>
      ))}
    </div>
  )
}
