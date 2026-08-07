//! The app's shared action list — the things a menu can ask Clipse to do.
//!
//! Two surfaces present this same list: the tray menu (`tray.rs`) and the quick
//! menu (`QuickMenu.tsx`, opened by Ctrl+PrintScreen). Keeping the bodies here
//! instead of inline in each menu's event handler means a new action is wired up
//! once rather than once per surface, so the two lists cannot drift apart.

use tauri::{command, AppHandle};

/// One entry of the shared action list.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum QuickAction {
    Capture,
    Repeat,
    /// Instant capture of the monitor under the cursor. Used to be
    /// Ctrl+PrintScreen's own action; now that the key opens this menu it lives
    /// here instead. Note that the property that motivated it — an open
    /// right-click context menu surviving into the capture, because nothing was
    /// activated first — is gone: this menu takes focus to read the arrow keys,
    /// which dismisses such a menu before the action ever runs.
    CursorMonitor,
    AllMonitors,
    Scroll,
    Fixed,
    Record,
    Gallery,
    Settings,
}

impl QuickAction {
    /// Parses the stable string id shared by both menus — tray `MenuItem` ids
    /// and the `quick_menu_run` IPC argument are the same strings on purpose, so
    /// the two surfaces can never disagree about what an id means.
    pub fn from_id(id: &str) -> Option<Self> {
        Some(match id {
            "capture" => Self::Capture,
            "cap_repeat" => Self::Repeat,
            "cap_cursor" => Self::CursorMonitor,
            "cap_all" => Self::AllMonitors,
            "cap_scroll" => Self::Scroll,
            "cap_fixed" => Self::Fixed,
            "record" => Self::Record,
            "gallery" => Self::Gallery,
            "settings" => Self::Settings,
            _ => return None,
        })
    }

    /// Short name for `clipse.log`.
    pub fn id(self) -> &'static str {
        match self {
            Self::Capture => "capture",
            Self::Repeat => "cap_repeat",
            Self::CursorMonitor => "cap_cursor",
            Self::AllMonitors => "cap_all",
            Self::Scroll => "cap_scroll",
            Self::Fixed => "cap_fixed",
            Self::Record => "record",
            Self::Gallery => "gallery",
            Self::Settings => "settings",
        }
    }
}

/// Runs an action. Callers are responsible for clearing away whatever UI the
/// user went through to get here *before* awaiting this — every capture arm
/// below snapshots the desktop, and a menu still on screen would be in it.
pub async fn run(app: AppHandle, action: QuickAction) -> Result<(), String> {
    match action {
        QuickAction::Capture => crate::window::open_overlay(&app),
        QuickAction::Repeat => super::capture::do_repeat_region_capture(app).await,
        QuickAction::CursorMonitor => super::capture::do_cursor_monitor_capture(app).await,
        QuickAction::AllMonitors => super::capture::do_virtual_desktop_capture(app).await,
        QuickAction::Scroll => super::capture::open_region_overlay_scroll(app).await,
        QuickAction::Fixed => crate::window::open_fixed_capture(&app),
        QuickAction::Record => {
            // While a recording is in progress the recorder window is hidden (so
            // its own UI stays out of the recording), which makes this the
            // always-reachable way to stop it. Otherwise: open the recorder to
            // start a new one.
            if !super::record::hotkey_stop_if_recording(&app) {
                crate::window::open_recorder(&app)
            } else {
                Ok(())
            }
        }
        QuickAction::Gallery => {
            crate::window::show_panel(&app);
            Ok(())
        }
        QuickAction::Settings => crate::window::open_settings(&app),
    }
}

/// Spawns `run` on the async runtime, logging a failure rather than dropping it.
/// Both menus want this fire-and-forget shape: the click/keypress that triggered
/// an action must not wait for window creation or a capture to finish.
pub fn spawn(app: &AppHandle, action: QuickAction, via: &'static str) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = run(app, action).await {
            eprintln!("[{via}] {} failed: {e}", action.id());
            crate::diag::log(&format!("{via}: {} failed: {e}", action.id()));
        }
    });
}

// ===== Commands =====

/// Opens the quick menu (Ctrl+PrintScreen's action). Exposed as a command so the
/// focused-window fallback path (`usePrintScreenKey.ts`) can reach it too.
#[command]
pub async fn open_quick_menu(app: AppHandle) -> Result<(), String> {
    crate::window::open_quick_menu(&app)
}

/// Runs the action the user picked in the quick menu.
///
/// The menu is hidden *before* the action starts, not after: several actions
/// freeze the desktop, and although the window is excluded from capture at the
/// OS level, leaving it on screen while an overlay comes up would still look
/// like it failed to close.
#[command]
pub async fn quick_menu_run(app: AppHandle, action: String) -> Result<(), String> {
    let Some(parsed) = QuickAction::from_id(&action) else {
        return Err(format!("Unknown action: {action}"));
    };
    crate::diag::log(&format!("quickmenu: run {}", parsed.id()));
    crate::window::hide_quick_menu(&app);
    spawn(&app, parsed, "quickmenu");
    Ok(())
}

/// Dismisses the quick menu (Esc, or focus lost to another window).
#[command]
pub async fn quick_menu_close(app: AppHandle) -> Result<(), String> {
    crate::diag::log("quickmenu: cancelled");
    crate::window::hide_quick_menu(&app);
    Ok(())
}
