import { useEffect } from 'react'
import { ipc } from './ipc'

/**
 * Last-resort PrintScreen handling for a focused Clipse window.
 *
 * PrintScreen normally never reaches any webview: the global low-level keyboard
 * hook (`hook_win.rs`) claims it process-wide and swallows it (`LRESULT(1)`), and
 * a `RegisterHotKey` fallback sits behind that. But both can miss the key while
 * one of *our own* windows has focus:
 *
 * - the hook is observed to go silent whenever a Clipse WebView2 window is
 *   focused — for every key, not just this one. A `WH_KEYBOARD_LL` hook is not
 *   supposed to be focus-dependent, and the mechanism is still unexplained;
 * - the hotkey registration fails outright when another process already owns
 *   PrintScreen (OneDrive's screenshot upload, Screenpresso, Windows' own
 *   "PrtScn opens screen snipping"), which is common.
 *
 * When both miss it, the one place the keystroke still lands is the focused
 * window itself — here. A hook that receives the key never lets it through to a
 * webview, so in the common case this handler simply never runs; when two paths
 * do overlap, the loser is rejected with "a capture is already in progress" and
 * swallowed below rather than shown to the user.
 *
 * Chromium reports PrintScreen on **keyup only** (no keydown is ever delivered),
 * so this listens on keyup.
 *
 * @param label short window name for the diagnostics line, e.g. `"editor"`.
 * @param onError surfaces a failed capture to the user; without it the key
 *        silently does nothing, which is the very symptom this exists to fix.
 */
export function usePrintScreenKey(label: string, onError: (message: string) => void) {
  useEffect(() => {
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== 'PrintScreen') return
      e.preventDefault()
      // Which of the three paths fired is otherwise invisible, and "PrintScreen
      // does nothing" is only diagnosable from a field report by knowing that.
      void ipc.logDiag(`${label}: PrintScreen seen by the focused window`).catch(() => {})
      // Ctrl+PrintScreen keeps its own meaning: open the quick action menu at
      // the cursor rather than capturing (see `window::open_quick_menu`).
      const capture = e.ctrlKey || e.metaKey
        ? ipc.openQuickMenu()
        : ipc.openRegionOverlay()
      capture.catch((err) => {
        const message = String(err)
        // Losing the capture claim is the *expected* outcome whenever one of the
        // other two PrintScreen paths got there first — which is normal on any
        // machine where the `RegisterHotKey` fallback registered successfully.
        // The design is deliberately redundant and the claim is what arbitrates,
        // so the overlay the user asked for is opening either way. Showing that
        // as a red error was simply wrong.
        if (/already in progress/i.test(message)) {
          void ipc.logDiag(`${label}: another path claimed this capture first`).catch(() => {})
          return
        }
        // A real failure. Logged as well as shown, because until now this path
        // reported errors to the toast and nowhere else — so "PrintScreen showed
        // a red message" left no trace to diagnose afterwards.
        void ipc.logDiag(`${label}: capture failed — ${message}`).catch(() => {})
        onError(message)
      })
    }
    window.addEventListener('keyup', onKeyUp)
    return () => window.removeEventListener('keyup', onKeyUp)
  }, [label, onError])
}
