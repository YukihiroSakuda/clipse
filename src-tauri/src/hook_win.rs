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

use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU32, AtomicU64, Ordering};
use std::sync::OnceLock;

use tauri::AppHandle;
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Threading::{
    GetCurrentThread, GetCurrentThreadId, SetThreadPriority, THREAD_PRIORITY_TIME_CRITICAL,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, RegisterHotKey, UnregisterHotKey, MOD_CONTROL, MOD_NOREPEAT,
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

/// Hotkey ids for the PrintScreen **fallback** (see `register_prtscn_fallback`).
const HOTKEY_ID_PRTSCN: i32 = 0xC1AC;
const HOTKEY_ID_PRTSCN_CTRL: i32 = 0xC1AD;
/// Posted to the hook thread to re-attempt a fallback registration that failed
/// because another process held the key (see `PRTSCN_RETRY_SECS`).
const WM_RETRY_PRTSCN: u32 = WM_APP + 3;

/// Which fallback hotkeys are currently registered — only touched on the hook
/// thread, so plain loads/stores are enough. Used to stop the retry loop.
static PRTSCN_HOTKEY_OK: AtomicBool = AtomicBool::new(false);
static PRTSCN_CTRL_HOTKEY_OK: AtomicBool = AtomicBool::new(false);
/// How often to re-attempt a failed fallback registration.
///
/// Whoever owns PrintScreen (Windows' own "PrtScn opens screen snipping"
/// binding, Screenpresso, …) can release it at any time — the user turns the
/// setting off, or quits the app — and there is no notification when that
/// happens. Without a retry the fallback would stay dead until Clipse itself is
/// restarted, which is a confusing thing to require after fixing the conflict.
const PRTSCN_RETRY_SECS: u64 = 30;

/// AppHandle made available to the C hook callback (which can capture no state).
static APP: OnceLock<AppHandle> = OnceLock::new();
/// Id of the hook thread, so other threads can post register/unregister requests.
static HOOK_THREAD_ID: AtomicU32 = AtomicU32::new(0);
/// How many features currently want the Escape stop-hotkey armed. Recording
/// and scrolling capture share the hotkey (same id, same "stop what's
/// running" semantics), and can overlap — a recording must not lose its Esc
/// because a scroll capture finished and unregistered it. Register on 0→1,
/// unregister on 1→0; only ever touched on the hook thread.
static STOP_HOTKEY_REFS: AtomicI32 = AtomicI32::new(0);

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
                dispatch_printscreen(ctrl_held, "hook");
            }
            // Swallow every PrintScreen event (down and up) so the OS Snipping
            // Tool / clipboard-grab never sees it.
            return LRESULT(1);
        }
    }
    CallNextHookEx(HHOOK::default(), code, wparam, lparam)
}

/// Runs the PrintScreen action. Shared by the low-level hook and the
/// `RegisterHotKey` fallback, so both entry points behave identically; `via`
/// only labels the log line.
///
/// Returns immediately — the work is handed to the async runtime, because the
/// hook callback must not overrun `LowLevelHooksTimeout` (Windows silently
/// evicts a slow hook, and then PrintScreen stops working entirely).
fn dispatch_printscreen(ctrl_held: bool, via: &'static str) {
    let Some(app) = APP.get() else { return };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        crate::diag::log(&format!(
            "{via}: PrintScreen{} dispatched",
            if ctrl_held { " (Ctrl)" } else { "" }
        ));
        // While a recording is in progress, PrintScreen stops it instead of
        // opening the region overlay.
        if crate::commands::record::hotkey_stop_if_recording(&app) {
            crate::diag::log(&format!("{via}: consumed to stop a recording"));
            return;
        }
        // Likewise, PrintScreen mid-scroll-capture stops the scroll (keeping
        // what's stitched so far) instead of trying to open a new overlay over it.
        if crate::scroll_win::stop_if_capturing() {
            crate::diag::log(&format!("{via}: consumed to stop a scrolling capture"));
            return;
        }
        if ctrl_held {
            if let Err(e) = crate::commands::capture::do_cursor_monitor_capture(app).await {
                eprintln!("[{via}] cursor-monitor capture error: {e}");
                crate::diag::log(&format!("{via}: cursor-monitor capture failed: {e}"));
            }
        } else if let Err(e) = crate::window::open_overlay(&app) {
            eprintln!("[{via}] overlay error: {e}");
            crate::diag::log(&format!("{via}: open_overlay failed: {e}"));
        }
    });
}

/// Registers PrintScreen (plain and Ctrl+) as `RegisterHotKey` hotkeys, as a
/// **fallback** for the low-level hook.
///
/// The two paths cannot double-fire, which is what makes this safe: the hook
/// runs *ahead* of hotkey dispatch and swallows PrintScreen (`LRESULT(1)`), so
/// whenever the hook works the hotkey never sees the key at all. It fires only
/// when the hook did not receive the keystroke — the reported failure, where
/// PrintScreen does nothing while a Clipse editor window holds focus even though
/// the same hook is receiving every other key.
///
/// Best-effort by design: `RegisterHotKey` fails when another process already
/// owns PrintScreen (Screenpresso, or Windows' own Snipping Tool binding), which
/// is the very reason the hook exists and is still the primary path. A failure
/// here just means no fallback, never a regression.
///
/// Must run on the hook thread — hotkeys are owned by the registering thread,
/// and `WM_HOTKEY` is delivered to that thread's message queue.
unsafe fn register_prtscn_fallback(first_attempt: bool) {
    for (id, modifiers, label, done) in [
        (HOTKEY_ID_PRTSCN, MOD_NOREPEAT, "PrintScreen", &PRTSCN_HOTKEY_OK),
        (
            HOTKEY_ID_PRTSCN_CTRL,
            MOD_NOREPEAT | MOD_CONTROL,
            "Ctrl+PrintScreen",
            &PRTSCN_CTRL_HOTKEY_OK,
        ),
    ] {
        if done.load(Ordering::SeqCst) {
            continue;
        }
        match RegisterHotKey(HWND::default(), id, modifiers, VK_SNAPSHOT) {
            Ok(()) => {
                done.store(true, Ordering::SeqCst);
                crate::diag::log(&format!("hook: {label} fallback hotkey registered"));
            }
            // Only the first failure is logged: the retry runs for the life of
            // the process, and a permanently-held key would otherwise add a line
            // every `PRTSCN_RETRY_SECS` forever.
            Err(e) if first_attempt => crate::diag::log(&format!(
                "hook: {label} fallback hotkey unavailable ({e}) — another process owns this key, \
                 so a keystroke the low-level hook misses cannot be recovered; retrying every {PRTSCN_RETRY_SECS}s"
            )),
            Err(_) => {}
        }
    }
}

/// Keeps re-posting a retry to the hook thread until both fallback hotkeys are
/// registered. Runs on its own thread because the hook thread must stay in its
/// message pump; `RegisterHotKey` itself has to happen *on* that thread, hence
/// the post rather than a direct call.
fn spawn_prtscn_retry() {
    std::thread::spawn(|| loop {
        std::thread::sleep(std::time::Duration::from_secs(PRTSCN_RETRY_SECS));
        if PRTSCN_HOTKEY_OK.load(Ordering::SeqCst) && PRTSCN_CTRL_HOTKEY_OK.load(Ordering::SeqCst) {
            return;
        }
        let tid = HOOK_THREAD_ID.load(Ordering::SeqCst);
        if tid == 0 {
            return;
        }
        unsafe {
            let _ = PostThreadMessageW(tid, WM_RETRY_PRTSCN, WPARAM(0), LPARAM(0));
        }
    });
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

                // Fallback for the case where the hook doesn't receive the key
                // (see `register_prtscn_fallback`). Registered here because
                // hotkeys belong to the thread that registers them.
                register_prtscn_fallback(true);
                spawn_prtscn_retry();

                let mut msg = MSG::default();
                while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                    match msg.message {
                        WM_HOTKEY
                            if msg.wParam.0 as i32 == HOTKEY_ID_PRTSCN
                                || msg.wParam.0 as i32 == HOTKEY_ID_PRTSCN_CTRL =>
                        {
                            // Only reachable when the low-level hook did NOT see
                            // this keystroke — a hook that sees it swallows it,
                            // so hotkey dispatch never happens. No dedup needed.
                            dispatch_printscreen(
                                msg.wParam.0 as i32 == HOTKEY_ID_PRTSCN_CTRL,
                                "hotkey",
                            );
                        }
                        WM_HOTKEY if msg.wParam.0 as i32 == HOTKEY_ID_STOP => {
                            // Recording and scrolling capture share this
                            // hotkey — stop whichever is running (the scroll
                            // stop flag is reset at capture start, so setting
                            // it with no capture running is harmless).
                            crate::scroll_win::request_stop();
                            if let Some(app) = APP.get() {
                                let app = app.clone();
                                tauri::async_runtime::spawn(async move {
                                    crate::commands::record::hotkey_stop_if_recording(&app);
                                });
                            }
                        }
                        WM_RETRY_PRTSCN => register_prtscn_fallback(false),
                        WM_ENABLE_STOP => {
                            // Register a bare-Escape global hotkey while at least
                            // one stoppable operation (recording, scrolling
                            // capture) runs (MOD_NOREPEAT so held Esc fires once).
                            if STOP_HOTKEY_REFS.fetch_add(1, Ordering::SeqCst) == 0 {
                                let _ = RegisterHotKey(
                                    HWND::default(),
                                    HOTKEY_ID_STOP,
                                    MOD_NOREPEAT,
                                    VK_ESCAPE,
                                );
                            }
                        }
                        WM_DISABLE_STOP => {
                            let prev = STOP_HOTKEY_REFS.fetch_sub(1, Ordering::SeqCst);
                            if prev <= 0 {
                                // Unbalanced disable — clamp back to zero.
                                STOP_HOTKEY_REFS.store(0, Ordering::SeqCst);
                            } else if prev == 1 {
                                let _ = UnregisterHotKey(HWND::default(), HOTKEY_ID_STOP);
                            }
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
