// Global-shortcut accelerators, frontend side.
//
// The mirror of `src-tauri/src/shortcuts.rs`: the canonical text form is
// `Ctrl+Alt+Shift+Key`, modifiers always in that order, and the key names below
// must match that file's `NAMED_KEYS` exactly — the string is what crosses the
// IPC boundary and lands in settings.json.
//
// Rust re-validates everything on save; the checks here exist so the user is
// told *while* they are pressing keys, not after.

/** Keys whose `e.code` is already the accelerator name. */
const DIRECT_CODES = new Set([
  'PrintScreen', 'Pause', 'ScrollLock',
  'Insert', 'Delete', 'Home', 'End', 'PageUp', 'PageDown',
  'Space', 'Tab', 'Backspace',
])

/** `e.code` values that need renaming to reach the accelerator name. */
const RENAMED_CODES: Record<string, string> = {
  ArrowLeft: 'Left', ArrowUp: 'Up', ArrowRight: 'Right', ArrowDown: 'Down',
}

/** Modifier keys, which can never be the accelerator's key on their own. */
const MODIFIER_CODES = /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/

/**
 * The accelerator key name for a `KeyboardEvent`, or null if this key can't be
 * bound. Reads `e.code` (physical key) rather than `e.key`, the same choice the
 * in-app shortcuts make: with a Japanese IME active `e.key` reports `'Process'`,
 * and CapsLock changes its case.
 */
function keyName(code: string): string | null {
  if (DIRECT_CODES.has(code)) return code
  if (code in RENAMED_CODES) return RENAMED_CODES[code]
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter) return letter[1]
  const digit = /^Digit(\d)$/.exec(code)
  if (digit) return digit[1]
  return null
}

/** Keys that may be bound with no modifier — see `standalone_ok` in shortcuts.rs. */
function standaloneOk(name: string): boolean {
  if (name === 'PrintScreen' || name === 'Pause' || name === 'ScrollLock') return true
  const f = /^F(\d+)$/.exec(name)
  return f !== null && Number(f[1]) >= 13
}

export interface Accel {
  /** Canonical text form, e.g. "Ctrl+Shift+F9". */
  text: string
  /** Why this combination can't be used, or null if it's fine. */
  error: string | null
}

/**
 * Builds an accelerator from a key event, or returns null when the event isn't
 * a candidate yet (a bare modifier, or a key with no accelerator name) so the
 * recorder can keep listening instead of rejecting it.
 */
export function accelFromEvent(e: KeyboardEvent): Accel | null {
  if (MODIFIER_CODES.test(e.code)) return null
  const name = keyName(e.code)
  if (!name) return null

  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  parts.push(name)
  const text = parts.join('+')

  let error: string | null = null
  if (e.metaKey) {
    // Win+… is left to Windows: Win+PrtScn saves a screenshot to file, and the
    // hook deliberately passes anything held with the Win key straight through.
    error = 'The Windows key can\'t be used'
  } else if (!e.ctrlKey && !e.altKey && !e.shiftKey && !standaloneOk(name)) {
    error = 'Needs at least one modifier (Ctrl, Alt or Shift)'
  } else if (name === 'PrintScreen' && e.altKey) {
    error = 'Alt+PrintScreen belongs to Windows'
  }
  return { text, error }
}

/** Splits an accelerator into its parts, for rendering as separate `<kbd>`s. */
export function accelParts(text: string): string[] {
  return text.split('+').filter(Boolean)
}
