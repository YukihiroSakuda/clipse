use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use tauri::menu::MenuItem;
use tauri::Wry;

use crate::settings::AppSettings;

/// A whole-virtual-desktop snapshot taken the instant PrintScreen fires, before
/// any Clipse window is shown/activated (see `commands::capture::freeze_desktop`).
/// The interactive overlay renders this as its background and crops the user's
/// eventual selection out of it (see `commands::capture::try_crop_frozen`), so
/// transient on-screen UI at that instant — most notably an open right-click
/// context menu, which the overlay's own activation would otherwise dismiss —
/// survives into the capture regardless of what happens during selection.
pub struct FrozenFrame {
    pub image: image::RgbaImage,
    /// Top-left of `image` in physical virtual-screen coordinates.
    pub x: i32,
    pub y: i32,
}

pub struct AppState {
    /// Raw PNG bytes of the most recently captured image, waiting to be loaded
    /// by the editor window (served via a raw binary IPC response — no base64).
    pub pending_image: Mutex<Option<Vec<u8>>>,
    /// Filesystem path of the capture currently being edited, if it has been
    /// saved to the captures directory. Used for in-place overwrite-save.
    pub pending_path: Mutex<Option<String>>,
    /// Annotation-sidecar JSON accompanying `pending_image`, when the capture
    /// was opened from the gallery and a sidecar exists (re-editable capture:
    /// `pending_image` then holds the pristine original, and this holds the
    /// annotations to restore over it). `None` for fresh captures — cleared in
    /// `finish_capture_flow` alongside every `pending_image` write.
    pub pending_annotations: Mutex<Option<String>>,
    /// User settings, loaded from `settings.json` on startup.
    pub settings: Mutex<AppSettings>,
    /// True while the overlay is open for scrolling capture (vs. a normal capture).
    pub scroll_mode: Mutex<bool>,
    /// Monitor-layout signature the prewarmed overlay window pool was built for
    /// (empty = no pool). See `window::open_overlay` / `window::prewarm_overlays`:
    /// overlays are kept alive and hidden between captures so PrintScreen only
    /// has to show them, not build webviews; a signature mismatch (monitor
    /// added/removed/rescaled) forces a rebuild.
    pub overlay_signature: Mutex<String>,
    /// True from the moment a capture pipeline claims the screen (overlay opened,
    /// or a no-overlay capture started) until it hands off to the editor or aborts.
    /// Guards against a second capture starting mid-flight: without this, a
    /// PrintScreen pressed while a slow scrolling capture is still stitching in
    /// the background opens a fresh overlay that races the first capture's own
    /// overlay-close / pending-image writes when it finally finishes (see
    /// `window::open_overlay` and the `complete_*` commands in `commands::capture`).
    pub capturing: Arc<AtomicBool>,
    /// Handle to the tray menu's "Record Screen" item, so its label can flip
    /// to "Stop Recording" while a recording is in progress (the recorder
    /// window itself is hidden during capture, so the tray menu is the one
    /// always-reachable place to see/stop it).
    pub record_menu_item: Mutex<Option<MenuItem<Wry>>>,
    /// The current PrintScreen-time frozen desktop snapshot, if any. Populated by
    /// `commands::capture::freeze_desktop` right before the overlay is shown;
    /// cleared once the capture pipeline it belongs to finishes (cancel, or any
    /// `complete_*`/`do_*` command) — see `CaptureReleaseGuard` in `commands::capture`.
    pub frozen_frame: Mutex<Option<FrozenFrame>>,
    /// Physical-pixel rect `(x, y, w, h)` of the most recent completed region
    /// selection, so "repeat last region" can re-capture the same spot without
    /// an overlay round-trip (`commands::capture::do_repeat_region_capture`).
    pub last_region: Mutex<Option<(i32, i32, u32, u32)>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            pending_image: Mutex::new(None),
            pending_path: Mutex::new(None),
            pending_annotations: Mutex::new(None),
            settings: Mutex::new(AppSettings::default()),
            scroll_mode: Mutex::new(false),
            overlay_signature: Mutex::new(String::new()),
            capturing: Arc::new(AtomicBool::new(false)),
            record_menu_item: Mutex::new(None),
            frozen_frame: Mutex::new(None),
            last_region: Mutex::new(None),
        }
    }
}
