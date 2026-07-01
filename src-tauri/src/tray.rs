//! System-tray icon and menu — keeps Clipse resident like Screenpresso.
//! Left-click opens the gallery; the menu exposes capture actions and Quit.

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

use crate::{commands, state::AppState, window};

/// Shows the gallery panel without a specific tray position (e.g. from menu).
fn show_main(app: &AppHandle) {
    window::show_panel(app, None);
}

/// Builds the tray icon and attaches its menu + click handlers.
pub fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let capture = MenuItem::with_id(app, "capture", "Take Screenshot", true, None::<&str>)?;
    let scroll =
        MenuItem::with_id(app, "cap_scroll", "Scrolling Capture", true, None::<&str>)?;
    let record = MenuItem::with_id(app, "record", "Record Screen", true, None::<&str>)?;
    let gallery = MenuItem::with_id(app, "gallery", "Open Gallery", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;

    // Stashed so record.rs can flip its label to "Stop Recording" while active.
    if let Ok(mut guard) = app.state::<AppState>().record_menu_item.lock() {
        *guard = Some(record.clone());
    }

    let menu = Menu::with_items(
        app,
        &[
            &capture,
            &scroll,
            &record,
            &sep1,
            &gallery,
            &settings,
            &sep2,
            &quit,
        ],
    )?;

    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().expect("default window icon").clone())
        .tooltip("Clipse — PrintScreen to capture")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "capture" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = window::open_overlay(&app) {
                        eprintln!("[tray] overlay error: {e}");
                    }
                });
            }
            "cap_scroll" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = commands::capture::open_region_overlay_scroll(app).await {
                        eprintln!("[tray] scroll overlay error: {e}");
                    }
                });
            }
            "record" => {
                // While a recording is in progress, the recorder window is hidden
                // (so its own UI doesn't show up in the capture) — this menu item
                // is the one always-reachable way to stop it. Otherwise, open the
                // recorder window to start a new one.
                if !commands::record::hotkey_stop_if_recording(app) {
                    if let Err(e) = window::open_recorder(app) {
                        eprintln!("[tray] recorder error: {e}");
                    }
                }
            }
            "gallery" => show_main(app),
            "settings" => {
                if let Err(e) = window::open_settings(app) {
                    eprintln!("[tray] settings error: {e}");
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                position,
                ..
            } = event
            {
                window::show_panel(tray.app_handle(), Some((position.x, position.y)));
            }
        })
        .build(app)?;

    Ok(())
}
