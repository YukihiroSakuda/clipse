//! Windows-only scrolling capture.
//!
//! Captures a fixed screen region repeatedly while sending mouse-wheel scroll
//! to the window under the cursor, then stitches the frames into one tall image
//! by detecting how far the content moved between frames.
//!
//! Overlap detection uses a per-row luminance signature (a handful of sampled
//! columns per row) and a coarse-to-fine search for the vertical shift that best
//! aligns the previous frame with the current one. Fixed headers/footers that do
//! not scroll can bias the match; the heuristics aim for "good enough", not
//! pixel-perfect, which matches how ShareX/Screenpresso behave in practice.

use std::time::Duration;

use image::RgbaImage;

use crate::capture_win;

const WHEEL_NOTCHES: i32 = 3; // wheel "clicks" per step
const SETTLE_MS: u64 = 350; // wait after scrolling for content to render
const MAX_FRAMES: usize = 80;
const MAX_TOTAL_HEIGHT: u32 = 20000;
const COL_SAMPLES: usize = 64; // columns sampled per row for the signature
const IDENTICAL_THRESH: u32 = 2; // mean per-sample diff <= this ⇒ no movement
const MATCH_THRESH: u32 = 24; // best match worse than this ⇒ unreliable ⇒ stop
const MIN_OVERLAP_DENOM: usize = 3; // require overlap >= H / this
const SCROLLBAR_MARGIN: u32 = 32; // ignore this many right-edge px when matching (scrollbar)
const REFINE_RADIUS: i32 = 4; // full-res search window (± rows) around the coarse delta

/// A compact per-row luminance signature: `data[row * samples + col]`.
struct Signature {
    rows: usize,
    samples: usize,
    data: Vec<u8>,
}

/// Captures `(x, y, w, h)` (physical px), scrolling and stitching until the
/// content stops advancing or limits are hit. Returns the tall stitched image.
pub fn capture_scrolling(x: i32, y: i32, w: u32, h: u32) -> Result<RgbaImage, String> {
    if w == 0 || h == 0 {
        return Err("Zero-size region".into());
    }

    let saved_cursor = get_cursor();
    let cx = x + w as i32 / 2;
    let cy = y + h as i32 / 2;
    set_cursor(cx, cy);
    std::thread::sleep(Duration::from_millis(150));

    let mut result = capture_region(x, y, w, h)?;
    let mut prev = result.clone(); // keep the previous full frame for pixel-exact refinement
    let mut prev_sig = signature(&result);

    for _ in 0..MAX_FRAMES {
        wheel_down(WHEEL_NOTCHES);
        std::thread::sleep(Duration::from_millis(SETTLE_MS));

        let cur = capture_region(x, y, w, h)?;
        let cur_sig = signature(&cur);
        // Coarse estimate from the cheap signature, then nail it to the exact
        // pixel against the full-resolution frames so the join is seamless.
        let coarse = detect_scroll_delta(&prev_sig, &cur_sig);
        if coarse == 0 {
            break; // reached the bottom (or no reliable movement)
        }
        let (delta, _cost) = refine_delta(&prev, &cur, coarse);
        if delta == 0 {
            break;
        }
        // Always hard-cut: the appended rows come from `cur`, so once the shift
        // is pixel-aligned the join differs only by sub-pixel capture noise —
        // far less visible than a feather band's blurry stripe. (A feather band
        // is left available in append_bottom but disabled here.)
        append_bottom(&mut result, &cur, delta, 0);
        if result.height() >= MAX_TOTAL_HEIGHT {
            break;
        }
        prev = cur;
        prev_sig = cur_sig;
    }

    if let Some((sx, sy)) = saved_cursor {
        set_cursor(sx, sy);
    }
    Ok(result)
}

// ===== Stitching =====

/// Width used for alignment matching, excluding the right-edge scrollbar whose
/// moving thumb would otherwise bias the search.
fn match_width(w: u32) -> u32 {
    if w > SCROLLBAR_MARGIN * 3 {
        w - SCROLLBAR_MARGIN
    } else {
        w
    }
}

fn signature(img: &RgbaImage) -> Signature {
    let w = img.width() as usize;
    let h = img.height() as usize;
    let usable = match_width(img.width()) as usize;
    let samples = COL_SAMPLES.min(usable.max(1));
    let step = (usable / samples).max(1);
    let raw = img.as_raw();
    let mut data = vec![0u8; h * samples];
    for row in 0..h {
        let row_base = row * w * 4;
        let out_base = row * samples;
        for s in 0..samples {
            let col = (s * step).min(usable - 1);
            let idx = row_base + col * 4;
            let lum = (raw[idx] as u32 + raw[idx + 1] as u32 + raw[idx + 2] as u32) / 3;
            data[out_base + s] = lum as u8;
        }
    }
    Signature { rows: h, samples, data }
}

/// Mean per-sample abs difference when the previous frame is shifted up by `d`
/// rows (i.e. content scrolled down by `d`). Compares prev[d..H] with cur[0..H-d].
fn mean_diff(prev: &Signature, cur: &Signature, d: usize) -> u32 {
    let h = prev.rows;
    let s = prev.samples;
    if d >= h {
        return u32::MAX;
    }
    let overlap = h - d;
    let mut total: u64 = 0;
    for i in 0..overlap {
        let pa = (d + i) * s;
        let ca = i * s;
        for k in 0..s {
            let diff = (prev.data[pa + k] as i32 - cur.data[ca + k] as i32).unsigned_abs();
            total += diff as u64;
        }
    }
    (total / (overlap as u64 * s as u64)) as u32
}

/// Returns how many pixels the content scrolled between frames (0 = none/stop).
fn detect_scroll_delta(prev: &Signature, cur: &Signature) -> u32 {
    let h = prev.rows;
    if h != cur.rows || prev.samples != cur.samples || h == 0 {
        return 0;
    }
    // No movement: frames are (near) identical.
    if mean_diff(prev, cur, 0) <= IDENTICAL_THRESH {
        return 0;
    }

    let max_d = h - h / MIN_OVERLAP_DENOM;
    let mut best_cost = u32::MAX;
    let mut best_d = 0usize;

    // Coarse pass (step 2), then refine ±1 around the best.
    let mut d = 4;
    while d <= max_d {
        let c = mean_diff(prev, cur, d);
        if c < best_cost {
            best_cost = c;
            best_d = d;
        }
        d += 2;
    }
    let lo = best_d.saturating_sub(1).max(1);
    let hi = (best_d + 1).min(max_d);
    for d in lo..=hi {
        let c = mean_diff(prev, cur, d);
        if c < best_cost {
            best_cost = c;
            best_d = d;
        }
    }

    if best_cost > MATCH_THRESH {
        return 0; // unreliable alignment ⇒ assume we're at the end
    }
    best_d as u32
}

/// Refines the coarse row-shift to the exact pixel using the full-resolution
/// frames (every other column/row, RGB). A signature off by even 1–2 px leaves a
/// visible seam, so this final pass is what makes the join clean.
/// Returns `(best_delta, best_cost)` where cost is the mean per-channel abs diff
/// at the winning alignment (lower = better match; used to decide whether to blend).
fn refine_delta(prev: &RgbaImage, cur: &RgbaImage, coarse: u32) -> (u32, u64) {
    let w = prev.width();
    let h = prev.height();
    if cur.width() != w || cur.height() != h || h == 0 {
        return (coarse, u64::MAX);
    }
    let mw = match_width(w) as usize;
    let wf = w as usize;
    let pr = prev.as_raw();
    let cr = cur.as_raw();

    let max_d = (h - h / MIN_OVERLAP_DENOM as u32) as i32;
    let lo = (coarse as i32 - REFINE_RADIUS).max(1);
    let hi = (coarse as i32 + REFINE_RADIUS).min(max_d);

    let mut best_d = coarse;
    let mut best_cost = u64::MAX;
    let mut d = lo;
    while d <= hi {
        let du = d as usize;
        let overlap = h as usize - du;
        let mut total: u64 = 0;
        let mut count: u64 = 0;
        // Compare prev rows [d, h) against cur rows [0, h-d); step rows/cols by 2.
        let mut i = 0usize;
        while i < overlap {
            let prow = (du + i) * wf * 4;
            let crow = i * wf * 4;
            let mut col = 0usize;
            while col < mw {
                let pi = prow + col * 4;
                let ci = crow + col * 4;
                total += (pr[pi] as i32 - cr[ci] as i32).unsigned_abs() as u64;
                total += (pr[pi + 1] as i32 - cr[ci + 1] as i32).unsigned_abs() as u64;
                total += (pr[pi + 2] as i32 - cr[ci + 2] as i32).unsigned_abs() as u64;
                count += 3;
                col += 2;
            }
            i += 2;
        }
        let cost = if count == 0 { u64::MAX } else { total / count };
        if cost < best_cost {
            best_cost = cost;
            best_d = d as u32;
        }
        d += 1;
    }
    (best_d, best_cost)
}

/// Appends the newly revealed `d` rows of `cur` onto `result`. When `blend_rows`
/// is non-zero, feather-blends that many rows just above the join so residual
/// rendering differences fade out instead of showing as a hard line; pass 0 for a
/// clean hard cut (preferred when the alignment is already pixel-tight).
fn append_bottom(result: &mut RgbaImage, cur: &RgbaImage, d: u32, blend_rows: u32) {
    let w = result.width();
    if cur.width() != w || d == 0 {
        return;
    }
    let ch = cur.height();
    let d = d.min(ch);
    let rh = result.height();
    let wf = w as usize;

    let mut data: Vec<u8> = Vec::with_capacity((w * (rh + d) * 4) as usize);
    data.extend_from_slice(result.as_raw());

    // Feather: result's last `blend` rows match cur rows [ch-d-blend, ch-d).
    // Ramp the weight 0 → 1 toward cur so the bottom meets the new slice cleanly.
    let blend = blend_rows.min(rh).min(ch.saturating_sub(d));
    if blend > 0 {
        let cur_raw = cur.as_raw();
        for i in 0..blend {
            let result_row = (rh - blend + i) as usize;
            let cur_row = (ch - d - blend + i) as usize;
            let alpha = (i as f32 + 1.0) / (blend as f32 + 1.0);
            let drow = result_row * wf * 4;
            let crow = cur_row * wf * 4;
            for px in 0..(wf * 4) {
                let a = data[drow + px] as f32;
                let b = cur_raw[crow + px] as f32;
                data[drow + px] = (a + (b - a) * alpha).round() as u8;
            }
        }
    }

    let start = ((ch - d) as usize) * wf * 4;
    data.extend_from_slice(&cur.as_raw()[start..]);
    if let Some(img) = RgbaImage::from_raw(w, rh + d, data) {
        *result = img;
    }
}

// ===== Capture (DXGI with xcap fallback) =====

fn capture_region(x: i32, y: i32, w: u32, h: u32) -> Result<RgbaImage, String> {
    match capture_win::capture_region_physical(x, y, w, h) {
        Ok(img) => Ok(img),
        Err(e) => {
            eprintln!("[scroll] DXGI failed ({e}), falling back to xcap");
            capture_region_xcap(x, y, w, h)
        }
    }
}

fn capture_region_xcap(x: i32, y: i32, w: u32, h: u32) -> Result<RgbaImage, String> {
    use image::DynamicImage;
    let monitors = xcap::Monitor::all().map_err(|e| e.to_string())?;
    let m = monitors
        .iter()
        .find(|m| {
            x >= m.x()
                && y >= m.y()
                && x < m.x() + m.width() as i32
                && y < m.y() + m.height() as i32
        })
        .ok_or("No monitor found for scroll region")?;
    let img = m.capture_image().map_err(|e| e.to_string())?;
    let dynamic = DynamicImage::ImageRgba8(img);
    let sx = dynamic.width() as f64 / m.width() as f64;
    let sy = dynamic.height() as f64 / m.height() as f64;
    let lx = (((x - m.x()) as f64) * sx).max(0.0) as u32;
    let ly = (((y - m.y()) as f64) * sy).max(0.0) as u32;
    let cw = ((w as f64 * sx) as u32).min(dynamic.width().saturating_sub(lx));
    let ch = ((h as f64 * sy) as u32).min(dynamic.height().saturating_sub(ly));
    if cw == 0 || ch == 0 {
        return Err("Scroll region empty after clipping".into());
    }
    Ok(dynamic.crop_imm(lx, ly, cw, ch).to_rgba8())
}

// ===== Input synthesis =====

fn get_cursor() -> Option<(i32, i32)> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    unsafe {
        let mut p = POINT::default();
        if GetCursorPos(&mut p).is_ok() {
            Some((p.x, p.y))
        } else {
            None
        }
    }
}

fn set_cursor(x: i32, y: i32) {
    use windows::Win32::UI::WindowsAndMessaging::SetCursorPos;
    unsafe {
        let _ = SetCursorPos(x, y);
    }
}

fn wheel_down(notches: i32) {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_WHEEL, MOUSEINPUT,
    };
    unsafe {
        let mi = MOUSEINPUT {
            dx: 0,
            dy: 0,
            mouseData: (-120 * notches) as u32, // negative = scroll down; 120 = WHEEL_DELTA
            dwFlags: MOUSEEVENTF_WHEEL,
            time: 0,
            dwExtraInfo: 0,
        };
        let input = INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 { mi },
        };
        SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
    }
}
