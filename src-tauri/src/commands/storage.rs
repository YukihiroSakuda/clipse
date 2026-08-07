use std::io::Cursor;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{command, Emitter, Manager};

use crate::settings::{self, AppSettings};

#[derive(Serialize)]
pub struct CaptureEntry {
    pub path: String,
    pub filename: String,
    pub created_at: u64,
    pub thumbnail_base64: String,
    pub width: u32,
    pub height: u32,
    pub file_type: String, // "image" | "video"
    pub favorite: bool,
}

/// Extensions the gallery recognizes.
const IMAGE_EXTS: [&str; 5] = ["png", "jpg", "jpeg", "webp", "gif"];
const VIDEO_EXTS: [&str; 1] = ["mp4"];

/// Resolves the capture directory from settings (custom save dir) or the
/// default `<app_data>/captures`, creating it if needed.
pub(crate) fn captures_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let settings = settings::current(app);
    let dir = match settings.save_dir {
        Some(ref d) if !d.trim().is_empty() => PathBuf::from(d),
        _ => app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("captures"),
    };
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Bump to invalidate every cached thumbnail (e.g. when the render size/filter changes).
const THUMB_VERSION: u32 = 1;
const THUMB_MAX: u32 = 440; // thumbnail bounding box (px); large enough for HiDPI cards

/// Directory holding generated thumbnails, kept out of the user's capture dir so
/// it never pollutes a custom save location.
pub(crate) fn thumb_cache_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("thumbnails");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Cache filename keyed by source path + mtime + size (+ version), so any edit to
/// the source — or a thumbnail format change — produces a fresh key automatically.
fn thumb_key(path: &Path, mtime: u64, size: u64) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    THUMB_VERSION.hash(&mut h);
    path.hash(&mut h);
    mtime.hash(&mut h);
    size.hash(&mut h);
    format!("{:016x}.png", h.finish())
}

/// Deletes thumbnail cache files that no longer match a current capture (orphans
/// left behind after the source image was deleted or edited). Best-effort: any
/// error is ignored so cleanup never blocks startup. Skips pruning entirely if the
/// capture dir can't be read, to avoid wiping the cache on a transient error.
pub(crate) fn prune_thumb_cache(app: &tauri::AppHandle) {
    let (Ok(dir), Ok(cache_dir)) = (captures_dir(app), thumb_cache_dir(app)) else {
        return;
    };
    let Ok(read) = std::fs::read_dir(&dir) else {
        return;
    };

    // Cache filenames still referenced by existing captures.
    let mut valid: std::collections::HashSet<String> = std::collections::HashSet::new();
    for entry in read.flatten() {
        let path = entry.path();
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();
        if IMAGE_EXTS.contains(&ext.as_str()) {
            if let Ok(meta) = entry.metadata() {
                let modified = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                valid.insert(thumb_key(&path, modified, meta.len()));
            }
        } else if VIDEO_EXTS.contains(&ext.as_str()) {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                valid.insert(format!("{}_thumb.png", stem));
            }
        }
    }

    // Remove every cache file not in the valid set.
    if let Ok(cache_read) = std::fs::read_dir(&cache_dir) {
        for entry in cache_read.flatten() {
            let name = entry.file_name();
            if !valid.contains(name.to_string_lossy().as_ref()) {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
}

/// Expands filename tokens ({ts}, {date}, {time}) and appends the extension.
pub(crate) fn format_filename(pattern: &str, ext: &str) -> String {
    use chrono::Local;
    let now = Local::now();
    let base = pattern
        .replace("{ts}", &now.timestamp().to_string())
        .replace("{date}", &now.format("%y%m%d").to_string())
        .replace("{time}", &now.format("%H%M%S").to_string());
    let base = if base.trim().is_empty() {
        format!("clipse_{}", now.timestamp())
    } else {
        base
    };
    format!("{base}.{ext}")
}

/// Ensures the path is unique within its directory by appending _1, _2, ... if needed.
fn unique_path(dir: &Path, filename: &str) -> PathBuf {
    let candidate = dir.join(filename);
    if !candidate.exists() {
        return candidate;
    }
    let stem = Path::new(filename)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "clipse".into());
    let ext = Path::new(filename)
        .extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_else(|| "png".into());
    for i in 1.. {
        let p = dir.join(format!("{stem}_{i}.{ext}"));
        if !p.exists() {
            return p;
        }
    }
    unreachable!()
}

/// Re-encodes raw PNG bytes to the target extension. PNG passes through
/// borrowed (no copy); jpg re-encodes (dropping alpha) at the given quality.
fn encode_bytes_for_ext<'a>(
    raw: &'a [u8],
    ext: &str,
    jpeg_quality: u8,
) -> Result<std::borrow::Cow<'a, [u8]>, String> {
    match ext {
        "jpg" | "jpeg" => {
            let img = image::load_from_memory(raw).map_err(|e| e.to_string())?;
            let mut buf = Vec::new();
            let mut cursor = Cursor::new(&mut buf);
            let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(
                &mut cursor,
                jpeg_quality.clamp(1, 100),
            );
            enc.encode_image(&img.to_rgb8())
                .map_err(|e| e.to_string())?;
            drop(enc);
            drop(cursor);
            Ok(std::borrow::Cow::Owned(buf))
        }
        _ => Ok(std::borrow::Cow::Borrowed(raw)),
    }
}

/// Decodes an incoming base64 PNG and re-encodes it to the target extension.
fn encode_for_ext(b64_png: &str, ext: &str, jpeg_quality: u8) -> Result<Vec<u8>, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let raw = STANDARD.decode(b64_png).map_err(|e| e.to_string())?;
    Ok(encode_bytes_for_ext(&raw, ext, jpeg_quality)?.into_owned())
}

/// Opens the captures directory in the system file explorer.
#[command]
pub fn open_captures_folder(app: tauri::AppHandle) -> Result<(), String> {
    let dir = captures_dir(&app)?;
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer")
        .arg(&dir)
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "windows"))]
    std::process::Command::new("open")
        .arg(&dir)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Auto-saves raw PNG bytes to the captures directory using the configured
/// format and filename pattern. Returns the saved file path. This is the
/// capture pipeline's save path (`finish_capture_flow`) — no base64 involved.
pub(crate) fn auto_save_png(app: &tauri::AppHandle, png: &[u8]) -> Result<String, String> {
    let settings = settings::current(app);
    let ext = settings.ext();
    let dir = captures_dir(app)?;

    let filename = format_filename(&settings.filename_pattern, ext);
    let path = unique_path(&dir, &filename);

    let bytes = encode_bytes_for_ext(png, ext, settings.jpeg_quality)?;
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

/// Opens a save dialog and writes the image to the chosen path, encoding to the
/// extension the user picks. Returns the saved file path.
#[command]
pub async fn save_image(
    image_base64: String,
    suggested_name: Option<String>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;

    let settings = settings::current(&app);
    let default_ext = settings.ext();
    let name = suggested_name
        .unwrap_or_else(|| format_filename(&settings.filename_pattern, default_ext));

    let path = app
        .dialog()
        .file()
        .set_file_name(&name)
        .add_filter("PNG Image", &["png"])
        .add_filter("JPEG Image", &["jpg", "jpeg"])
        .blocking_save_file()
        .ok_or_else(|| "Save cancelled".to_string())?;

    let save_path = path.as_path().ok_or("Invalid path")?.to_path_buf();
    let ext = save_path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_else(|| default_ext.to_string());
    let bytes = encode_for_ext(&image_base64, &ext, settings.jpeg_quality)?;
    std::fs::write(&save_path, &bytes).map_err(|e| e.to_string())?;
    Ok(save_path.to_string_lossy().to_string())
}

/// Lists all captures in the auto-save directory, sorted newest-first.
#[command]
pub async fn list_captures(app: tauri::AppHandle) -> Result<Vec<CaptureEntry>, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};

    let dir = captures_dir(&app)?;
    let cache_dir = thumb_cache_dir(&app)?;
    let favorites = load_favorites(&dir);
    let mut entries: Vec<CaptureEntry> = Vec::new();

    let read = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in read.flatten() {
        let path = entry.path();
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();
        let is_image = IMAGE_EXTS.contains(&ext.as_str());
        let is_video = VIDEO_EXTS.contains(&ext.as_str());
        if !is_image && !is_video {
            continue;
        }

        let meta = entry.metadata().map_err(|e| e.to_string())?;
        let created_at = meta
            .created()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let favorite = favorites.contains(&path.to_string_lossy().to_string());

        let capture_entry = if is_image {
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            let (width, height) = match image::image_dimensions(&path) {
                Ok(d) => d,
                Err(_) => continue,
            };

            let cache_path = cache_dir.join(thumb_key(&path, modified, meta.len()));
            let thumb_bytes = match std::fs::read(&cache_path) {
                Ok(b) => b,
                Err(_) => {
                    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
                    let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;
                    let thumb = img.resize(THUMB_MAX, THUMB_MAX, image::imageops::FilterType::Lanczos3);
                    let mut buf = Vec::new();
                    thumb
                        .write_to(&mut Cursor::new(&mut buf), image::ImageOutputFormat::Png)
                        .map_err(|e| e.to_string())?;
                    let _ = std::fs::write(&cache_path, &buf);
                    buf
                }
            };

            CaptureEntry {
                path: path.to_string_lossy().to_string(),
                filename: path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
                created_at,
                thumbnail_base64: STANDARD.encode(&thumb_bytes),
                width,
                height,
                file_type: "image".into(),
                favorite,
            }
        } else {
            // Video: look for the first-frame thumbnail saved during recording.
            let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
            let cache_path = cache_dir.join(format!("{}_thumb.png", stem));
            let (thumbnail_base64, width, height) = if let Ok(thumb_bytes) = std::fs::read(&cache_path) {
                let (w, h) = image::image_dimensions(&cache_path).unwrap_or((0, 0));
                (STANDARD.encode(&thumb_bytes), w, h)
            } else {
                (String::new(), 0, 0)
            };

            CaptureEntry {
                path: path.to_string_lossy().to_string(),
                filename: path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
                created_at,
                thumbnail_base64,
                width,
                height,
                file_type: "video".into(),
                favorite,
            }
        };

        entries.push(capture_entry);
    }

    entries.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(entries)
}

// ===== Favorites (gallery "important" mark) =====
//
// A flat JSON array of absolute capture paths, stored alongside the
// annotation sidecars in `.clipse/` but otherwise unrelated to them —
// favoriting works on any capture, edited or not. Missing/corrupt file reads
// as an empty set; every write is best-effort within its own command.

fn favorites_path(dir: &Path) -> PathBuf {
    dir.join(".clipse").join("favorites.json")
}

fn load_favorites(dir: &Path) -> std::collections::HashSet<String> {
    let Ok(text) = std::fs::read_to_string(favorites_path(dir)) else {
        return Default::default();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

fn save_favorites(dir: &Path, set: &std::collections::HashSet<String>) -> Result<(), String> {
    let path = favorites_path(dir);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let list: Vec<&String> = set.iter().collect();
    let json = serde_json::to_string(&list).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

/// Toggles the favorite state of a capture and returns the new state.
#[command]
pub async fn toggle_favorite(path: String, app: tauri::AppHandle) -> Result<bool, String> {
    let dir = captures_dir(&app)?;
    let mut favorites = load_favorites(&dir);
    let now_favorite = if favorites.remove(&path) {
        false
    } else {
        favorites.insert(path);
        true
    };
    save_favorites(&dir, &favorites)?;
    Ok(now_favorite)
}

// ===== Annotation sidecars (re-editable captures) =====
//
// A capture saved from the editor with annotations keeps them re-editable:
// the flattened image on disk stays a plain PNG/JPEG (what users paste and
// share), while a hidden `.clipse/` subfolder next to it holds
//   `<stem>.json`     — the annotation data (see the frontend's sidecar schema)
//   `<stem>.orig.png` — the pristine base image, always lossless PNG
// Reopening the capture from the gallery loads the original + annotations
// instead of the burned-in pixels. Captures never saved with annotations have
// no sidecar and behave exactly as before.

/// Sidecar (json, orig) paths for a capture file, keyed by its file stem.
/// Doesn't create or check anything — pure path derivation.
fn sidecar_paths(capture_path: &Path) -> Option<(PathBuf, PathBuf)> {
    let dir = capture_path.parent()?;
    let stem = capture_path.file_stem()?.to_str()?;
    let sc = dir.join(".clipse");
    Some((sc.join(format!("{stem}.json")), sc.join(format!("{stem}.orig.png"))))
}

/// Writes/updates a capture's annotation sidecar. `orig_base64` (pristine base
/// image, PNG) is only sent when it isn't stashed yet or the base changed
/// (crop) — omitted otherwise to keep saves cheap.
#[command]
pub async fn save_sidecar(
    path: String,
    annotations_json: String,
    orig_base64: Option<String>,
) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD, Engine};

    let (json_path, orig_path) =
        sidecar_paths(Path::new(&path)).ok_or("Invalid capture path")?;
    let sc_dir = json_path.parent().ok_or("Invalid sidecar path")?;
    std::fs::create_dir_all(sc_dir).map_err(|e| e.to_string())?;

    if let Some(b64) = orig_base64 {
        let raw = STANDARD.decode(&b64).map_err(|e| e.to_string())?;
        std::fs::write(&orig_path, &raw).map_err(|e| e.to_string())?;
    } else if !orig_path.exists() {
        // First sidecar save must include the original — without it the
        // annotations have no base image to be restored over.
        return Err("Sidecar original missing and not provided".into());
    }
    std::fs::write(&json_path, annotations_json.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}

/// Returns the annotation-sidecar JSON for the document the *calling* editor
/// window was opened on, set when that target came from the gallery and had a
/// sidecar. `None` for fresh captures or sidecar-less files. Per-window for the
/// same reason as `capture::get_pending_image` — several editors can be open,
/// each on its own document.
#[command]
pub async fn get_pending_annotations(
    window: tauri::WebviewWindow,
) -> Result<Option<String>, String> {
    Ok(crate::commands::capture::pending_for(&window).and_then(|p| p.annotations))
}

/// Best-effort removal of a capture's sidecar files (and the `.clipse/` dir
/// itself once empty). Never fails the caller.
fn remove_sidecar(capture_path: &Path) {
    if let Some((json_path, orig_path)) = sidecar_paths(capture_path) {
        let _ = std::fs::remove_file(&json_path);
        let _ = std::fs::remove_file(&orig_path);
        if let Some(sc) = json_path.parent() {
            let _ = std::fs::remove_dir(sc); // fails (kept) unless empty
        }
    }
}

/// Removes a capture's annotation sidecar without touching the capture file
/// itself — used when a re-editable capture is saved back down to zero
/// annotations, so a later reopen doesn't resurrect annotations the user
/// already cleared. Best-effort/idempotent: no sidecar is not an error.
#[command]
pub async fn delete_sidecar(path: String) -> Result<(), String> {
    remove_sidecar(Path::new(&path));
    Ok(())
}

/// Deletes a capture file. Emits `capture-saved` — the same event the gallery
/// already listens to for refreshing its list after a new capture — so a
/// delete triggered from a different window (e.g. the editor deleting the
/// image it has open) also refreshes an already-open gallery.
#[command]
pub async fn delete_capture(path: String, app: tauri::AppHandle) -> Result<(), String> {
    std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    remove_sidecar(Path::new(&path));
    if let Ok(dir) = captures_dir(&app) {
        let mut favorites = load_favorites(&dir);
        if favorites.remove(&path) {
            let _ = save_favorites(&dir, &favorites);
        }
    }
    let _ = app.emit("capture-saved", ());
    Ok(())
}

/// Renames a capture to `new_name` (base name, no extension), keeping its
/// original extension and directory. For videos, the cached first-frame
/// thumbnail (keyed by file stem) is moved too so it isn't lost. Returns the
/// new full path.
#[command]
pub async fn rename_capture(
    path: String,
    new_name: String,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let old = PathBuf::from(&path);
    let dir = old.parent().ok_or("Invalid path")?.to_path_buf();
    let ext = old
        .extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_default();

    let stem = new_name.trim();
    if stem.is_empty() {
        return Err("Name cannot be empty".into());
    }
    if stem.contains(|c: char| matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')) {
        return Err("Name contains invalid characters".into());
    }

    let new_filename = if ext.is_empty() {
        stem.to_string()
    } else {
        format!("{stem}.{ext}")
    };
    let new_path = dir.join(&new_filename);

    if new_path == old {
        return Ok(path);
    }
    if new_path.exists() {
        return Err("A file with that name already exists".into());
    }
    std::fs::rename(&old, &new_path).map_err(|e| e.to_string())?;

    // Move the annotation sidecar (keyed by file stem) along with the capture.
    if let (Some((old_json, old_orig)), Some((new_json, new_orig))) =
        (sidecar_paths(&old), sidecar_paths(&new_path))
    {
        if old_json.exists() {
            let _ = std::fs::rename(&old_json, &new_json);
        }
        if old_orig.exists() {
            let _ = std::fs::rename(&old_orig, &new_orig);
        }
    }

    // Move a video's cached first-frame thumbnail (keyed by file stem).
    if VIDEO_EXTS.contains(&ext.to_lowercase().as_str()) {
        if let Ok(cache_dir) = thumb_cache_dir(&app) {
            let old_stem = old.file_stem().and_then(|s| s.to_str());
            let new_stem = new_path.file_stem().and_then(|s| s.to_str());
            if let (Some(os), Some(ns)) = (old_stem, new_stem) {
                let old_thumb = cache_dir.join(format!("{os}_thumb.png"));
                if old_thumb.exists() {
                    let _ = std::fs::rename(&old_thumb, cache_dir.join(format!("{ns}_thumb.png")));
                }
            }
        }
    }

    // Carry the favorite mark over to the new path.
    {
        let mut favorites = load_favorites(&dir);
        if favorites.remove(&path) {
            favorites.insert(new_path.to_string_lossy().to_string());
            let _ = save_favorites(&dir, &favorites);
        }
    }

    // Keep any open gallery in sync.
    use tauri::Emitter;
    let _ = app.emit("capture-saved", ());

    Ok(new_path.to_string_lossy().to_string())
}

/// Opens a file with the system default application.
#[command]
pub fn open_file(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Reads an existing capture file and opens it in the editor. The raw file
/// bytes go straight into the pending slot — the editor loads them via the
/// binary `get_pending_image` response (no base64 anywhere on this path).
///
/// If the capture has an annotation sidecar (saved re-editable from the
/// editor), the pristine original is loaded instead of the flattened file,
/// and the sidecar JSON is stashed for the editor to restore over it via
/// `get_pending_annotations` — reopening resumes lossless editing rather than
/// starting over on burned-in pixels. No sidecar = today's plain behavior.
/// The document is handed straight to the new window rather than going through
/// `AppState.pending_*`: those slots belong to the capture flow (a toast can be
/// clicked long after the capture), and routing a gallery open through them
/// would let two quick opens in a row race each other for the same slot.
#[command]
pub async fn open_capture_in_editor(path: String, app: tauri::AppHandle) -> Result<(), String> {
    use crate::{state::PendingCapture, window};

    let sidecar = sidecar_paths(Path::new(&path)).filter(|(json, orig)| json.exists() && orig.exists());
    let (bytes, annotations_json) = if let Some((json_path, orig_path)) = &sidecar {
        let orig_bytes = std::fs::read(orig_path).map_err(|e| e.to_string())?;
        let json = std::fs::read_to_string(json_path).map_err(|e| e.to_string())?;
        (orig_bytes, Some(json))
    } else {
        (std::fs::read(&path).map_err(|e| e.to_string())?, None)
    };

    window::open_editor_with(
        &app,
        PendingCapture {
            image: bytes,
            path: Some(path),
            annotations: annotations_json,
        },
    )
}

/// Overwrites an existing capture file with the (annotated) image, encoding to
/// match the file's existing extension so the round-trip stays consistent.
/// Refreshes the gallery. Used for in-place "save to gallery".
#[command]
pub async fn overwrite_image(
    path: String,
    image_base64: String,
    app: tauri::AppHandle,
) -> Result<String, String> {
    use tauri::Emitter;

    let settings: AppSettings = settings::current(&app);
    let ext = Path::new(&path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_else(|| "png".into());
    let bytes = encode_for_ext(&image_base64, &ext, settings.jpeg_quality)?;
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    app.emit("capture-saved", ()).map_err(|e| e.to_string())?;
    Ok(path)
}
