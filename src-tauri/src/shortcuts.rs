//! Global-shortcut accelerators: the string form stored in `settings.json`, and
//! the `(modifiers, virtual-key)` pair the keyboard hook matches against.
//!
//! The canonical text form is `Ctrl+Alt+Shift+Key` — modifiers always in that
//! order, then one key name, joined by `+`. `src/lib/shortcuts.ts` is the
//! frontend mirror of this file and must produce the same strings; the names
//! below are the contract between them.
//!
//! Windows-only in effect (the hook is), but the parsing is platform-neutral so
//! settings written on one machine still round-trip anywhere.

/// The two actions a global shortcut can be bound to. Deliberately a closed set:
/// everything else Clipse does is reached from the quick menu rather than from a
/// hotkey of its own (see the "Global hotkeys" section of CLAUDE.md).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GlobalAction {
    /// Region-select overlay.
    Capture,
    /// Quick action menu at the cursor.
    QuickMenu,
}

pub const MOD_CTRL: u32 = 1;
pub const MOD_ALT: u32 = 2;
pub const MOD_SHIFT: u32 = 4;

/// A parsed accelerator: a modifier bitmask plus one Windows virtual-key code.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Accel {
    pub mods: u32,
    pub vk: u32,
}

/// Virtual-key code for PrintScreen (VK_SNAPSHOT) — special-cased in several
/// places, so it's named rather than looked up.
pub const VK_SNAPSHOT: u32 = 0x2C;

/// Named keys, by their accelerator name. Letters, digits and F-keys are handled
/// by range below rather than listed here.
const NAMED_KEYS: &[(&str, u32)] = &[
    ("PrintScreen", VK_SNAPSHOT),
    ("Pause", 0x13),
    ("ScrollLock", 0x91),
    ("Insert", 0x2D),
    ("Delete", 0x2E),
    ("Home", 0x24),
    ("End", 0x23),
    ("PageUp", 0x21),
    ("PageDown", 0x22),
    ("Space", 0x20),
    ("Tab", 0x09),
    ("Backspace", 0x08),
    ("Left", 0x25),
    ("Up", 0x26),
    ("Right", 0x27),
    ("Down", 0x28),
];

/// Keys safe to bind on their own, with no modifier.
///
/// A global hotkey is swallowed process-wide, so binding a bare key takes it
/// away from every other application. That is fine for keys nothing types with
/// — and is exactly what PrintScreen has always done here — but a bare `A`, or
/// even a bare `F5`, would be indistinguishable from a broken keyboard. Anything
/// not in this set needs at least one modifier (`validate`).
fn standalone_ok(vk: u32) -> bool {
    // PrintScreen, Pause, ScrollLock, and F13-F24 (which no standard keyboard
    // even has as a single keypress, so nothing else is listening for them).
    vk == VK_SNAPSHOT || vk == 0x13 || vk == 0x91 || (0x7C..=0x87).contains(&vk)
}

/// Resolves a key name to its virtual-key code.
fn vk_from_name(name: &str) -> Option<u32> {
    if let Some(&(_, vk)) = NAMED_KEYS.iter().find(|(n, _)| n.eq_ignore_ascii_case(name)) {
        return Some(vk);
    }
    // F1-F24 → 0x70..=0x87
    if let Some(digits) = name.strip_prefix('F').or_else(|| name.strip_prefix('f')) {
        if let Ok(n) = digits.parse::<u32>() {
            if (1..=24).contains(&n) {
                return Some(0x6F + n);
            }
        }
    }
    let mut chars = name.chars();
    let (first, rest) = (chars.next()?, chars.next());
    if rest.is_some() {
        return None;
    }
    match first {
        'A'..='Z' => Some(first as u32),
        'a'..='z' => Some(first.to_ascii_uppercase() as u32),
        '0'..='9' => Some(first as u32),
        _ => None,
    }
}

/// The name `vk_from_name` would accept back — used to canonicalize whatever was
/// in `settings.json` into the form the UI displays.
fn name_from_vk(vk: u32) -> Option<String> {
    if let Some(&(name, _)) = NAMED_KEYS.iter().find(|(_, v)| *v == vk) {
        return Some(name.to_string());
    }
    if (0x70..=0x87).contains(&vk) {
        return Some(format!("F{}", vk - 0x6F));
    }
    if (0x41..=0x5A).contains(&vk) || (0x30..=0x39).contains(&vk) {
        return char::from_u32(vk).map(|c| c.to_string());
    }
    None
}

impl Accel {
    /// Parses `"Ctrl+Shift+F9"`. Modifier names are case-insensitive and may
    /// appear in any order; `Cmd`/`Meta`/`Win` are rejected along with anything
    /// else unrecognized (see `validate` for why the Windows key is out).
    pub fn parse(text: &str) -> Result<Self, String> {
        let mut mods = 0;
        let mut key = None;
        for part in text.split('+').map(str::trim).filter(|p| !p.is_empty()) {
            match part.to_ascii_lowercase().as_str() {
                "ctrl" | "control" => mods |= MOD_CTRL,
                "alt" => mods |= MOD_ALT,
                "shift" => mods |= MOD_SHIFT,
                _ => {
                    if key.is_some() {
                        return Err(format!("More than one key in \"{text}\""));
                    }
                    key = Some(
                        vk_from_name(part).ok_or_else(|| format!("Unknown key \"{part}\""))?,
                    );
                }
            }
        }
        let vk = key.ok_or_else(|| format!("No key in \"{text}\""))?;
        Ok(Self { mods, vk })
    }

    /// Canonical text form, as stored and displayed.
    pub fn format(&self) -> String {
        let mut out = String::new();
        if self.mods & MOD_CTRL != 0 {
            out.push_str("Ctrl+");
        }
        if self.mods & MOD_ALT != 0 {
            out.push_str("Alt+");
        }
        if self.mods & MOD_SHIFT != 0 {
            out.push_str("Shift+");
        }
        out.push_str(&name_from_vk(self.vk).unwrap_or_else(|| format!("0x{:02X}", self.vk)));
        out
    }

    /// Rejects bindings that would be actively harmful. Returns the reason, for
    /// showing next to the offending row in Settings.
    pub fn validate(&self) -> Result<(), String> {
        if self.mods == 0 && !standalone_ok(self.vk) {
            return Err("Needs at least one modifier (Ctrl, Alt or Shift)".into());
        }
        // Alt+PrtScn (active window to clipboard) and Win+PrtScn (save to file)
        // are OS shortcuts the hook deliberately lets through untouched; binding
        // over one would mean either breaking it or silently not working.
        if self.vk == VK_SNAPSHOT && self.mods & MOD_ALT != 0 {
            return Err("Alt+PrintScreen belongs to Windows".into());
        }
        Ok(())
    }
}

/// Parses and validates a stored accelerator, falling back to `default` — which
/// is a compile-time constant and so is expected to parse — when the stored one
/// is unusable. A `settings.json` hand-edited into nonsense therefore degrades to
/// the shipped binding rather than leaving the action unreachable.
pub fn resolve(text: &str, default: &str) -> Accel {
    let parsed = Accel::parse(text).and_then(|a| a.validate().map(|_| a));
    match parsed {
        Ok(a) => a,
        Err(e) => {
            crate::diag::log(&format!(
                "shortcuts: \"{text}\" rejected ({e}) — falling back to {default}"
            ));
            Accel::parse(default).unwrap_or(Accel {
                mods: 0,
                vk: VK_SNAPSHOT,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_the_defaults() {
        for text in ["PrintScreen", "Ctrl+PrintScreen", "Ctrl+Alt+Shift+F9", "Ctrl+K"] {
            assert_eq!(Accel::parse(text).unwrap().format(), text, "{text}");
        }
    }

    #[test]
    fn orders_modifiers_canonically() {
        assert_eq!(Accel::parse("shift+ctrl+a").unwrap().format(), "Ctrl+Shift+A");
    }

    #[test]
    fn rejects_bare_typing_keys_but_allows_printscreen() {
        assert!(Accel::parse("A").unwrap().validate().is_err());
        assert!(Accel::parse("F5").unwrap().validate().is_err());
        assert!(Accel::parse("PrintScreen").unwrap().validate().is_ok());
        assert!(Accel::parse("F13").unwrap().validate().is_ok());
    }

    #[test]
    fn rejects_the_os_printscreen_combo() {
        assert!(Accel::parse("Alt+PrintScreen").unwrap().validate().is_err());
    }

    #[test]
    fn rejects_junk() {
        assert!(Accel::parse("Ctrl+Nope").is_err());
        assert!(Accel::parse("Ctrl").is_err());
        assert!(Accel::parse("Ctrl+A+B").is_err());
    }

    #[test]
    fn resolve_falls_back_on_a_bad_stored_value() {
        assert_eq!(resolve("Ctrl+Nope", "Ctrl+PrintScreen").format(), "Ctrl+PrintScreen");
        assert_eq!(resolve("A", "PrintScreen").format(), "PrintScreen");
    }
}
