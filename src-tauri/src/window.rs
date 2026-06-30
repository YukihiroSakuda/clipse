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
pub fn open_overlay(app: &AppHandle) -> Result<(), String> {
    // Hide main window so it won't be captured
    if let Some(main) = app.get_webview_window("main") {
        main.hide().map_err(|e| e.to_string())?;
    }

    // Close any existing overlays
    close_all_overlays(app);

    // Default to normal (non-scrolling) capture. The scroll command re-sets this
    // to true after this call; the overlay reads it once mounted (much later).
    if let Some(state) = app.try_state::<crate::state::AppState>() {
        if let Ok(mut g) = state.scroll_mode.lock() {
            *g = false;
        }
    }

    let monitors = xcap::Monitor::all().map_err(|e| e.to_string())?;
    if monitors.is_empty() {
        return Err("No monitors found".to_string());
    }

    for (i, m) in monitors.iter().enumerate() {
        let label = format!("overlay-{i}");
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

    Ok(())
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
        .title("SnapNote — Settings")
        .inner_size(560.0, 640.0)
        .min_inner_size(480.0, 480.0)
        .decorations(true)
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
        .title("SnapNote — Recorder")
        .inner_size(540.0, 210.0)
        .resizable(false)
        .always_on_top(true)
        .decorations(true)
        .center()
        .focused(true)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Opens the annotation editor window.
/// If an editor window is already open, brings it to the front.
pub fn open_editor(app: &AppHandle) -> Result<(), String> {
    // Close existing editor first (avoids stale images)
    if let Some(existing) = app.get_webview_window("editor") {
        let _ = existing.close();
    }

    let editor = WebviewWindowBuilder::new(app, "editor", WebviewUrl::App("/".into()))
        .title("SnapNote")
        .inner_size(1100.0, 700.0)
        .min_inner_size(800.0, 500.0)
        .decorations(true)
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
