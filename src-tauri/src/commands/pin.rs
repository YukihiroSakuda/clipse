use tauri::{command, AppHandle, Manager};

use crate::{state::AppState, window};

/// Pins PNG bytes received as a raw binary IPC body to the screen (Editor's
/// "Pin" button — the current, possibly-annotated canvas export). Mirrors
/// `commands::clipboard::copy_image_bytes_to_clipboard`'s raw-body pattern
/// to skip a base64/JSON round-trip.
///
/// The body extraction stays synchronous (`tauri::ipc::Request<'_>` borrows
/// from the invoke message, so this can't itself be an `async fn` the way
/// `pin_capture_by_path` below is) — but the actual window creation is
/// handed off to the async runtime rather than run inline here. Calling
/// `open_pin_window` directly from this synchronous command handler froze
/// the whole app (the calling window itself became undraggable) when
/// invoked from Editor: `WebviewWindowBuilder::build()` needs the OS message
/// pump to keep turning to finish WebView2's own async init, and running it
/// inline blocked whatever thread was also responsible for pumping that
/// loop. `pin_capture_by_path`, being `async fn`, never inline on that
/// thread in the first place — spawning here gets the same effect.
#[command]
pub fn pin_image_bytes(request: tauri::ipc::Request<'_>, app: AppHandle) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected a raw binary body".into());
    };
    let bytes = bytes.clone();
    tauri::async_runtime::spawn(async move {
        let _ = window::open_pin_window(&app, bytes);
    });
    Ok(())
}

/// Pins an already-saved capture file (Gallery's per-card "Pin" button).
#[command]
pub async fn pin_capture_by_path(path: String, app: AppHandle) -> Result<(), String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    window::open_pin_window(&app, bytes)
}

/// Returns the PNG bytes for the pin window labeled `label` (raw binary IPC
/// response, same pattern as `commands::capture::get_pending_image`).
#[command]
pub fn get_pinned_image(label: String, app: AppHandle) -> Result<tauri::ipc::Response, String> {
    let state = app.state::<AppState>();
    let bytes = state
        .pinned_images
        .lock()
        .map_err(|e| e.to_string())?
        .get(&label)
        .cloned()
        .unwrap_or_default();
    Ok(tauri::ipc::Response::new(bytes))
}
