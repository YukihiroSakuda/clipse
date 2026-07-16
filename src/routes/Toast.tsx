import { useCallback, useEffect, useRef, useState } from 'react'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { X } from 'lucide-react'
import { ipc } from '../lib/ipc'
import styles from './Toast.module.css'

const AUTO_DISMISS_MS = 3000

// Capture-complete toast (Teams-notification style), shown at the bottom-right
// of the captured monitor (window.rs::show_capture_toast). The capture is
// already saved and on the clipboard by the time this appears; clicking the
// card opens the editor on it. The window is reused across captures — each
// re-show fires a `toast-show` event that restarts the entrance animation and
// the auto-dismiss timer (unconditional: hovering does not pause it).
//
// The card is made invisible the moment the window is dismissed or hidden
// (visibilitychange), so the reused window can never flash its previous,
// fully-rendered frame before the entrance animation replays — without this
// the toast visibly appeared "twice" on every capture after the first.
export default function Toast() {
  const [showKey, setShowKey] = useState(0)
  const [hidden, setHidden] = useState(false)
  const timerRef = useRef<number | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const armTimer = useCallback(() => {
    clearTimer()
    timerRef.current = window.setTimeout(() => {
      setHidden(true)
      ipc.toastDismiss().catch(console.error)
    }, AUTO_DISMISS_MS)
  }, [clearTimer])

  useEffect(() => {
    armTimer()
    const unlisten = getCurrentWebviewWindow().listen('toast-show', () => {
      setHidden(false)
      setShowKey((k) => k + 1)
      armTimer()
    })
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        setHidden(true)
        clearTimer()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      clearTimer()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      unlisten.then((f) => f())
    }
  }, [armTimer, clearTimer])

  const handleOpen = useCallback(() => {
    clearTimer()
    setHidden(true)
    ipc.toastOpenEditor().catch(console.error)
  }, [clearTimer])

  const handleDismiss = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    clearTimer()
    setHidden(true)
    ipc.toastDismiss().catch(console.error)
  }, [clearTimer])

  return (
    <div
      key={showKey}
      className={`${styles.card} ${hidden ? styles.cardHidden : ''}`}
      onClick={handleOpen}
    >
      <img className={styles.appIcon} src="/icon.png" alt="" />
      <div className={styles.textCol}>
        <span className={styles.title}>Copied to clipboard!</span>
        <span className={styles.sub}>Click here if you want to edit</span>
      </div>
      <button className={styles.closeBtn} onClick={handleDismiss} title="Dismiss">
        <X size={13} strokeWidth={2} />
      </button>
    </div>
  )
}
