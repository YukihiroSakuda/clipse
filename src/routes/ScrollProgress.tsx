import { Loader2 } from 'lucide-react'
import styles from './ScrollProgress.module.css'

// Purely informational: shown while a scrolling capture stitches frames in the
// background (the region overlay is hidden the instant scrolling starts, so
// without this the user has no on-screen sign anything is still happening).
// The window is click-through and excluded from screen capture (window.rs),
// so it can never appear in the stitched output or intercept input.
export default function ScrollProgress() {
  return (
    <div className={styles.badge}>
      <Loader2 size={14} strokeWidth={2} className={styles.spinner} />
      <span>Scrolling &amp; stitching…</span>
    </div>
  )
}
