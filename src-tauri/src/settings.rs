use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Manager};

use crate::state::AppState;

/// User-configurable hotkeys (global-shortcut accelerator strings).
/// PrintScreen is handled by a low-level keyboard hook and is intentionally
/// not configurable here.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Hotkeys {
    pub region: String,
    pub window: String,
    pub fullscreen: String,
}

impl Default for Hotkeys {
    fn default() -> Self {
        Self {
            region: String::new(),
            window: String::new(),
            fullscreen: String::new(),
        }
    }
}

/// Screen-recording settings.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct RecordingSettings {
    /// Output format: "mp4" | "gif".
    pub format: String,
    /// Target frame rate for MP4.
    pub mp4_fps: u32,
    /// Target frame rate for GIF (kept low — GIFs are heavy).
    pub gif_fps: u32,
    /// Max GIF width in px; frames are downscaled to fit.
    pub gif_max_width: u32,
}

impl Default for RecordingSettings {
    fn default() -> Self {
        Self {
            format: "mp4".into(),
            mp4_fps: 30,
            gif_fps: 12,
            gif_max_width: 1000,
        }
    }
}

/// Persisted application settings. Stored as `settings.json` in the app data dir.
/// `#[serde(default)]` lets older/partial files load forward-compatibly.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct AppSettings {
    /// Custom save directory. Empty/None → `<app_data>/captures`.
    pub save_dir: Option<String>,
    /// Filename pattern. Tokens: {ts} (unix secs), {date} (YYYYMMDD), {time} (HHMMSS).
    pub filename_pattern: String,
    /// Output format for saved images: "png" | "jpeg".
    pub output_format: String,
    /// JPEG quality 1..=100 (ignored for png).
    pub jpeg_quality: u8,
    /// Copy the image to the clipboard automatically after each capture.
    pub auto_copy: bool,
    /// Include the mouse cursor in captures (reserved for capture pipeline use).
    pub capture_cursor: bool,
    /// Launch the app on OS startup.
    pub launch_on_startup: bool,
    /// Global capture hotkeys.
    pub hotkeys: Hotkeys,
    /// Screen-recording settings.
    pub recording: RecordingSettings,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            save_dir: None,
            filename_pattern: "clipse_{date}_{time}".into(),
            output_format: "png".into(),
            jpeg_quality: 90,
            auto_copy: false,
            capture_cursor: false,
            launch_on_startup: false,
            hotkeys: Hotkeys::default(),
            recording: RecordingSettings::default(),
        }
    }
}

impl AppSettings {
    /// Normalized output extension ("png" or "jpg").
    pub fn ext(&self) -> &'static str {
        match self.output_format.as_str() {
            "jpeg" | "jpg" => "jpg",
            _ => "png",
        }
    }
}

/// Path to the settings file (`<app_data>/settings.json`).
fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    Ok(data_dir.join("settings.json"))
}

/// Loads settings from disk, falling back to defaults on any error.
pub fn load(app: &AppHandle) -> AppSettings {
    let path = match settings_path(app) {
        Ok(p) => p,
        Err(_) => return AppSettings::default(),
    };
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => AppSettings::default(),
    }
}

/// Persists settings to disk (pretty JSON).
pub fn persist(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| e.to_string())
}

/// Returns a clone of the current in-memory settings.
pub fn current(app: &AppHandle) -> AppSettings {
    app.state::<AppState>()
        .settings
        .lock()
        .map(|g| g.clone())
        .unwrap_or_default()
}

// ===== Commands =====

#[command]
pub async fn get_settings(app: AppHandle) -> Result<AppSettings, String> {
    Ok(current(&app))
}

/// Opens a folder picker for choosing the save directory. Returns the selected
/// path, or None if cancelled.
#[command]
pub async fn pick_directory(
    app: AppHandle,
    current: Option<String>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let mut builder = app.dialog().file();
    if let Some(c) = current {
        if !c.trim().is_empty() {
            builder = builder.set_directory(c);
        }
    }
    let picked = builder.blocking_pick_folder();
    Ok(picked.and_then(|p| p.as_path().map(|p| p.to_string_lossy().to_string())))
}

/// Replaces the stored settings, persists them, and applies side effects
/// (hotkey re-registration, autostart toggle).
#[command]
pub async fn update_settings(app: AppHandle, settings: AppSettings) -> Result<AppSettings, String> {
    let previous = current(&app);

    {
        let state = app.state::<AppState>();
        let mut guard = state.settings.lock().map_err(|e| e.to_string())?;
        *guard = settings.clone();
    }
    persist(&app, &settings)?;

    // Apply hotkey changes if they differ.
    if previous.hotkeys.region != settings.hotkeys.region
        || previous.hotkeys.window != settings.hotkeys.window
        || previous.hotkeys.fullscreen != settings.hotkeys.fullscreen
    {
        crate::shortcuts::reregister(&app, &previous.hotkeys, &settings.hotkeys)?;
    }

    // Apply autostart changes if they differ.
    if previous.launch_on_startup != settings.launch_on_startup {
        use tauri_plugin_autostart::ManagerExt;
        let mgr = app.autolaunch();
        let res = if settings.launch_on_startup {
            mgr.enable()
        } else {
            mgr.disable()
        };
        if let Err(e) = res {
            eprintln!("[settings] autostart toggle failed: {e}");
        }
    }

    Ok(settings)
}
