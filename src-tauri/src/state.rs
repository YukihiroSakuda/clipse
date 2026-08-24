use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use tauri::menu::MenuItem;
use tauri::Wry;

use crate::settings::AppSettings;

/// One "copy elements" from an editor window, ready to be pasted into any
/// editor window (see `commands::clipboard`).
pub struct AnnotationCopy {
    /// Bumped on every copy. The seq lets a pasting window notice the payload
    /// changed and restart its paste-offset cascade.
    pub seq: u64,
    /// `{ version, annotations }`, serialized by the editor that copied it.
    pub json: String,
    /// The OS clipboard's sequence number at the moment of the copy. Ctrl+V has
    /// two possible sources — this internal payload and a picture on the system
    /// clipboard — and the only honest way to pick between them is recency:
    /// a *later* OS sequence number means the system clipboard was written
    /// after these annotations were copied, so the picture wins. Without it,
    /// every capture's auto-copy would leave a screenshot that outranks a
    /// subsequent element copy forever (or vice versa).
    pub os_seq: u64,
}

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

/// A constraint the region overlay applies to the user's selection, set by
/// the Fixed Capture window (`window::open_fixed_capture`) before opening the
/// overlay. `is_ratio = true` locks the drag selection to `w:h` proportions
/// (either dimension free, both scale together); `false` fixes the exact
/// pixel size `w x h` and turns the overlay into click-to-capture at the
/// cursor (no drag needed).
#[derive(Clone, Copy, serde::Serialize, serde::Deserialize)]
pub struct FixedRegionSpec {
    pub is_ratio: bool,
    pub w: u32,
    pub h: u32,
}

/// Everything one editor window needs to load its document: the image it
/// edits, where that image lives on disk (if saved), and an annotation
/// sidecar to restore over it (re-editable capture reopened from the gallery).
///
/// Several editors can be open at once, each on its own capture, so this is
/// handed to a specific window at creation time and looked up by that window's
/// own label (`AppState.pending_editors`) — never read from a single global
/// slot, which would let a capture completing while an editor is still cold-
/// starting swap the document out from under it.
#[derive(Clone, Default)]
pub struct PendingCapture {
    pub image: Vec<u8>,
    pub path: Option<String>,
    pub annotations: Option<String>,
}

pub struct AppState {
    /// Staging slot: raw PNG bytes of the document the *next* editor window to
    /// be opened should load. Written by whatever produced it (a finished
    /// capture, or the gallery opening a file) and consumed by
    /// `window::open_editor`, which copies it into that window's own
    /// `pending_editors` entry. Editors never read this directly — see
    /// `PendingCapture` for why.
    pub pending_image: Mutex<Option<Vec<u8>>>,
    /// Staging slot for `pending_image`'s on-disk path, if it has been saved to
    /// the captures directory. Used for in-place overwrite-save.
    pub pending_path: Mutex<Option<String>>,
    /// Staging slot for the annotation-sidecar JSON accompanying
    /// `pending_image`, when the capture was opened from the gallery and a
    /// sidecar exists (re-editable capture: `pending_image` then holds the
    /// pristine original, and this holds the annotations to restore over it).
    /// `None` for fresh captures — cleared in `finish_capture_flow` alongside
    /// every `pending_image` write.
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
    /// When `capturing` was last claimed. A claim is only ever released by the
    /// pipeline that took it, so a pipeline that dies without releasing (a
    /// panicking command, an overlay torn down by the OS without the frontend
    /// getting to call `cancel_overlay`) would wedge every later capture with no
    /// visible symptom beyond "PrintScreen stopped working". This lets
    /// `window::try_claim_capture` recognize a claim that has been held far too
    /// long with nothing actually running, and take it over instead.
    pub capture_claimed_at: Mutex<Option<std::time::Instant>>,
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
    /// Set (just before showing the overlay pool) when the current capture
    /// session should constrain the selection — see `FixedRegionSpec`. `None`
    /// for a normal free-form capture. Like `scroll_mode`, this is written by
    /// `window::open_overlay_inner` on every session, so a plain capture right
    /// after a fixed one can't inherit a stale constraint.
    pub fixed_region: Mutex<Option<FixedRegionSpec>>,
    /// PNG bytes for every currently-open "Pin to Screen" window, keyed by
    /// its own window label (`pin-{n}`, see `window::open_pin_window`).
    /// Unlike `pending_image` this supports several pins open at once; each
    /// entry is written right before its window is created and removed when
    /// that window is destroyed (see the `Destroyed` handler in
    /// `open_pin_window`), so this never accumulates stale data.
    pub pinned_images: Mutex<HashMap<String, Vec<u8>>>,
    /// The document each currently-open editor window was opened on, keyed by
    /// its own window label (`editor-{n}`, see `window::open_editor`). Same
    /// per-window ownership model as `pinned_images`: written just before the
    /// window is created, removed when it's destroyed. The `pending_*` slots
    /// above are only the *staging area* for the next editor to be opened (a
    /// capture finishes, the toast may be clicked much later); `open_editor`
    /// moves a snapshot of them in here so each editor keeps the document it
    /// was opened with even as later captures overwrite the staging slots.
    pub pending_editors: Mutex<HashMap<String, PendingCapture>>,
    /// Raw `HWND` (as `isize`) of every open editor window, keyed by the same
    /// label as `pending_editors`.
    ///
    /// Cached at window-creation time on purpose: the only way to ask Tauri for
    /// a window's OS handle is `window_handle()`, which is a **blocking
    /// round-trip to the main-thread event loop** (`window_getter!` in
    /// tauri-runtime-wry, with no timeout). That is fine while setting a window
    /// up, but the PrintScreen path must not do it — it runs on an async-runtime
    /// thread and would stall the whole capture on the main thread being free.
    /// `SetWindowDisplayAffinity` has no thread affinity, so a cached handle is
    /// all `window::set_editors_excluded_from_capture` needs.
    pub editor_hwnds: Mutex<HashMap<String, isize>>,
    /// True while the region-selection overlay pool is on screen. Plain atomic
    /// (no window queries) so `window::try_claim_capture` can tell a genuinely
    /// busy session from a leaked claim without any main-thread round-trip.
    pub overlay_showing: AtomicBool,
    /// Annotations copied in one editor window. Lives in the backend because
    /// each editor window is its own webview with its own store — this is what
    /// makes copy/paste work *between* editors.
    pub annotation_clipboard: Mutex<Option<AnnotationCopy>>,
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
            capture_claimed_at: Mutex::new(None),
            record_menu_item: Mutex::new(None),
            frozen_frame: Mutex::new(None),
            last_region: Mutex::new(None),
            fixed_region: Mutex::new(None),
            pinned_images: Mutex::new(HashMap::new()),
            pending_editors: Mutex::new(HashMap::new()),
            editor_hwnds: Mutex::new(HashMap::new()),
            overlay_showing: AtomicBool::new(false),
            annotation_clipboard: Mutex::new(None),
        }
    }
}
