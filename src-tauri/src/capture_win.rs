//! Windows DXGI Desktop Duplication — physical-pixel screen capture.
//! Bypasses GDI DPI scaling so the image is always at native monitor resolution.

use image::RgbaImage;
use windows::core::Interface;
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_UNKNOWN;
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, D3D11_BOX, D3D11_CPU_ACCESS_READ,
    D3D11_CREATE_DEVICE_FLAG, D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ,
    D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT,
    D3D11_USAGE_STAGING, ID3D11Device, ID3D11DeviceContext, ID3D11Resource, ID3D11Texture2D,
};
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, IDXGIFactory1, IDXGIOutput1, IDXGIOutputDuplication, IDXGIResource,
    DXGI_ERROR_WAIT_TIMEOUT, DXGI_OUTDUPL_FRAME_INFO,
};
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_FORMAT_B8G8R8A8_UNORM_SRGB, DXGI_FORMAT_B8G8R8X8_UNORM,
    DXGI_SAMPLE_DESC,
};
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MONITORINFO};

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;

/// On some machines DXGI Desktop Duplication only ever yields all-black frames
/// (driver/GPU/virtualization quirks). Rather than pay the full adapter-enumeration +
/// device-creation + duplication cost on every capture only to discard a black frame,
/// disable DXGI for the rest of the session after a few consecutive all-black results
/// and go straight to the xcap/GDI fallback. Reset on app restart (statics) and on any
/// successful frame. Transient errors (timeouts, no adapter) do NOT disable it.
static DXGI_DISABLED: AtomicBool = AtomicBool::new(false);
static DXGI_BLACK_STREAK: AtomicU32 = AtomicU32::new(0);
const DXGI_BLACK_LIMIT: u32 = 3;

/// A DXGI Desktop Duplication kept alive across captures, keyed by the physical
/// monitor bounds it covers. Recreating one from scratch (adapter enumeration +
/// device creation + `DuplicateOutput`) is the dominant cost of every capture —
/// worse, a freshly-created duplication's very first acquired frame is often
/// black, guaranteeing an extra acquire+copy cycle too (see `do_capture`). Once
/// warmed up, a duplication just needs `AcquireNextFrame` per capture, which is
/// far cheaper. Evicted and rebuilt on any real acquire error (not a plain
/// black frame) — e.g. `DXGI_ERROR_ACCESS_LOST` after a display-mode change,
/// monitor unplug, or exclusive-fullscreen app taking over — so a stale entry
/// self-heals on next use instead of silently failing forever.
///
/// D3D11 objects not created with `D3D11_CREATE_DEVICE_SINGLETHREADED` (we
/// don't) are documented as safe for multithreaded use given external
/// synchronization; that's provided here by only ever touching an entry while
/// holding `DUPL_CACHE`'s lock.
struct CachedDuplication {
    mon_left: i32,
    mon_top: i32,
    mon_right: i32,
    mon_bottom: i32,
    device: ID3D11Device,
    ctx: ID3D11DeviceContext,
    dupl: IDXGIOutputDuplication,
    /// GPU-side copy of the most recent good frame. Desktop Duplication only
    /// delivers a frame when the screen *changes*, so on a static desktop
    /// `AcquireNextFrame` times out with nothing to give — but this kept copy
    /// is still pixel-identical to what's on screen, so captures are served
    /// from it instead of failing (which used to cost a 2s wait, a cache
    /// eviction + full rebuild, and a GDI-quality fallback).
    last_frame: Option<ID3D11Texture2D>,
}
unsafe impl Send for CachedDuplication {}

static DUPL_CACHE: Mutex<Vec<CachedDuplication>> = Mutex::new(Vec::new());

/// Drops every cached duplication and re-arms DXGI after a display-topology
/// change (`WM_DISPLAYCHANGE`, see `hook_win`). Both caches key off monitor
/// geometry that just became meaningless: a cached duplication is matched by
/// its creation-time monitor bounds, so after a VDI connect/disconnect
/// rearranges the virtual desktop, a lookup can hit an entry whose rectangle
/// now belongs to a *different* physical monitor — and if that duplication is
/// still alive, `AcquireNextFrame` just times out on a static desktop and the
/// crop is served from the kept copy of the wrong monitor's frame,
/// indefinitely, with no error to trigger the usual self-heal eviction.
/// Likewise the all-black kill switch may have been tripped by a state (VDI
/// capture protection, secure desktop) that no longer exists; a topology
/// change is exactly when re-probing DXGI is worth another try — worst case
/// it re-disables after `DXGI_BLACK_LIMIT` captures.
pub fn invalidate_after_display_change() {
    let cleared = DUPL_CACHE.lock().map(|mut c| std::mem::take(&mut *c).len()).unwrap_or(0);
    DXGI_BLACK_STREAK.store(0, Ordering::Relaxed);
    let was_disabled = DXGI_DISABLED.swap(false, Ordering::Relaxed);
    crate::diag::log(&format!(
        "dxgi: display change — dropped {cleared} cached duplication(s){}",
        if was_disabled { ", re-enabled DXGI (was session-disabled)" } else { "" }
    ));
}

/// Captures a rectangle of the virtual screen at full physical pixel resolution.
/// `x`, `y`, `w`, `h` are in physical pixel coordinates (same space as xcap's monitor bounds).
/// Returns RGBA8 image data, or an error string if DXGI is unavailable (locked screen, no GPU…).
pub fn capture_region_physical(x: i32, y: i32, w: u32, h: u32) -> Result<RgbaImage, String> {
    if w == 0 || h == 0 {
        return Err("Zero-size capture region".to_string());
    }
    if DXGI_DISABLED.load(Ordering::Relaxed) {
        return Err("DXGI disabled this session (repeated all-black frames)".to_string());
    }

    let result = unsafe { do_capture(x, y, w, h) };
    match &result {
        Ok(_) => DXGI_BLACK_STREAK.store(0, Ordering::Relaxed),
        Err(e) if e.contains("all-black") => {
            let streak = DXGI_BLACK_STREAK.fetch_add(1, Ordering::Relaxed) + 1;
            if streak >= DXGI_BLACK_LIMIT {
                DXGI_DISABLED.store(true, Ordering::Relaxed);
                crate::diag::log(&format!(
                    "dxgi: disabled after {streak} consecutive all-black frames (until restart or display change)"
                ));
            }
        }
        Err(_) => {} // transient failure — keep DXGI enabled
    }
    result
}

unsafe fn do_capture(cap_x: i32, cap_y: i32, cap_w: u32, cap_h: u32) -> Result<RgbaImage, String> {
    let mut cache = DUPL_CACHE.lock().map_err(|e| e.to_string())?;

    // ── Fast path: reuse an already-warmed-up duplication for this monitor ──
    if let Some(idx) = cache.iter().position(|e| {
        e.mon_left <= cap_x && cap_x < e.mon_right && e.mon_top <= cap_y && cap_y < e.mon_bottom
    }) {
        let entry = &mut cache[idx];
        let (ml, mt) = (entry.mon_left, entry.mon_top);
        let CachedDuplication { device, ctx, dupl, last_frame, .. } = entry;
        match acquire_and_process(device, ctx, dupl, last_frame, ml, mt, cap_x, cap_y, cap_w, cap_h) {
            Ok(img) => return Ok(img),
            // Black frames and unsupported (HDR) formats aren't staleness —
            // rebuilding wouldn't change either, so keep the entry and let the
            // caller fall back (rebuild churn on every capture otherwise).
            Err(e) if e.contains("all-black") || e.contains("unsupported frame format") => {
                return Err(e)
            }
            Err(_e) => {
                // A real acquire error (not just an unlucky black frame) means this
                // duplication is stale — evict it and fall through to rebuild.
                #[cfg(debug_assertions)]
                eprintln!("[dxgi] cached duplication failed ({_e}), rebuilding");
                cache.remove(idx);
            }
        }
    }

    // ── Slow path: enumerate adapters to find the one that owns the target output ──
    // D3D_DRIVER_TYPE_HARDWARE with adapter=None picks the "default" GPU which
    // may be the discrete GPU (NVIDIA/AMD) on laptops where the display is
    // driven by the integrated GPU — DuplicateOutput on the wrong adapter gives
    // permanently black frames.  Always enumerate via IDXGIFactory1 instead.
    let factory: IDXGIFactory1 =
        CreateDXGIFactory1().map_err(|e| format!("CreateDXGIFactory1: {e}"))?;

    let mut found_device: Option<ID3D11Device> = None;
    let mut found_output1: Option<IDXGIOutput1> = None;
    let mut mon_left = 0i32;
    let mut mon_top = 0i32;
    let mut mon_right = 0i32;
    let mut mon_bottom = 0i32;

    'adapters: for adapter_idx in 0u32.. {
        let adapter = match factory.EnumAdapters(adapter_idx) {
            Ok(a) => a,
            Err(_) => break, // no more adapters
        };

        for output_idx in 0u32.. {
            let output = match adapter.EnumOutputs(output_idx) {
                Ok(o) => o,
                Err(_) => break, // no more outputs on this adapter
            };

            let desc = match output.GetDesc() {
                Ok(d) => d,
                Err(_) => continue,
            };

            let mut mi: MONITORINFO = std::mem::zeroed();
            mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
            if GetMonitorInfoW(desc.Monitor, &mut mi).0 == 0 {
                continue;
            }
            let r = mi.rcMonitor;
            if !(r.left <= cap_x && cap_x < r.right && r.top <= cap_y && cap_y < r.bottom) {
                continue;
            }

            // Found the output — create a D3D11 device tied to THIS adapter.
            // Must use D3D_DRIVER_TYPE_UNKNOWN when specifying the adapter explicitly.
            let mut dev: Option<ID3D11Device> = None;
            if D3D11CreateDevice(
                Some(&adapter),
                D3D_DRIVER_TYPE_UNKNOWN,
                None,
                D3D11_CREATE_DEVICE_FLAG(0),
                None,
                D3D11_SDK_VERSION,
                Some(&mut dev),
                None,
                None,
            )
            .is_ok()
            {
                found_device = dev;
                found_output1 = output.cast::<IDXGIOutput1>().ok();
                mon_left = r.left;
                mon_top = r.top;
                mon_right = r.right;
                mon_bottom = r.bottom;
                break 'adapters;
            }
        }
    }

    let device = found_device.ok_or("No D3D11 device found for capture region")?;
    let output1 = found_output1.ok_or("No DXGI output found for capture region")?;

    // ── Desktop duplication ─────────────────────────────────────────────────
    let dupl = output1
        .DuplicateOutput(&device)
        .map_err(|e| format!("DuplicateOutput: {e}"))?;

    // ── D3D11 immediate context ─────────────────────────────────────────────
    let ctx = device
        .GetImmediateContext()
        .map_err(|e| format!("GetImmediateContext: {e}"))?;

    let mut last_frame: Option<ID3D11Texture2D> = None;
    let result = acquire_and_process(
        &device, &ctx, &dupl, &mut last_frame,
        mon_left, mon_top, cap_x, cap_y, cap_w, cap_h,
    );

    // Cache the duplication for next time unless it's fundamentally broken —
    // a plain black-frame result still means the interface itself is good
    // (just unlucky this once), and an unsupported-format (HDR) output is a
    // property of the display mode, not this duplication: caching it makes
    // the per-capture failure cheap (one acquire) instead of a full rebuild.
    if result.is_ok()
        || matches!(&result, Err(e) if e.contains("all-black") || e.contains("unsupported frame format"))
    {
        cache.push(CachedDuplication {
            mon_left, mon_top, mon_right, mon_bottom, device, ctx, dupl, last_frame,
        });
    }

    result
}

/// Acquires the current desktop frame from `dupl` and copies out the requested
/// crop as RGBA8. A brand-new duplication's very first acquired frame can come
/// back completely black on some drivers/GPUs — a documented DXGI quirk — so
/// this retries a few times against the *same* duplication (which is primed
/// after the first acquire) before giving up; once `dupl` is warmed up via the
/// cache in `do_capture`, subsequent calls typically succeed on the first try.
///
/// `last_frame` (see `CachedDuplication`) is written with a GPU-side copy of
/// every good frame, and read when `AcquireNextFrame` has nothing to deliver —
/// which is the *normal* case on a static desktop, not an error. A timeout
/// therefore proves the kept copy still matches the screen exactly.
unsafe fn acquire_and_process(
    device: &ID3D11Device,
    ctx: &ID3D11DeviceContext,
    dupl: &IDXGIOutputDuplication,
    last_frame: &mut Option<ID3D11Texture2D>,
    mon_left: i32,
    mon_top: i32,
    cap_x: i32,
    cap_y: i32,
    cap_w: u32,
    cap_h: u32,
) -> Result<RgbaImage, String> {
    const MAX_BLACK_RETRIES: u32 = 5;
    let mut last_err = "DXGI capture produced no frame".to_string();

    for _attempt in 0..MAX_BLACK_RETRIES {
        // Acquire the next desktop update. With a kept last frame one short
        // wait is enough: a timeout then just means "nothing changed since the
        // kept copy" and we serve the crop from it. Without one (fresh
        // duplication, or the kept copy was discarded after a black frame),
        // wait the full 20 × 100 ms as before.
        let mut frame_info: DXGI_OUTDUPL_FRAME_INFO = std::mem::zeroed();
        let mut resource: Option<IDXGIResource> = None;
        let mut acquired = false;
        let tries = if last_frame.is_some() { 1 } else { 20 };
        for _ in 0..tries {
            match dupl.AcquireNextFrame(100, &mut frame_info, &mut resource) {
                Ok(()) => {
                    acquired = true;
                    break;
                }
                // Only a genuine timeout proves "nothing changed since the kept
                // copy". Any other failure — DXGI_ERROR_ACCESS_LOST after
                // lock/unlock, sleep/resume, a display-mode change, an
                // exclusive-fullscreen app, a virtual-desktop switch — means
                // this duplication is dead and the screen may have changed
                // arbitrarily since the kept copy was taken. Serving the copy
                // then would return a stale frame as a *successful* capture,
                // and because that path is Ok the broken cache entry would
                // never be evicted (every later capture repeats the stale
                // frame until app restart). Fail instead so `do_capture`
                // evicts this entry and rebuilds the duplication.
                Err(e) if e.code() != DXGI_ERROR_WAIT_TIMEOUT => {
                    return Err(format!("AcquireNextFrame: {e}"));
                }
                Err(_) => {} // timeout — retry, or fall through to the kept copy
            }
        }
        if !acquired {
            if let Some(prev) = last_frame.as_ref() {
                #[cfg(debug_assertions)]
                eprintln!("[dxgi] no new frame (static desktop), serving from kept copy");
                return read_crop(device, ctx, prev, mon_left, mon_top, cap_x, cap_y, cap_w, cap_h);
            }
            return Err("DXGI AcquireNextFrame timed out".to_string());
        }
        let resource = match resource {
            Some(r) => r,
            None => return Err("DXGI resource is None".to_string()),
        };
        let frame_tex: ID3D11Texture2D = match resource.cast() {
            Ok(t) => t,
            Err(e) => {
                dupl.ReleaseFrame().ok();
                return Err(e.to_string());
            }
        };

        let img = match read_crop(device, ctx, &frame_tex, mon_left, mon_top, cap_x, cap_y, cap_w, cap_h) {
            Ok(img) => img,
            Err(e) => {
                dupl.ReleaseFrame().ok();
                return Err(e);
            }
        };

        // Keep a GPU-side copy of the full frame so a later capture of a
        // static desktop can be served without a new acquire. Best-effort:
        // if the keep-texture can't be (re)created the reuse path is simply
        // unavailable, never the capture itself.
        let mut fdesc: D3D11_TEXTURE2D_DESC = std::mem::zeroed();
        frame_tex.GetDesc(&mut fdesc);
        let needs_new = match last_frame.as_ref() {
            Some(t) => {
                let mut d: D3D11_TEXTURE2D_DESC = std::mem::zeroed();
                t.GetDesc(&mut d);
                d.Width != fdesc.Width || d.Height != fdesc.Height || d.Format != fdesc.Format
            }
            None => true,
        };
        if needs_new {
            let keep_desc = D3D11_TEXTURE2D_DESC {
                Width: fdesc.Width,
                Height: fdesc.Height,
                MipLevels: 1,
                ArraySize: 1,
                Format: fdesc.Format,
                SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
                Usage: D3D11_USAGE_DEFAULT,
                BindFlags: 0,
                CPUAccessFlags: 0,
                MiscFlags: 0,
            };
            let mut t: Option<ID3D11Texture2D> = None;
            *last_frame = if device.CreateTexture2D(&keep_desc, None, Some(&mut t)).is_ok() {
                t
            } else {
                None
            };
        }
        if let Some(keep) = last_frame.as_ref() {
            if let (Ok(dst), Ok(src)) = (
                keep.cast::<ID3D11Resource>(),
                frame_tex.cast::<ID3D11Resource>(),
            ) {
                ctx.CopyResource(&dst, &src);
            }
        }
        dupl.ReleaseFrame().ok();

        let all_black = img
            .as_raw()
            .chunks_exact(4)
            .all(|p| p[0] == 0 && p[1] == 0 && p[2] == 0);
        if all_black {
            // Distinguish "DXGI failed to read the screen" (classic black-frame
            // quirk) from "the screen really is black there" (fullscreen video
            // letterboxing, black wallpaper…). GDI reads the same region through
            // a completely different path — if it agrees, this is real content,
            // not a failure, and must not count toward the session kill switch.
            let sx = cap_x.max(mon_left);
            let sy = cap_y.max(mon_top);
            if gdi_confirms_black(sx, sy, img.width(), img.height()) {
                #[cfg(debug_assertions)]
                eprintln!("[dxgi] frame is black and GDI agrees — genuine black content");
                return Ok(img);
            }
            #[cfg(debug_assertions)]
            eprintln!("[dxgi] frame all-black on attempt {_attempt}, retrying with the same duplication");
            // The kept copy would be black too — don't serve it later.
            *last_frame = None;
            last_err = "DXGI frame is all-black".to_string();
            continue;
        }

        #[cfg(debug_assertions)]
        eprintln!("[dxgi] captured {}×{}", img.width(), img.height());

        return Ok(img);
    }

    Err(last_err)
}

/// Copies the screen-space crop `(cap_x, cap_y, cap_w, cap_h)` out of `src` —
/// a full-monitor frame texture whose pixel (0,0) is the monitor's top-left —
/// through a CPU-readable staging texture, and converts BGRA→RGBA.
///
/// Only 8-bit BGRA-family formats are accepted. An HDR-enabled display can
/// make the duplication produce e.g. `R16G16B16A16_FLOAT` (8 bytes/px); the
/// fixed 4-bytes/px read below would misinterpret that as garbage pixels, so
/// it's refused up front ("unsupported frame format") and the caller falls
/// back to xcap/GDI, which captures HDR content tone-mapped instead.
unsafe fn read_crop(
    device: &ID3D11Device,
    ctx: &ID3D11DeviceContext,
    src: &ID3D11Texture2D,
    mon_left: i32,
    mon_top: i32,
    cap_x: i32,
    cap_y: i32,
    cap_w: u32,
    cap_h: u32,
) -> Result<RgbaImage, String> {
    let mut desc: D3D11_TEXTURE2D_DESC = std::mem::zeroed();
    src.GetDesc(&mut desc);
    if desc.Format != DXGI_FORMAT_B8G8R8A8_UNORM
        && desc.Format != DXGI_FORMAT_B8G8R8A8_UNORM_SRGB
        && desc.Format != DXGI_FORMAT_B8G8R8X8_UNORM
    {
        return Err(format!(
            "unsupported frame format {} (HDR display?)",
            desc.Format.0
        ));
    }
    let fw = desc.Width;
    let fh = desc.Height;

    // Texture pixel (0,0) = physical pixel at the monitor's top-left corner
    let lx = ((cap_x - mon_left).max(0) as u32).min(fw.saturating_sub(1));
    let ly = ((cap_y - mon_top).max(0) as u32).min(fh.saturating_sub(1));
    let cw = cap_w.min(fw - lx);
    let ch = cap_h.min(fh - ly);
    if cw == 0 || ch == 0 {
        return Err("Crop region is empty after clipping to monitor bounds".to_string());
    }

    // ── Staging texture (CPU-readable, crop size) ──────────────────────────
    // Use the frame's actual format — CopySubresourceRegion silently no-ops
    // when source and destination formats differ.
    let staging_desc = D3D11_TEXTURE2D_DESC {
        Width: cw,
        Height: ch,
        MipLevels: 1,
        ArraySize: 1,
        Format: desc.Format,
        SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
        Usage: D3D11_USAGE_STAGING,
        BindFlags: 0,
        CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
        MiscFlags: 0,
    };
    let mut staging: Option<ID3D11Texture2D> = None;
    device
        .CreateTexture2D(&staging_desc, None, Some(&mut staging))
        .map_err(|e| format!("CreateTexture2D: {e}"))?;
    let staging = staging.ok_or("staging texture is None")?;

    // Copy only the requested crop region from the frame to staging
    let src_res: ID3D11Resource = src.cast().map_err(|e| e.to_string())?;
    let dst: ID3D11Resource = staging.cast().map_err(|e| e.to_string())?;
    let src_box = D3D11_BOX {
        left: lx,
        top: ly,
        front: 0,
        right: lx + cw,
        bottom: ly + ch,
        back: 1,
    };
    ctx.CopySubresourceRegion(&dst, 0, 0, 0, 0, &src_res, 0, Some(&src_box as *const D3D11_BOX));

    // ── Map staging and read pixels ─────────────────────────────────────────
    let mut mapped: D3D11_MAPPED_SUBRESOURCE = std::mem::zeroed();
    ctx.Map(
        &dst,
        0,
        D3D11_MAP_READ,
        0,
        Some(&mut mapped as *mut D3D11_MAPPED_SUBRESOURCE),
    )
    .map_err(|e| format!("Map staging: {e}"))?;

    let stride = mapped.RowPitch as usize;
    let base = mapped.pData as *const u8;
    let mut pixels = vec![0u8; (cw * ch * 4) as usize];
    for row in 0..ch as usize {
        std::ptr::copy_nonoverlapping(
            base.add(row * stride),
            pixels.as_mut_ptr().add(row * cw as usize * 4),
            cw as usize * 4,
        );
    }
    ctx.Unmap(&dst, 0);

    // DXGI/D3D11 returns BGRA (or BGRX with A=0 on some drivers).
    // Convert to RGBA and force full opacity — desktop is always opaque.
    for px in pixels.chunks_exact_mut(4) {
        px.swap(0, 2); // B↔R
        px[3] = 255;
    }

    RgbaImage::from_raw(cw, ch, pixels).ok_or_else(|| "RgbaImage::from_raw failed".to_string())
}

/// Second opinion for an all-black DXGI frame: samples a 3×3 grid of points in
/// the same screen rect via GDI `GetPixel`. Returns `true` only when every
/// readable sample is black too — i.e. the region genuinely shows black
/// content and the DXGI frame was correct. Returns `false` when any sample
/// has color (real DXGI black-frame failure) or when no sample could be read
/// at all (inconclusive — treated as a failure so behavior stays conservative).
unsafe fn gdi_confirms_black(x: i32, y: i32, w: u32, h: u32) -> bool {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Gdi::{GetDC, GetPixel, ReleaseDC, CLR_INVALID};

    let dc = GetDC(HWND::default());
    if dc.is_invalid() {
        return false;
    }
    let mut any_valid = false;
    let mut all_black = true;
    'outer: for fy in [0.1f32, 0.5, 0.9] {
        for fx in [0.1f32, 0.5, 0.9] {
            let px = x + (w as f32 * fx) as i32;
            let py = y + (h as f32 * fy) as i32;
            let c = GetPixel(dc, px, py);
            if c.0 == CLR_INVALID {
                continue;
            }
            any_valid = true;
            if c.0 & 0x00FF_FFFF != 0 {
                all_black = false;
                break 'outer;
            }
        }
    }
    ReleaseDC(HWND::default(), dc);
    any_valid && all_black
}
