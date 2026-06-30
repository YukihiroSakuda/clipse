// Builds Tauri global-shortcut accelerator strings (e.g. "Ctrl+Shift+1") from
// keyboard events, and validates them.

const MODIFIER_CODES = new Set([
  'ControlLeft', 'ControlRight',
  'ShiftLeft', 'ShiftRight',
  'AltLeft', 'AltRight',
  'MetaLeft', 'MetaRight',
])

/** True when the pressed key is only a modifier (no main key yet). */
export function isModifierOnly(e: KeyboardEvent): boolean {
  return MODIFIER_CODES.has(e.code)
}

/** Maps a KeyboardEvent.code to a Tauri accelerator key token, or null if unsupported. */
function codeToKey(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)            // KeyA → A
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)          // Digit1 → 1
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code        // F1..F24
  if (/^Numpad[0-9]$/.test(code)) return code                   // Numpad0..9
  const named: Record<string, string> = {
    Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace',
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
    Semicolon: ';', Quote: "'", Backquote: '`', Backslash: '\\',
    Comma: ',', Period: '.', Slash: '/',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    Insert: 'Insert', Delete: 'Delete',
  }
  return named[code] ?? null
}

/**
 * Builds an accelerator string from a keydown event. Returns null if the event
 * is only a modifier or the main key is unsupported. Requires at least one
 * modifier so accelerators don't clash with plain typing.
 */
export function accelFromEvent(e: KeyboardEvent): string | null {
  if (isModifierOnly(e)) return null
  const key = codeToKey(e.code)
  if (!key) return null
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')
  if (e.metaKey) parts.push('Super')
  if (parts.length === 0) return null   // require a modifier
  parts.push(key)
  return parts.join('+')
}

/** Pretty display for an accelerator (keeps the canonical token form). */
export function formatAccel(accel: string): string {
  return accel.split('+').join(' + ')
}
