//! Windows keyboard integration for capture + recording control.
//!
//! Two mechanisms live here, on one dedicated thread with its own message pump:
//!
//! 1. A low-level keyboard hook (`WH_KEYBOARD_LL`) for **PrintScreen**.
//!    `RegisterHotKey` loses the race for PrintScreen whenever another process —
//!    Screenpresso, or Windows 11's Snipping Tool — has claimed it, so a
//!    low-level hook sits *ahead* of that dispatch, grabs PrintScreen and
//!    swallows it to suppress the default Snipping Tool.
//!
//! 2. A `RegisterHotKey` **Escape** hotkey to stop an in-progress recording.
//!    The LL hook is unreliable here: under recording load Windows can silently
//!    evict it (LowLevelHooksTimeout), after which it receives no input at all.
//!    `RegisterHotKey` is message-based (WM_HOTKEY) and immune to that eviction.
//!    Esc is only registered *while recording*, so normal Escape is untouched
//!    otherwise. Register/unregister must run on the thread that owns the hotkey,
//!    so `enable_stop_hotkey`/`disable_stop_hotkey` post to this thread.
//!
//! 3. A hidden top-level window that receives **`WM_DISPLAYCHANGE`** — display
//!    attach/detach, resolution change, rearrangement (a message-only
//!    `HWND_MESSAGE` window would NOT get this broadcast; it goes to top-level
//!    windows only). VDI clients connecting/disconnecting reshape the desktop
//!    topology, which silently invalidates two geometry-keyed caches: the
//!    hidden overlay-window pool (`window::prewarm_overlays`) and the DXGI
//!    duplication cache (`capture_win::DUPL_CACHE`). Without this watcher both
//!    were only reconciled lazily at the next capture, which misses the case
//!    where the layout returns to a byte-identical signature but the pooled
//!    windows/duplications behind it are broken — the reported "a display is
//!    never recognized after using VDI". Events arrive in bursts, so the
//!    invalidation is debounced (`DISPLAY_DEBOUNCE_MS`).

use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::OnceLock;

use tauri::AppHandle;
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Threading::{
    GetCurrentThread, GetCurrentThreadId, SetThreadPriority, THREAD_PRIORITY_TIME_CRITICAL,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, RegisterHotKey, UnregisterHotKey, MOD_NOREPEAT,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW,
    PostThreadMessageW, RegisterClassW, SetWindowsHookExW, TranslateMessage, HHOOK,
    KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL, WINDOW_EX_STYLE, WM_APP, WM_DISPLAYCHANGE, WM_HOTKEY,
    WM_KEYUP, WM_SYSKEYUP, WNDCLASSW, WS_OVERLAPPED,
};

/// Virtual-key code for PrintScreen (VK_SNAPSHOT).
const VK_SNAPSHOT: u32 = 0x2C;
/// Virtual-key code for Escape (VK_ESCAPE).
const VK_ESCAPE: u32 = 0x1B;
/// Virtual-key code for Ctrl (VK_CONTROL), checked via `GetAsyncKeyState` to
/// distinguish Ctrl+PrintScreen from plain PrintScreen.
const VK_CONTROL: i32 = 0x11;
/// Alt (VK_MENU) and the Win keys — PrintScreen combined with either belongs
/// to the OS (Alt+PrtScn = active window to clipboard, Win+PrtScn = save to
/// file) and must NOT be swallowed; users rely on those muscle-memory combos.
const VK_MENU: i32 = 0x12;
const VK_LWIN: i32 = 0x5B;
const VK_RWIN: i32 = 0x5C;

/// Hotkey id + thread messages for the recording-stop Escape hotkey.
const HOTKEY_ID_STOP: i32 = 0xC1AB;
const WM_ENABLE_STOP: u32 = WM_APP + 1;
const WM_DISABLE_STOP: u32 = WM_APP + 2;

/// AppHandle made available to the C hook callback (which can capture no state).
static APP: OnceLock<AppHandle> = OnceLock::new();
/// Id of the hook thread, so other threads can post register/unregister requests.
static HOOK_THREAD_ID: AtomicU32 = AtomicU32::new(0);

/// `WM_DISPLAYCHANGE` fires several times per real-world topology change (one
/// per re-modeset), and reacting to each would rebuild the overlay pool — one
/// WebView2 process per monitor — repeatedly. Each event bumps this epoch and
/// arms a delayed worker; only the worker whose epoch is still current when it
/// wakes acts, so a burst collapses into one invalidation after the last event.
static DISPLAY_EPOCH: AtomicU64 = AtomicU64::new(0);
const DISPLAY_DEBOUNCE_MS: u64 = 1000;

unsafe extern "system" fn display_watch_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if msg == WM_DISPLAYCHANGE {
        // Runs on the (time-critical) hook thread via message delivery — do
        // nothing here beyond arming the debounced worker.
        let epoch = DISPLAY_EPOCH.fetch_add(1, Ordering::SeqCst) + 1;
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(DISPLAY_DEBOUNCE_MS));
            if DISPLAY_EPOCH.load(Ordering::SeqCst) != epoch {
                return; // superseded by a newer event in the same burst
            }
            crate::diag::log("display change: invalidating DXGI cache and overlay pool");
            crate::capture_win::invalidate_after_display_change();
            if let Some(app) = APP.get() {
                let app = app.clone();
                // Window creation is safest on the main thread; prewarm itself
                // skips if a capture is mid-flight (the cleared signature then
                // makes the next open_overlay rebuild instead).
                let handle = app.clone();
                let _ = handle.run_on_main_thread(move || {
                    crate::window::rebuild_overlays_for_display_change(&app);
                });
            }
        });
        return LRESULT(0);
    }
    DefWindowProcW(hwnd, msg, wparam, lparam)
}

/// Creates the invisible top-level window that receives `WM_DISPLAYCHANGE`.
/// Must be called on a thread with a message pump (the hook thread). The
/// window is never shown and is destroyed by the OS at process exit.
unsafe fn create_display_watch_window(hinstance: HINSTANCE) {
    let class_name = w!("ClipseDisplayWatch");
    let wc = WNDCLASSW {
        lpfnWndProc: Some(display_watch_proc),
        hInstance: hinstance,
        lpszClassName: class_name,
        ..Default::default()
    };
    if RegisterClassW(&wc) == 0 {
        crate::diag::log("display watch: RegisterClassW failed — display changes won't be detected");
        return;
    }
    if CreateWindowExW(
        WINDOW_EX_STYLE(0),
        class_name,
        PCWSTR::null(),
        WS_OVERLAPPED,
        0,
        0,
        0,
        0,
        None, // top-level (a message-only window wouldn't receive WM_DISPLAYCHANGE)
        None,
        hinstance,
        None,
    )
    .is_err()
    {
        crate::diag::log("display watch: CreateWindowExW failed — display changes won't be detected");
    }
}

unsafe extern "system" fn keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let kb = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
        let msg = wparam.0 as u32;
        let is_keyup = msg == WM_KEYUP || msg == WM_SYSKEYUP;

        if kb.vkCode == VK_SNAPSHOT {
            // Alt+PrtScn / Win+PrtScn are OS shortcuts (window-to-clipboard /
            // save-to-file). Swallowing every VK_SNAPSHOT used to break both —
            // pass them through untouched and only claim plain and
            // Ctrl+PrintScreen for ourselves.
            let alt_or_win = (GetAsyncKeyState(VK_MENU) as u16 & 0x8000) != 0
                || (GetAsyncKeyState(VK_LWIN) as u16 & 0x8000) != 0
                || (GetAsyncKeyState(VK_RWIN) as u16 & 0x8000) != 0;
            if alt_or_win {
                return CallNextHookEx(HHOOK::default(), code, wparam, lparam);
            }

            // PrintScreen reliably delivers a key-up at the LL-hook level on all
            // Windows configs; fire there. Keep the callback cheap — dispatch the
            // capture onto the async runtime and return immediately, or Windows
            // will silently evict a slow hook (LowLevelHooksTimeout).
            if is_keyup {
                // Ctrl+PrintScreen captures the monitor under the cursor directly,
                // with no overlay shown beforehand — unlike the plain-PrintScreen
                // region overlay (which itself takes focus and would dismiss an
                // open right-click context menu), this path never activates any
                // Clipse window before the screen is grabbed, so such menus survive
                // into the captured image.
                let ctrl_held = (GetAsyncKeyState(VK_CONTROL) as u16 & 0x8000) != 0;
                if let Some(app) = APP.get() {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        // While a recording is in progress, PrintScreen stops it
                        // instead of opening the region overlay.
                        if crate::commands::record::hotkey_stop_if_recording(&app) {
                            return;
                        }
                        if ctrl_held {
                            if let Err(e) = crate::commands::capture::do_cursor_monitor_capture(app).await {
                                eprintln!("[hook] cursor-monitor capture error: {e}");
                            }
                        } else if let Err(e) = crate::window::open_overlay(&app) {
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

/// Installs the PrintScreen hook and runs the message pump (also serving the
/// recording-stop Escape hotkey). The thread lives for the process lifetime;
/// the OS removes the hook automatically on exit.
pub fn install(app: AppHandle) {
    let _ = APP.set(app);
    std::thread::spawn(|| unsafe {
        let hmod = GetModuleHandleW(PCWSTR::null()).unwrap_or_default();
        match SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), HINSTANCE(hmod.0), 0) {
            Ok(_hook) => {
                HOOK_THREAD_ID.store(GetCurrentThreadId(), Ordering::SeqCst);
                // Under recording load the capture/encoder threads can starve
                // this thread; run high so the PrintScreen callback is serviced
                // promptly (LowLevelHooksTimeout eviction otherwise).
                let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_TIME_CRITICAL);

                // Display-topology watcher (see module docs, item 3) — lives on
                // this thread because it already has the required message pump.
                create_display_watch_window(HINSTANCE(hmod.0));

                let mut msg = MSG::default();
                while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                    match msg.message {
                        WM_HOTKEY if msg.wParam.0 as i32 == HOTKEY_ID_STOP => {
                            if let Some(app) = APP.get() {
                                let app = app.clone();
                                tauri::async_runtime::spawn(async move {
                                    crate::commands::record::hotkey_stop_if_recording(&app);
                                });
                            }
                        }
                        WM_ENABLE_STOP => {
                            // Register a bare-Escape global hotkey for the duration
                            // of the recording (MOD_NOREPEAT so held Esc fires once).
                            let _ =
                                RegisterHotKey(HWND::default(), HOTKEY_ID_STOP, MOD_NOREPEAT, VK_ESCAPE);
                        }
                        WM_DISABLE_STOP => {
                            let _ = UnregisterHotKey(HWND::default(), HOTKEY_ID_STOP);
                        }
                        _ => {
                            // Route window messages (the display watcher's
                            // WM_DISPLAYCHANGE included) to their wndproc; the
                            // thread messages above have no target window.
                            let _ = TranslateMessage(&msg);
                            DispatchMessageW(&msg);
                        }
                    }
                }
            }
            Err(e) => eprintln!("[hook] SetWindowsHookExW failed: {e}"),
        }
    });
}

/// Arms the Escape-stops-recording hotkey. Call when a recording starts.
pub fn enable_stop_hotkey() {
    let tid = HOOK_THREAD_ID.load(Ordering::SeqCst);
    if tid != 0 {
        unsafe {
            let _ = PostThreadMessageW(tid, WM_ENABLE_STOP, WPARAM(0), LPARAM(0));
        }
    }
}

/// Disarms the Escape-stops-recording hotkey. Call when a recording stops, so
/// Escape returns to its normal behaviour everywhere.
pub fn disable_stop_hotkey() {
    let tid = HOOK_THREAD_ID.load(Ordering::SeqCst);
    if tid != 0 {
        unsafe {
            let _ = PostThreadMessageW(tid, WM_DISABLE_STOP, WPARAM(0), LPARAM(0));
        }
    }
}
