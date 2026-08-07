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
    GetAsyncKeyState, RegisterHotKey, UnregisterHotKey, MOD_ALT as WIN_MOD_ALT, MOD_CONTROL,
    MOD_NOREPEAT, MOD_SHIFT as WIN_MOD_SHIFT,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW,
    PostThreadMessageW, RegisterClassW, SetWindowsHookExW, TranslateMessage, HHOOK,
    KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL, WINDOW_EX_STYLE, WM_APP, WM_DISPLAYCHANGE, WM_HOTKEY,
    WM_KEYUP, WM_SYSKEYUP, WNDCLASSW, WS_OVERLAPPED,
};

use crate::settings::ShortcutSettings;
use crate::shortcuts::{self, Accel, GlobalAction, MOD_ALT, MOD_CTRL, MOD_SHIFT, VK_SNAPSHOT};

/// Virtual-key code for Escape (VK_ESCAPE).
const VK_ESCAPE: u32 = 0x1B;
/// Modifier virtual-keys, read live via `GetAsyncKeyState` at key-up — the
/// `KBDLLHOOKSTRUCT` only describes the key that moved, not what is held.
const VK_CONTROL: i32 = 0x11;
const VK_SHIFT: i32 = 0x10;
/// Alt (VK_MENU) and the Win keys — PrintScreen combined with either belongs
/// to the OS (Alt+PrtScn = active window to clipboard, Win+PrtScn = save to
/// file) and must NOT be swallowed; users rely on those muscle-memory combos.
const VK_MENU: i32 = 0x12;
const VK_LWIN: i32 = 0x5B;
const VK_RWIN: i32 = 0x5C;

/// The two live bindings, held as plain atomics rather than behind a lock.
///
/// The hook callback reads them on **every keystroke on the machine** and must
/// never block: a lock held by a settings save while the user is typing would
/// stall the callback, and Windows silently evicts a hook that overruns
/// `LowLevelHooksTimeout` — after which Clipse's hotkeys stop working entirely,
/// with no error anywhere. Two `u32`s per binding fit in atomics exactly, so the
/// question doesn't arise. A torn read (mods from the old binding, vk from the
/// new) can only happen during the one instant a rebind is applied and at worst
/// drops that single keystroke.
static CAPTURE_VK: AtomicU32 = AtomicU32::new(VK_SNAPSHOT);
static CAPTURE_MODS: AtomicU32 = AtomicU32::new(0);
static MENU_VK: AtomicU32 = AtomicU32::new(VK_SNAPSHOT);
static MENU_MODS: AtomicU32 = AtomicU32::new(MOD_CTRL);

/// Set while Settings is listening for a new accelerator.
///
/// Without this the recorder cannot read the very keys it most needs to: the
/// hook swallows a bound keystroke (`LRESULT(1)`) so the webview never sees it,
/// which would make PrintScreen — the default binding — impossible to re-enter.
/// While suspended the hook passes everything through and the `RegisterHotKey`
/// fallback is unregistered, so neither path can fire mid-recording either.
static SUSPENDED: AtomicBool = AtomicBool::new(false);
const WM_SUSPEND: u32 = WM_APP + 5;
const WM_RESUME: u32 = WM_APP + 6;

/// Suspends or resumes global-shortcut handling. Called from Settings around a
/// key-recording session; safe from any thread.
pub fn suspend(suspend: bool) {
    SUSPENDED.store(suspend, Ordering::SeqCst);
    crate::diag::log(if suspend {
        "shortcuts: suspended for rebinding"
    } else {
        "shortcuts: resumed"
    });
    let tid = HOOK_THREAD_ID.load(Ordering::SeqCst);
    if tid != 0 {
        unsafe {
            let msg = if suspend { WM_SUSPEND } else { WM_RESUME };
            let _ = PostThreadMessageW(tid, msg, WPARAM(0), LPARAM(0));
        }
    }
}

/// Reads the currently bound accelerators.
fn current_bindings() -> [(Accel, GlobalAction); 2] {
    [
        (
            Accel {
                mods: CAPTURE_MODS.load(Ordering::Relaxed),
                vk: CAPTURE_VK.load(Ordering::Relaxed),
            },
            GlobalAction::Capture,
        ),
        (
            Accel {
                mods: MENU_MODS.load(Ordering::Relaxed),
                vk: MENU_VK.load(Ordering::Relaxed),
            },
            GlobalAction::QuickMenu,
        ),
    ]
}

/// Installs `settings`' accelerators and re-registers the `RegisterHotKey`
/// fallback for them. Safe to call from any thread and at any time; the
/// re-registration is posted to the hook thread, which owns those hotkeys.
pub fn apply_shortcuts(settings: &ShortcutSettings) {
    let capture = shortcuts::resolve(
        &settings.capture,
        crate::settings::DEFAULT_CAPTURE_SHORTCUT,
    );
    let mut menu = shortcuts::resolve(
        &settings.quick_menu,
        crate::settings::DEFAULT_QUICK_MENU_SHORTCUT,
    );
    // Both bound to the same keystroke would leave the menu permanently
    // unreachable — the hook matches in order and capture always wins. The UI
    // refuses this, so it only arrives via a hand-edited settings.json.
    if menu == capture {
        menu = shortcuts::resolve("", crate::settings::DEFAULT_QUICK_MENU_SHORTCUT);
        crate::diag::log(
            "shortcuts: both actions bound to the same key — quick menu reset to its default",
        );
    }
    CAPTURE_MODS.store(capture.mods, Ordering::Relaxed);
    CAPTURE_VK.store(capture.vk, Ordering::Relaxed);
    MENU_MODS.store(menu.mods, Ordering::Relaxed);
    MENU_VK.store(menu.vk, Ordering::Relaxed);
    crate::diag::log(&format!(
        "shortcuts: capture={} quickmenu={}",
        capture.format(),
        menu.format()
    ));

    let tid = HOOK_THREAD_ID.load(Ordering::SeqCst);
    if tid != 0 {
        unsafe {
            let _ = PostThreadMessageW(tid, WM_REBIND, WPARAM(0), LPARAM(0));
        }
    }
}

/// Hotkey id + thread messages for the recording-stop Escape hotkey.
const HOTKEY_ID_STOP: i32 = 0xC1AB;
const WM_ENABLE_STOP: u32 = WM_APP + 1;
const WM_DISABLE_STOP: u32 = WM_APP + 2;

/// Hotkey ids for the **fallback** registrations (see `register_fallback`).
const HOTKEY_ID_CAPTURE: i32 = 0xC1AC;
const HOTKEY_ID_MENU: i32 = 0xC1AD;
/// Posted to the hook thread to re-attempt a fallback registration that failed
/// because another process held the key (see `FALLBACK_RETRY_SECS`).
const WM_RETRY_FALLBACK: u32 = WM_APP + 3;
/// Posted to the hook thread when the bound accelerators change, so the fallback
/// hotkeys are torn down and re-registered for the new keys.
const WM_REBIND: u32 = WM_APP + 4;

/// Which fallback hotkeys are currently registered — only touched on the hook
/// thread, so plain loads/stores are enough. Used to stop the retry loop.
static CAPTURE_HOTKEY_OK: AtomicBool = AtomicBool::new(false);
static MENU_HOTKEY_OK: AtomicBool = AtomicBool::new(false);
/// How often to re-attempt a failed fallback registration.
///
/// Whoever owns the key (Windows' own "PrtScn opens screen snipping" binding,
/// Screenpresso, …) can release it at any time — the user turns the setting off,
/// or quits the app — and there is no notification when that happens. Without a
/// retry the fallback would stay dead until Clipse itself is restarted, which is
/// a confusing thing to require after fixing the conflict.
const FALLBACK_RETRY_SECS: u64 = 30;

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

/// Modifier bitmask of what is held right now, in `shortcuts`' encoding.
unsafe fn held_modifiers() -> u32 {
    let down = |vk: i32| (GetAsyncKeyState(vk) as u16 & 0x8000) != 0;
    let mut mods = 0;
    if down(VK_CONTROL) {
        mods |= MOD_CTRL;
    }
    if down(VK_MENU) {
        mods |= MOD_ALT;
    }
    if down(VK_SHIFT) {
        mods |= MOD_SHIFT;
    }
    mods
}

unsafe extern "system" fn keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 && !SUSPENDED.load(Ordering::Relaxed) {
        let kb = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
        let msg = wparam.0 as u32;
        let is_keyup = msg == WM_KEYUP || msg == WM_SYSKEYUP;

        let bindings = current_bindings();
        // Cheapest possible rejection first: this runs for every keystroke on
        // the machine, and all but a couple of keys can never match.
        if bindings.iter().any(|(a, _)| a.vk == kb.vkCode) {
            // The Win key is never part of a Clipse binding (`Accel::parse`
            // won't produce one), so anything held with it belongs to the OS —
            // Win+PrtScn saves a screenshot to file, and swallowing it broke
            // that. Checked before the match so no binding can shadow it.
            let win_held = (GetAsyncKeyState(VK_LWIN) as u16 & 0x8000) != 0
                || (GetAsyncKeyState(VK_RWIN) as u16 & 0x8000) != 0;
            if !win_held {
                let mods = held_modifiers();
                if let Some((_, action)) = bindings.iter().find(|(a, _)| {
                    a.vk == kb.vkCode && a.mods == mods
                }) {
                    // Fire on key-up: PrintScreen delivers one reliably at the
                    // LL-hook level on every Windows config, and Chromium only
                    // ever reports it on key-up too. Keep the callback cheap —
                    // dispatch onto the async runtime and return immediately, or
                    // Windows silently evicts a slow hook (LowLevelHooksTimeout)
                    // and every hotkey stops working with no error anywhere.
                    if is_keyup {
                        dispatch_action(*action, "hook");
                    }
                    // Swallow both the down and the up, so whoever else wants
                    // this key (the OS Snipping Tool on PrintScreen) never sees
                    // it. Only ever reached for an exact modifier match, so
                    // Alt+PrtScn and every other combination still passes.
                    return LRESULT(1);
                }
            }
        }
    }
    CallNextHookEx(HHOOK::default(), code, wparam, lparam)
}

/// Runs a global-shortcut action. Shared by the low-level hook and the
/// `RegisterHotKey` fallback, so both entry points behave identically; `via`
/// only labels the log line.
///
/// Returns immediately — the work is handed to the async runtime, because the
/// hook callback must not overrun `LowLevelHooksTimeout` (Windows silently
/// evicts a slow hook, and then the hotkeys stop working entirely).
fn dispatch_action(action: GlobalAction, via: &'static str) {
    let Some(app) = APP.get() else { return };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let name = match action {
            GlobalAction::Capture => "capture",
            GlobalAction::QuickMenu => "quick menu",
        };
        crate::diag::log(&format!("{via}: {name} dispatched"));
        // Either shortcut stops a recording in progress rather than doing its
        // usual job — with the recorder window hidden mid-recording, the hotkeys
        // are the reachable way to stop.
        if crate::commands::record::hotkey_stop_if_recording(&app) {
            crate::diag::log(&format!("{via}: consumed to stop a recording"));
            return;
        }
        // Likewise mid-scroll-capture: stop the scroll (keeping what's stitched
        // so far) instead of trying to open something over it.
        if crate::scroll_win::stop_if_capturing() {
            crate::diag::log(&format!("{via}: consumed to stop a scrolling capture"));
            return;
        }
        let result = match action {
            GlobalAction::Capture => crate::window::open_overlay(&app),
            GlobalAction::QuickMenu => crate::window::open_quick_menu(&app),
        };
        if let Err(e) = result {
            eprintln!("[{via}] {name} error: {e}");
            crate::diag::log(&format!("{via}: {name} failed: {e}"));
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
unsafe fn register_fallback(first_attempt: bool) {
    for ((accel, _), id, done) in current_bindings()
        .into_iter()
        .zip([HOTKEY_ID_CAPTURE, HOTKEY_ID_MENU])
        .zip([&CAPTURE_HOTKEY_OK, &MENU_HOTKEY_OK])
        .map(|((b, id), done)| (b, id, done))
    {
        if done.load(Ordering::SeqCst) {
            continue;
        }
        let mut modifiers = MOD_NOREPEAT;
        if accel.mods & MOD_CTRL != 0 {
            modifiers |= MOD_CONTROL;
        }
        if accel.mods & MOD_ALT != 0 {
            modifiers |= WIN_MOD_ALT;
        }
        if accel.mods & MOD_SHIFT != 0 {
            modifiers |= WIN_MOD_SHIFT;
        }
        let label = accel.format();
        match RegisterHotKey(HWND::default(), id, modifiers, accel.vk) {
            Ok(()) => {
                done.store(true, Ordering::SeqCst);
                crate::diag::log(&format!("hook: {label} fallback hotkey registered"));
            }
            // Only the first failure is logged: the retry runs for the life of
            // the process, and a permanently-held key would otherwise add a line
            // every `FALLBACK_RETRY_SECS` forever.
            Err(e) if first_attempt => crate::diag::log(&format!(
                "hook: {label} fallback hotkey unavailable ({e}) — another process owns this key, \
                 so a keystroke the low-level hook misses cannot be recovered; retrying every {FALLBACK_RETRY_SECS}s"
            )),
            Err(_) => {}
        }
    }
}

/// Drops the fallback registrations so `register_fallback` can re-make them for
/// the new keys. Hook thread only — hotkeys belong to the thread that made them.
unsafe fn unregister_fallback() {
    for (id, done) in [
        (HOTKEY_ID_CAPTURE, &CAPTURE_HOTKEY_OK),
        (HOTKEY_ID_MENU, &MENU_HOTKEY_OK),
    ] {
        if done.swap(false, Ordering::SeqCst) {
            let _ = UnregisterHotKey(HWND::default(), id);
        }
    }
}

/// Keeps re-posting a retry to the hook thread until both fallback hotkeys are
/// registered. Runs on its own thread because the hook thread must stay in its
/// message pump; `RegisterHotKey` itself has to happen *on* that thread, hence
/// the post rather than a direct call.
fn spawn_fallback_retry() {
    std::thread::spawn(|| loop {
        std::thread::sleep(std::time::Duration::from_secs(FALLBACK_RETRY_SECS));
        // Never returns early on success: unlike before, the bindings can change
        // at any time, and the new key may well be one another process holds.
        // The loop is one wakeup every 30s and posts nothing once both are
        // registered, so leaving it running costs nothing.
        if CAPTURE_HOTKEY_OK.load(Ordering::SeqCst) && MENU_HOTKEY_OK.load(Ordering::SeqCst) {
            continue;
        }
        let tid = HOOK_THREAD_ID.load(Ordering::SeqCst);
        if tid == 0 {
            return;
        }
        unsafe {
            let _ = PostThreadMessageW(tid, WM_RETRY_FALLBACK, WPARAM(0), LPARAM(0));
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
                // (see `register_fallback`). Registered here because hotkeys
                // belong to the thread that registers them.
                register_fallback(true);
                spawn_fallback_retry();

                let mut msg = MSG::default();
                while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                    match msg.message {
                        WM_HOTKEY
                            if msg.wParam.0 as i32 == HOTKEY_ID_CAPTURE
                                || msg.wParam.0 as i32 == HOTKEY_ID_MENU =>
                        {
                            // Only reachable when the low-level hook did NOT see
                            // this keystroke — a hook that sees it swallows it,
                            // so hotkey dispatch never happens. No dedup needed.
                            dispatch_action(
                                if msg.wParam.0 as i32 == HOTKEY_ID_MENU {
                                    GlobalAction::QuickMenu
                                } else {
                                    GlobalAction::Capture
                                },
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
                        WM_RETRY_FALLBACK => {
                            if !SUSPENDED.load(Ordering::SeqCst) {
                                register_fallback(false)
                            }
                        }
                        WM_SUSPEND => unregister_fallback(),
                        WM_RESUME => register_fallback(true),
                        WM_REBIND => {
                            // The accelerators changed: drop the old fallback
                            // registrations and claim the new keys. The hook
                            // itself needs nothing here — it reads the atomics
                            // fresh on every keystroke.
                            unregister_fallback();
                            register_fallback(true);
                        }
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
