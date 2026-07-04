use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use tauri::menu::MenuItem;
use tauri::Wry;

use crate::settings::AppSettings;

pub struct AppState {
    /// Raw PNG bytes of the most recently captured image, waiting to be loaded
    /// by the editor window (served via a raw binary IPC response — no base64).
    pub pending_image: Mutex<Option<Vec<u8>>>,
    /// Filesystem path of the capture currently being edited, if it has been
    /// saved to the captures directory. Used for in-place overwrite-save.
    pub pending_path: Mutex<Option<String>>,
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
}

impl AppState {
    pub fn new() -> Self {
        Self {
            pending_image: Mutex::new(None),
            pending_path: Mutex::new(None),
            settings: Mutex::new(AppSettings::default()),
            scroll_mode: Mutex::new(false),
            overlay_signature: Mutex::new(String::new()),
            capturing: Arc::new(AtomicBool::new(false)),
            record_menu_item: Mutex::new(None),
        }
    }
}
