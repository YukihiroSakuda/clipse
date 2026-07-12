use image::DynamicImage;
use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Emitter, Manager};

use crate::{state::AppState, window};

// xcap types (Monitor, Window) are not Send, so all xcap work is done inside
// synchronous closures that are completed before any .await point.

// ===== Types =====

#[derive(Serialize, Clone)]
pub struct MonitorInfo {
    pub id: u32,
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f32,
    pub is_primary: bool,
}

#[derive(Serialize, Clone)]
pub struct WindowInfo {
    pub id: u32,
    pub title: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Bounding rectangle of a UI Automation element within a window, in physical pixels.
#[derive(Serialize, Clone)]
pub struct ElementRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Deserialize)]
pub struct RegionArgs {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

// ===== Commands =====

/// Returns info for all connected monitors.
#[command]
pub async fn get_monitors() -> Result<Vec<MonitorInfo>, String> {
    let monitors = xcap::Monitor::all().map_err(|e| e.to_string())?;
    Ok(monitors
        .iter()
        .map(|m| MonitorInfo {
            id: m.id(),
            name: m.name().to_string(),
            x: m.x(),
            y: m.y(),
            width: m.width(),
            height: m.height(),
            scale_factor: m.scale_factor(),
            is_primary: m.is_primary(),
        })
        .collect())
}

/// Returns all visible, non-minimized windows with their visual bounds in physical pixels.
/// Uses DWMWA_EXTENDED_FRAME_BOUNDS so the bounds match the visible window frame exactly
/// (excluding invisible resize shadows / including title bar).
#[command]
pub async fn get_windows_info() -> Result<Vec<WindowInfo>, String> {
    let windows = xcap::Window::all().map_err(|e| e.to_string())?;
    Ok(windows
        .iter()
        .filter(|w| !w.is_minimized() && w.width() > 0 && w.height() > 0 && !w.title().is_empty())
        .filter_map(|w| {
            let bounds = dwm_extended_frame_bounds(w.id())?;
            Some(WindowInfo {
                id: w.id(),
                title: w.title().to_string(),
                x: bounds.0,
                y: bounds.1,
                width: bounds.2,
                height: bounds.3,
            })
        })
        .collect())
}

/// Returns the bounding rectangles (physical px) of every UI Automation element inside
/// the given top-level window — used for Screenpresso-style sub-window region targeting.
/// The overlay caches the result per window and hit-tests it locally on hover.
/// The UIA/COM walk is synchronous and can take a while on complex windows, so it runs
/// on a blocking-pool thread rather than the async runtime's own worker threads.
#[command]
pub async fn get_element_rects(window_id: u32) -> Result<Vec<ElementRect>, String> {
    let rects = tauri::async_runtime::spawn_blocking(move || crate::uia_win::element_rects(window_id))
        .await
        .map_err(|e| e.to_string())?;
    Ok(rects
        .into_iter()
        .map(|(x, y, width, height)| ElementRect { x, y, width, height })
        .collect())
}

/// Returns (x, y, width, height) of the DWM extended frame — the actual visible window rect
/// in physical screen coordinates, without invisible resize handles or drop-shadows.
/// Returns None if DWM composition is disabled or the call fails.
#[cfg(target_os = "windows")]
fn dwm_extended_frame_bounds(window_id: u32) -> Option<(i32, i32, u32, u32)> {
    use std::ffi::c_void;
    use std::mem;
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};

    unsafe {
        let hwnd = HWND(window_id as usize as *mut c_void);
        let mut rect = RECT::default();
        if DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut rect as *mut RECT as *mut c_void,
            mem::size_of::<RECT>() as u32,
        )
        .is_ok()
        {
            let w = (rect.right - rect.left).max(0) as u32;
            let h = (rect.bottom - rect.top).max(0) as u32;
            if w > 0 && h > 0 {
                return Some((rect.left, rect.top, w, h));
            }
        }
        None
    }
}

#[cfg(not(target_os = "windows"))]
fn dwm_extended_frame_bounds(window_id: u32) -> Option<(i32, i32, u32, u32)> {
    None
}

/// Composites a physical-pixel rectangle of the virtual desktop by capturing each
/// intersecting monitor's slice and stitching them into one image. Needed for
/// windows that span multiple monitors — `xcap::Window::capture_image()` can't
/// cross monitor boundaries (especially under mixed DPI). Screenpresso-style.
#[cfg(target_os = "windows")]
fn capture_rect_composited(
    monitors: &[xcap::Monitor],
    x: i32,
    y: i32,
    w: u32,
    h: u32,
) -> Result<image::RgbaImage, String> {
    use image::RgbaImage;

    let mut out = RgbaImage::new(w, h);
    let mut any = false;
    let (rx1, ry1) = (x + w as i32, y + h as i32);

    for m in monitors {
        let (mx0, my0) = (m.x(), m.y());
        let (mx1, my1) = (m.x() + m.width() as i32, m.y() + m.height() as i32);

        // Intersection of the window rect with this monitor (physical px).
        let ix0 = x.max(mx0);
        let iy0 = y.max(my0);
        let ix1 = rx1.min(mx1);
        let iy1 = ry1.min(my1);
        if ix1 <= ix0 || iy1 <= iy0 {
            continue;
        }
        let (iw, ih) = ((ix1 - ix0) as u32, (iy1 - iy0) as u32);

        // Capture this monitor's slice (DXGI physical → xcap/GDI fallback).
        let slice: RgbaImage = match crate::capture_win::capture_region_physical(ix0, iy0, iw, ih) {
            Ok(img) => img,
            Err(_) => {
                let full = m.capture_image().map_err(|e| e.to_string())?;
                let lx = (ix0 - mx0).max(0) as u32;
                let ly = (iy0 - my0).max(0) as u32;
                image::imageops::crop_imm(&full, lx, ly, iw, ih).to_image()
            }
        };

        // Blit the slice into the output at its offset within the rect (auto-clipped).
        image::imageops::replace(&mut out, &slice, (ix0 - x) as i64, (iy0 - y) as i64);
        any = true;
    }

    if !any {
        return Err("Window rect did not intersect any monitor".to_string());
    }
    Ok(out)
}

/// Captures the entire virtual desktop (every monitor, composited into one
/// image) with zero window activation, and stores it in `AppState.frozen_frame`
/// as the pixel source for the upcoming interactive overlay and its eventual
/// capture (see `try_crop_frozen`). Called at the very start of
/// `window::open_overlay_inner`, before any Clipse window is shown, hidden, or
/// focused, so anything transient on screen at that instant — most notably an
/// open right-click context menu, which the overlay's own activation would
/// otherwise dismiss — survives into the frame regardless of what the overlay
/// does afterward. Best-effort: on failure `frozen_frame` is left as `None`,
/// and every capture path (`try_crop_frozen`) falls back to a live re-grab.
#[cfg(target_os = "windows")]
pub(crate) fn freeze_desktop(app: &AppHandle) {
    let result = (|| -> Result<crate::state::FrozenFrame, String> {
        let (x, y, w, h) = window::virtual_screen_bounds()?;
        let monitors = xcap::Monitor::all().map_err(|e| e.to_string())?;
        let mut image = capture_rect_composited(&monitors, x as i32, y as i32, w as u32, h as u32)?;
        if crate::settings::current(app).capture_cursor {
            overlay_cursor(&mut image, x as i32, y as i32);
        }
        Ok(crate::state::FrozenFrame { image, x: x as i32, y: y as i32 })
    })();
    match result {
        Ok(frame) => {
            if let Some(state) = app.try_state::<AppState>() {
                if let Ok(mut g) = state.frozen_frame.lock() {
                    *g = Some(frame);
                }
            }
        }
        Err(_e) => {
            #[cfg(debug_assertions)]
            eprintln!("[overlay] freeze_desktop failed ({_e}), captures will fall back to a live grab");
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn freeze_desktop(_app: &AppHandle) {}

/// Crops the requested physical rect out of the PrintScreen-time frozen
/// snapshot (see `freeze_desktop`), so a capture reflects whatever was on
/// screen at that instant — right-click menus included — instead of a live
/// re-grab that could miss it. Returns `None` if there is no frozen frame at
/// all (freeze failed, off-Windows) or the rect doesn't overlap it whatsoever,
/// so the caller falls back to a live capture.
///
/// Clamps to the frame's actual coverage rather than rejecting outright when
/// the requested rect extends beyond it: `DWMWA_EXTENDED_FRAME_BOUNDS` can
/// report a window rect that spills slightly past the captured virtual screen
/// (observed with a maximized browser window at e.g. x=-290) — cropping the
/// overlapping portion still gives a correct, menu-preserving capture, whereas
/// rejecting it entirely used to silently drop back to the pre-freeze capture
/// path (and its own, separately-fixed activation-ordering issue) for exactly
/// the windows most likely to need the frozen frame.
fn try_crop_frozen(app: &AppHandle, x: i32, y: i32, w: u32, h: u32) -> Option<Vec<u8>> {
    if w == 0 || h == 0 {
        return None;
    }
    let state = app.try_state::<AppState>()?;
    let guard = state.frozen_frame.lock().ok()?;
    let frame = guard.as_ref()?;

    let x1 = x.max(frame.x);
    let y1 = y.max(frame.y);
    let x2 = (x as i64 + w as i64).min(frame.x as i64 + frame.image.width() as i64) as i32;
    let y2 = (y as i64 + h as i64).min(frame.y as i64 + frame.image.height() as i64) as i32;
    if x2 <= x1 || y2 <= y1 {
        return None;
    }
    let lx = (x1 - frame.x) as u32;
    let ly = (y1 - frame.y) as u32;
    let cw = (x2 - x1) as u32;
    let ch = (y2 - y1) as u32;

    let slice = image::imageops::crop_imm(&frame.image, lx, ly, cw, ch).to_image();
    dynamic_to_png_bytes(DynamicImage::ImageRgba8(slice)).ok()
}

/// Composites the current system mouse cursor onto `img`, a physical-pixel
/// screen capture whose top-left corresponds to screen coordinates
/// (`region_x`, `region_y`). No-op if the cursor is hidden or GDI fails at any
/// step — the capture itself must never fail just because the cursor overlay
/// couldn't be drawn.
///
/// The DIB is seeded with `img`'s own pixels before `DrawIconEx` draws into it,
/// so the cursor is composited *against the real captured content* rather than
/// a blank buffer — this is what makes both modern (32-bit alpha) and legacy
/// (AND/XOR-masked, still used by the default arrow cursor) cursors render
/// correctly without needing separate blending logic for each.
#[cfg(target_os = "windows")]
fn overlay_cursor(img: &mut image::RgbaImage, region_x: i32, region_y: i32) {
    use std::ffi::c_void;
    use windows::Win32::Foundation::{HANDLE, HWND};
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC,
        SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        DrawIconEx, GetCursorInfo, GetIconInfo, LoadCursorW, CURSORINFO, CURSOR_SHOWING, DI_NORMAL,
        IDC_ARROW,
    };

    unsafe {
        let mut ci = CURSORINFO {
            cbSize: std::mem::size_of::<CURSORINFO>() as u32,
            ..Default::default()
        };
        if GetCursorInfo(&mut ci).is_err() {
            return;
        }

        // Windows' "hide pointer while typing" setting kicks in the instant any
        // key is pressed — exactly what Ctrl+PrintScreen is — and swaps the
        // active cursor to a blank/invisible resource rather than merely
        // clearing a "don't render" flag. That handle is still perfectly valid
        // (GetIconInfo succeeds on it), it just renders nothing, which is why
        // trusting `ci.hCursor` whenever `flags` shows it's suppressed drew
        // nothing at all even with the flag check removed. So when suppressed,
        // skip `ci.hCursor` entirely and go straight to the plain system arrow
        // at the cursor's last known position — the true cursor shape can't be
        // recovered once Windows has swapped it out, but *something* at the
        // right spot beats nothing.
        let suppressed = ci.flags != CURSOR_SHOWING;

        let mut icon_info = Default::default();
        let mut hcursor = ci.hCursor;
        if suppressed || GetIconInfo(hcursor, &mut icon_info).is_err() {
            let Ok(fallback) = LoadCursorW(None, IDC_ARROW) else { return };
            if GetIconInfo(fallback, &mut icon_info).is_err() {
                return;
            }
            hcursor = fallback;
        }

        let (w, h) = (img.width() as i32, img.height() as i32);
        if w <= 0 || h <= 0 {
            let _ = DeleteObject(HGDIOBJ::from(icon_info.hbmColor));
            let _ = DeleteObject(HGDIOBJ::from(icon_info.hbmMask));
            return;
        }

        let screen_dc = GetDC(HWND::default());
        let mem_dc = CreateCompatibleDC(screen_dc);

        let mut bmi = BITMAPINFO::default();
        bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bmi.bmiHeader.biWidth = w;
        bmi.bmiHeader.biHeight = -h; // top-down, matches RgbaImage's row order
        bmi.bmiHeader.biPlanes = 1;
        bmi.bmiHeader.biBitCount = 32;
        bmi.bmiHeader.biCompression = BI_RGB.0;

        let mut bits: *mut c_void = std::ptr::null_mut();
        let hbmp = match CreateDIBSection(mem_dc, &bmi, DIB_RGB_COLORS, &mut bits, HANDLE::default(), 0) {
            Ok(b) => b,
            Err(_) => {
                let _ = DeleteDC(mem_dc);
                ReleaseDC(HWND::default(), screen_dc);
                let _ = DeleteObject(HGDIOBJ::from(icon_info.hbmColor));
                let _ = DeleteObject(HGDIOBJ::from(icon_info.hbmMask));
                return;
            }
        };
        let old = SelectObject(mem_dc, HGDIOBJ::from(hbmp));

        if !bits.is_null() {
            let n = (w as usize) * (h as usize) * 4;
            // RGBA -> BGRA for the DIB.
            let mut buf = img.as_raw().clone();
            for px in buf.chunks_exact_mut(4) {
                px.swap(0, 2);
            }
            std::ptr::copy_nonoverlapping(buf.as_ptr(), bits as *mut u8, n);

            // ptScreenPos is the cursor's hotspot in screen coordinates; the
            // icon's top-left is offset back by the hotspot within the icon.
            let dx = ci.ptScreenPos.x - region_x - icon_info.xHotspot as i32;
            let dy = ci.ptScreenPos.y - region_y - icon_info.yHotspot as i32;
            // cxWidth/cyHeight = 0 draws at the cursor's own natural size.
            let _ = DrawIconEx(mem_dc, dx, dy, hcursor, 0, 0, 0, None, DI_NORMAL);

            let mut out = vec![0u8; n];
            std::ptr::copy_nonoverlapping(bits as *const u8, out.as_mut_ptr(), n);
            for px in out.chunks_exact_mut(4) {
                px.swap(0, 2); // BGRA -> RGBA
                px[3] = 255;
            }
            img.copy_from_slice(&out);
        }

        SelectObject(mem_dc, old);
        let _ = DeleteObject(HGDIOBJ::from(hbmp));
        let _ = DeleteDC(mem_dc);
        ReleaseDC(HWND::default(), screen_dc);
        let _ = DeleteObject(HGDIOBJ::from(icon_info.hbmColor));
        let _ = DeleteObject(HGDIOBJ::from(icon_info.hbmMask));
    }
}

/// Renders a window's own content with `PrintWindow(PW_RENDERFULLCONTENT)`. This is
/// immune to occlusion (other windows on top) and to monitor boundaries, because it
/// asks the window to paint itself into an off-screen bitmap rather than reading the
/// screen. Returns `None` if the render is empty/all-black — which happens for some
/// GPU-accelerated apps (hardware-accelerated browsers, DirectX) — so the caller can
/// fall back to a screen capture. The image is cropped to the DWM visible frame so it
/// matches the on-screen window (no invisible resize borders).
#[cfg(target_os = "windows")]
fn capture_window_printwindow(window_id: u32) -> Option<image::RgbaImage> {
    use std::ffi::c_void;
    use windows::Win32::Foundation::{HANDLE, HWND, RECT};
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC,
        SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
    };
    use windows::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};
    use windows::Win32::UI::WindowsAndMessaging::{GetWindowRect, PW_RENDERFULLCONTENT};

    unsafe {
        let hwnd = HWND(window_id as usize as *mut c_void);
        let mut wr = RECT::default();
        if GetWindowRect(hwnd, &mut wr).is_err() {
            return None;
        }
        let w = wr.right - wr.left;
        let h = wr.bottom - wr.top;
        if w <= 0 || h <= 0 {
            return None;
        }

        let screen_dc = GetDC(HWND::default());
        let mem_dc = CreateCompatibleDC(screen_dc);

        // Top-down 32-bit DIB (negative height) so pixel row 0 is the top.
        let mut bmi = BITMAPINFO::default();
        bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bmi.bmiHeader.biWidth = w;
        bmi.bmiHeader.biHeight = -h;
        bmi.bmiHeader.biPlanes = 1;
        bmi.bmiHeader.biBitCount = 32;
        bmi.bmiHeader.biCompression = BI_RGB.0;

        let mut bits: *mut c_void = std::ptr::null_mut();
        let hbmp = match CreateDIBSection(mem_dc, &bmi, DIB_RGB_COLORS, &mut bits, HANDLE::default(), 0)
        {
            Ok(b) => b,
            Err(_) => {
                let _ = DeleteDC(mem_dc);
                ReleaseDC(HWND::default(), screen_dc);
                return None;
            }
        };
        let old = SelectObject(mem_dc, HGDIOBJ::from(hbmp));

        let ok = PrintWindow(hwnd, mem_dc, PRINT_WINDOW_FLAGS(PW_RENDERFULLCONTENT)).as_bool();

        let mut result: Option<image::RgbaImage> = None;
        if ok && !bits.is_null() {
            let n = (w as usize) * (h as usize) * 4;
            let mut pixels = vec![0u8; n];
            std::ptr::copy_nonoverlapping(bits as *const u8, pixels.as_mut_ptr(), n);
            // GDI DIB is BGRA; convert to RGBA and force opaque (PrintWindow alpha
            // is not reliable).
            for px in pixels.chunks_exact_mut(4) {
                px.swap(0, 2);
                px[3] = 255;
            }
            result = image::RgbaImage::from_raw(w as u32, h as u32, pixels);
        }

        SelectObject(mem_dc, old);
        let _ = DeleteObject(HGDIOBJ::from(hbmp));
        let _ = DeleteDC(mem_dc);
        ReleaseDC(HWND::default(), screen_dc);

        let img = result?;
        // Reject an all-black render (GPU app where PrintWindow can't read the surface).
        if img.as_raw().chunks_exact(4).all(|p| p[0] == 0 && p[1] == 0 && p[2] == 0) {
            return None;
        }

        // Crop to the visible DWM frame so invisible resize borders are excluded and
        // the result lines up with the highlight/selection.
        if let Some((dx, dy, dw, dh)) = dwm_extended_frame_bounds(window_id) {
            let ox = (dx - wr.left).max(0) as u32;
            let oy = (dy - wr.top).max(0) as u32;
            let cw = dw.min(img.width().saturating_sub(ox));
            let ch = dh.min(img.height().saturating_sub(oy));
            if cw > 0 && ch > 0 {
                return Some(image::imageops::crop_imm(&img, ox, oy, cw, ch).to_image());
            }
        }
        Some(img)
    }
}

/// Captures a single window by its id (HWND on Windows). The primary path needs only
/// the id, so callers don't have to hold a (non-`Send`) `xcap::Window` — xcap is only
/// enumerated in the rare screen-capture fallback. Order: Windows.Graphics.Capture →
/// PrintWindow → per-monitor screen composite (spanning windows) → xcap per-window.
#[cfg(target_os = "windows")]
fn capture_window_smart(window_id: u32, with_cursor: bool) -> Result<DynamicImage, String> {
    // 1. Windows.Graphics.Capture — captures the window's own composed surface, so it
    //    works for GPU-accelerated apps (Chromium/Electron/DirectX) and is immune to
    //    occlusion and monitor boundaries. Primary method; handles a spanning window
    //    even when it's occluded on one display. Also the only path that can draw the
    //    cursor: WGC composites it into the frame itself when requested.
    let hwnd = window_id as usize as *mut std::ffi::c_void;
    if let Ok(img) = crate::record_win::capture_window(hwnd, with_cursor) {
        return Ok(DynamicImage::ImageRgba8(img));
    }

    // 2. PrintWindow — also renders the window's own content (occlusion/monitor
    //    immune), but returns black for some GPU apps. Fallback for pre-WGC Windows.
    if let Some(img) = capture_window_printwindow(window_id) {
        return Ok(DynamicImage::ImageRgba8(img));
    }

    // 3. Screen capture. A window spanning monitors needs a per-monitor composite of
    //    its bounds (single-window capture can't cross monitors).
    let bounds = dwm_extended_frame_bounds(window_id);
    let monitors = xcap::Monitor::all().ok();

    if let (Some((wx, wy, ww, wh)), Some(mons)) = (bounds, monitors.as_ref()) {
        let spanned = mons
            .iter()
            .filter(|m| {
                wx < m.x() + m.width() as i32
                    && wx + ww as i32 > m.x()
                    && wy < m.y() + m.height() as i32
                    && wy + wh as i32 > m.y()
            })
            .count();
        if spanned > 1 {
            if let Ok(img) = capture_rect_composited(mons, wx, wy, ww, wh) {
                return Ok(DynamicImage::ImageRgba8(img));
            }
        }
    }

    // xcap per-window capture (only reached if every content-based method failed).
    let windows = xcap::Window::all().map_err(|e| e.to_string())?;
    let win = windows
        .into_iter()
        .find(|w| w.id() == window_id)
        .ok_or_else(|| format!("Window {window_id} not found"))?;
    match win.capture_image() {
        Ok(img) => Ok(DynamicImage::ImageRgba8(img)),
        Err(e) => {
            // Last resort: a screen-region composite of the window bounds.
            if let (Some((wx, wy, ww, wh)), Some(mons)) = (bounds, monitors.as_ref()) {
                if let Ok(img) = capture_rect_composited(mons, wx, wy, ww, wh) {
                    return Ok(DynamicImage::ImageRgba8(img));
                }
            }
            Err(e.to_string())
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn capture_window_smart(window_id: u32, _with_cursor: bool) -> Result<DynamicImage, String> {
    let windows = xcap::Window::all().map_err(|e| e.to_string())?;
    let win = windows
        .into_iter()
        .find(|w| w.id() == window_id)
        .ok_or_else(|| format!("Window {window_id} not found"))?;
    let img = win.capture_image().map_err(|e| e.to_string())?;
    Ok(DynamicImage::ImageRgba8(img))
}

/// Resolves the window a "capture the active window" action should target: the
/// *real* foreground window (what the user sees focused), skipping Clipse's own
/// windows and minimized ones. The previous approach — first non-minimized
/// entry in xcap's enumeration — walks raw z-order and could land on tool
/// windows or invisible layered windows that outrank the actual app. Falls
/// back to the topmost xcap window that looks like a real app window.
#[cfg(target_os = "windows")]
fn active_window_id() -> Result<u32, String> {
    use windows::Win32::System::Threading::GetCurrentProcessId;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId, IsIconic,
    };

    unsafe {
        let hwnd = GetForegroundWindow();
        if !hwnd.is_invalid() {
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid != 0 && pid != GetCurrentProcessId() && !IsIconic(hwnd).as_bool() {
                return Ok(hwnd.0 as usize as u32);
            }
        }
    }

    let windows = xcap::Window::all().map_err(|e| e.to_string())?;
    windows
        .into_iter()
        .find(|w| !w.is_minimized() && w.width() > 0 && w.height() > 0 && !w.title().is_empty())
        .map(|w| w.id())
        .ok_or_else(|| "No visible window found".to_string())
}

#[cfg(not(target_os = "windows"))]
fn active_window_id() -> Result<u32, String> {
    let windows = xcap::Window::all().map_err(|e| e.to_string())?;
    windows
        .into_iter()
        .find(|w| !w.is_minimized() && w.width() > 0 && w.height() > 0 && !w.title().is_empty())
        .map(|w| w.id())
        .ok_or_else(|| "No visible window found".to_string())
}

/// Raises a window to the top of the z-order (and tries to activate it) so a window
/// capture isn't occluded by windows on top of it — important for the spanning-window
/// path, which composites the on-screen region of the window's bounds. `window_id`
/// is the HWND (xcap's `id()` is the HWND on Windows).
#[cfg(target_os = "windows")]
fn bring_window_to_front(window_id: u32) {
    use std::ffi::c_void;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, GetForegroundWindow, GetWindowThreadProcessId, IsIconic,
        SetForegroundWindow, SetWindowPos, ShowWindow, HWND_TOP, SWP_NOMOVE, SWP_NOSIZE,
        SWP_SHOWWINDOW, SW_RESTORE,
    };
    unsafe {
        let hwnd = HWND(window_id as usize as *mut c_void);
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }

        // Plain SetForegroundWindow is blocked by Windows' foreground lock when the
        // calling process doesn't own the foreground (it just flashes the taskbar).
        // The reliable workaround: attach our input queue to the current foreground
        // thread, which lets SetForegroundWindow/BringWindowToTop actually raise and
        // activate the target. Detach again afterward.
        let fg = GetForegroundWindow();
        let fg_thread = GetWindowThreadProcessId(fg, None);
        let cur_thread = GetCurrentThreadId();
        let attached = fg_thread != 0
            && fg_thread != cur_thread
            && AttachThreadInput(cur_thread, fg_thread, true).as_bool();

        let _ = SetWindowPos(
            hwnd,
            HWND_TOP,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
        );
        let _ = BringWindowToTop(hwnd);
        let _ = SetForegroundWindow(hwnd);

        if attached {
            let _ = AttachThreadInput(cur_thread, fg_thread, false);
        }
    }
}

/// Returns the (x, y) origin of the virtual screen in physical pixels (xcap coordinates).
/// The overlay window starts at this position; the frontend uses this value plus
/// (CSS_pixel * devicePixelRatio) to compute global physical coordinates for capture.
#[command]
pub async fn get_virtual_screen_origin() -> Result<(f64, f64), String> {
    let (x, y, _, _) = window::virtual_screen_bounds()?;
    Ok((x, y))
}

/// Opens the overlay window so the user can select a capture region (CAP-01 / CAP-04).
#[command]
pub async fn open_region_overlay(app: AppHandle) -> Result<(), String> {
    window::open_overlay(&app)
}

/// Opens the overlay in scrolling-capture mode: the selected region is captured
/// repeatedly while scrolling and stitched into one tall image. The mode flag
/// is set inside `open_overlay_mode` *before* the overlays are shown, so the
/// prewarmed pool's near-instant mode fetch can't race it.
#[command]
pub async fn open_region_overlay_scroll(app: AppHandle) -> Result<(), String> {
    window::open_overlay_mode(&app, true)
}

/// Whether the overlay is currently in scrolling-capture mode (queried by the overlay).
#[command]
pub async fn get_scroll_mode(app: AppHandle) -> Result<bool, String> {
    let state = app.state::<AppState>();
    let guard = state.scroll_mode.lock().map_err(|e| e.to_string())?;
    Ok(*guard)
}

/// Cancels region selection: hides every per-monitor overlay window (they stay
/// alive as the prewarmed pool for the next capture). Called by any overlay on
/// Esc, since only the focused overlay receives the key event but all of them
/// must go away.
#[command]
pub async fn cancel_overlay(app: AppHandle) -> Result<(), String> {
    window::hide_all_overlays(&app);
    window::release_capture(&app);
    clear_frozen_frame(&app);
    Ok(())
}

/// Frees the PrintScreen-time frozen snapshot (if any) — it can be several MB
/// (a whole virtual-desktop RGBA buffer) and must not outlive the capture
/// pipeline it was taken for, or a stale frame could show up in the next one.
fn clear_frozen_frame(app: &AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut g) = state.frozen_frame.lock() {
            *g = None;
        }
    }
}

fn set_scroll_mode(app: &AppHandle, on: bool) {
    if let Ok(mut g) = app.state::<AppState>().scroll_mode.lock() {
        *g = on;
    }
}

/// Releases the shared "capturing" flag when a capture pipeline finishes —
/// success, error, or an early `?` return all drop this and run it. Bind to a
/// variable (`let _guard = ...`) at the top of any command that represents the
/// tail end of a capture (the `complete_*` commands, which follow an
/// `open_overlay` that claimed the flag) or a whole self-contained capture
/// (`do_window_capture`/`do_fullscreen_capture`, which claim it themselves).
struct CaptureReleaseGuard(AppHandle);

impl Drop for CaptureReleaseGuard {
    fn drop(&mut self) {
        window::release_capture(&self.0);
        clear_frozen_frame(&self.0);
    }
}

/// Called by the overlay once the user has finished selecting a region.
/// Accepts physical-pixel global coordinates (CSS coords × devicePixelRatio from the frontend).
/// Captures the region, auto-saves, stores in pending state, then opens the editor (CAP-01 / CAP-05).
#[command]
pub async fn complete_region_capture(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    window_id: Option<u32>,
) -> Result<(), String> {
    let _release = CaptureReleaseGuard(app.clone());

    // Remember the selection so "repeat last region" can re-capture the same
    // spot later without an overlay round-trip.
    if width >= 1.0 && height >= 1.0 {
        if let Ok(mut g) = app.state::<AppState>().last_region.lock() {
            *g = Some((x as i32, y as i32, width as u32, height as u32));
        }
    }

    // Crop from the PrintScreen-time frozen snapshot when available, so whatever
    // was on screen at that instant — a right-click menu included — survives
    // into the capture, uniformly for every selection mode. No raise-to-front
    // for the owning window (sub-element selection) here: since the crop is
    // already fixed at freeze time, raising it afterward can't change what was
    // captured, and doing it anyway used to just bake in visual confusion
    // (window flashes to front, capture still shows it as it was at freeze
    // time) — dropped in favor of consistent behavior across all modes.
    if let Some(bytes) = try_crop_frozen(&app, x as i32, y as i32, width as u32, height as u32) {
        window::hide_all_overlays(&app);
        return finish_capture_flow(&app, bytes).await;
    }

    // Hide overlays immediately so they don't appear in the (live) capture below.
    // hide() removes them from DWM compositing faster than close().
    window::hide_all_overlays(&app);

    // When the region belongs to a window (e.g. a sub-element selection), raise that
    // window to the front first so other windows don't occlude the captured region.
    #[cfg(target_os = "windows")]
    if let Some(id) = window_id {
        bring_window_to_front(id);
    }

    // Brief pause so the hide (and the raise, if any) is composited before we capture.
    let settle = if window_id.is_some() { 150 } else { 80 };
    tokio::time::sleep(std::time::Duration::from_millis(settle)).await;

    // Try DXGI physical-pixel capture first; fall back to xcap/GDI on error.
    // All capture types are non-Send, so keep everything inside a sync closure
    // that is dropped before the next await point.
    let png = (|| -> Result<Vec<u8>, String> {
        // Composite across every monitor the region touches. A region drag can
        // span two monitors (the originating overlay keeps an implicit mouse
        // capture across the boundary), so single-monitor capture would clip the
        // far side. capture_rect_composited stitches each monitor's slice
        // (DXGI physical → xcap/GDI fallback per monitor).
        #[cfg(target_os = "windows")]
        if width > 0.0 && height > 0.0 {
            if let Ok(monitors) = xcap::Monitor::all() {
                match capture_rect_composited(&monitors, x as i32, y as i32, width as u32, height as u32) {
                    Ok(mut img) => {
                        if crate::settings::current(&app).capture_cursor {
                            overlay_cursor(&mut img, x as i32, y as i32);
                        }
                        return dynamic_to_png_bytes(DynamicImage::ImageRgba8(img));
                    }
                    Err(_e) => {
                        #[cfg(debug_assertions)]
                        eprintln!("[capture] composited region failed ({_e}), falling back to single-monitor xcap/GDI");
                    }
                }
            }
        }

        // xcap/GDI fallback (single monitor; captures at logical/DPI-scaled resolution)
        let monitors = xcap::Monitor::all().map_err(|e| e.to_string())?;
        let monitor = monitors
            .iter()
            .find(|m| {
                x >= m.x() as f64
                    && y >= m.y() as f64
                    && x < (m.x() + m.width() as i32) as f64
                    && y < (m.y() + m.height() as i32) as f64
            })
            .ok_or_else(|| "No monitor found for the selected region".to_string())?;

        let screen_img = monitor.capture_image().map_err(|e| e.to_string())?;
        let dynamic = DynamicImage::ImageRgba8(screen_img);

        let img_scale_x = dynamic.width() as f64 / monitor.width() as f64;
        let img_scale_y = dynamic.height() as f64 / monitor.height() as f64;

        let local_x = ((x - monitor.x() as f64) * img_scale_x).max(0.0) as u32;
        let local_y = ((y - monitor.y() as f64) * img_scale_y).max(0.0) as u32;

        let crop_w = ((width * img_scale_x) as u32).min(dynamic.width().saturating_sub(local_x));
        let crop_h = ((height * img_scale_y) as u32).min(dynamic.height().saturating_sub(local_y));

        #[cfg(debug_assertions)]
        eprintln!(
            "[capture/gdi] recv=({x},{y},{width},{height}) mon=({},{},{},{}) img={}x{} scale=({img_scale_x:.4},{img_scale_y:.4}) local=({local_x},{local_y}) crop=({crop_w},{crop_h})",
            monitor.x(), monitor.y(), monitor.width(), monitor.height(),
            dynamic.width(), dynamic.height(),
        );

        if crop_w == 0 || crop_h == 0 {
            return Err("Selection too small".to_string());
        }

        let cropped = dynamic.crop_imm(local_x, local_y, crop_w, crop_h);

        // Honor the capture-cursor setting on this fallback path too — the
        // composited path above already does, and the setting silently doing
        // nothing depending on which internal path won is a bug, not a policy.
        #[cfg(target_os = "windows")]
        if crate::settings::current(&app).capture_cursor {
            let mut rgba = cropped.to_rgba8();
            overlay_cursor(&mut rgba, x as i32, y as i32);
            return dynamic_to_png_bytes(DynamicImage::ImageRgba8(rgba));
        }

        dynamic_to_png_bytes(cropped)
    })()?; // all capture types dropped here

    // Overlays stay hidden (not closed) so the prewarmed pool survives for the
    // next capture — see window::open_overlay.

    finish_capture_flow(&app, png).await
}

/// Scrolling capture: captures the selected region repeatedly while scrolling,
/// stitches the frames into one tall image, then opens the editor. Windows-only.
#[command]
pub async fn complete_scroll_capture(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let _release = CaptureReleaseGuard(app.clone());
    set_scroll_mode(&app, false);

    window::hide_all_overlays(&app);
    tokio::time::sleep(std::time::Duration::from_millis(120)).await;

    // The overlay (and its "Scrolling & stitching…" hint) is already hidden above,
    // so without this the user has zero on-screen feedback for however long the
    // scroll-and-stitch loop below takes — hard to tell it's still running, let
    // alone when it finishes. Closed again as soon as the blocking task returns,
    // success or error, so it can never outlive the capture it represents.
    window::show_scroll_progress(&app);

    // The scroll loop is long-running, blocking, and uses non-Send capture
    // types, so run it on a blocking thread.
    let (xi, yi, wi, hi) = (x as i32, y as i32, width as u32, height as u32);
    let scroll_settings = crate::settings::current(&app).scroll;
    let result: Result<Result<image::RgbaImage, String>, String> = tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            crate::scroll_win::capture_scrolling(
                xi,
                yi,
                wi,
                hi,
                scroll_settings.settle_ms,
                scroll_settings.crop_scrollbar,
            )
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = (xi, yi, wi, hi, scroll_settings);
            Err::<image::RgbaImage, String>("Scrolling capture is Windows-only".into())
        }
    })
    .await
    .map_err(|e| e.to_string());
    window::close_scroll_progress(&app);
    let img = result??;

    let png = dynamic_to_png_bytes(DynamicImage::ImageRgba8(img))?;
    finish_capture_flow(&app, png).await
}

/// Captures the currently focused window and opens the editor (CAP-02 / CAP-05).
#[command]
pub async fn do_window_capture(app: AppHandle) -> Result<(), String> {
    if !window::try_claim_capture(&app) {
        return Err("A capture is already in progress".to_string());
    }
    let _release = CaptureReleaseGuard(app.clone());

    // Hide main window so it doesn't appear in focus. The settle sleep is only
    // needed when it was actually visible (tray-triggered captures usually start
    // with the gallery already hidden — skip the 150ms entirely then).
    if let Some(main) = app.get_webview_window("main") {
        if main.is_visible().unwrap_or(true) {
            main.hide().map_err(|e| e.to_string())?;
            tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        }
    }

    // Identify the target (foreground) window first, so we can raise it to the
    // front before capturing.
    let window_id = active_window_id()?;

    #[cfg(target_os = "windows")]
    bring_window_to_front(window_id);
    // WGC captures the window's own surface (occlusion-independent), so this only needs
    // to be long enough for a minimized window to finish restoring, not to settle on top.
    tokio::time::sleep(std::time::Duration::from_millis(60)).await;

    let png = dynamic_to_png_bytes(capture_window_smart(window_id, crate::settings::current(&app).capture_cursor)?)?;

    finish_capture_flow(&app, png).await
}

/// Captures the primary monitor's full screen and opens the editor (CAP-03 / CAP-05).
#[command]
pub async fn do_fullscreen_capture(app: AppHandle, monitor_id: Option<u32>) -> Result<(), String> {
    if !window::try_claim_capture(&app) {
        return Err("A capture is already in progress".to_string());
    }
    let _release = CaptureReleaseGuard(app.clone());

    // Hide main window; skip the settle sleep when it was already hidden
    // (the common case for tray/hotkey-triggered captures).
    if let Some(main) = app.get_webview_window("main") {
        if main.is_visible().unwrap_or(true) {
            main.hide().map_err(|e| e.to_string())?;
            tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        }
    }

    // xcap::Monitor is not Send — complete all xcap work inside a sync closure
    let png = (|| -> Result<Vec<u8>, String> {
        let monitors = xcap::Monitor::all().map_err(|e| e.to_string())?;
        let monitor = match monitor_id {
            Some(id) => monitors
                .into_iter()
                .find(|m| m.id() == id)
                .ok_or_else(|| format!("Monitor {} not found", id))?,
            None => monitors
                .into_iter()
                .find(|m| m.is_primary())
                .ok_or_else(|| "No primary monitor found".to_string())?,
        };

        // DXGI path: physical-pixel resolution
        #[cfg(target_os = "windows")]
        match crate::capture_win::capture_region_physical(
            monitor.x(),
            monitor.y(),
            monitor.width(),
            monitor.height(),
        ) {
            Ok(mut img) => {
                if crate::settings::current(&app).capture_cursor {
                    overlay_cursor(&mut img, monitor.x(), monitor.y());
                }
                return dynamic_to_png_bytes(DynamicImage::ImageRgba8(img));
            }
            Err(_e) => {
                #[cfg(debug_assertions)]
                eprintln!("[capture] DXGI failed ({_e}), falling back to xcap/GDI");
            }
        }

        let mut img = monitor.capture_image().map_err(|e| e.to_string())?;
        #[cfg(target_os = "windows")]
        if crate::settings::current(&app).capture_cursor {
            overlay_cursor(&mut img, monitor.x(), monitor.y());
        }
        dynamic_to_png_bytes(DynamicImage::ImageRgba8(img))
    })()?; // monitor is dropped here

    finish_capture_flow(&app, png).await
}

/// Captures the monitor currently under the mouse cursor and opens the editor,
/// without ever showing an overlay or focusing any Clipse window beforehand.
/// Bound to Ctrl+PrintScreen (`hook_win.rs`), specifically so a fullscreen
/// capture can include transient desktop UI that a focus change would
/// dismiss — most notably an open right-click context menu, which closes the
/// instant any other window is activated. The normal PrintScreen→overlay flow
/// can't offer this guarantee (showing/focusing the overlay is itself what
/// closes the menu), so this is a deliberately separate, overlay-free path.
#[command]
pub async fn do_cursor_monitor_capture(app: AppHandle) -> Result<(), String> {
    if !window::try_claim_capture(&app) {
        return Err("A capture is already in progress".to_string());
    }
    let _release = CaptureReleaseGuard(app.clone());

    // Hide main window; skip the settle sleep when it was already hidden
    // (the common case for tray/hotkey-triggered captures). Hiding an
    // already-unfocused window doesn't steal activation from whatever has
    // it, so this can't dismiss the very menu we're trying to preserve.
    if let Some(main) = app.get_webview_window("main") {
        if main.is_visible().unwrap_or(true) {
            main.hide().map_err(|e| e.to_string())?;
            tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        }
    }

    // xcap::Monitor is not Send — complete all xcap work inside a sync closure
    let png = (|| -> Result<Vec<u8>, String> {
        let monitors = xcap::Monitor::all().map_err(|e| e.to_string())?;
        let (cx, cy) = cursor_position();
        let monitor = monitors
            .iter()
            .find(|m| {
                cx >= m.x() && cx < m.x() + m.width() as i32 && cy >= m.y() && cy < m.y() + m.height() as i32
            })
            .or_else(|| monitors.iter().find(|m| m.is_primary()))
            .ok_or_else(|| "No monitor found under the cursor".to_string())?;

        // DXGI path: physical-pixel resolution
        #[cfg(target_os = "windows")]
        match crate::capture_win::capture_region_physical(
            monitor.x(),
            monitor.y(),
            monitor.width(),
            monitor.height(),
        ) {
            Ok(mut img) => {
                if crate::settings::current(&app).capture_cursor {
                    overlay_cursor(&mut img, monitor.x(), monitor.y());
                }
                return dynamic_to_png_bytes(DynamicImage::ImageRgba8(img));
            }
            Err(_e) => {
                #[cfg(debug_assertions)]
                eprintln!("[capture] DXGI failed ({_e}), falling back to xcap/GDI");
            }
        }

        let mut img = monitor.capture_image().map_err(|e| e.to_string())?;
        #[cfg(target_os = "windows")]
        if crate::settings::current(&app).capture_cursor {
            overlay_cursor(&mut img, monitor.x(), monitor.y());
        }
        dynamic_to_png_bytes(DynamicImage::ImageRgba8(img))
    })()?; // monitor is dropped here

    finish_capture_flow(&app, png).await
}

/// Physical-pixel mouse cursor position. Falls back to `(0, 0)` off-Windows or
/// on failure, in which case the caller falls back to the primary monitor.
#[cfg(target_os = "windows")]
fn cursor_position() -> (i32, i32) {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    unsafe {
        let mut pt = POINT::default();
        if GetCursorPos(&mut pt).is_ok() {
            (pt.x, pt.y)
        } else {
            (0, 0)
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn cursor_position() -> (i32, i32) {
    (0, 0)
}

/// Captures a physical-pixel rect of the virtual desktop — multi-monitor
/// composite with per-monitor DXGI→GDI fallback on Windows, single-monitor
/// xcap elsewhere — honoring the capture-cursor setting, encoded as PNG.
/// Shared by the overlay-free capture commands below. Uses only `Send` types
/// after the sync section, so callers can `.await` afterwards.
fn capture_region_png(app: &AppHandle, x: i32, y: i32, w: u32, h: u32) -> Result<Vec<u8>, String> {
    if w == 0 || h == 0 {
        return Err("Empty capture region".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let monitors = xcap::Monitor::all().map_err(|e| e.to_string())?;
        let mut img = capture_rect_composited(&monitors, x, y, w, h)?;
        if crate::settings::current(app).capture_cursor {
            overlay_cursor(&mut img, x, y);
        }
        dynamic_to_png_bytes(DynamicImage::ImageRgba8(img))
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        let monitors = xcap::Monitor::all().map_err(|e| e.to_string())?;
        let m = monitors
            .iter()
            .find(|m| {
                x >= m.x()
                    && y >= m.y()
                    && x < m.x() + m.width() as i32
                    && y < m.y() + m.height() as i32
            })
            .ok_or_else(|| "No monitor found for the region".to_string())?;
        let img = m.capture_image().map_err(|e| e.to_string())?;
        let dynamic = DynamicImage::ImageRgba8(img);
        let lx = (x - m.x()).max(0) as u32;
        let ly = (y - m.y()).max(0) as u32;
        let cw = w.min(dynamic.width().saturating_sub(lx));
        let ch = h.min(dynamic.height().saturating_sub(ly));
        if cw == 0 || ch == 0 {
            return Err("Region empty after clipping".to_string());
        }
        dynamic_to_png_bytes(dynamic.crop_imm(lx, ly, cw, ch))
    }
}

/// Re-captures the exact rect of the most recent completed region selection —
/// no overlay round-trip, no re-selecting (ShareX's "capture last region").
/// Errors when no region capture has completed yet this session.
#[command]
pub async fn do_repeat_region_capture(app: AppHandle) -> Result<(), String> {
    if !window::try_claim_capture(&app) {
        return Err("A capture is already in progress".to_string());
    }
    let _release = CaptureReleaseGuard(app.clone());

    let (x, y, w, h) = {
        let state = app.state::<AppState>();
        let guard = state.last_region.lock().map_err(|e| e.to_string())?;
        guard.ok_or("No previous region to repeat")?
    };

    if let Some(main) = app.get_webview_window("main") {
        if main.is_visible().unwrap_or(true) {
            main.hide().map_err(|e| e.to_string())?;
        }
    }
    // Unlike `do_cursor_monitor_capture` (hotkey-triggered, must NOT delay so
    // it doesn't dismiss the very context menu it's meant to preserve), this
    // command is only ever invoked from Clipse's own tray menu — so the
    // transient UI still on screen right after the click is *our* menu
    // closing, not something to preserve. Always wait for it to finish
    // dismissing/DWM to recomposite, or its closing frame bleeds into the
    // capture.
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;

    let png = capture_region_png(&app, x, y, w, h)?;
    finish_capture_flow(&app, png).await
}

/// Captures the entire virtual desktop — every monitor composited into one
/// image (ShareX/Greenshot "fullscreen" semantics) — and opens the editor.
#[command]
pub async fn do_virtual_desktop_capture(app: AppHandle) -> Result<(), String> {
    if !window::try_claim_capture(&app) {
        return Err("A capture is already in progress".to_string());
    }
    let _release = CaptureReleaseGuard(app.clone());

    if let Some(main) = app.get_webview_window("main") {
        if main.is_visible().unwrap_or(true) {
            main.hide().map_err(|e| e.to_string())?;
        }
    }
    // Only ever invoked from Clipse's own tray menu — see the identical
    // comment in `do_repeat_region_capture` above.
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;

    let (x, y, w, h) = window::virtual_screen_bounds()?;
    let png = capture_region_png(&app, x as i32, y as i32, w as u32, h as u32)?;
    finish_capture_flow(&app, png).await
}

/// Closes the overlay then captures a specific window by its xcap ID (CAP-smart).
/// Called when the user clicks on a highlighted window in the overlay.
#[command]
pub async fn complete_window_capture_by_id(app: AppHandle, window_id: u32) -> Result<(), String> {
    let _release = CaptureReleaseGuard(app.clone());

    // Crop the window's own rect out of the PrintScreen-time frozen snapshot when
    // available, so this mode behaves consistently with fullscreen/region
    // selection rather than switching capture strategy per mode. No raise-to-
    // front: the crop is already fixed at freeze time, so raising the window
    // afterward can't change what was captured — it would only cause visual
    // confusion (window flashes to front, capture still shows how things
    // looked at freeze time, occluded or not).
    #[cfg(target_os = "windows")]
    if let Some((x, y, w, h)) = dwm_extended_frame_bounds(window_id) {
        if let Some(bytes) = try_crop_frozen(&app, x, y, w, h) {
            window::hide_all_overlays(&app);
            return finish_capture_flow(&app, bytes).await;
        }
    }

    // Fallback path (no frozen frame available): live capture via WGC/PrintWindow,
    // occlusion-independent, so raising the window first is what makes it show
    // up unoccluded here (unlike the frozen-crop path above).
    window::hide_all_overlays(&app);
    #[cfg(target_os = "windows")]
    bring_window_to_front(window_id);
    tokio::time::sleep(std::time::Duration::from_millis(60)).await;

    let png = dynamic_to_png_bytes(capture_window_smart(window_id, crate::settings::current(&app).capture_cursor)?)?;

    finish_capture_flow(&app, png).await
}

/// Closes the overlay then captures a full monitor by its xcap ID (CAP-smart).
/// Called when the user clicks on an area with no window in the overlay.
#[command]
pub async fn complete_monitor_capture(app: AppHandle, monitor_id: u32) -> Result<(), String> {
    let _release = CaptureReleaseGuard(app.clone());
    window::hide_all_overlays(&app);

    // Crop from the PrintScreen-time frozen snapshot when available, so any
    // transient UI present at that instant (a right-click menu, most notably)
    // survives into the capture instead of a live re-grab that would miss it.
    let frozen = (|| -> Option<Vec<u8>> {
        let monitors = xcap::Monitor::all().ok()?;
        let monitor = monitors.into_iter().find(|m| m.id() == monitor_id)?;
        try_crop_frozen(&app, monitor.x(), monitor.y(), monitor.width(), monitor.height())
    })();
    if let Some(bytes) = frozen {
        return finish_capture_flow(&app, bytes).await;
    }

    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    let png = (|| -> Result<Vec<u8>, String> {
        let monitors = xcap::Monitor::all().map_err(|e| e.to_string())?;
        let monitor = monitors
            .into_iter()
            .find(|m| m.id() == monitor_id)
            .ok_or_else(|| format!("Monitor {} not found", monitor_id))?;

        #[cfg(target_os = "windows")]
        match crate::capture_win::capture_region_physical(
            monitor.x(),
            monitor.y(),
            monitor.width(),
            monitor.height(),
        ) {
            Ok(mut img) => {
                if crate::settings::current(&app).capture_cursor {
                    overlay_cursor(&mut img, monitor.x(), monitor.y());
                }
                return dynamic_to_png_bytes(DynamicImage::ImageRgba8(img));
            }
            Err(_e) => {
                #[cfg(debug_assertions)]
                eprintln!("[capture] DXGI failed ({_e}), falling back to xcap/GDI");
            }
        }

        let mut img = monitor.capture_image().map_err(|e| e.to_string())?;
        #[cfg(target_os = "windows")]
        if crate::settings::current(&app).capture_cursor {
            overlay_cursor(&mut img, monitor.x(), monitor.y());
        }
        dynamic_to_png_bytes(DynamicImage::ImageRgba8(img))
    })()?;

    finish_capture_flow(&app, png).await
}

/// Serves one overlay window's own slice of the PrintScreen-time frozen desktop
/// snapshot (see `freeze_desktop`), as a raw binary IPC response (PNG bytes) —
/// same raw-binary pattern as `get_pending_image`, since a full-desktop frame
/// can be tens of MB. The caller passes its own physical bounds (from
/// `outerPosition`/`outerSize`), so no monitor-index bookkeeping is needed on
/// either side. An empty body means no frozen frame is available (freeze
/// failed, off-Windows, or this overlay wasn't shown via the PrintScreen
/// flow) — the frontend then falls back to the window's own transparency.
#[command]
pub async fn get_frozen_frame(
    app: AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<tauri::ipc::Response, String> {
    let bytes = try_crop_frozen(&app, x, y, width, height).unwrap_or_default();
    Ok(tauri::ipc::Response::new(bytes))
}

/// Returns the pending image stored after the most recent capture, as a raw
/// binary IPC response (no base64/JSON round-trip — the image can be tens of
/// MB at physical resolution). An empty body means "no pending image"; the
/// frontend checks `byteLength`. Called by the editor window on mount/reload.
#[command]
pub async fn get_pending_image(app: AppHandle) -> Result<tauri::ipc::Response, String> {
    let state = app.state::<AppState>();
    let bytes = state
        .pending_image
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .unwrap_or_default();
    Ok(tauri::ipc::Response::new(bytes))
}

/// Returns the on-disk path of the capture being edited (for in-place save).
#[command]
pub async fn get_pending_path(app: AppHandle) -> Result<Option<String>, String> {
    let state = app.state::<AppState>();
    let guard = state.pending_path.lock().map_err(|e| e.to_string())?;
    Ok(guard.clone())
}

// ===== Helpers =====

/// Auto-saves the image, stores it as the pending image, then opens the editor.
/// Takes raw PNG bytes — the whole pipeline (save → clipboard → editor pickup)
/// works on the same buffer without any base64 encode/decode or reclone.
pub async fn finish_capture_flow(app: &AppHandle, png: Vec<u8>) -> Result<(), String> {
    use crate::commands::storage;

    // Auto-save to captures dir
    let saved_path = storage::auto_save_png(app, &png)?;

    // Optionally copy the fresh capture to the clipboard (setting).
    if crate::settings::current(app).auto_copy {
        if let Err(e) = crate::commands::clipboard::write_image_bytes_to_clipboard(&png, app) {
            eprintln!("[capture] auto-copy failed: {e}");
        }
    }

    // Notify the gallery to refresh
    app.emit("capture-saved", ()).map_err(|e| e.to_string())?;

    // Store for the editor to pick up (image + its on-disk path)
    {
        let state = app.state::<AppState>();
        let mut guard = state.pending_image.lock().map_err(|e| e.to_string())?;
        *guard = Some(png);
        let mut path_guard = state.pending_path.lock().map_err(|e| e.to_string())?;
        *path_guard = Some(saved_path);
    }

    window::open_editor(app)
}

/// Encodes to PNG with fast compression: this buffer is a transit format
/// (editor display, clipboard decode, disk write), so encode speed matters far
/// more than the last few percent of size. `png`'s fast mode (fdeflate) is
/// several times quicker than the default zlib profile on screenshot content
/// for a modest size penalty.
fn dynamic_to_png_bytes(img: DynamicImage) -> Result<Vec<u8>, String> {
    use image::codecs::png::{CompressionType, FilterType, PngEncoder};

    let mut buf = Vec::new();
    let enc = PngEncoder::new_with_quality(&mut buf, CompressionType::Fast, FilterType::Adaptive);
    img.write_with_encoder(enc).map_err(|e| e.to_string())?;
    Ok(buf)
}

fn dynamic_to_base64_png(img: DynamicImage) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    Ok(STANDARD.encode(dynamic_to_png_bytes(img)?))
}

// ===== Low-level capture commands (used directly from frontend) =====

/// Captures the full screen of a monitor; returns base64 PNG.
#[command]
pub async fn capture_fullscreen(monitor_id: Option<u32>) -> Result<String, String> {
    let monitors = xcap::Monitor::all().map_err(|e| e.to_string())?;
    let monitor = match monitor_id {
        Some(id) => monitors
            .into_iter()
            .find(|m| m.id() == id)
            .ok_or_else(|| format!("Monitor {} not found", id))?,
        None => monitors
            .into_iter()
            .find(|m| m.is_primary())
            .ok_or_else(|| "No primary monitor found".to_string())?,
    };

    #[cfg(target_os = "windows")]
    if let Ok(img) = crate::capture_win::capture_region_physical(
        monitor.x(),
        monitor.y(),
        monitor.width(),
        monitor.height(),
    ) {
        return dynamic_to_base64_png(DynamicImage::ImageRgba8(img));
    }

    let img = monitor.capture_image().map_err(|e| e.to_string())?;
    dynamic_to_base64_png(DynamicImage::ImageRgba8(img))
}

/// Captures the currently focused window; returns base64 PNG.
#[command]
pub async fn capture_active_window() -> Result<String, String> {
    let window_id = active_window_id()?;

    #[cfg(target_os = "windows")]
    bring_window_to_front(window_id);
    tokio::time::sleep(std::time::Duration::from_millis(60)).await;

    capture_window_smart(window_id, false).and_then(dynamic_to_base64_png)
}

/// Captures a screen region from physical-pixel coordinates; returns base64 PNG.
#[command]
pub async fn capture_region(args: RegionArgs) -> Result<String, String> {
    // Composite across every monitor the region touches (handles regions that
    // span monitor boundaries); fall back to single-monitor crop below.
    #[cfg(target_os = "windows")]
    if let Ok(monitors) = xcap::Monitor::all() {
        if let Ok(img) =
            capture_rect_composited(&monitors, args.x, args.y, args.width, args.height)
        {
            return dynamic_to_base64_png(DynamicImage::ImageRgba8(img));
        }
    }

    let monitors = xcap::Monitor::all().map_err(|e| e.to_string())?;
    let monitor = monitors
        .iter()
        .find(|m| {
            args.x >= m.x()
                && args.y >= m.y()
                && args.x < m.x() + m.width() as i32
                && args.y < m.y() + m.height() as i32
        })
        .ok_or_else(|| "No monitor found for the given region".to_string())?;

    let screen_img = monitor.capture_image().map_err(|e| e.to_string())?;
    let dynamic = DynamicImage::ImageRgba8(screen_img);
    let img_scale_x = dynamic.width() as f64 / monitor.width() as f64;
    let img_scale_y = dynamic.height() as f64 / monitor.height() as f64;
    let local_x = (((args.x - monitor.x()) as f64) * img_scale_x).max(0.0) as u32;
    let local_y = (((args.y - monitor.y()) as f64) * img_scale_y).max(0.0) as u32;
    let crop_w = ((args.width as f64 * img_scale_x) as u32).min(dynamic.width().saturating_sub(local_x));
    let crop_h = ((args.height as f64 * img_scale_y) as u32).min(dynamic.height().saturating_sub(local_y));
    let cropped = dynamic.crop_imm(local_x, local_y, crop_w, crop_h);
    dynamic_to_base64_png(cropped)
}
