use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Manager};

use crate::state::AppState;

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

/// Scrolling-capture tuning. Defaults match the previous hardcoded behavior.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct ScrollSettings {
    /// Milliseconds to wait after each scroll step before capturing, so
    /// the page has time to finish rendering. Slow/animated pages may need
    /// more; fast static pages can use less.
    pub settle_ms: u64,
    /// Crop the right-edge scrollbar strip from the stitched output. The
    /// scrollbar thumb moves every step, so leaving it in shows a hard
    /// discontinuity at each join. Not exposed in the Settings UI.
    pub crop_scrollbar: bool,
}

impl Default for ScrollSettings {
    fn default() -> Self {
        Self {
            settle_ms: 350,
            crop_scrollbar: true,
        }
    }
}

/// Last-used Fixed Capture window selection, so it's remembered across
/// restarts (`FixedCapture.tsx`). Not itself a live constraint — that's
/// `AppState.fixed_region`, set fresh each time "Capture" is pressed.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct FixedCaptureSettings {
    /// "ratio" (lock w:h proportions) or "size" (lock exact pixel dimensions).
    pub kind: String,
    pub w: u32,
    pub h: u32,
}

impl Default for FixedCaptureSettings {
    fn default() -> Self {
        Self {
            kind: "ratio".into(),
            w: 16,
            h: 9,
        }
    }
}

/// The default accelerators, also the fallback whenever a stored one won't parse
/// or fails validation. Named so `settings.rs` and `shortcuts::resolve` agree.
pub const DEFAULT_CAPTURE_SHORTCUT: &str = "PrintScreen";
pub const DEFAULT_QUICK_MENU_SHORTCUT: &str = "Ctrl+PrintScreen";

/// The two global shortcuts, in the `Ctrl+Alt+Shift+Key` text form parsed by
/// `crate::shortcuts::Accel`. Only these two exist — everything else Clipse can
/// do is reached from the quick menu rather than a hotkey of its own.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(default)]
pub struct ShortcutSettings {
    /// Opens the region-select overlay.
    pub capture: String,
    /// Opens the quick action menu at the cursor.
    pub quick_menu: String,
}

impl Default for ShortcutSettings {
    fn default() -> Self {
        Self {
            capture: DEFAULT_CAPTURE_SHORTCUT.into(),
            quick_menu: DEFAULT_QUICK_MENU_SHORTCUT.into(),
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
    /// Filename pattern. Tokens: {ts} (unix secs), {date} (YYMMDD), {time} (HHMMSS).
    pub filename_pattern: String,
    /// Output format for saved images: "png" | "jpeg".
    pub output_format: String,
    /// JPEG quality 1..=100 (ignored for png).
    pub jpeg_quality: u8,
    /// Open the annotation editor immediately after each capture (legacy
    /// behavior). When off (default), a click-to-edit toast is shown on the
    /// captured monitor instead. The clipboard copy always happens either way.
    pub open_editor_after_capture: bool,
    /// Include the mouse cursor in captures.
    pub capture_cursor: bool,
    /// Launch the app on OS startup.
    pub launch_on_startup: bool,
    /// Set once the first-run welcome (gallery shown on first launch) has
    /// happened, so it doesn't reappear on every subsequent start.
    pub onboarded: bool,
    /// UI language for prose/explanatory text ("en" | "ja"). Button captions,
    /// labels, and section titles stay in English regardless of this setting.
    pub language: String,
    /// Screen-recording settings.
    pub recording: RecordingSettings,
    /// Scrolling-capture settings.
    pub scroll: ScrollSettings,
    /// Last-used Fixed Capture window selection.
    pub fixed_capture: FixedCaptureSettings,
    /// The two global shortcuts.
    pub shortcuts: ShortcutSettings,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            save_dir: None,
            filename_pattern: "clipse_{date}{time}".into(),
            output_format: "png".into(),
            jpeg_quality: 90,
            open_editor_after_capture: false,
            capture_cursor: false,
            launch_on_startup: false,
            onboarded: false,
            language: "ja".into(),
            recording: RecordingSettings::default(),
            scroll: ScrollSettings::default(),
            fixed_capture: FixedCaptureSettings::default(),
            shortcuts: ShortcutSettings::default(),
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

/// The `filename_pattern` default shipped before the 2026-07 switch to a
/// 2-digit year with no separator. A `settings.json` already on disk has this
/// literal string saved (not just "absent, so fall back to the Rust default"),
/// so changing `AppSettings::default()` alone never reaches existing installs —
/// `load()` migrates it below, but only for users still on the untouched
/// previous default (anyone who customized the pattern is left alone).
const LEGACY_DEFAULT_FILENAME_PATTERN: &str = "clipse_{date}_{time}";

/// Loads settings from disk, falling back to defaults on any error.
pub fn load(app: &AppHandle) -> AppSettings {
    let path = match settings_path(app) {
        Ok(p) => p,
        Err(_) => return AppSettings::default(),
    };
    let mut settings: AppSettings = match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => return AppSettings::default(),
    };
    if settings.filename_pattern == LEGACY_DEFAULT_FILENAME_PATTERN {
        settings.filename_pattern = AppSettings::default().filename_pattern;
    }
    settings
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

/// Opens the settings window (or focuses it if already open).
#[command]
pub async fn open_settings(app: AppHandle) -> Result<(), String> {
    crate::window::open_settings(&app)
}

/// Opens the About window (or focuses it if already open).
#[command]
pub async fn open_about(app: AppHandle) -> Result<(), String> {
    crate::window::open_about(&app)
}

/// Returns the app's version string (from `tauri.conf.json`/`Cargo.toml`),
/// for display on the About page.
#[command]
pub async fn get_app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

/// Suspends global-shortcut handling while Settings listens for a new key
/// combination, and resumes it afterwards.
///
/// Required, not a nicety: a bound keystroke is swallowed by the hook before any
/// webview sees it, so without this the recorder could never capture PrintScreen
/// — the default binding, and the one users are most likely to re-enter.
/// Resuming is the frontend's job (a `finally`, plus the window's own unload),
/// but a missed resume is recoverable by reopening Settings.
#[command]
pub async fn set_shortcut_recording(_app: AppHandle, recording: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    crate::hook_win::suspend(recording);
    let _ = recording;
    Ok(())
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

    // Re-arm the global hotkeys if they changed. Cheap and idempotent, but
    // gated anyway: applying tears down and re-registers the `RegisterHotKey`
    // fallback, which can transiently lose the key to another process.
    #[cfg(target_os = "windows")]
    if previous.shortcuts != settings.shortcuts {
        crate::hook_win::apply_shortcuts(&settings.shortcuts);
    }

    // Apply autostart changes if they differ.
    let mut settings = settings;
    if previous.launch_on_startup != settings.launch_on_startup {
        settings.launch_on_startup = apply_autostart(&app, settings.launch_on_startup);
        // The value can come back changed — inside an MSIX package the user may
        // have switched the entry off in Task Manager, which we cannot override.
        // Persist and return what actually happened, so the toggle in Settings
        // reflects reality rather than the request.
        if settings.launch_on_startup != previous.launch_on_startup
            || settings.launch_on_startup != current(&app).launch_on_startup
        {
            if let Ok(mut guard) = app.state::<AppState>().settings.lock() {
                guard.launch_on_startup = settings.launch_on_startup;
            }
            persist(&app, &settings)?;
        }
    }

    Ok(settings)
}

/// Turns "launch on startup" on or off by whichever mechanism this build is
/// running under, and reports what the setting actually ended up as.
///
/// Two mechanisms, chosen at runtime rather than compile time because one binary
/// ships both ways: an MSIX package drives its manifest-declared StartupTask,
/// anything else writes the registry Run key via `tauri-plugin-autostart`. See
/// `startup_win` for why the registry one cannot work inside a package.
fn apply_autostart(app: &AppHandle, enable: bool) -> bool {
    #[cfg(target_os = "windows")]
    if crate::startup_win::is_packaged() {
        return crate::startup_win::set_enabled(enable) && enable;
    }

    use tauri_plugin_autostart::ManagerExt;
    let mgr = app.autolaunch();
    let res = if enable { mgr.enable() } else { mgr.disable() };
    if let Err(e) = res {
        eprintln!("[settings] autostart toggle failed: {e}");
        crate::diag::log(&format!("startup: autostart toggle failed: {e}"));
        // Keep the previous value rather than claim a change that didn't happen.
        return !enable;
    }
    enable
}
