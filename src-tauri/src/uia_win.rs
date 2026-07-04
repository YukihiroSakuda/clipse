//! Windows UI Automation helper for Screenpresso-style sub-window element detection.
//!
//! Given a top-level window HWND, walks its UI Automation subtree and returns the
//! bounding rectangle (physical screen pixels) of every meaningful element — toolbar
//! buttons, panes, list items, web/Electron content, etc. The overlay caches these
//! per-window and does smallest-rect hit-testing in JS for smooth hover highlighting.
//!
//! Why per-window (`ElementFromHandle`) rather than per-cursor (`ElementFromPoint`):
//! the region overlay is a full-screen, always-on-top window that *receives* mouse
//! input, so a global `ElementFromPoint` would always resolve to the overlay itself.
//! Querying by the underlying window's HWND sidesteps that occlusion entirely.
//!
//! Rects are fetched via `FindAllBuildCache` with a cache request (not `FindAll` +
//! per-element `CurrentBoundingRectangle`): the latter is one extra COM round-trip
//! per element, which on complex windows (browsers, Electron, IDEs) is slow enough
//! that scroll-driven sub-element narrowing lags noticeably right after a capture
//! starts, since the overlay can't hit-test until this per-window fetch resolves.

#[cfg(target_os = "windows")]
pub fn element_rects(window_id: u32) -> Vec<(i32, i32, u32, u32)> {
    use std::cell::RefCell;
    use std::ffi::c_void;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
    };
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, TreeScope_Subtree, UIA_BoundingRectanglePropertyId,
    };

    // Cap the element count so pathological trees (large web pages) can't hang the
    // overlay. A few thousand rectangles is more than enough for useful targeting.
    const MAX_ELEMENTS: usize = 4000;
    // Ignore sub-pixel / invisible elements; they aren't useful capture targets.
    const MIN_SIZE: i32 = 8;

    // The IUIAutomation instance is reused per worker thread. Tokio reuses a small
    // pool of worker threads, so this avoids re-creating the COM object every hover.
    thread_local! {
        static UIA: RefCell<Option<IUIAutomation>> = const { RefCell::new(None) };
    }

    unsafe {
        // Join the MTA. Harmless if the thread is already initialized (returns
        // S_FALSE / RPC_E_CHANGED_MODE, both ignorable for our read-only use).
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

        let uia: IUIAutomation = match UIA.with(|cell| {
            let mut slot = cell.borrow_mut();
            if slot.is_none() {
                match CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) {
                    Ok(u) => *slot = Some(u),
                    Err(_) => return None,
                }
            }
            slot.clone()
        }) {
            Some(u) => u,
            None => return Vec::new(),
        };

        let hwnd = HWND(window_id as usize as *mut c_void);
        let root = match uia.ElementFromHandle(hwnd) {
            Ok(r) => r,
            Err(_) => return Vec::new(),
        };
        // Control view (buttons, panes, list items, …) skips the raw/decorative nodes
        // (text runs, group wrappers) that dominate web/Electron accessibility trees —
        // far fewer elements to walk, and the ones left are actually useful targets.
        let cond = match uia.ControlViewCondition() {
            Ok(c) => c,
            Err(_) => return Vec::new(),
        };
        // Build a cache request so bounding rects come back in the same FindAll call.
        // Without this, reading `CurrentBoundingRectangle()` per element below means
        // one extra cross-process COM round-trip *per element* (up to MAX_ELEMENTS of
        // them) — the dominant cost that made sub-element hover/scroll feel laggy
        // right after a capture starts, especially on complex windows.
        let cache = match uia.CreateCacheRequest() {
            Ok(c) => c,
            Err(_) => return Vec::new(),
        };
        if cache.AddProperty(UIA_BoundingRectanglePropertyId).is_err() {
            return Vec::new();
        }
        // TreeScope_Subtree = the element itself plus all descendants, in one call.
        let arr = match root.FindAllBuildCache(TreeScope_Subtree, &cond, &cache) {
            Ok(a) => a,
            Err(_) => return Vec::new(),
        };

        let len = arr.Length().unwrap_or(0);
        let mut out = Vec::new();
        for i in 0..len {
            if out.len() >= MAX_ELEMENTS {
                break;
            }
            let Ok(el) = arr.GetElement(i) else { continue };
            let Ok(rect) = el.CachedBoundingRectangle() else {
                continue;
            };
            let w = rect.right - rect.left;
            let h = rect.bottom - rect.top;
            if w >= MIN_SIZE && h >= MIN_SIZE {
                out.push((rect.left, rect.top, w as u32, h as u32));
            }
        }
        out
    }
}

#[cfg(not(target_os = "windows"))]
pub fn element_rects(_window_id: u32) -> Vec<(i32, i32, u32, u32)> {
    Vec::new()
}
