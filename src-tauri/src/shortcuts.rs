//! Global capture hotkeys. Each accelerator is registered with its own handler
//! via `on_shortcut`, so custom user accelerators can be re-registered at runtime
//! without a central match on key codes.
//!
//! PrintScreen is handled separately by the low-level keyboard hook (hook_win.rs).

use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::settings::Hotkeys;
use crate::{commands, window};

/// One of the three capture actions a hotkey can trigger.
#[derive(Clone, Copy)]
enum Action {
    Region,
    Window,
    Fullscreen,
}

fn run_action(app: &AppHandle, action: Action) {
    // While a recording is in progress, the capture hotkeys stop it instead
    // of taking a screenshot (the recorder window may be hidden).
    if commands::record::hotkey_stop_if_recording(app) {
        return;
    }
    let app = app.clone();
    match action {
        Action::Region => {
            tauri::async_runtime::spawn(async move {
                if let Err(e) = window::open_overlay(&app) {
                    eprintln!("[hotkey] overlay error: {e}");
                }
            });
        }
        Action::Window => {
            tauri::async_runtime::spawn(async move {
                if let Err(e) = commands::capture::do_window_capture(app).await {
                    eprintln!("[hotkey] window capture error: {e}");
                }
            });
        }
        Action::Fullscreen => {
            tauri::async_runtime::spawn(async move {
                if let Err(e) = commands::capture::do_fullscreen_capture(app, None).await {
                    eprintln!("[hotkey] fullscreen error: {e}");
                }
            });
        }
    }
}

fn register_one(app: &AppHandle, accel: &str, action: Action) -> Result<(), String> {
    if accel.is_empty() {
        return Ok(());
    }
    app.global_shortcut()
        .on_shortcut(accel, move |app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                run_action(app, action);
            }
        })
        .map_err(|e| format!("register '{accel}': {e}"))
}

/// Registers all three capture hotkeys. Errors for individual accelerators are
/// logged but not fatal (e.g. another app already holds the key).
pub fn register_all(app: &AppHandle, hk: &Hotkeys) {
    for (accel, action) in [
        (&hk.region, Action::Region),
        (&hk.window, Action::Window),
        (&hk.fullscreen, Action::Fullscreen),
    ] {
        if let Err(e) = register_one(app, accel, action) {
            eprintln!("[hotkey] {e}");
        }
    }
}

/// Unregisters the old accelerators and registers the new ones. Used when the
/// user changes hotkeys in settings.
pub fn reregister(app: &AppHandle, old: &Hotkeys, new: &Hotkeys) -> Result<(), String> {
    let gs = app.global_shortcut();
    for accel in [&old.region, &old.window, &old.fullscreen] {
        if !accel.is_empty() {
            let _ = gs.unregister(accel.as_str());
        }
    }
    register_all(app, new);
    Ok(())
}
