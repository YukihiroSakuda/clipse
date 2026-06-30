//! Screen-recording commands. The heavy lifting lives in `record_win` (Windows
//! only); these commands resolve the output path from settings and bridge to it.

use serde::Serialize;
use tauri::{command, AppHandle};

#[derive(Serialize)]
pub struct RecordingMonitorInfo {
    pub index: usize,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub is_primary: bool,
}

#[cfg(target_os = "windows")]
fn monitor_position(raw_hmonitor: *mut std::ffi::c_void) -> (i32, i32) {
    use std::mem;
    use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, HMONITOR, MONITORINFO};
    let mut info = MONITORINFO {
        cbSize: mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    unsafe { let _ = GetMonitorInfoW(HMONITOR(raw_hmonitor), &mut info); }
    (info.rcMonitor.left, info.rcMonitor.top)
}

/// Returns all connected monitors with 1-based indexes suitable for start_recording.
#[command]
pub async fn list_recording_monitors() -> Result<Vec<RecordingMonitorInfo>, String> {
    #[cfg(target_os = "windows")]
    {
        use windows_capture::monitor::Monitor;
        let monitors = Monitor::enumerate().map_err(|e| e.to_string())?;
        let primary = Monitor::primary().ok();
        monitors
            .iter()
            .enumerate()
            .map(|(i, m)| {
                let (x, y) = monitor_position(m.as_raw_hmonitor());
                Ok(RecordingMonitorInfo {
                    index: i + 1,
                    name: m.name().unwrap_or_else(|_| format!("Display {}", i + 1)),
                    width: m.width().map_err(|e| e.to_string())?,
                    height: m.height().map_err(|e| e.to_string())?,
                    x,
                    y,
                    is_primary: primary.map(|p| p == *m).unwrap_or(i == 0),
                })
            })
            .collect()
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(vec![])
    }
}

/// Starts recording the specified monitor. `format` is "mp4" or "gif".
/// `monitor_index` is 1-based (matches list_recording_monitors); 0 or None means primary.
#[command]
pub async fn start_recording(
    app: AppHandle,
    format: String,
    monitor_index: Option<usize>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use crate::record_win::{RecordFlags, RecordMode};

        let s = crate::settings::current(&app);
        let mode = if format == "gif" {
            RecordMode::Gif
        } else {
            RecordMode::Mp4
        };
        let ext = if matches!(mode, RecordMode::Gif) { "gif" } else { "mp4" };
        let dir = crate::commands::storage::captures_dir(&app)?;
        let name = crate::commands::storage::format_filename(&s.filename_pattern, ext);
        let path = dir.join(&name);

        // For MP4, pre-compute a thumbnail path so the recorder can save
        // the first captured frame there for gallery display.
        let thumb_path = if matches!(mode, RecordMode::Mp4) {
            let cache_dir = crate::commands::storage::thumb_cache_dir(&app)?;
            let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("record").to_string();
            Some(cache_dir.join(format!("{}_thumb.png", stem)))
        } else {
            None
        };

        crate::record_win::start(RecordFlags {
            mode,
            path,
            thumb_path,
            mp4_fps: s.recording.mp4_fps,
            gif_fps: s.recording.gif_fps,
            gif_max_width: s.recording.gif_max_width,
            monitor_index: monitor_index.unwrap_or(0),
        })
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, format);
        Err("Recording is Windows-only".into())
    }
}

/// Stops recording, finalizes the file, and returns the saved path.
#[command]
pub async fn stop_recording(app: AppHandle) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use tauri::Emitter;
        let (path, _format) = crate::record_win::stop()?;
        let _ = app.emit("capture-saved", ());
        Ok(path.to_string_lossy().to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err("Recording is Windows-only".into())
    }
}

/// Opens the small recorder control window (format/monitor picker + record button).
#[command]
pub async fn open_recorder(app: AppHandle) -> Result<(), String> {
    crate::window::open_recorder(&app)
}

/// Returns whether a recording is currently in progress.
#[command]
pub async fn is_recording() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        Ok(crate::record_win::is_recording())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(false)
    }
}

/// Called from the capture hotkeys (region/window/fullscreen + PrintScreen).
/// If a recording is in progress, stops it instead of taking a screenshot and
/// returns `true` so the caller skips the normal capture action. The recorder
/// window (if open) and the gallery learn about it via the `recording-stopped`
/// event, since the hotkey path bypasses their own stop button.
#[cfg(target_os = "windows")]
pub fn hotkey_stop_if_recording(app: &AppHandle) -> bool {
    if !crate::record_win::is_recording() {
        return false;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        use tauri::Emitter;
        match crate::record_win::stop() {
            Ok((path, _format)) => {
                let path_str = path.to_string_lossy().to_string();
                let _ = app.emit("capture-saved", ());
                let _ = app.emit("recording-stopped", path_str);
            }
            Err(e) => eprintln!("[hotkey] stop_recording error: {e}"),
        }
    });
    true
}

#[cfg(not(target_os = "windows"))]
pub fn hotkey_stop_if_recording(_app: &AppHandle) -> bool {
    false
}
