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
/// All UIA/COM work is synchronous and finishes before returning (no `.await` inside).
#[command]
pub async fn get_element_rects(window_id: u32) -> Result<Vec<ElementRect>, String> {
    let rects = crate::uia_win::element_rects(window_id);
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
fn capture_window_smart(window_id: u32) -> Result<DynamicImage, String> {
    // 1. Windows.Graphics.Capture — captures the window's own composed surface, so it
    //    works for GPU-accelerated apps (Chromium/Electron/DirectX) and is immune to
    //    occlusion and monitor boundaries. Primary method; handles a spanning window
    //    even when it's occluded on one display.
    let hwnd = window_id as usize as *mut std::ffi::c_void;
    if let Ok(img) = crate::record_win::capture_window(hwnd) {
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
fn capture_window_smart(window_id: u32) -> Result<DynamicImage, String> {
    let windows = xcap::Window::all().map_err(|e| e.to_string())?;
    let win = windows
        .into_iter()
        .find(|w| w.id() == window_id)
        .ok_or_else(|| format!("Window {window_id} not found"))?;
    let img = win.capture_image().map_err(|e| e.to_string())?;
    Ok(DynamicImage::ImageRgba8(img))
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
/// repeatedly while scrolling and stitched into one tall image.
/// `open_overlay` resets the flag to false, so set it true *after* opening.
#[command]
pub async fn open_region_overlay_scroll(app: AppHandle) -> Result<(), String> {
    window::open_overlay(&app)?;
    set_scroll_mode(&app, true);
    Ok(())
}

/// Whether the overlay is currently in scrolling-capture mode (queried by the overlay).
#[command]
pub async fn get_scroll_mode(app: AppHandle) -> Result<bool, String> {
    let state = app.state::<AppState>();
    let guard = state.scroll_mode.lock().map_err(|e| e.to_string())?;
    Ok(*guard)
}

/// Cancels region selection: closes every per-monitor overlay window. Called by
/// any overlay on Esc, since only the focused overlay receives the key event but
/// all of them must close.
#[command]
pub async fn cancel_overlay(app: AppHandle) -> Result<(), String> {
    window::close_all_overlays(&app);
    Ok(())
}

fn set_scroll_mode(app: &AppHandle, on: bool) {
    if let Ok(mut g) = app.state::<AppState>().scroll_mode.lock() {
        *g = on;
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
    // Hide overlays immediately so they don't appear in the capture.
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
    let b64 = (|| -> Result<String, String> {
        // Composite across every monitor the region touches. A region drag can
        // span two monitors (the originating overlay keeps an implicit mouse
        // capture across the boundary), so single-monitor capture would clip the
        // far side. capture_rect_composited stitches each monitor's slice
        // (DXGI physical → xcap/GDI fallback per monitor).
        #[cfg(target_os = "windows")]
        if width > 0.0 && height > 0.0 {
            if let Ok(monitors) = xcap::Monitor::all() {
                match capture_rect_composited(&monitors, x as i32, y as i32, width as u32, height as u32) {
                    Ok(img) => return dynamic_to_base64_png(DynamicImage::ImageRgba8(img)),
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
        dynamic_to_base64_png(cropped)
    })()?; // all capture types dropped here

    // Close the now-hidden overlays after capture
    window::close_all_overlays(&app);

    finish_capture_flow(&app, b64).await
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
    set_scroll_mode(&app, false);

    window::hide_all_overlays(&app);
    tokio::time::sleep(std::time::Duration::from_millis(120)).await;

    // The scroll loop is long-running, blocking, and uses non-Send capture
    // types, so run it on a blocking thread.
    let (xi, yi, wi, hi) = (x as i32, y as i32, width as u32, height as u32);
    let scroll_settings = crate::settings::current(&app).scroll;
    let img: image::RgbaImage = tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            crate::scroll_win::capture_scrolling(
                xi,
                yi,
                wi,
                hi,
                scroll_settings.notches,
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
    .map_err(|e| e.to_string())??;

    window::close_all_overlays(&app);

    let b64 = dynamic_to_base64_png(DynamicImage::ImageRgba8(img))?;
    finish_capture_flow(&app, b64).await
}

/// Captures the currently focused window and opens the editor (CAP-02 / CAP-05).
#[command]
pub async fn do_window_capture(app: AppHandle) -> Result<(), String> {
    // Hide main window so it doesn't appear in focus
    if let Some(main) = app.get_webview_window("main") {
        main.hide().map_err(|e| e.to_string())?;
    }
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;

    // Identify the target (topmost visible) window first, so we can raise it to the
    // front before capturing. xcap::Window is !Send, so resolve the id in a closure
    // that drops before the next await.
    let window_id = (|| -> Result<u32, String> {
        let windows = xcap::Window::all().map_err(|e| e.to_string())?;
        let win = windows
            .into_iter()
            .find(|w| !w.is_minimized())
            .ok_or_else(|| "No visible window found".to_string())?;
        Ok(win.id())
    })()?;

    #[cfg(target_os = "windows")]
    bring_window_to_front(window_id);
    // WGC captures the window's own surface (occlusion-independent), so this only needs
    // to be long enough for a minimized window to finish restoring, not to settle on top.
    tokio::time::sleep(std::time::Duration::from_millis(60)).await;

    let b64 = dynamic_to_base64_png(capture_window_smart(window_id)?)?;

    finish_capture_flow(&app, b64).await
}

/// Captures the primary monitor's full screen and opens the editor (CAP-03 / CAP-05).
#[command]
pub async fn do_fullscreen_capture(app: AppHandle, monitor_id: Option<u32>) -> Result<(), String> {
    // Hide main window
    if let Some(main) = app.get_webview_window("main") {
        main.hide().map_err(|e| e.to_string())?;
    }
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;

    // xcap::Monitor is not Send — complete all xcap work inside a sync closure
    let b64 = (|| -> Result<String, String> {
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
            Ok(img) => return dynamic_to_base64_png(DynamicImage::ImageRgba8(img)),
            Err(_e) => {
                #[cfg(debug_assertions)]
                eprintln!("[capture] DXGI failed ({_e}), falling back to xcap/GDI");
            }
        }

        let img = monitor.capture_image().map_err(|e| e.to_string())?;
        dynamic_to_base64_png(DynamicImage::ImageRgba8(img))
    })()?; // monitor is dropped here

    finish_capture_flow(&app, b64).await
}

/// Closes the overlay then captures a specific window by its xcap ID (CAP-smart).
/// Called when the user clicks on a highlighted window in the overlay.
#[command]
pub async fn complete_window_capture_by_id(app: AppHandle, window_id: u32) -> Result<(), String> {
    window::hide_all_overlays(&app);

    // Raise the chosen window to the front (best-effort) so it's the active window
    // afterward. WGC capture itself is occlusion-independent, so the short wait only
    // needs to cover a possible minimize→restore.
    #[cfg(target_os = "windows")]
    bring_window_to_front(window_id);
    tokio::time::sleep(std::time::Duration::from_millis(60)).await;

    let b64 = dynamic_to_base64_png(capture_window_smart(window_id)?)?;

    window::close_all_overlays(&app);

    finish_capture_flow(&app, b64).await
}

/// Closes the overlay then captures a full monitor by its xcap ID (CAP-smart).
/// Called when the user clicks on an area with no window in the overlay.
#[command]
pub async fn complete_monitor_capture(app: AppHandle, monitor_id: u32) -> Result<(), String> {
    window::hide_all_overlays(&app);
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    let b64 = (|| -> Result<String, String> {
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
            Ok(img) => return dynamic_to_base64_png(DynamicImage::ImageRgba8(img)),
            Err(_e) => {
                #[cfg(debug_assertions)]
                eprintln!("[capture] DXGI failed ({_e}), falling back to xcap/GDI");
            }
        }

        let img = monitor.capture_image().map_err(|e| e.to_string())?;
        dynamic_to_base64_png(DynamicImage::ImageRgba8(img))
    })()?;

    window::close_all_overlays(&app);

    finish_capture_flow(&app, b64).await
}

/// Returns the pending image stored after the most recent capture.
/// Called by the editor window on mount.
#[command]
pub async fn get_pending_image(app: AppHandle) -> Result<Option<String>, String> {
    let state = app.state::<AppState>();
    let guard = state.pending_image.lock().map_err(|e| e.to_string())?;
    Ok(guard.clone())
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
pub async fn finish_capture_flow(app: &AppHandle, b64: String) -> Result<(), String> {
    use crate::commands::storage;

    // Auto-save to captures dir
    let saved_path = storage::auto_save_image(b64.clone(), app.clone())
        .await
        .map_err(|e| e.to_string())?;

    // Optionally copy the fresh capture to the clipboard (setting).
    if crate::settings::current(app).auto_copy {
        if let Err(e) =
            crate::commands::clipboard::copy_image_to_clipboard(b64.clone(), app.clone()).await
        {
            eprintln!("[capture] auto-copy failed: {e}");
        }
    }

    // Notify the gallery to refresh
    app.emit("capture-saved", ()).map_err(|e| e.to_string())?;

    // Store for the editor to pick up (image + its on-disk path)
    {
        let state = app.state::<AppState>();
        let mut guard = state.pending_image.lock().map_err(|e| e.to_string())?;
        *guard = Some(b64);
        let mut path_guard = state.pending_path.lock().map_err(|e| e.to_string())?;
        *path_guard = Some(saved_path);
    }

    window::open_editor(app)
}

fn dynamic_to_base64_png(img: DynamicImage) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use std::io::Cursor;

    let mut buf = Vec::new();
    img.write_to(&mut Cursor::new(&mut buf), image::ImageOutputFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(STANDARD.encode(&buf))
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
    let window_id = (|| -> Result<u32, String> {
        let windows = xcap::Window::all().map_err(|e| e.to_string())?;
        let win = windows
            .into_iter()
            .find(|w| !w.is_minimized())
            .ok_or_else(|| "No visible window found".to_string())?;
        Ok(win.id())
    })()?;

    #[cfg(target_os = "windows")]
    bring_window_to_front(window_id);
    tokio::time::sleep(std::time::Duration::from_millis(60)).await;

    capture_window_smart(window_id).and_then(dynamic_to_base64_png)
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
