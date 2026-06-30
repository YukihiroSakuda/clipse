//! Windows DXGI Desktop Duplication — physical-pixel screen capture.
//! Bypasses GDI DPI scaling so the image is always at native monitor resolution.

use image::RgbaImage;
use windows::core::Interface;
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_UNKNOWN;
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, D3D11_BOX, D3D11_CPU_ACCESS_READ,
    D3D11_CREATE_DEVICE_FLAG, D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ,
    D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC,
    D3D11_USAGE_STAGING, ID3D11Device, ID3D11Resource, ID3D11Texture2D,
};
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, IDXGIFactory1, IDXGIOutput1, IDXGIResource, DXGI_OUTDUPL_FRAME_INFO,
};
use windows::Win32::Graphics::Dxgi::Common::DXGI_SAMPLE_DESC;
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MONITORINFO};

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

/// On some machines DXGI Desktop Duplication only ever yields all-black frames
/// (driver/GPU/virtualization quirks). Rather than pay the full adapter-enumeration +
/// device-creation + duplication cost on every capture only to discard a black frame,
/// disable DXGI for the rest of the session after a few consecutive all-black results
/// and go straight to the xcap/GDI fallback. Reset on app restart (statics) and on any
/// successful frame. Transient errors (timeouts, no adapter) do NOT disable it.
static DXGI_DISABLED: AtomicBool = AtomicBool::new(false);
static DXGI_BLACK_STREAK: AtomicU32 = AtomicU32::new(0);
const DXGI_BLACK_LIMIT: u32 = 3;

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
                eprintln!(
                    "[dxgi] disabled this session after {streak} consecutive all-black frames"
                );
            }
        }
        Err(_) => {} // transient failure — keep DXGI enabled
    }
    result
}

unsafe fn do_capture(cap_x: i32, cap_y: i32, cap_w: u32, cap_h: u32) -> Result<RgbaImage, String> {
    // ── Enumerate all adapters to find the one that owns the target output ──
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

    // Acquire the current desktop frame (retry up to 20 × 100 ms = 2 s)
    let mut frame_info: DXGI_OUTDUPL_FRAME_INFO = std::mem::zeroed();
    let mut resource: Option<IDXGIResource> = None;
    let mut acquired = false;
    for _ in 0..20 {
        if dupl
            .AcquireNextFrame(100, &mut frame_info, &mut resource)
            .is_ok()
        {
            acquired = true;
            break;
        }
    }
    if !acquired {
        return Err("DXGI AcquireNextFrame timed out".to_string());
    }
    let resource = resource.ok_or("DXGI resource is None")?;
    let frame_tex: ID3D11Texture2D = resource.cast().map_err(|e| e.to_string())?;

    // ── Frame dimensions ────────────────────────────────────────────────────
    let mut frame_desc: D3D11_TEXTURE2D_DESC = std::mem::zeroed();
    frame_tex.GetDesc(&mut frame_desc);
    let fw = frame_desc.Width;
    let fh = frame_desc.Height;

    #[cfg(debug_assertions)]
    eprintln!(
        "[dxgi] frame {}×{} fmt={} mon=({},{}) cap=({},{},{},{})",
        fw, fh, frame_desc.Format.0, mon_left, mon_top, cap_x, cap_y, cap_w, cap_h
    );

    // Texture pixel (0,0) = physical pixel at the monitor's top-left corner
    let lx = ((cap_x - mon_left).max(0) as u32).min(fw.saturating_sub(1));
    let ly = ((cap_y - mon_top).max(0) as u32).min(fh.saturating_sub(1));
    let cw = cap_w.min(fw - lx);
    let ch = cap_h.min(fh - ly);

    if cw == 0 || ch == 0 {
        dupl.ReleaseFrame().ok();
        return Err("Crop region is empty after clipping to monitor bounds".to_string());
    }

    // ── D3D11 immediate context ─────────────────────────────────────────────
    let ctx = device
        .GetImmediateContext()
        .map_err(|e| format!("GetImmediateContext: {e}"))?;

    // ── Staging texture (CPU-readable, crop size) ───────────────────────────
    // Use the frame's actual format — CopySubresourceRegion silently no-ops
    // when source and destination formats differ.
    let staging_desc = D3D11_TEXTURE2D_DESC {
        Width: cw,
        Height: ch,
        MipLevels: 1,
        ArraySize: 1,
        Format: frame_desc.Format,
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
    let src: ID3D11Resource = frame_tex.cast().map_err(|e| e.to_string())?;
    let dst: ID3D11Resource = staging.cast().map_err(|e| e.to_string())?;
    let src_box = D3D11_BOX {
        left: lx,
        top: ly,
        front: 0,
        right: lx + cw,
        bottom: ly + ch,
        back: 1,
    };
    ctx.CopySubresourceRegion(&dst, 0, 0, 0, 0, &src, 0, Some(&src_box as *const D3D11_BOX));
    dupl.ReleaseFrame().ok();

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

    // Sanity-check: if every pixel is still black the duplication returned a
    // blank frame (can happen on the very first AcquireNextFrame after
    // DuplicateOutput on some drivers).  Treat as failure so the caller can
    // fall back to xcap/GDI.
    let all_black = pixels.chunks_exact(4).all(|p| p[0] == 0 && p[1] == 0 && p[2] == 0);
    if all_black {
        return Err("DXGI frame is all-black".to_string());
    }

    #[cfg(debug_assertions)]
    eprintln!("[dxgi] captured {}×{} at ({},{})", cw, ch, lx, ly);

    RgbaImage::from_raw(cw, ch, pixels)
        .ok_or_else(|| "RgbaImage::from_raw failed".to_string())
}
