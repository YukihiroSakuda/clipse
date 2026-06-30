use std::sync::Mutex;

use crate::settings::AppSettings;

pub struct AppState {
    /// Base64-encoded PNG of the most recently captured image,
    /// waiting to be loaded by the editor window.
    pub pending_image: Mutex<Option<String>>,
    /// Filesystem path of the capture currently being edited, if it has been
    /// saved to the captures directory. Used for in-place overwrite-save.
    pub pending_path: Mutex<Option<String>>,
    /// User settings, loaded from `settings.json` on startup.
    pub settings: Mutex<AppSettings>,
    /// True while the overlay is open for scrolling capture (vs. a normal capture).
    pub scroll_mode: Mutex<bool>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            pending_image: Mutex::new(None),
            pending_path: Mutex::new(None),
            settings: Mutex::new(AppSettings::default()),
            scroll_mode: Mutex::new(false),
        }
    }
}
