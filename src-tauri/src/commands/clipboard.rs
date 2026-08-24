use tauri::{command, Manager};

/// One copy of annotations, ready to be pasted into any editor window.
#[derive(serde::Serialize)]
pub struct AnnotationClipboard {
    /// Bumped on every copy. A pasting window compares this against the seq it
    /// last pasted from: a change means "different payload", which restarts the
    /// cascading paste offset instead of continuing to walk away from the
    /// original position.
    pub seq: u64,
    /// The payload itself — `{ version, annotations }`, serialized by the editor
    /// that copied it. Deliberately opaque here: annotation shapes are a
    /// frontend concern, and the backend only has to hand the same bytes back.
    pub json: String,
    /// True when the *system* clipboard has been written since these
    /// annotations were copied — i.e. whatever is on it now is the more recent
    /// of the two, so a paste should prefer a picture from there over this
    /// payload. See `AnnotationCopy::os_seq`.
    pub superseded: bool,
}

/// The OS clipboard's current sequence number — bumped by the system on every
/// write, by any process. Reading it costs nothing and, unlike opening the
/// clipboard, can't fail or contend with whatever else is reading it.
#[cfg(target_os = "windows")]
fn os_clipboard_seq() -> u64 {
    use windows::Win32::System::DataExchange::GetClipboardSequenceNumber;
    unsafe { GetClipboardSequenceNumber() as u64 }
}

/// No such counter outside Windows, so every comparison against it comes out
/// equal and `AnnotationClipboard::superseded` is always false — paste then
/// simply prefers the annotation payload, as it did before.
#[cfg(not(target_os = "windows"))]
fn os_clipboard_seq() -> u64 {
    0
}

/// Stores annotations copied in one editor window so *any* editor window can
/// paste them. This is a Clipse-internal clipboard, not the system one: each
/// editor is its own webview with its own store, so an in-page clipboard could
/// never reach a sibling window — and putting annotation JSON on the system
/// clipboard would clobber whatever the user actually had there (and paste as
/// gibberish into other apps).
#[command]
pub async fn set_annotation_clipboard(json: String, app: tauri::AppHandle) -> Result<u64, String> {
    let state = app.state::<crate::state::AppState>();
    let mut guard = state
        .annotation_clipboard
        .lock()
        .map_err(|e| e.to_string())?;
    let seq = guard.as_ref().map(|c| c.seq + 1).unwrap_or(1);
    *guard = Some(crate::state::AnnotationCopy { seq, json, os_seq: os_clipboard_seq() });
    Ok(seq)
}

/// Returns the current annotation clipboard, or `None` if nothing was copied
/// this session.
#[command]
pub async fn get_annotation_clipboard(
    app: tauri::AppHandle,
) -> Result<Option<AnnotationClipboard>, String> {
    let state = app.state::<crate::state::AppState>();
    let guard = state
        .annotation_clipboard
        .lock()
        .map_err(|e| e.to_string())?;
    let os_seq = os_clipboard_seq();
    Ok(guard.as_ref().map(|c| AnnotationClipboard {
        seq: c.seq,
        json: c.json.clone(),
        superseded: os_seq != c.os_seq,
    }))
}

/// Decodes raw image bytes and writes them to the system clipboard as an image.
/// Also called directly from the capture pipeline (`finish_capture_flow`) so
/// auto-copy never round-trips through base64.
pub(crate) fn write_image_bytes_to_clipboard(bytes: &[u8], app: &tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;

    let img = image::load_from_memory(bytes).map_err(|e| e.to_string())?;
    let rgba = img.to_rgba8();
    let (width, height) = (rgba.width(), rgba.height());

    let clip_img = tauri::image::Image::new_owned(rgba.into_raw(), width, height);
    app.clipboard()
        .write_image(&clip_img)
        .map_err(|e| e.to_string())
}

/// Reads a picture off the system clipboard and returns it as PNG bytes, in a
/// raw binary IPC response (no base64 — a pasted 4K screenshot would otherwise
/// cost a third more bytes and a JSON string on both sides). An empty response
/// means "the clipboard holds no image", which is an ordinary outcome of
/// Ctrl+V, not an error: arboard reports every no-picture case (text on the
/// clipboard, an empty clipboard, a format it can't decode) the same way.
///
/// The clipboard hands back raw RGBA, so the re-encode here is what makes the
/// result something the editor can put in an `<img>`/`Image` at all.
#[command]
pub async fn read_clipboard_image(app: tauri::AppHandle) -> Result<tauri::ipc::Response, String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;

    let Ok(img) = app.clipboard().read_image() else {
        return Ok(tauri::ipc::Response::new(Vec::new()));
    };
    let (w, h) = (img.width(), img.height());
    let Some(buf) = image::RgbaImage::from_raw(w, h, img.rgba().to_vec()) else {
        return Err("clipboard image had an unexpected buffer size".into());
    };
    let png = super::capture::dynamic_to_png_bytes(image::DynamicImage::ImageRgba8(buf))?;
    Ok(tauri::ipc::Response::new(png))
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

/// Writes PNG bytes received as a raw binary IPC body to the clipboard.
/// Skips the base64/JSON round-trip of `copy_image_to_clipboard`, which
/// matters for large exports (4K captures, tall scrolling stitches).
#[command]
pub fn copy_image_bytes_to_clipboard(
    request: tauri::ipc::Request<'_>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected a raw binary body".into());
    };
    write_image_bytes_to_clipboard(bytes, &app)
}

/// Reads a saved capture file from disk and writes the image to the clipboard.
#[command]
pub async fn copy_capture_to_clipboard(path: String, app: tauri::AppHandle) -> Result<(), String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    write_image_bytes_to_clipboard(&bytes, &app)
}

/// Places a file itself on the clipboard (CF_HDROP), so it can be pasted as a
/// file into Explorer, chat apps, etc. Used for recordings (MP4/GIF), which
/// can't go on the clipboard as an image.
#[cfg(target_os = "windows")]
#[command]
pub async fn copy_file_to_clipboard(path: String) -> Result<(), String> {
    use std::mem::size_of;
    use windows::Win32::Foundation::{HANDLE, HGLOBAL, HWND};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
    };
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    use windows::Win32::System::Ole::CF_HDROP;
    use windows::Win32::UI::Shell::DROPFILES;

    // The CF_HDROP file list is a set of NUL-terminated wide paths ended by an
    // extra NUL — here a single path, so two trailing NULs.
    let mut wide: Vec<u16> = path.encode_utf16().collect();
    wide.push(0);
    wide.push(0);

    let header = size_of::<DROPFILES>();
    let total = header + wide.len() * 2;

    unsafe {
        let hglobal: HGLOBAL = GlobalAlloc(GMEM_MOVEABLE, total).map_err(|e| e.to_string())?;
        let ptr = GlobalLock(hglobal);
        if ptr.is_null() {
            return Err("GlobalLock failed".into());
        }
        let df = ptr as *mut DROPFILES;
        (*df).pFiles = header as u32;
        (*df).pt = Default::default();
        (*df).fNC = false.into();
        (*df).fWide = true.into();
        let files = (ptr as *mut u8).add(header) as *mut u16;
        std::ptr::copy_nonoverlapping(wide.as_ptr(), files, wide.len());
        let _ = GlobalUnlock(hglobal);

        OpenClipboard(HWND::default()).map_err(|e| e.to_string())?;
        let res = (|| -> Result<(), String> {
            EmptyClipboard().map_err(|e| e.to_string())?;
            // On success the system owns the memory, so it must not be freed here.
            SetClipboardData(CF_HDROP.0 as u32, HANDLE(hglobal.0)).map_err(|e| e.to_string())?;
            Ok(())
        })();
        let _ = CloseClipboard();
        res?;
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
#[command]
pub async fn copy_file_to_clipboard(_path: String) -> Result<(), String> {
    Err("Copying files to the clipboard is Windows-only".into())
}
