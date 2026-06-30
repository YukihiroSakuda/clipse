use tauri::command;

/// Decodes raw image bytes and writes them to the system clipboard as an image.
fn write_image_bytes_to_clipboard(bytes: &[u8], app: &tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;

    let img = image::load_from_memory(bytes).map_err(|e| e.to_string())?;
    let rgba = img.to_rgba8();
    let (width, height) = (rgba.width(), rgba.height());

    let clip_img = tauri::image::Image::new_owned(rgba.into_raw(), width, height);
    app.clipboard()
        .write_image(&clip_img)
        .map_err(|e| e.to_string())
}

/// Writes a base64-encoded PNG image to the system clipboard.
#[command]
pub async fn copy_image_to_clipboard(
    image_base64: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD, Engine};

    let bytes = STANDARD.decode(&image_base64).map_err(|e| e.to_string())?;
    write_image_bytes_to_clipboard(&bytes, &app)
}

/// Reads a saved capture file from disk and writes the image to the clipboard.
#[command]
pub async fn copy_capture_to_clipboard(path: String, app: tauri::AppHandle) -> Result<(), String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    write_image_bytes_to_clipboard(&bytes, &app)
}
