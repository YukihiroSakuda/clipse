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
    for (label, win) in app.webview_windows() {
        if label.starts_with("overlay") {
            let _ = win.hide();
        }
    }
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
    // Hide main window so it won't be captured
    if let Some(main) = app.get_webview_window("main") {
        main.hide().map_err(|e| e.to_string())?;
    }

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
            for (label, win) in &overlays {
                // Index is the label's trailing `-{i}`, mapping it to its monitor.
                let idx: usize = label.rsplit('-').next().and_then(|s| s.parse().ok()).unwrap_or(0);
                if let Some(m) = monitors.get(idx) {
                    let _ = win.set_position(PhysicalPosition::new(m.x(), m.y()));
                    let _ = win.set_size(PhysicalSize::new(m.width(), m.height()));
                    let _ = win.show();
                    if m.is_primary() {
                        let _ = win.set_focus();
                    }
                }
            }
            let _ = app.emit("overlay-show", ());
            return Ok(());
        }
    }

    // Slow path: no pool (first run) or the monitor layout changed — build
    // fresh overlays, visible immediately. They stay alive (hidden) after the
    // capture, becoming the pool for next time.
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

    WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("/".into()))
        .title("Clipse — Settings")
        .inner_size(560.0, 640.0)
        .min_inner_size(480.0, 480.0)
        .decorations(false)
        .center()
        .focused(true)
        .build()
        .map_err(|e| e.to_string())?;

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

    WebviewWindowBuilder::new(app, "recorder", WebviewUrl::App("/".into()))
        .title("Clipse — Recorder")
        .inner_size(540.0, 210.0)
        .resizable(false)
        .always_on_top(true)
        .decorations(false)
        .center()
        .focused(true)
        .build()
        .map_err(|e| e.to_string())?;

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

    // The capture flow just raised the captured window to the front, which can leave
    // the new editor behind it. Briefly toggling always-on-top forces the editor's
    // z-order to the top (reliable for our own window without foreground rights),
    // then we restore normal stacking and focus it.
    let _ = editor.set_always_on_top(true);
    let _ = editor.set_always_on_top(false);
    let _ = editor.set_focus();

    Ok(())
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

    const W: f64 = 240.0;
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
