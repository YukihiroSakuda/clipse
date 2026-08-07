import { useCallback, useEffect, useRef, useState } from 'react'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import {
  Camera, Copy, Images, Maximize, Monitor, MousePointer,
  Scroll, Settings as SettingsIcon, Video,
} from 'lucide-react'
import { ipc } from '../lib/ipc'
import styles from './QuickMenu.module.css'

/**
 * Quick action menu — Ctrl+PrintScreen's action (`window::open_quick_menu`).
 *
 * Driven with the keyboard: ↑/↓ move the selection (wrapping at both ends),
 * Enter runs it, Esc dismisses, and 1–9 run a row directly. The mouse works too,
 * but the keyboard is the point: the whole flow is meant to be Ctrl+PrintScreen,
 * an arrow or two, Enter — without ever leaving the keyboard.
 *
 * The window is reused across invocations (created once, then hidden/shown), so
 * a stale selection from last time would otherwise be waiting on the next open.
 * The `quickmenu-show` event resets it, and the same trick as the capture toast
 * blanks the panel while hidden so the reused window can't flash its previous
 * frame before the entrance animation replays.
 */

/** `id` must match a `QuickAction::from_id` arm in `commands/actions.rs`. */
const ITEMS = [
  // Gallery leads, so it is what the selection starts on: Ctrl+PrintScreen then
  // Enter opens the capture history. Plain PrintScreen already covers taking a
  // shot, which is why that isn't the default here.
  { id: 'gallery',    label: 'Open Gallery',       Icon: Images },
  { id: 'capture',    label: 'Take Screenshot',    Icon: Camera },
  { id: 'cap_repeat', label: 'Repeat Last Region', Icon: Copy },
  { id: 'cap_cursor', label: 'Capture This Monitor', Icon: MousePointer },
  { id: 'cap_all',    label: 'Capture All Monitors', Icon: Monitor },
  { id: 'cap_scroll', label: 'Scrolling Capture',  Icon: Scroll },
  { id: 'cap_fixed',  label: 'Fixed-Size Capture', Icon: Maximize },
  { id: 'record',     label: 'Record Screen',      Icon: Video },
  { id: 'settings',   label: 'Settings',           Icon: SettingsIcon },
] as const

export default function QuickMenu() {
  const [selected, setSelected] = useState(0)
  const [showKey, setShowKey] = useState(0)
  const [hidden, setHidden] = useState(false)
  // Guards against a second action firing after one is already on its way —
  // Enter and a click can both land before the window finishes hiding.
  const runningRef = useRef(false)
  const blurTimerRef = useRef<number | null>(null)

  const close = useCallback(() => {
    if (runningRef.current) return
    runningRef.current = true
    setHidden(true)
    ipc.quickMenuClose().catch(console.error)
  }, [])

  const run = useCallback((index: number) => {
    if (runningRef.current) return
    runningRef.current = true
    setHidden(true)
    ipc.quickMenuRun(ITEMS[index].id).catch(console.error)
  }, [])

  useEffect(() => {
    const unlisten = getCurrentWebviewWindow().listen('quickmenu-show', () => {
      if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current)
      blurTimerRef.current = null
      runningRef.current = false
      setSelected(0)
      setHidden(false)
      setShowKey((k) => k + 1)
    })

    // Focus can be lost without Esc ever being pressed (a click elsewhere,
    // Alt+Tab). A menu left floating on top after that is the classic stuck-
    // window bug, so treat it as a dismiss — same as the OS does for its own
    // menus. Confirmed a tick later rather than acted on immediately: showing
    // the window and then focusing it is two steps, and a blur landing in that
    // gap would otherwise close the menu the instant it appeared.
    const onBlur = () => {
      if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current)
      blurTimerRef.current = window.setTimeout(() => {
        blurTimerRef.current = null
        if (!document.hasFocus()) close()
      }, 80)
    }

    // The window can also be hidden from the backend without this webview being
    // told (`hide_quick_menu`, e.g. the user pressed PrintScreen with the menu
    // open). Blank the panel so the reused window can't flash its stale last
    // frame on the next open, the same way the capture toast does.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') setHidden(true)
    }

    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      unlisten.then((f) => f())
    }
  }, [close])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelected((i) => (i + 1) % ITEMS.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelected((i) => (i - 1 + ITEMS.length) % ITEMS.length)
      } else if (e.key === 'Home') {
        e.preventDefault()
        setSelected(0)
      } else if (e.key === 'End') {
        e.preventDefault()
        setSelected(ITEMS.length - 1)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        run(selected)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        close()
      } else if (e.key >= '1' && e.key <= '9') {
        const index = Number(e.key) - 1
        if (index < ITEMS.length) {
          e.preventDefault()
          run(index)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selected, run, close])

  return (
    <div key={showKey} className={`${styles.panel} ${hidden ? styles.panelHidden : ''}`}>
      <ul className={styles.list}>
        {ITEMS.map((item, i) => (
          <li key={item.id}>
            <button
              className={`${styles.item} ${i === selected ? styles.itemSelected : ''}`}
              // Hover selects rather than merely highlighting, so the mouse and
              // the arrow keys can't end up disagreeing about what Enter runs.
              onMouseEnter={() => setSelected(i)}
              onClick={() => run(i)}
            >
              <item.Icon className={styles.icon} size={14} strokeWidth={1.5} />
              <span className={styles.label}>{item.label}</span>
              <span className={styles.num}>{i + 1}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className={styles.hint}>&uarr;&darr; select &middot; Enter run &middot; Esc close</div>
    </div>
  )
}
