use tauri::{
    AppHandle, LogicalPosition, Manager, PhysicalPosition, PhysicalSize, WebviewUrl,
    WebviewWindowBuilder,
};

/// Shows the gallery panel near the tray click position, or at the bottom-right
/// corner of the primary monitor if no cursor position is given.
/// `cursor_phys` is in physical pixels from the tray `Click` event.
pub fn show_panel(app: &AppHandle, cursor_phys: Option<(f64, f64)>) {
    const PANEL_W: f64 = 800.0;
    const PANEL_H: f64 = 700.0;
    const MARGIN: f64 = 8.0;

    let Some(window) = app.get_webview_window("main") else { return };

    let (sf, screen_w, screen_h) = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| {
            let sf = m.scale_factor();
            let w = m.size().width as f64 / sf;
            let h = m.size().height as f64 / sf;
            (sf, w, h)
        })
        .unwrap_or((1.0, 1920.0, 1080.0));

    // Nudge the panel slightly left and down from its computed anchor.
    const X_OFFSET: f64 = 40.0; // move left
    const Y_OFFSET: f64 = 60.0; // move down

    let (x, y) = if let Some((px, py)) = cursor_phys {
        let lx = px / sf;
        let ly = py / sf;
        let x = (lx - PANEL_W / 2.0).max(0.0).min(screen_w - PANEL_W);
        let y = (ly - PANEL_H - MARGIN).max(0.0).min(screen_h - PANEL_H);
        (x, y)
    } else {
        // Default: bottom-right above taskbar
        let x = (screen_w - PANEL_W - MARGIN).max(0.0);
        let y = (screen_h - PANEL_H - 48.0 - MARGIN).max(0.0);
        (x, y)
    };

    // Apply the offset, then re-clamp so the panel stays fully on-screen.
    let x = (x - X_OFFSET).max(0.0).min((screen_w - PANEL_W).max(0.0));
    let y = (y + Y_OFFSET).max(0.0).min((screen_h - PANEL_H).max(0.0));

    let _ = window.set_position(LogicalPosition::new(x, y));
    let _ = window.show();
    let _ = window.set_focus();
}

/// Returns (min_x, min_y, total_width, total_height) of the virtual screen
/// spanning all monitors, in physical pixels (as reported by xcap via GetMonitorInfoW).
pub fn virtual_screen_bounds() -> Result<(f64, f64, f64, f64), String> {
    let monitors = xcap::Monitor::all().map_err(|e| e.to_string())?;
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
pub fn try_claim_capture(app: &AppHandle) -> bool {
    let Some(state) = app.try_state::<crate::state::AppState>() else { return true };
    state
        .capturing
        .compare_exchange(
            false,
            true,
            std::sync::atomic::Ordering::SeqCst,
            std::sync::atomic::Ordering::SeqCst,
        )
        .is_ok()
}

/// Releases the "a capture is in progress" flag. Called once a capture pipeline
/// reaches its natural end: the user cancelled the pending selection, or a
/// `complete_*`/`do_*` capture command in `commands::capture` finished (success
/// or error).
pub fn release_capture(app: &AppHandle) {
    if let Some(state) = app.try_state::<crate::state::AppState>() {
        state.capturing.store(false, std::sync::atomic::Ordering::SeqCst);
    }
}

/// Hides every region-selection overlay window (labels starting with "overlay").
/// Used right before a capture so no overlay appears in the screenshot.
pub fn hide_all_overlays(app: &AppHandle) {
    use tauri::Emitter;
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
pub fn close_all_overlays(app: &AppHandle) {
    for (label, win) in app.webview_windows() {
        if label.starts_with("overlay") {
            let _ = win.close();
        }
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
    open_overlay_mode(app, false)
}

/// Like `open_overlay`, but lets the caller choose scrolling-capture mode.
/// The scroll flag is set *before* the overlays are shown, so the frontend's
/// mode fetch (fired by `overlay-show` on the prewarmed pool, which reacts
/// within milliseconds) can never race it.
pub fn open_overlay_mode(app: &AppHandle, scroll: bool) -> Result<(), String> {
    if !try_claim_capture(app) {
        return Err("A capture is already in progress".to_string());
    }
    match open_overlay_inner(app, scroll) {
        Ok(()) => Ok(()),
        Err(e) => {
            release_capture(app);
            Err(e)
        }
    }
}

/// Monitor-layout fingerprint the overlay pool is keyed on: any change in
/// count, position, or size (incl. DPI-driven physical size changes) must
/// rebuild the pool, since each overlay is pinned to one monitor's bounds.
fn monitors_signature(monitors: &[xcap::Monitor]) -> String {
    monitors
        .iter()
        .map(|m| format!("{}:{}:{}x{}", m.x(), m.y(), m.width(), m.height()))
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

fn open_overlay_inner(app: &AppHandle, scroll: bool) -> Result<(), String> {
    // Hide our own gallery window BEFORE snapshotting the desktop — otherwise
    // it gets baked into the frozen frame that the overlay draws as its
    // background (and crops the capture from), so it "stays" on the overlay
    // even though the window is gone. Hiding a background window of our own
    // can't dismiss another app's context menu, so the transient-UI intent of
    // freezing early still holds. Only pause for DWM to drop the window from
    // the composited desktop when it was actually visible — the hot path
    // (gallery already hidden, e.g. the PrintScreen hotkey) skips the wait.
    let main_was_visible = if let Some(main) = app.get_webview_window("main") {
        let visible = main.is_visible().unwrap_or(false);
        if visible {
            main.hide().map_err(|e| e.to_string())?;
        }
        visible
    } else {
        false
    };
    if main_was_visible {
        std::thread::sleep(std::time::Duration::from_millis(90));
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
    }

    let monitors = xcap::Monitor::all().map_err(|e| e.to_string())?;
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
        let overlays: Vec<_> = app
            .webview_windows()
            .into_iter()
            .filter(|(label, _)| label.starts_with("overlay"))
            .collect();
        if overlays.len() == monitors.len() {
            use tauri::Emitter;
            // Any placement/show failure on any pooled window means the pool
            // can't be trusted (a window broken by a display change while it
            // sat hidden, an unparseable label…) — fall through to a full
            // rebuild instead of silently showing an incomplete overlay set.
            let healthy = overlays.iter().all(|(label, win)| {
                // Index is the label's trailing `-{i}`, mapping it to its monitor.
                let Some(m) = label
                    .rsplit('-')
                    .next()
                    .and_then(|s| s.parse::<usize>().ok())
                    .and_then(|idx| monitors.get(idx))
                else {
                    return false;
                };
                let ok = win.set_position(PhysicalPosition::new(m.x(), m.y())).is_ok()
                    && win.set_size(PhysicalSize::new(m.width(), m.height())).is_ok()
                    && win.show().is_ok();
                if ok && m.is_primary() {
                    let _ = win.set_focus();
                }
                ok
            });
            if healthy {
                let _ = app.emit("overlay-show", ());
                return Ok(());
            }
            crate::diag::log("overlay: pooled window failed to place/show — rebuilding pool");
        }
    }

    // Slow path: no pool (first run) or the monitor layout changed — build
    // fresh overlays, visible immediately. They stay alive (hidden) after the
    // capture, becoming the pool for next time.
    crate::diag::log("overlay: building fresh pool (slow path)");
    close_all_overlays(app);
    let generation = OVERLAY_GENERATION.fetch_add(1, std::sync::atomic::Ordering::SeqCst);

    for (i, m) in monitors.iter().enumerate() {
        let label = format!("overlay-g{generation}-{i}");
        // Build hidden, then place/size in *physical* pixels (xcap coordinates).
        // PhysicalPosition/PhysicalSize are DPI-independent, so the window lands
        // exactly on the target monitor and takes on its native scale factor —
        // unlike builder logical coords, which are interpreted in the primary
        // monitor's DPI and misplace windows on differently-scaled monitors.
        let win = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("/".into()))
            .title("")
            .transparent(true)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .shadow(false)
            .resizable(false)
            .visible(false)
            .build()
            .map_err(|e| e.to_string())?;

        #[cfg(target_os = "windows")]
        disable_browser_accelerator_keys(&win);

        win.set_position(PhysicalPosition::new(m.x(), m.y()))
            .map_err(|e| e.to_string())?;
        win.set_size(PhysicalSize::new(m.width(), m.height()))
            .map_err(|e| e.to_string())?;
        let _ = win.show();
        // Focus the primary monitor's overlay so keyboard (Esc/Enter/Ctrl) works
        // without an initial click; mouse events reach any overlay regardless.
        if m.is_primary() {
            let _ = win.set_focus();
        }
    }

    if let Some(state) = app.try_state::<crate::state::AppState>() {
        if let Ok(mut g) = state.overlay_signature.lock() {
            *g = sig;
        }
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
/// below rebuilds now, or — if a capture is mid-flight and prewarm bows out —
/// the next `open_overlay` takes the slow path and rebuilds then.
pub fn rebuild_overlays_for_display_change(app: &AppHandle) {
    if let Some(state) = app.try_state::<crate::state::AppState>() {
        if let Ok(mut g) = state.overlay_signature.lock() {
            g.clear();
        }
    }
    prewarm_overlays(app);
}

/// Builds the hidden overlay pool ahead of time (app startup) so the first
/// PrintScreen already hits `open_overlay`'s fast path. No-op if a capture is
/// in flight or the pool already matches the current monitor layout.
pub fn prewarm_overlays(app: &AppHandle) {
    let Some(state) = app.try_state::<crate::state::AppState>() else { return };
    if state.capturing.load(std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    let Ok(monitors) = xcap::Monitor::all() else { return };
    if monitors.is_empty() {
        return;
    }
    let sig = monitors_signature(&monitors);
    if state.overlay_signature.lock().map(|g| *g == sig).unwrap_or(false) {
        return;
    }

    close_all_overlays(app);
    let generation = OVERLAY_GENERATION.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    for (i, m) in monitors.iter().enumerate() {
        let label = format!("overlay-g{generation}-{i}");
        let Ok(win) = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("/".into()))
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
        disable_browser_accelerator_keys(&win);
        let _ = win.set_position(PhysicalPosition::new(m.x(), m.y()));
        let _ = win.set_size(PhysicalSize::new(m.width(), m.height()));
    }
    if let Ok(mut g) = state.overlay_signature.lock() {
        *g = sig;
    };
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

/// Opens the annotation editor window.
///
/// An already-open editor is reused: it gets an `editor-load` event (the
/// frontend refetches the pending image and resets its annotation state)
/// instead of being closed and cold-started again — recreating the webview
/// costs hundreds of ms per capture.
pub fn open_editor(app: &AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("editor") {
        use tauri::Emitter;
        let _ = existing.show();
        let _ = existing.unminimize();
        let _ = app.emit_to("editor", "editor-load", ());
        // Same z-order dance as below: the captured window was just raised.
        let _ = existing.set_always_on_top(true);
        let _ = existing.set_always_on_top(false);
        let _ = existing.set_focus();
        return Ok(());
    }

    let editor = WebviewWindowBuilder::new(app, "editor", WebviewUrl::App("/".into()))
        .title("Clipse")
        .inner_size(1100.0, 700.0)
        .min_inner_size(800.0, 500.0)
        .decorations(false)
        .center()
        .focused(true)
        .build()
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    disable_browser_accelerator_keys(&editor);

    // The capture flow just raised the captured window to the front, which can leave
    // the new editor behind it. Briefly toggling always-on-top forces the editor's
    // z-order to the top (reliable for our own window without foreground rights),
    // then we restore normal stacking and focus it.
    let _ = editor.set_always_on_top(true);
    let _ = editor.set_always_on_top(false);
    let _ = editor.set_focus();

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
    let Ok(monitors) = xcap::Monitor::all() else { return };
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

/// Bottom-right corner (physical px) of the work area — the monitor rect minus
/// the taskbar — of the monitor containing the given point.
#[cfg(target_os = "windows")]
fn monitor_work_area_bottom_right(cx: i32, cy: i32) -> Option<(i32, i32)> {
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
        GetMonitorInfoW(hmon, &mut mi)
            .as_bool()
            .then(|| (mi.rcWork.right, mi.rcWork.bottom))
    }
}

#[cfg(not(target_os = "windows"))]
fn monitor_work_area_bottom_right(_cx: i32, _cy: i32) -> Option<(i32, i32)> {
    None
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
    });
}

#[cfg(target_os = "windows")]
pub fn set_excluded_from_capture(window: &tauri::WebviewWindow, excluded: bool) {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
    };

    let Ok(handle) = window.window_handle() else { return };
    let RawWindowHandle::Win32(win32) = handle.as_raw() else { return };
    let hwnd = HWND(win32.hwnd.get() as *mut std::ffi::c_void);
    let affinity = if excluded { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE };
    unsafe {
        let _ = SetWindowDisplayAffinity(hwnd, affinity);
    }
}
