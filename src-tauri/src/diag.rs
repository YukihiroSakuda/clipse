//! Minimal file diagnostics for field reports (release builds included).
//!
//! Capture problems reported from user machines — VDI/display-topology issues
//! especially — are impossible to confirm from a debug build's `eprintln!`
//! output, which users never see. This logs the handful of load-bearing
//! decisions (monitor enumeration at capture time, overlay-pool path taken,
//! DXGI invalidation/kill-switch events) to `clipse.log` in the app data dir,
//! so an affected user can just send that file.
//!
//! Deliberately scoped to geometry and code-path decisions only — no window
//! titles, no image data — so the log is safe to hand over from corporate
//! machines.

use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;

use parking_lot::Mutex;

static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();
static LOG_LOCK: Mutex<()> = Mutex::new(());

/// Rotation threshold: one PrintScreen writes a couple of short lines, so 1 MB
/// is months of heavy use; the single `.1` backup bounds total disk use at ~2 MB.
const MAX_LOG_BYTES: u64 = 1_000_000;

/// Resolves the log file path once at startup. Before this runs (or if the app
/// data dir is unavailable), `log` falls back to stderr — never a hard error.
pub fn init(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&dir);
        let _ = LOG_PATH.set(dir.join("clipse.log"));
    }
}

/// Appends one timestamped line to the diagnostics log, rotating to
/// `clipse.log.1` when the file exceeds `MAX_LOG_BYTES`. Best-effort: any I/O
/// failure is swallowed — diagnostics must never break the capture path.
pub fn log(msg: &str) {
    #[cfg(debug_assertions)]
    eprintln!("[diag] {msg}");

    let Some(path) = LOG_PATH.get() else { return };
    let _guard = LOG_LOCK.lock();
    if std::fs::metadata(path).map(|m| m.len() > MAX_LOG_BYTES).unwrap_or(false) {
        let _ = std::fs::rename(path, path.with_extension("log.1"));
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let _ = writeln!(f, "[{ts}] {msg}");
    }
}
