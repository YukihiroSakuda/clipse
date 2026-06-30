//! Windows low-level keyboard hook (WH_KEYBOARD_LL) for the PrintScreen key.
//!
//! `RegisterHotKey` (used by tauri-plugin-global-shortcut) loses the race for
//! PrintScreen whenever another process — Screenpresso, or Windows 11's own
//! Snipping Tool ("Use PrtScn to open screen snipping") — has already claimed
//! it. A low-level hook sits *ahead* of that dispatch, so it grabs PrintScreen
//! unconditionally and can swallow the keystroke to suppress the default
//! Snipping Tool. This is the same mechanism Screenpresso uses.

use std::sync::OnceLock;

use tauri::AppHandle;
use windows::core::PCWSTR;
use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, GetMessageW, SetWindowsHookExW, HHOOK, KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL,
    WM_KEYUP, WM_SYSKEYUP,
};

/// Virtual-key code for PrintScreen (VK_SNAPSHOT).
const VK_SNAPSHOT: u32 = 0x2C;

/// AppHandle made available to the C hook callback (which can capture no state).
static APP: OnceLock<AppHandle> = OnceLock::new();

unsafe extern "system" fn keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let kb = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
        if kb.vkCode == VK_SNAPSHOT {
            let msg = wparam.0 as u32;
            // PrintScreen reliably delivers a key-up at the LL-hook level on all
            // Windows configs; fire there. Keep the callback cheap — dispatch the
            // capture onto the async runtime and return immediately, or Windows
            // will silently evict a slow hook (LowLevelHooksTimeout).
            if msg == WM_KEYUP || msg == WM_SYSKEYUP {
                if let Some(app) = APP.get() {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        // While a recording is in progress, PrintScreen stops it
                        // instead of opening the region overlay.
                        if crate::commands::record::hotkey_stop_if_recording(&app) {
                            return;
                        }
                        if let Err(e) = crate::window::open_overlay(&app) {
                            eprintln!("[hook] overlay error: {e}");
                        }
                    });
                }
            }
            // Swallow every PrintScreen event (down and up) so the OS Snipping
            // Tool / clipboard-grab never sees it.
            return LRESULT(1);
        }
    }
    CallNextHookEx(HHOOK::default(), code, wparam, lparam)
}

/// Installs the PrintScreen hook on a dedicated thread with its own message
/// pump (required for WH_KEYBOARD_LL delivery). The thread lives for the
/// process lifetime; the OS removes the hook automatically on exit.
pub fn install(app: AppHandle) {
    let _ = APP.set(app);
    std::thread::spawn(|| unsafe {
        let hmod = GetModuleHandleW(PCWSTR::null()).unwrap_or_default();
        match SetWindowsHookExW(
            WH_KEYBOARD_LL,
            Some(keyboard_proc),
            HINSTANCE(hmod.0),
            0,
        ) {
            Ok(_hook) => {
                let mut msg = MSG::default();
                while GetMessageW(&mut msg, None, 0, 0).as_bool() {}
            }
            Err(e) => eprintln!("[hook] SetWindowsHookExW failed: {e}"),
        }
    });
}
