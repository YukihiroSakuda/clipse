use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder,
};

/// Shows the gallery panel flush into the bottom-right corner of the primary
/// monitor's **work area** — against the right edge of the display and the edge
/// of the taskbar, whichever side the taskbar is on.
///
/// One fixed position, computed the same way every time, whatever opened it:
/// the tray icon, the tray menu, or the quick menu. It used to be anchored on
/// the tray icon's own rectangle, which turned out not to be a fixed point at
/// all — the rect moves as the notification area reflows, and reads differently
/// again for an icon inside the overflow flyout, so the panel appeared in a
/// different place run to run.
///
/// Everything here is in **physical** pixels, start to finish. The earlier
/// version computed a logical position from the primary monitor's scale factor
/// and passed it to `set_position(LogicalPosition)`, which converts back using
/// the scale factor of whichever monitor the window currently sits on — on a
/// mixed-DPI desktop those differ, so the panel landed somewhere other than
/// intended, and landing there changed the conversion for the next call.
/// `place_toast` and `place_quick_menu` avoid this the same way.
pub fn show_panel(app: &AppHandle) {
    /// Panel size in logical px, scaled to the target monitor below.
    const PANEL_W: f64 = 800.0;
    const PANEL_H: f64 = 700.0;
    /// Gap kept between the panel and every work-area edge, logical px. Applied
    /// on all four sides — the two it actually touches when the panel is smaller
    /// than the screen, and the other two once it has been shrunk to fit one.
    const MARGIN: f64 = 12.0;

    let Some(window) = app.get_webview_window("main") else { return };

    // (0, 0) is by definition on the primary monitor, which is the one carrying
    // the taskbar the tray icon lives in.
    let Some((left, top, right, bottom)) = monitor_work_area(0, 0) else {
        // Not Windows, or the lookup failed — leave the window where it is.
        let _ = window.show();
        let _ = window.set_focus();
        return;
    };

    // Read the scale factor off the monitor rather than the window, so it
    // doesn't depend on where the window happens to be sitting.
    let sf = app
        .monitor_from_point(right as f64 - 1.0, bottom as f64 - 1.0)
        .ok()
        .flatten()
        .map(|m| m.scale_factor())
        .unwrap_or(1.0);
    // Inset the work area on all four sides, then treat that as the space the
    // panel lives in: its bottom-right corner sits on the inset corner, and it
    // is never bigger than the inset area — so on a screen too small for it the
    // top and left keep their gap too instead of running off the edge.
    let margin = (MARGIN * sf).round() as i32;
    let (left, top) = (left + margin, top + margin);
    let (right, bottom) = (right - margin, bottom - margin);
    let w = ((PANEL_W * sf) as i32).min(right - left).max(1);
    let h = ((PANEL_H * sf) as i32).min(bottom - top).max(1);

    let (x, y) = (right - w, bottom - h);

    let _ = window.set_size(PhysicalSize::new(w as u32, h as u32));
    let _ = window.set_position(PhysicalPosition::new(x, y));
    let _ = window.show();
    let _ = window.set_focus();
}

/// Returns (min_x, min_y, total_width, total_height) of the virtual screen
/// spanning all monitors, in physical pixels (as reported by xcap via GetMonitorInfoW).
///
/// Takes the monitor list rather than enumerating its own, and deliberately has
/// no enumerating convenience wrapper: every caller of this also composites
/// pixels from a monitor list, and two `crate::monitors::enumerate()` calls a
/// few microseconds apart can disagree — a display mid-mode-change drops out of
/// one and not the other (see that module). A virtual screen sized from one
/// list while the pixels come from another is exactly how a monitor's entire
/// area ends up transparent: `capture_rect_composited` zero-fills whatever no
/// part covers. Passing one list through makes that mismatch unrepresentable.
pub fn virtual_screen_bounds_of(monitors: &[xcap::Monitor]) -> Result<(f64, f64, f64, f64), String> {
    if monitors.is_empty() {
        return Err("No monitors found".to_string());
    }
    let min_x = monitors.iter().map(|m| m.x()).min().unwrap_or(0) as f64;
    let min_y = monitors.iter().map(|m| m.y()).min().unwrap_or(0) as f64;
    let max_x = monitors
        .iter()
        .map(|m| m.x() + m.width() as i32)
        .max()
        .unwrap_or(1920) as f64;
    let max_y = monitors
        .iter()
        .map(|m| m.y() + m.height() as i32)
        .max()
        .unwrap_or(1080) as f64;
    Ok((min_x, min_y, max_x - min_x, max_y - min_y))
}

/// Tries to claim the app-wide "a capture is in progress" flag. Returns `false`
/// if one is already claimed (an overlay is open, or a no-overlay capture is
/// running) — callers should treat that as "ignore this request" rather than
/// tearing down whatever is already in flight.
///
/// A claim that has clearly been abandoned is taken over instead of refused; see
/// `stale_capture_claim`. Both outcomes are logged, because a refusal is
/// otherwise completely invisible — the user just sees PrintScreen do nothing.
pub fn try_claim_capture(app: &AppHandle) -> bool {
    let Some(state) = app.try_state::<crate::state::AppState>() else { return true };
    let claimed = state
        .capturing
        .compare_exchange(
            false,
            true,
            std::sync::atomic::Ordering::SeqCst,
            std::sync::atomic::Ordering::SeqCst,
        )
        .is_ok();
    if claimed {
        if let Ok(mut g) = state.capture_claimed_at.lock() {
            *g = Some(std::time::Instant::now());
        }
        return true;
    }
    // Someone already holds the flag. If that claim is stale (see
    // `stale_capture_claim`) the pipeline behind it is gone and never released —
    // take the claim over rather than refusing captures for the rest of the
    // session.
    if stale_capture_claim(&state) {
        crate::diag::log("capture: taking over a stale claim (previous pipeline never released)");
        if let Ok(mut g) = state.capture_claimed_at.lock() {
            *g = Some(std::time::Instant::now());
        }
        return true;
    }
    // Logged because this is otherwise an entirely silent rejection: the user
    // presses PrintScreen, nothing happens, and no line is written anywhere.
    crate::diag::log("capture: request ignored — a capture is already in progress");
    false
}

/// How long a capture claim may be held before it is treated as leaked, given
/// nothing observable is running. Generous on purpose: it only has to exceed how
/// long a *legitimate* claim can go without an overlay on screen and without the
/// scrolling-capture flag set — the no-overlay captures (fullscreen, window,
/// repeat-region) all finish in well under a second.
const STALE_CLAIM_SECS: u64 = 20;

/// Whether the current capture claim looks abandoned: held longer than
/// `STALE_CLAIM_SECS`, with no selection overlay on screen and no scrolling
/// capture running. Both liveness checks matter — a scrolling capture legitimately
/// holds the claim for a long time with its overlay already hidden, and a user can
/// legitimately leave the selection overlay up indefinitely.
///
/// Reads only atomics: this is on the PrintScreen path, so it must not ask Tauri
/// whether a window is visible (a blocking main-thread round-trip).
fn stale_capture_claim(state: &crate::state::AppState) -> bool {
    let held_long_enough = state
        .capture_claimed_at
        .lock()
        .ok()
        .and_then(|g| *g)
        .map(|t| t.elapsed().as_secs() >= STALE_CLAIM_SECS)
        // No timestamp at all means the claim predates this bookkeeping (or the
        // lock is poisoned) — don't guess, leave it alone.
        .unwrap_or(false);
    if !held_long_enough {
        return false;
    }
    let overlay_up = state
        .overlay_showing
        .load(std::sync::atomic::Ordering::SeqCst);
    #[cfg(target_os = "windows")]
    let scrolling = crate::scroll_win::is_capturing();
    #[cfg(not(target_os = "windows"))]
    let scrolling = false;
    !overlay_up && !scrolling
}

/// Releases the "a capture is in progress" flag. Called once a capture pipeline
/// reaches its natural end: the user cancelled the pending selection, or a
/// `complete_*`/`do_*` capture command in `commands::capture` finished (success
/// or error).
pub fn release_capture(app: &AppHandle) {
    if let Some(state) = app.try_state::<crate::state::AppState>() {
        state.capturing.store(false, std::sync::atomic::Ordering::SeqCst);
        if let Ok(mut g) = state.capture_claimed_at.lock() {
            *g = None;
        }
    }
    // Whatever the session did, the editors go back to being capturable. This
    // is the single clearing point for every path (cancel, success, error) and
    // is a no-op for the paths that never excluded them.
    set_editors_excluded_from_capture(app, false);
}

/// Master switch for taking editor windows out of Clipse's own captures.
///
/// **Currently off, deliberately** — flip to `true` to restore. Off means an
/// editor that is on screen when a capture starts is part of the desktop like
/// any other window: it appears in the PrintScreen-time frozen snapshot, so it
/// shows in the overlay's background *and* in the captured image. In exchange the
/// hot path loses `AFFINITY_SETTLE_MS` (the 80ms wait for DWM to recompose) and
/// the editor is never invisible to a screen share.
///
/// The handle caching in `open_editor_with` stays either way, so flipping this
/// back needs no other change.
const EXCLUDE_EDITORS_FROM_CAPTURE: bool = false;

/// Hides every open `editor-{n}` window from screen capture, or restores it.
///
/// Called around a capture session rather than once at window creation (as the
/// gallery does): a permanently-excluded editor would also be invisible to
/// Teams/Zoom screen shares and third-party recorders, which is the opposite of
/// useful for the window you annotate screenshots in. Within a session the
/// exclusion is what makes "PrintScreen while an editor is open" coherent — the
/// region overlay's background *is* the frozen desktop snapshot, so an editor
/// absent from that snapshot is also absent from what the user selects against.
///
/// Being an OS/compositor-level flag, it needs DWM to recompose before the
/// window really drops out of captured output — callers must not grab the
/// screen in the same breath (see `open_overlay_inner`'s settle delay).
///
/// Works off the handles cached in `AppState.editor_hwnds`, so it issues no
/// Tauri window calls at all: this runs on the PrintScreen path, and asking each
/// editor window for its own handle here (the obvious implementation) couples
/// every capture to the main-thread event loop being free — see `raw_hwnd`.
pub fn set_editors_excluded_from_capture(app: &AppHandle, excluded: bool) {
    if !EXCLUDE_EDITORS_FROM_CAPTURE {
        return;
    }
    #[cfg(target_os = "windows")]
    if let Some(state) = app.try_state::<crate::state::AppState>() {
        if let Ok(map) = state.editor_hwnds.lock() {
            for hwnd in map.values() {
                set_hwnd_excluded_from_capture(*hwnd, excluded);
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = (app, excluded);
}

/// Applies the exclusion above for the rest of the current capture session, and
/// reports whether there was anything to exclude: `true` means at least one
/// editor is open, so the caller **must** let DWM recompose before grabbing the
/// screen.
///
/// Every capture path that means "capture the desktop" goes through this. The
/// two that don't are deliberate: `do_cursor_monitor_capture`
/// (Ctrl+PrintScreen) exists precisely to capture what is on screen at that
/// instant, and `do_window_capture` may well be pointed at an editor.
pub fn exclude_editors_from_capture(app: &AppHandle) -> bool {
    if !EXCLUDE_EDITORS_FROM_CAPTURE {
        return false;
    }
    // Deliberately "is any editor open?" rather than "is any editor visible?" —
    // answering the latter needs `is_visible()` per window, another blocking
    // main-thread round-trip. An open editor is a visible editor in practice,
    // and the cost of being wrong is one 150ms settle we didn't need.
    let any_open = app
        .try_state::<crate::state::AppState>()
        .and_then(|s| s.editor_hwnds.lock().ok().map(|m| !m.is_empty()))
        .unwrap_or(false);
    if any_open {
        set_editors_excluded_from_capture(app, true);
    }
    any_open
}

/// Hides every region-selection overlay window (labels starting with "overlay").
/// Used right before a capture so no overlay appears in the screenshot.
pub fn hide_all_overlays(app: &AppHandle) {
    use tauri::Emitter;
    set_overlay_showing(app, false);
    for (label, win) in app.webview_windows() {
        if label.starts_with("overlay") {
            let _ = win.hide();
        }
    }
    // The pooled webviews stay alive with the last session's frozen-desktop
    // frame still painted on their canvas. Tell them to wipe it now, while
    // hidden, so the next `show()` (which lands before the frontend can react
    // to `overlay-show`) can't flash the previous capture's image.
    let _ = app.emit("overlay-hidden", ());
}

/// Closes every region-selection overlay window (labels starting with "overlay").
/// Only ever called from `build_pool`, i.e. under `POOL_LOCK` — closing the pool
/// outside that lock is what lets a display-change rebuild tear down the windows
/// a capture is in the middle of showing.
fn close_all_overlays(app: &AppHandle) {
    set_overlay_showing(app, false);
    for (label, win) in app.webview_windows() {
        if label.starts_with("overlay") {
            let _ = win.close();
        }
    }
}

/// Records whether the selection overlay is currently on screen. Read by
/// `try_claim_capture` to tell a live session from a leaked claim without
/// querying any window (see `stale_capture_claim`).
fn set_overlay_showing(app: &AppHandle, showing: bool) {
    if let Some(state) = app.try_state::<crate::state::AppState>() {
        state
            .overlay_showing
            .store(showing, std::sync::atomic::Ordering::SeqCst);
    }
}

/// Opens the transparent region-selection overlay.
///
/// One overlay window is created **per monitor**, each positioned and sized to
/// that monitor's exact physical bounds. This is essential on mixed-DPI
/// multi-monitor setups: a single window spanning monitors can only render at
/// one `devicePixelRatio`, so the portion on a different-DPI monitor is stretched
/// and its CSS↔physical coordinate mapping is wrong (selection on the sub-monitor
/// becomes impossible). A dedicated per-monitor window adopts that monitor's DPI,
/// keeping rendering crisp and coordinate math self-consistent within it.
///
/// Hides the main gallery window first so it does not appear in captures.
///
/// Claims the shared "capturing" flag before doing anything else. If a capture
/// (overlay-based or not) is already in progress, this is a no-op error instead
/// of tearing down/racing whatever is currently running — see `try_claim_capture`.
/// The flag is released again here on any error path; on success it stays held
/// until the eventual `complete_*` command finishes or the user cancels.
pub fn open_overlay(app: &AppHandle) -> Result<(), String> {
    open_overlay_mode(app, false, None)
}

/// Like `open_overlay`, but lets the caller choose scrolling-capture mode and/or
/// constrain the selection to a fixed size/ratio (`fixed`, see `FixedRegionSpec`
/// — `None` for a normal free-form capture). Both flags are set *before* the
/// overlays are shown, so the frontend's mode fetch (fired by `overlay-show` on
/// the prewarmed pool, which reacts within milliseconds) can never race them.
pub fn open_overlay_mode(
    app: &AppHandle,
    scroll: bool,
    fixed: Option<crate::state::FixedRegionSpec>,
) -> Result<(), String> {
    if !try_claim_capture(app) {
        return Err("A capture is already in progress".to_string());
    }
    match open_overlay_inner(app, scroll, fixed) {
        Ok(()) => Ok(()),
        Err(e) => {
            release_capture(app);
            Err(e)
        }
    }
}

/// One monitor, as the overlay pool needs it: its exact bounds on the virtual
/// screen in physical pixels, and whether it is the primary (whose overlay takes
/// keyboard focus). See `overlay_monitors` for where these come from.
#[derive(Clone, Copy)]
struct OverlayMonitor {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    is_primary: bool,
}

/// Enumerates the monitors the overlay pool has to cover.
///
/// On Windows this is `EnumDisplayMonitors` + `GetMonitorInfoW` rather than
/// `xcap::Monitor::all`, for two reasons that both end in "that display got no
/// overlay":
///
/// - **xcap drops a monitor it can't fully describe.** It builds each entry from
///   `EnumDisplaySettingsW` *and* a `CreateDC` on the device, and silently skips
///   any monitor either call fails on — precisely the sort of thing that happens
///   while a display is being attached or a VDI session is reconnecting. A
///   monitor missing from that list simply gets no overlay window, with nothing
///   downstream able to tell it was ever there.
/// - **`rcMonitor` is the coordinate space the rest of the app already works
///   in.** xcap reports `DEVMODE.dmPosition`/`dmPelsWidth`, the display *mode's*
///   geometry, which for a rotated display is the unrotated one — a portrait
///   sub-monitor would be covered by a landscape-sized overlay spilling onto its
///   neighbour. The DXGI capture path (`capture_win`) finds its output by
///   `rcMonitor`, the recorder takes its origin from `rcMonitor`, Tauri's
///   `PhysicalPosition`/`PhysicalSize` are Win32 virtual-screen coordinates, and
///   the overlay frontend derives every physical coordinate from its own
///   window's `outerPosition()`. This keeps the pool in that same space.
///
/// Falls back to xcap if the enumeration comes back empty, and is xcap outright
/// everywhere else.
fn overlay_monitors() -> Result<Vec<OverlayMonitor>, String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::{BOOL, LPARAM, RECT, TRUE};
        use windows::Win32::Graphics::Gdi::{
            EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO,
        };
        use windows::Win32::UI::WindowsAndMessaging::MONITORINFOF_PRIMARY;

        unsafe extern "system" fn collect(
            hmonitor: HMONITOR,
            _: HDC,
            _: *mut RECT,
            data: LPARAM,
        ) -> BOOL {
            // `data` is the `Vec<HMONITOR>` below. `EnumDisplayMonitors` calls
            // this synchronously and returns before the vec goes out of scope.
            (*(data.0 as *mut Vec<HMONITOR>)).push(hmonitor);
            TRUE
        }

        let mut handles: Vec<HMONITOR> = Vec::new();
        unsafe {
            let _ = EnumDisplayMonitors(
                HDC::default(),
                None,
                Some(collect),
                LPARAM(&mut handles as *mut Vec<HMONITOR> as isize),
            );
        }
        let mut monitors = Vec::with_capacity(handles.len());
        for hmonitor in handles {
            let mut info = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            let ok = unsafe { GetMonitorInfoW(hmonitor, &mut info).as_bool() };
            if !ok {
                // Logged rather than skipped silently: this is one of the few
                // ways a monitor can go missing between here and the pool.
                crate::diag::log("overlay: GetMonitorInfoW failed for an enumerated monitor");
                continue;
            }
            let r = info.rcMonitor;
            monitors.push(OverlayMonitor {
                x: r.left,
                y: r.top,
                width: (r.right - r.left).max(0) as u32,
                height: (r.bottom - r.top).max(0) as u32,
                is_primary: (info.dwFlags & MONITORINFOF_PRIMARY) != 0,
            });
        }
        if !monitors.is_empty() {
            return Ok(monitors);
        }
        crate::diag::log("overlay: EnumDisplayMonitors found nothing — falling back to xcap");
    }

    xcap_monitors()
}

/// The same list as xcap sees it. The overlay pool only falls back to this off
/// Windows (and if the Win32 enumeration comes back empty), but everything
/// *downstream* of the overlay — `freeze_desktop`'s composite, `get_monitors`'
/// hover targets — is still keyed on it, which is why `prewarm_overlays`
/// compares the two.
fn xcap_monitors() -> Result<Vec<OverlayMonitor>, String> {
    Ok(xcap::Monitor::all()
        .map_err(|e| e.to_string())?
        .iter()
        .map(|m| OverlayMonitor {
            x: m.x(),
            y: m.y(),
            width: m.width(),
            height: m.height(),
            is_primary: m.is_primary(),
        })
        .collect())
}

/// Monitor-layout fingerprint the overlay pool is keyed on: any change in
/// count, position, or size (incl. DPI-driven physical size changes) must
/// rebuild the pool, since each overlay is pinned to one monitor's bounds.
fn monitors_signature(monitors: &[OverlayMonitor]) -> String {
    monitors
        .iter()
        .map(|m| format!("{}:{}:{}x{}", m.x, m.y, m.width, m.height))
        .collect::<Vec<_>>()
        .join("|")
}

/// Labels are generation-tagged (`overlay-g{n}-{i}`) so a rebuild can create
/// new windows while the old generation's `close()` is still completing —
/// reusing the exact same label immediately after close() can collide.
/// Everything else matches on the `overlay` prefix (hide/close helpers, the
/// `overlay-*` capability glob, the frontend's route match), so the tag is
/// transparent to the rest of the app.
static OVERLAY_GENERATION: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

/// Splits an overlay label back into `(generation, monitor index)`. `None` for
/// any label that isn't one of ours — a pooled window that can't be mapped back
/// to a monitor makes the whole pool untrustworthy (see `usable_pool`).
fn parse_overlay_label(label: &str) -> Option<(u32, usize)> {
    let (generation, index) = label.strip_prefix("overlay-g")?.split_once('-')?;
    Some((generation.parse().ok()?, index.parse().ok()?))
}

/// Serializes every mutation of the overlay pool — building it, closing it,
/// re-placing it, and the signature that describes it.
///
/// Two threads legitimately touch the pool: the capture path
/// (`open_overlay_inner`, always on an async-runtime worker — every caller
/// reaches it through `async_runtime::spawn`) and the display-change rebuild
/// (`prewarm_overlays`, dispatched to the main thread by `hook_win`). Without
/// this lock a `WM_DISPLAYCHANGE` landing next to a PrintScreen can close the
/// very windows the capture path just decided to show, or have both sides build
/// a pool at once — and the user gets an overlay on some monitors but not
/// others, intermittently, exactly around plugging a display in or out.
///
/// **Never block on this from the main thread.** Creating a window from a worker
/// thread waits on the main thread to do it, so a main-thread waiter deadlocks
/// the app; `prewarm_overlays` takes the lock with `try_lock` for that reason.
static POOL_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn lock_pool() -> std::sync::MutexGuard<'static, ()> {
    POOL_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

/// Records the monitor layout the pool was built for — or, with an empty `sig`,
/// clears it so the next capture rebuilds instead of reusing what's there.
fn store_pool_signature(app: &AppHandle, sig: &str) {
    if let Some(state) = app.try_state::<crate::state::AppState>() {
        if let Ok(mut g) = state.overlay_signature.lock() {
            g.clear();
            g.push_str(sig);
        }
    }
}

/// Pins one overlay window to one monitor's exact physical bounds.
///
/// The position is asserted **twice**, on purpose. Moving a window onto a
/// monitor with a different scale factor makes Windows send it `WM_DPICHANGED`,
/// and that message carries a *suggested* rectangle which tao applies on our
/// behalf — near where we asked for, not where we asked for. On a mixed-DPI
/// desktop that is enough to leave the overlay straddling the monitor boundary
/// (or back on the monitor it came from) right after the move that was supposed
/// to place it. Re-asserting the position after the size, with the window
/// already carrying the target monitor's DPI, settles it. Setters are queued to
/// the main thread in order and don't block on it, unlike the getters
/// (`outer_position`, `scale_factor`, …) this path must stay away from, so the
/// extra call costs nothing on the PrintScreen hot path.
fn place_overlay(win: &tauri::WebviewWindow, m: &OverlayMonitor) -> bool {
    let pos = PhysicalPosition::new(m.x, m.y);
    let size = PhysicalSize::new(m.width, m.height);
    win.set_position(pos).is_ok() && win.set_size(size).is_ok() && win.set_position(pos).is_ok()
}

/// The current pool as `(monitor index, window)` pairs, but only if it can be
/// trusted to cover `count` monitors: one window per monitor, all from the same
/// generation, indices exactly `0..count`.
///
/// The generation filter is what makes this safe while a previous pool is still
/// going away: `close()` only *requests* the teardown, so an older generation's
/// windows can still be listed for a frame or two. Counting labels alone could
/// then accept a set that places two windows on one monitor and none on
/// another — a missing sub-monitor overlay with nothing in the log to show for
/// it. Only the newest generation is ever shown; the stragglers are already
/// closed and disappear on their own.
fn usable_pool(app: &AppHandle, count: usize) -> Option<Vec<(usize, tauri::WebviewWindow)>> {
    let mut newest: Option<u32> = None;
    let mut all: Vec<(u32, usize, tauri::WebviewWindow)> = Vec::new();
    for (label, win) in app.webview_windows() {
        if !label.starts_with("overlay") {
            continue;
        }
        let Some((generation, index)) = parse_overlay_label(&label) else {
            crate::diag::log(&format!("overlay: unrecognized pooled window label {label}"));
            return None;
        };
        newest = Some(newest.map_or(generation, |g: u32| g.max(generation)));
        all.push((generation, index, win));
    }
    let newest = newest?;
    let total = all.len();
    let mut pool: Vec<(usize, tauri::WebviewWindow)> = all
        .into_iter()
        .filter(|(generation, _, _)| *generation == newest)
        .map(|(_, index, win)| (index, win))
        .collect();
    if total != pool.len() {
        crate::diag::log(&format!(
            "overlay: {} window(s) from an older generation still closing",
            total - pool.len()
        ));
    }
    if pool.len() != count {
        return None;
    }
    pool.sort_by_key(|(index, _)| *index);
    if pool.iter().enumerate().any(|(n, (index, _))| n != *index) {
        return None;
    }
    Some(pool)
}

/// Replaces the pool with one freshly built window per monitor, under a new
/// generation. Returns how many were actually created: a short count means some
/// monitor has **no** overlay, which every caller turns into "don't keep this
/// pool" rather than letting it be reused for the rest of the session.
///
/// Callers must hold `POOL_LOCK`.
fn build_pool(app: &AppHandle, monitors: &[OverlayMonitor], visible: bool) -> usize {
    close_all_overlays(app);
    let generation = OVERLAY_GENERATION.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let mut built = 0;
    for (i, m) in monitors.iter().enumerate() {
        let label = format!("overlay-g{generation}-{i}");
        // Build hidden, then place/size in *physical* pixels (xcap coordinates)
        // via `place_overlay`. PhysicalPosition/PhysicalSize are DPI-independent,
        // so the window lands exactly on the target monitor and takes on its
        // native scale factor — unlike builder logical coords, which are
        // interpreted in the primary monitor's DPI and misplace windows on
        // differently-scaled monitors.
        let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("/".into()))
            .title("")
            .transparent(true)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .shadow(false)
            .resizable(false)
            .visible(false);
        if !visible {
            builder = builder.focused(false);
        }
        let win = match builder.build() {
            Ok(win) => win,
            Err(e) => {
                // Keep going. Failing the whole loop here used to leave every
                // monitor *after* the failing one with no overlay at all (and,
                // on the capture path, the ones before it orphaned on screen) —
                // the "sub-monitor sometimes gets no overlay" report. One
                // monitor Windows won't give us a window on is bad; taking the
                // others down with it is worse.
                crate::diag::log(&format!("overlay: build failed for monitor {i} — {e}"));
                continue;
            }
        };

        #[cfg(target_os = "windows")]
        disable_browser_accelerator_keys(&win);

        if !place_overlay(&win, m) {
            crate::diag::log(&format!("overlay: placement failed for monitor {i}"));
        }
        if visible {
            let _ = win.show();
            // Focus the primary monitor's overlay so keyboard (Esc/Enter/Ctrl)
            // works without an initial click; mouse events reach any overlay
            // regardless.
            if m.is_primary {
                let _ = win.set_focus();
            }
        }
        built += 1;
    }
    built
}

/// Wait after `hide()`-ing one of our own windows before snapshotting the
/// desktop. 90ms used to be enough for DWM to drop a plain window, but a
/// WebView2 window (GPU-composited, sometimes with its own fade) can still be
/// mid-teardown at that point — the leftover frame then gets baked into the
/// frozen snapshot and "ghosts" in the overlay background for the whole
/// selection drag. Matches the margin used elsewhere for the same class of wait
/// (`bring_window_to_front`'s settle in `complete_region_capture`).
const HIDE_SETTLE_MS: u64 = 150;
/// Wait after changing a window's *display affinity* instead of hiding it.
/// Much cheaper than a teardown: the window stays exactly where it is and only
/// has to be dropped from the next composition, so a handful of frames at 60Hz
/// is ample. Kept separate from `HIDE_SETTLE_MS` because this one is on the
/// PrintScreen hot path whenever an editor is open, and the two are not the same
/// kind of wait.
const AFFINITY_SETTLE_MS: u64 = 80;

fn open_overlay_inner(
    app: &AppHandle,
    scroll: bool,
    fixed: Option<crate::state::FixedRegionSpec>,
) -> Result<(), String> {
    // Logged before anything can block: everything below here (window
    // hide/show, the desktop freeze, monitor enumeration) can in principle
    // stall, and without this line a stall is indistinguishable in the log from
    // "the hotkey never fired at all".
    crate::diag::log("overlay: opening");

    // Hide our own gallery window — and, defensively, the Fixed Capture
    // control window (normally already hidden by `FixedCapture.tsx` itself
    // before calling into this) — BEFORE snapshotting the desktop.
    // Otherwise it gets baked into the frozen frame the overlay draws as its
    // background (and crops the capture from), so it "stays" on the overlay
    // even though the window is gone. Hiding background windows of our own
    // can't dismiss another app's context menu, so the transient-UI intent
    // of freezing early still holds. The Fixed Capture window is also
    // permanently excluded from screen capture at the OS level (see
    // `set_excluded_from_capture` in `open_fixed_capture`), so unlike the
    // gallery it doesn't actually need this — it's just belt-and-suspenders
    // for what the user sees on their own desktop, not the capture content.
    // Only pause for DWM to drop a window from the composited desktop when
    // it was actually visible — the hot path (both already hidden, e.g. the
    // PrintScreen hotkey) skips the wait entirely. See `HIDE_SETTLE_MS` /
    // `AFFINITY_SETTLE_MS` for why the two kinds of wait differ in length; only
    // the longest one that applies is taken.
    let mut settle_ms = 0;
    for label in ["main", "fixed-capture"] {
        if let Some(win) = app.get_webview_window(label) {
            let visible = win.is_visible().unwrap_or(false);
            if visible {
                win.hide().map_err(|e| e.to_string())?;
                settle_ms = settle_ms.max(HIDE_SETTLE_MS);
            }
        }
    }
    // The quick menu gets no settle wait of its own: it is permanently excluded
    // from capture (see `open_quick_menu`), so its pixels can't reach the frozen
    // snapshot however long DWM takes — hiding it is purely so the user doesn't
    // see a stale menu sitting under the overlay. Paying `HIDE_SETTLE_MS` here
    // would slow the "menu open, user hits PrintScreen instead" path for nothing.
    hide_quick_menu(app);

    // Editor windows are deliberately *not* hidden: the overlay covers them
    // anyway, and annotation work in progress must not be disturbed by a
    // hide/show cycle. They're taken out of *capture* instead — restored by
    // `release_capture` when the session ends — so the frozen snapshot below
    // (the overlay's background, and what the selection is cropped from) shows
    // what's actually behind them.
    if exclude_editors_from_capture(app) {
        settle_ms = settle_ms.max(AFFINITY_SETTLE_MS);
    }
    if settle_ms > 0 {
        std::thread::sleep(std::time::Duration::from_millis(settle_ms));
    }

    // Snapshot the whole desktop (now that our gallery is gone) so transient UI
    // still on screen (e.g. an open right-click context menu) is captured into
    // the frame regardless of what showing/focusing the overlay does next — see
    // `commands::capture::freeze_desktop` / `commands::capture::try_crop_frozen`.
    crate::commands::capture::freeze_desktop(app);

    // Set the capture mode before any overlay can observe it.
    if let Some(state) = app.try_state::<crate::state::AppState>() {
        if let Ok(mut g) = state.scroll_mode.lock() {
            *g = scroll;
        }
        if let Ok(mut g) = state.fixed_region.lock() {
            *g = fixed;
        }
    }

    let crate::monitors::Enumeration { monitors, complete } = crate::monitors::enumerate()?;
    if monitors.is_empty() {
        return Err("No monitors found".to_string());
    }
    let sig = monitors_signature(&monitors);
    // The enumeration result is the load-bearing fact in every "a display gets
    // no overlay" field report — if a monitor is missing here (seen around
    // VDI connect/disconnect transitions), nothing downstream can select on it.
    crate::diag::log(&format!("overlay: {} monitor(s) enumerated [{sig}]", monitors.len()));

    // Fast path: a prewarmed (hidden) pool built for this exact monitor layout
    // already exists — just show it. This keeps webview creation (the slow part,
    // hundreds of ms) out of the PrintScreen hot path entirely. The frontend
    // re-fetches window lists/scroll mode/origin on the `overlay-show` event.
    let pool_matches = app
        .try_state::<crate::state::AppState>()
        .and_then(|s| s.overlay_signature.lock().ok().map(|g| *g == sig))
        .unwrap_or(false);
    if pool_matches {
        if let Some(pool) = usable_pool(app, monitors.len()) {
            use tauri::Emitter;
            // Any placement/show failure on any pooled window means the pool
            // can't be trusted (a window broken by a display change while it sat
            // hidden, an unparseable label…) — fall through to a full rebuild
            // instead of silently showing an incomplete overlay set. Every
            // window is still attempted rather than stopping at the first
            // failure, so the rest are on screen while the rebuild happens.
            let mut healthy = true;
            for (index, win) in &pool {
                let m = &monitors[*index];
                if !place_overlay(win, m) || win.show().is_err() {
                    crate::diag::log(&format!(
                        "overlay: pooled window for monitor {index} failed to place/show"
                    ));
                    healthy = false;
                    continue;
                }
                // Focus the primary monitor's overlay so keyboard (Esc/Enter/Ctrl)
                // works without an initial click; mouse events reach any overlay
                // regardless.
                if m.is_primary {
                    let _ = win.set_focus();
                }
            }
            if healthy {
                set_overlay_showing(app, true);
                let _ = app.emit("overlay-show", ());
                crate::diag::log(&format!("overlay: pool shown ({} window(s))", pool.len()));
                return Ok(());
            }
            crate::diag::log("overlay: pooled window failed to place/show — rebuilding pool");
        } else {
            crate::diag::log("overlay: pool doesn't cover every monitor — rebuilding pool");
        }
    }

    // Slow path: no pool (first run) or the monitor layout changed — build
    // fresh overlays, visible immediately. They stay alive (hidden) after the
    // capture, becoming the pool for next time.
    crate::diag::log("overlay: building fresh pool (slow path)");
    let built = build_pool(app, &monitors, true);
    if built == 0 {
        store_pool_signature(app, "");
        return Err("Failed to create the selection overlay".to_string());
    }
    set_overlay_showing(app, true);
    // Only a layout we trust becomes the pool's key. Storing a signature built
    // from a degraded enumeration is how a missing display becomes *permanent*
    // rather than momentary: the next capture finds the stored signature
    // matching the (still degraded) list, takes the fast path above, and shows
    // a pool that has no overlay for the missing monitor — with nothing left to
    // notice the difference. Leaving the signature alone costs one slow-path
    // rebuild per capture until the display comes back, which is the right
    // trade against a display silently dropping out for the rest of the session.
    if complete {
        if let Some(state) = app.try_state::<crate::state::AppState>() {
            if let Ok(mut g) = state.overlay_signature.lock() {
                *g = sig;
            }
        }
    } else {
        crate::diag::log("overlay: built from a degraded monitor list — pool signature not stored");
    }

    Ok(())
}

/// Rebuilds the overlay pool after a display-topology change (`WM_DISPLAYCHANGE`,
/// see `hook_win`). Clearing the stored signature FIRST is the point: the pool
/// must be rebuilt even when the layout ends up byte-identical to the one it
/// was built for (VDI session ends and the monitors come back exactly as
/// before), because a hidden pooled WebView2 window that Windows shuffled
/// across monitors/DPIs while a display was detached can come back blank —
/// `show()` succeeds, nothing renders, and the signature check alone would
/// keep fast-pathing onto it forever ("the overlay never appears on that
/// display"). With the signature cleared, either the `prewarm_overlays` call
/// below rebuilds now, or — if a capture is mid-flight, or a pool operation on
/// another thread holds `POOL_LOCK`, and prewarm bows out — the next
/// `open_overlay` takes the slow path and rebuilds then.
pub fn rebuild_overlays_for_display_change(app: &AppHandle) {
    store_pool_signature(app, "");
    prewarm_overlays(app);
}

/// Builds the hidden overlay pool ahead of time (app startup, and after a
/// display-topology change) so the first PrintScreen already hits
/// `open_overlay`'s fast path. No-op if a capture is in flight, another pool
/// operation is running, or the pool already matches the current monitor layout.
pub fn prewarm_overlays(app: &AppHandle) {
    let Some(state) = app.try_state::<crate::state::AppState>() else { return };
    // `try_lock`, never `lock`: this also runs on the **main thread** (the
    // display-change rebuild is dispatched there), while the capture path holds
    // the pool lock across window creation — work that needs the main thread to
    // complete. A main-thread waiter would deadlock the app outright. Bowing out
    // costs nothing: prewarming is an optimization, and whoever holds the lock
    // either leaves a pool matching the current layout or clears the signature,
    // so the next capture rebuilds.
    let _pool = match POOL_LOCK.try_lock() {
        Ok(guard) => guard,
        Err(std::sync::TryLockError::Poisoned(p)) => p.into_inner(),
        Err(std::sync::TryLockError::WouldBlock) => {
            crate::diag::log("overlay: prewarm skipped — another pool operation is running");
            return;
        }
    };
    if state.capturing.load(std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    let Ok(crate::monitors::Enumeration { monitors, complete }) = crate::monitors::enumerate()
    else {
        return;
    };
    if monitors.is_empty() {
        return;
    }
    // Prewarming is a latency optimization, so it is the one caller that can
    // simply decline. Building a pool from a degraded list would key it on a
    // layout that is missing a display — and this runs at startup and (via
    // `rebuild_overlays_for_display_change`) about a second after
    // `WM_DISPLAYCHANGE`, both of which land squarely in the window where a
    // display is mid-mode-change and drops out of the list. Bowing out leaves
    // the signature cleared, so the next `open_overlay` takes the slow path and
    // enumerates again — a few hundred ms once, instead of a wrong pool.
    if !complete {
        crate::diag::log("prewarm: skipped — monitor list degraded, leaving pool unbuilt");
        return;
    }
    let sig = monitors_signature(&monitors);

    // Cross-check, deliberately off the PrintScreen hot path (this runs at
    // startup and after each display change, where a handful of `CreateDC`
    // calls cost nothing). The overlay pool is placed from Win32 `rcMonitor`,
    // but everything downstream of it — `freeze_desktop`'s composite, the
    // `get_monitors` hover targets — is still keyed on xcap's DEVMODE geometry.
    // The two agree on every ordinary desktop; if they ever don't, the overlay
    // is on the right monitor while those are not, and this line is the only
    // thing that would say so.
    #[cfg(target_os = "windows")]
    {
        if let Ok(from_xcap) = xcap_monitors() {
            let xcap_sig = monitors_signature(&from_xcap);
            if xcap_sig != sig {
                crate::diag::log(&format!(
                    "overlay: monitor geometry disagreement — win32 [{sig}] vs xcap [{xcap_sig}]"
                ));
            }
        }
    }

    if state.overlay_signature.lock().map(|g| *g == sig).unwrap_or(false) {
        return;
    }

    let built = build_pool(app, &monitors, false);
    if built == monitors.len() {
        store_pool_signature(app, &sig);
    } else {
        // Same rule as the capture path: a pool that is missing a monitor is not
        // a pool. Leaving the signature cleared means the next capture rebuilds
        // rather than fast-pathing onto a set of windows that can't cover every
        // display.
        crate::diag::log(&format!(
            "overlay: prewarm built {built}/{} window(s) — pool not kept",
            monitors.len()
        ));
        store_pool_signature(app, "");
    }
}

/// Opens the settings window, or focuses it if already open.
pub fn open_settings(app: &AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("settings") {
        let _ = existing.show();
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        return Ok(());
    }

    let win = WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("/".into()))
        .title("Clipse — Settings")
        .inner_size(560.0, 640.0)
        .min_inner_size(480.0, 480.0)
        .decorations(false)
        .center()
        .focused(true)
        .build()
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    disable_browser_accelerator_keys(&win);

    Ok(())
}

/// Opens the About window, or focuses it if already open.
pub fn open_about(app: &AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("about") {
        let _ = existing.show();
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        return Ok(());
    }

    let win = WebviewWindowBuilder::new(app, "about", WebviewUrl::App("/".into()))
        .title("About Clipse")
        .inner_size(420.0, 520.0)
        .resizable(false)
        .decorations(false)
        .center()
        .focused(true)
        .build()
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    disable_browser_accelerator_keys(&win);

    Ok(())
}

/// Opens the small always-on-top screen-recorder control window.
pub fn open_recorder(app: &AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("recorder") {
        let _ = existing.show();
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        return Ok(());
    }

    let win = WebviewWindowBuilder::new(app, "recorder", WebviewUrl::App("/".into()))
        .title("Clipse — Recorder")
        .inner_size(540.0, 210.0)
        .resizable(false)
        .always_on_top(true)
        .decorations(false)
        .center()
        .focused(true)
        .build()
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    disable_browser_accelerator_keys(&win);

    Ok(())
}

/// Opens the small fixed-size/ratio capture control window, or shows/focuses
/// it if it already exists. It hides itself (from the frontend) right before
/// the overlay opens, and the backend hides it again on a successful capture
/// or re-shows it on cancel/error (see `commands::capture::
/// end_fixed_capture_session`) — so by the time a user reopens it from the
/// tray, it's almost always this same still-alive, just-hidden window this
/// branch reuses, not a freshly built one.
pub fn open_fixed_capture(app: &AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("fixed-capture") {
        let _ = existing.show();
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        return Ok(());
    }

    let win = WebviewWindowBuilder::new(app, "fixed-capture", WebviewUrl::App("/".into()))
        .title("Clipse — Fixed Capture")
        .inner_size(420.0, 360.0)
        .resizable(false)
        .decorations(false)
        .center()
        .focused(true)
        .build()
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    disable_browser_accelerator_keys(&win);
    // Excludes this window from every screen-capture path (DXGI Desktop
    // Duplication, GDI, Windows.Graphics.Capture) at the OS/compositor
    // level — the same mechanism the recorder's mini control bar uses to
    // keep itself out of its own recording. This makes its capture-time
    // *visibility* irrelevant: no amount of "hide it, then wait for DWM to
    // settle / for DXGI to notice" timing can go wrong if the window can
    // never be captured in the first place, regardless of whether it's
    // still mid hide-animation, still technically visible, or anything
    // else. (`hide()`/`show()` around a capture still matter for what the
    // *user* sees on their own desktop — this is only about what ends up in
    // the screenshot.)
    #[cfg(target_os = "windows")]
    set_excluded_from_capture(&win, true);

    Ok(())
}

/// Counter for "Pin to Screen" window labels (`pin-{n}`) — several can be
/// open at once, so each needs a distinct label, unlike every other window
/// in the app which is a get-or-create singleton.
static PIN_COUNTER: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

/// Opens a borderless, always-on-top window pinning `png_bytes` to the
/// screen (CleanShot-style "Pin to Screen") — for comparing a screenshot
/// against something else, or keeping reference material visible while
/// working in another app. Resizing is Pin.tsx's own corner handle, not
/// native OS resize (see `resizable(false)` below for why). Unlike the
/// utility windows above, this one is deliberately *not* excluded from
/// screen capture: a pinned reference image showing up in a later
/// screenshot is expected, not a bug.
pub fn open_pin_window(app: &AppHandle, png_bytes: Vec<u8>) -> Result<(), String> {
    let label = format!("pin-{}", PIN_COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst));

    // Size the window to the image's own aspect ratio (capped to a modest
    // on-screen footprint — the user can always resize larger) instead of a
    // fixed default, so it doesn't open comically stretched for a very wide
    // or very tall capture.
    const MAX_DIM: f64 = 480.0;
    const MIN_W: f64 = 120.0;
    const MIN_H: f64 = 80.0;
    let (iw, ih) = image::io::Reader::new(std::io::Cursor::new(&png_bytes))
        .with_guessed_format()
        .ok()
        .and_then(|r| r.into_dimensions().ok())
        .unwrap_or((800, 600));
    let scale = (MAX_DIM / iw as f64).min(MAX_DIM / ih as f64).min(1.0);
    let mut win_w = iw as f64 * scale;
    let mut win_h = ih as f64 * scale;
    // Enforce the floor by scaling both dimensions up together, never one
    // independently — an independent `.max()` per axis (the previous
    // behavior) breaks the window's aspect ratio for thin/wide or very
    // small captures, which leaves `object-fit: contain` letterboxing the
    // image inside it. Pin.tsx's zoom math assumes container-local
    // coordinates equal image-local coordinates 1:1 (true only with zero
    // letterbox), so that mismatch is what desynced the cursor position
    // from the zoomed point under it.
    let min_extra_scale = (MIN_W / win_w).max(MIN_H / win_h).max(1.0);
    win_w *= min_extra_scale;
    win_h *= min_extra_scale;

    if let Some(state) = app.try_state::<crate::state::AppState>() {
        if let Ok(mut map) = state.pinned_images.lock() {
            map.insert(label.clone(), png_bytes);
        }
    }

    let win = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("/".into()))
        .title("Clipse — Pin")
        .inner_size(win_w, win_h)
        .min_inner_size(80.0, 60.0)
        .decorations(false)
        .shadow(true)
        .always_on_top(true)
        .skip_taskbar(true)
        // The OS's own edge/corner resize can't keep the window locked to
        // the image's aspect ratio — Tauri has no declarative constraint for
        // that, only "correct it after the fact" via a resize event, which
        // is visibly janky on a live drag (the window briefly snaps to the
        // raw OS-reported size, then to the corrected one, every mouse-move
        // tick). Pin.tsx implements its own single corner resize handle
        // instead, computing an already-correct target size directly from
        // the drag — no wrong-then-corrected step, so no jitter.
        .resizable(false)
        .focused(false)
        .build()
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    disable_browser_accelerator_keys(&win);

    // The pinned bytes are only ever needed while this specific window is
    // alive — remove them the moment it's destroyed so a long session
    // opening/closing many pins doesn't accumulate stale PNGs in memory.
    let cleanup_app = app.clone();
    let cleanup_label = label;
    win.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            if let Some(state) = cleanup_app.try_state::<crate::state::AppState>() {
                if let Ok(mut map) = state.pinned_images.lock() {
                    map.remove(&cleanup_label);
                }
            }
        }
    });

    Ok(())
}

/// Counter for editor window labels (`editor-{n}`). Like the pin windows —
/// and unlike the app's singleton utility windows — several editors can be
/// open at once, each on its own capture, so every open gets a fresh label.
static EDITOR_COUNTER: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

/// Diagonal offset (logical px) between stacked editor windows, so a second
/// editor opened while the first is still up doesn't land exactly on top of it
/// and look like the same window with its content replaced.
const EDITOR_CASCADE_STEP: f64 = 32.0;
/// The cascade wraps after this many steps instead of walking off-screen.
const EDITOR_CASCADE_WRAP: u32 = 6;

/// Opens a new editor window on whatever is currently staged in
/// `AppState.pending_{image,path,annotations}` — the capture-flow path (the
/// toast is clicked, or `open_editor_after_capture` fires straight away).
/// Callers that already hold the document should use `open_editor_with`.
pub fn open_editor(app: &AppHandle) -> Result<(), String> {
    let pending = app
        .try_state::<crate::state::AppState>()
        .map(|state| crate::state::PendingCapture {
            image: state
                .pending_image
                .lock()
                .ok()
                .and_then(|g| g.clone())
                .unwrap_or_default(),
            path: state.pending_path.lock().ok().and_then(|g| g.clone()),
            annotations: state.pending_annotations.lock().ok().and_then(|g| g.clone()),
        })
        .unwrap_or_default();
    open_editor_with(app, pending)
}

/// Opens a new annotation editor window on `pending`.
///
/// Every call creates its own window: keeping several captures open side by
/// side (and copying annotations between them — see
/// `commands::clipboard::set_annotation_clipboard`) is the point, so an open
/// editor is never reused/reloaded out from under whatever the user is doing
/// in it. `pending` is filed under this window's own label
/// (`AppState.pending_editors`) *before* the window exists, so the document is
/// fixed at creation time — a capture that completes, or another editor that
/// opens, while this webview is still cold-starting can't swap it out.
pub fn open_editor_with(
    app: &AppHandle,
    pending: crate::state::PendingCapture,
) -> Result<(), String> {
    let n = EDITOR_COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let label = format!("editor-{n}");

    if let Some(state) = app.try_state::<crate::state::AppState>() {
        if let Ok(mut map) = state.pending_editors.lock() {
            map.insert(label.clone(), pending);
        }
    }

    // How many editors are already up — decides where in the cascade this one
    // lands. Counted before the build so the first editor gets a plain center.
    let existing_editors = app
        .webview_windows()
        .keys()
        .filter(|l| l.starts_with("editor"))
        .count() as u32;

    let editor = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("/".into()))
        .title("Clipse")
        .inner_size(1100.0, 700.0)
        .min_inner_size(800.0, 500.0)
        .decorations(false)
        .center()
        .focused(true)
        .build()
        .map_err(|e| {
            // The window never came up, so nothing will ever fetch (or clean
            // up) its staged document.
            if let Some(state) = app.try_state::<crate::state::AppState>() {
                if let Ok(mut map) = state.pending_editors.lock() {
                    map.remove(&label);
                }
            }
            e.to_string()
        })?;
    #[cfg(target_os = "windows")]
    disable_browser_accelerator_keys(&editor);
    // Resolve and cache this window's OS handle for `set_editors_excluded_from_
    // capture` — at setup time, where the blocking main-thread round-trip it
    // costs is affordable, unlike on the capture path itself (see `raw_hwnd`).
    // Gated on the same switch as the feature: with exclusion off nothing ever
    // reads the handle, and resolving it anyway would be a main-thread round-trip
    // per editor opened, paid for a value that is never used.
    #[cfg(target_os = "windows")]
    if EXCLUDE_EDITORS_FROM_CAPTURE {
        if let Some(hwnd) = raw_hwnd(&editor) {
            if let Some(state) = app.try_state::<crate::state::AppState>() {
                if let Ok(mut map) = state.editor_hwnds.lock() {
                    map.insert(label.clone(), hwnd);
                }
            }
        }
    }

    if existing_editors > 0 {
        // Step the window off the centered position of the ones already open.
        if let Ok(pos) = editor.outer_position() {
            let sf = editor.scale_factor().unwrap_or(1.0);
            let step = (EDITOR_CASCADE_STEP * sf).round() as i32
                * (existing_editors % EDITOR_CASCADE_WRAP) as i32;
            let _ = editor.set_position(PhysicalPosition::new(pos.x + step, pos.y + step));
        }
    }

    // The capture flow just raised the captured window to the front, which can leave
    // the new editor behind it. Briefly toggling always-on-top forces the editor's
    // z-order to the top (reliable for our own window without foreground rights),
    // then we restore normal stacking and focus it.
    let _ = editor.set_always_on_top(true);
    let _ = editor.set_always_on_top(false);
    let _ = editor.set_focus();

    // Both per-window entries are only ever needed by this window (the document
    // is re-fetched on a webview reload), so they live exactly as long as it
    // does — otherwise a long session opening and closing editors would pile up
    // multi-MB PNG buffers and stale window handles. Same lifecycle as
    // `open_pin_window`'s bytes.
    let cleanup_app = app.clone();
    let cleanup_label = label;
    editor.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            if let Some(state) = cleanup_app.try_state::<crate::state::AppState>() {
                if let Ok(mut map) = state.pending_editors.lock() {
                    map.remove(&cleanup_label);
                }
                if let Ok(mut map) = state.editor_hwnds.lock() {
                    map.remove(&cleanup_label);
                }
            }
        }
    });

    Ok(())
}

// ===== Capture-complete toast =====

/// Toast card size in logical pixels (scaled per-monitor for placement).
/// Width is sized to the card's actual content (icon 30 + gap 12 + the longer
/// text line ~194 + paddings 16/24) — much wider leaves dead space on the right.
const TOAST_W: f64 = 300.0;
const TOAST_H: f64 = 84.0;
/// Gap between the toast and the work-area edges, logical px.
const TOAST_MARGIN: f64 = 16.0;

/// Shows the capture-complete toast (Teams-notification style) at the
/// bottom-right of the monitor containing `anchor`'s center — the captured
/// rect in physical pixels — falling back to the primary monitor when `anchor`
/// is `None` or off-screen. Clicking the toast opens the editor on the pending
/// capture (`toast_open_editor`); it auto-dismisses from the frontend
/// (`toast_dismiss`).
///
/// The window is created once and reused (hide → reposition → show), so only
/// the very first toast pays the webview-creation cost. It never takes focus
/// (`WS_EX_NOACTIVATE` — a notification must not yank the user out of whatever
/// they were doing) and is excluded from screen capture so it can't appear in
/// a follow-up screenshot.
pub fn show_capture_toast(app: &AppHandle, anchor: Option<(i32, i32, u32, u32)>) {
    // Resolve the target monitor: physical bounds + scale factor.
    let Ok(monitors) = crate::monitors::enumerate().map(|e| e.monitors) else { return };
    if monitors.is_empty() {
        return;
    }
    let center = anchor.map(|(x, y, w, h)| (x + (w / 2) as i32, y + (h / 2) as i32));
    let monitor = center
        .and_then(|(cx, cy)| {
            monitors.iter().find(|m| {
                cx >= m.x()
                    && cx < m.x() + m.width() as i32
                    && cy >= m.y()
                    && cy < m.y() + m.height() as i32
            })
        })
        .or_else(|| monitors.iter().find(|m| m.is_primary()))
        .or_else(|| monitors.first());
    let Some(m) = monitor else { return };

    let (mx, my) = (m.x(), m.y());
    let (mw, mh) = (m.width() as i32, m.height() as i32);

    // Work area (excludes the taskbar) so the toast sits above it, like OS
    // notifications do. Fallback: full bounds minus a taskbar-sized strip.
    let (wa_right, wa_bottom) = monitor_work_area_bottom_right(mx + mw / 2, my + mh / 2)
        .unwrap_or((mx + mw, my + mh - (48.0 * m.scale_factor() as f64) as i32));

    // Warm instance: reposition and re-show; the frontend restarts its
    // dismiss timer and entrance animation on the `toast-show` event.
    if let Some(existing) = app.get_webview_window("toast") {
        use tauri::Emitter;
        place_toast(&existing, wa_right, wa_bottom);
        let _ = existing.show();
        // Must come *after* show(): tao recomputes GWL_EXSTYLE from its own
        // window flags on every visibility toggle, erasing an earlier edit.
        #[cfg(target_os = "windows")]
        set_no_activate(&existing);
        let _ = app.emit_to("toast", "toast-show", ());
        return;
    }

    let Ok(win) = WebviewWindowBuilder::new(app, "toast", WebviewUrl::App("/".into()))
        .title("")
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .resizable(false)
        .visible(false)
        .focused(false)
        .build()
    else {
        return;
    };

    #[cfg(target_os = "windows")]
    {
        disable_browser_accelerator_keys(&win);
        set_excluded_from_capture(&win, true);
    }

    place_toast(&win, wa_right, wa_bottom);
    let _ = win.show();
    // After show() — see the comment on the reuse path above.
    #[cfg(target_os = "windows")]
    set_no_activate(&win);
}

/// Sizes and positions the (still hidden) toast at the bottom-right of the
/// given work area (physical px). The size is specified in *logical* px and
/// converted by the window's own scale factor, so the window is first moved
/// coarsely onto the target monitor to adopt its DPI, then the exact position
/// is computed back from the resulting physical size. (The previous approach —
/// physical size = TOAST_W × xcap's `scale_factor()` — undersized the toast on
/// DPI-scaled monitors where xcap reports a scale factor of 1.0, clipping the
/// message text.)
fn place_toast(win: &tauri::WebviewWindow, wa_right: i32, wa_bottom: i32) {
    let _ = win.set_position(PhysicalPosition::new(wa_right - 200, wa_bottom - 100));
    let _ = win.set_size(tauri::LogicalSize::new(TOAST_W, TOAST_H));
    let sf = win.scale_factor().unwrap_or(1.0);
    let (w_phys, h_phys) = win
        .outer_size()
        .map(|s| (s.width as i32, s.height as i32))
        .unwrap_or(((TOAST_W * sf) as i32, (TOAST_H * sf) as i32));
    let margin = (TOAST_MARGIN * sf).round() as i32;
    let _ = win.set_position(PhysicalPosition::new(
        wa_right - w_phys - margin,
        wa_bottom - h_phys - margin,
    ));
}

/// Hides the toast (kept alive as a warm instance for the next capture).
pub fn hide_toast(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("toast") {
        let _ = win.hide();
    }
}

/// Work area (physical px, `left, top, right, bottom`) — the monitor rect minus
/// the taskbar — of the monitor containing the given point.
#[cfg(target_os = "windows")]
fn monitor_work_area(cx: i32, cy: i32) -> Option<(i32, i32, i32, i32)> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    unsafe {
        let hmon = MonitorFromPoint(POINT { x: cx, y: cy }, MONITOR_DEFAULTTONEAREST);
        let mut mi = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        GetMonitorInfoW(hmon, &mut mi).as_bool().then(|| {
            (
                mi.rcWork.left,
                mi.rcWork.top,
                mi.rcWork.right,
                mi.rcWork.bottom,
            )
        })
    }
}

#[cfg(not(target_os = "windows"))]
fn monitor_work_area(_cx: i32, _cy: i32) -> Option<(i32, i32, i32, i32)> {
    None
}

/// Bottom-right corner (physical px) of the work area of the monitor containing
/// the given point.
fn monitor_work_area_bottom_right(cx: i32, cy: i32) -> Option<(i32, i32)> {
    monitor_work_area(cx, cy).map(|(_, _, r, b)| (r, b))
}

// ===== Quick menu (Ctrl+PrintScreen) =====

/// Logical size of the quick menu. Kept in step with `QuickMenu.module.css`:
/// the window is sized here and the content lays out to fill it exactly, so an
/// action added to `QuickMenu.tsx` needs `QUICKMENU_H` bumped by one row (32px).
/// Height = 8px shadow gutter ×2 + 6px panel padding + 9 rows ×32px + 24px hint.
const QUICKMENU_W: f64 = 264.0;
const QUICKMENU_H: f64 = 334.0;
/// Gap between the menu and the cursor, and between the menu and the work-area
/// edges when it has to be pushed back inside them.
const QUICKMENU_MARGIN: f64 = 8.0;

/// Opens the quick action menu at the mouse cursor — Ctrl+PrintScreen's action.
///
/// Unlike every other floating window here this one **takes focus**: it is
/// driven with the arrow keys and Enter, so it has to receive keystrokes. That
/// is also why Ctrl+PrintScreen can no longer preserve an open right-click
/// context menu the way it did when it captured directly (activating any window
/// dismisses one) — the actions themselves are what matter now.
///
/// Created once and then reused (hide → reposition → show + a `quickmenu-show`
/// event), like the capture toast: a menu bound to a global hotkey has to feel
/// instant, and building a WebView2 costs hundreds of ms.
pub fn open_quick_menu(app: &AppHandle) -> Result<(), String> {
    let (cx, cy) = crate::commands::capture::cursor_position();

    let (win, warm) = match app.get_webview_window("quickmenu") {
        Some(existing) => (existing, true),
        None => (build_quick_menu(app)?, false),
    };

    place_quick_menu(&win, cx, cy);
    win.show().map_err(|e| e.to_string())?;
    let _ = win.unminimize();
    let _ = win.set_focus();
    if warm {
        // The reused webview still holds the previous run's selection — this
        // tells it to reset to the first row and replay its entrance animation.
        // A freshly built one already starts there, hence only on the warm path.
        use tauri::Emitter;
        let _ = app.emit_to("quickmenu", "quickmenu-show", ());
    }
    crate::diag::log(if warm {
        "quickmenu: shown (warm)"
    } else {
        "quickmenu: shown (cold)"
    });
    Ok(())
}

/// Builds the (hidden) quick-menu window. Split out so startup can prewarm it.
fn build_quick_menu(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    let win = WebviewWindowBuilder::new(app, "quickmenu", WebviewUrl::App("/".into()))
        .title("")
        .inner_size(QUICKMENU_W, QUICKMENU_H)
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .resizable(false)
        .visible(false)
        .focused(false)
        .build()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    {
        disable_browser_accelerator_keys(&win);
        // Permanent exclusion, like the Fixed Capture control window: every
        // action on this menu can start a capture, and the menu itself must
        // never end up in one no matter how the hide/show timing plays out.
        set_excluded_from_capture(&win, true);
    }
    Ok(win)
}

/// Builds the quick menu hidden at startup so the first Ctrl+PrintScreen only
/// has to show it — same reasoning as `prewarm_overlays`, since a WebView2 costs
/// hundreds of ms to create and this window sits on a global hotkey.
/// Best-effort: on failure `open_quick_menu` just takes the cold path.
pub fn prewarm_quick_menu(app: &AppHandle) {
    if app.get_webview_window("quickmenu").is_some() {
        return;
    }
    if let Err(e) = build_quick_menu(app) {
        crate::diag::log(&format!("quickmenu: prewarm failed: {e}"));
    }
}

/// Hides the quick menu, keeping it warm for the next Ctrl+PrintScreen.
pub fn hide_quick_menu(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("quickmenu") {
        let _ = win.hide();
    }
}

/// Places the menu next to the cursor (physical px), context-menu style: down
/// and to the right, flipping to the other side when the work area doesn't have
/// room, then clamped inside it. It is deliberately offset rather than centred
/// on the pointer — a menu opening *under* the cursor would take a hover on
/// whatever row landed there and pre-select an arbitrary action.
fn place_quick_menu(win: &tauri::WebviewWindow, cx: i32, cy: i32) {
    // Coarse move first so the window adopts the target monitor's scale factor,
    // then size in logical px and read the physical result back — the same dance
    // as `place_toast`, for the same reason (a logical size is meaningless until
    // the window sits on the monitor that will display it).
    let _ = win.set_position(PhysicalPosition::new(cx, cy));
    let _ = win.set_size(tauri::LogicalSize::new(QUICKMENU_W, QUICKMENU_H));
    let sf = win.scale_factor().unwrap_or(1.0);
    let (w, h) = win
        .outer_size()
        .map(|s| (s.width as i32, s.height as i32))
        .unwrap_or(((QUICKMENU_W * sf) as i32, (QUICKMENU_H * sf) as i32));
    let margin = (QUICKMENU_MARGIN * sf).round() as i32;

    let (left, top, right, bottom) = monitor_work_area(cx, cy).unwrap_or((
        cx.min(0),
        cy.min(0),
        cx + w + margin * 2,
        cy + h + margin * 2,
    ));
    let x = if cx + margin + w <= right {
        cx + margin
    } else {
        cx - margin - w
    };
    let y = if cy + margin + h <= bottom {
        cy + margin
    } else {
        cy - margin - h
    };
    let _ = win.set_position(PhysicalPosition::new(
        x.clamp(left, (right - w).max(left)),
        y.clamp(top, (bottom - h).max(top)),
    ));
}

/// Marks `window` as never-activating (`WS_EX_NOACTIVATE`): it can be clicked
/// (mouse events still dispatch) but showing or clicking it never steals
/// keyboard focus from the foreground app — required for a notification toast.
#[cfg(target_os = "windows")]
fn set_no_activate(window: &tauri::WebviewWindow) {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE,
    };

    let Ok(handle) = window.window_handle() else { return };
    let RawWindowHandle::Win32(win32) = handle.as_raw() else { return };
    let hwnd = HWND(win32.hwnd.get() as *mut std::ffi::c_void);
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex | WS_EX_NOACTIVATE.0 as isize);
    }
}

/// Shows a small floating "Scrolling & stitching…" indicator while a scrolling
/// capture runs. The region overlay is hidden the moment scrolling starts (so it
/// can't appear in the captured frames), which otherwise leaves the user with no
/// on-screen sign that anything is still happening for however long the
/// scroll-and-stitch loop takes. Click-through and excluded from screen capture
/// so it's purely informational and can never end up in the stitched output.
pub fn show_scroll_progress(app: &AppHandle) {
    if let Some(existing) = app.get_webview_window("scroll-progress") {
        let _ = existing.show();
        return;
    }

    // Wide enough for "Scrolling & stitching… · Esc to stop" + spinner.
    const W: f64 = 320.0;
    const TOP_MARGIN: f64 = 48.0;

    let screen_w = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| m.size().width as f64 / m.scale_factor())
        .unwrap_or(1920.0);
    let x = ((screen_w - W) / 2.0).max(0.0);

    let Ok(win) = WebviewWindowBuilder::new(app, "scroll-progress", WebviewUrl::App("/".into()))
        .title("")
        .inner_size(W, 48.0)
        .position(x, TOP_MARGIN)
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .resizable(false)
        .focused(false)
        .build()
    else {
        return;
    };

    let _ = win.set_ignore_cursor_events(true);
    #[cfg(target_os = "windows")]
    set_excluded_from_capture(&win, true);
}

/// Closes the scroll-progress indicator, if open.
pub fn close_scroll_progress(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("scroll-progress") {
        let _ = win.close();
    }
}

/// Hides `window` from screen capture (DXGI Desktop Duplication, the
/// Windows.Graphics.Capture API used by `record_win`, BitBlt/PrintWindow)
/// while it stays visible and interactive on screen. Used for the
/// recorder's mini control bar, so it doesn't have to be hidden outright
/// to keep it out of its own recording.
/// Disables WebView2's built-in "browser accelerator keys" (F3/F5/F6/F7/F12,
/// Ctrl+P/F/G, etc.) on `window`. Without this, WebView2 itself intercepts
/// F12 to toggle DevTools / trigger a page reload *before* our own keydown
/// handlers ever see it — since F12 is bound to the Select tool
/// (`FKEY_TO_TOOL` in `Toolbar.tsx`), pressing it could reload the editor's
/// webview and silently wipe every unsaved annotation in memory. Applied to
/// every window at creation. Best-effort: on any failure the accelerator
/// keys just stay at their WebView2 default, no worse than before this call.
#[cfg(target_os = "windows")]
pub fn disable_browser_accelerator_keys(window: &tauri::WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
    // Must be windows-core's `Interface` (not our `windows = "0.58"` crate's
    // re-export) — the COM types below come from webview2-com/tao, which
    // resolve to a different, newer windows-core version.
    use windows_core::Interface;

    let _ = window.with_webview(|pw| {
        let controller = pw.controller();
        let Ok(core) = (unsafe { controller.CoreWebView2() }) else { return };
        let Ok(settings) = (unsafe { core.Settings() }) else { return };
        if let Ok(settings3) = settings.cast::<ICoreWebView2Settings3>() {
            unsafe {
                let _ = settings3.SetAreBrowserAcceleratorKeysEnabled(false);
            }
        }
        // Also kill WebView2's own Ctrl+Wheel / Ctrl+Plus/Minus page-zoom —
        // it consumes the wheel event at the browser level before any DOM
        // listener (even a non-passive one) gets a chance, which broke
        // Pin.tsx's Ctrl+wheel in-image zoom (the whole webview zoomed
        // instead of the intended custom transform).
        unsafe {
            let _ = settings.SetIsZoomControlEnabled(false);
        }
    });
}

#[cfg(target_os = "windows")]
pub fn set_excluded_from_capture(window: &tauri::WebviewWindow, excluded: bool) {
    if let Some(hwnd) = raw_hwnd(window) {
        set_hwnd_excluded_from_capture(hwnd, excluded);
    }
}

/// `window`'s OS handle as a raw `isize`.
///
/// **Blocking**: resolving a Tauri window handle is a round-trip to the
/// main-thread event loop with no timeout (`window_getter!` in
/// tauri-runtime-wry). Only call this while setting a window up — never from a
/// capture path, which runs on an async-runtime thread and would then hang for
/// as long as the main thread is busy. Cache the result instead; see
/// `state::AppState::editor_hwnds`.
#[cfg(target_os = "windows")]
fn raw_hwnd(window: &tauri::WebviewWindow) -> Option<isize> {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    let handle = window.window_handle().ok()?;
    let RawWindowHandle::Win32(win32) = handle.as_raw() else { return None };
    Some(win32.hwnd.get())
}

/// Applies (or clears) the capture exclusion on an already-resolved handle.
/// `SetWindowDisplayAffinity` has no thread affinity, so unlike resolving the
/// handle this is safe to call from anywhere, including the capture hot path.
/// A handle whose window has since been destroyed just fails harmlessly.
#[cfg(target_os = "windows")]
fn set_hwnd_excluded_from_capture(hwnd: isize, excluded: bool) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
    };

    let affinity = if excluded { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE };
    unsafe {
        let _ = SetWindowDisplayAffinity(HWND(hwnd as *mut std::ffi::c_void), affinity);
    }
}
