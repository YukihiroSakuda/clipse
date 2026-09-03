//! Windows-only scrolling capture.
//!
//! Captures a fixed screen region repeatedly while sending mouse-wheel scroll
//! to the window under the cursor, then stitches the frames into one tall image
//! by detecting how far the content moved between frames.
//!
//! Overlap detection uses a per-row luminance signature (a handful of sampled
//! columns per row) and a coarse-to-fine search for the vertical shift that best
//! aligns the previous frame with the current one. Fixed headers/footers (sticky
//! nav bars, chat input boxes, etc.) don't move between frames, so they're
//! detected over the first few scroll steps (`detect_fixed_bands`, min-locked)
//! and excluded from both the alignment search and the appended slice —
//! otherwise they bias the match cost (sometimes enough to trip the
//! "unreliable, stop" threshold) and would otherwise repeat every step in the
//! stitched output.
//!
//! Seam avoidance: every frame is settle-verified (re-captured until two
//! consecutive shots match, so mid-animation frames are never stitched), joins
//! whose best alignment cost is still high are refused outright, and mildly
//! imperfect joins (ClearType re-rendering, fractional scroll offsets) get a
//! 2-row feather instead of a hard cut. The heuristics still aim for "good
//! enough", not pixel-perfect, which matches how ShareX/Screenpresso behave in
//! practice.
//!
//! The bottom edge of a mid-scroll frame is also the least trustworthy part
//! of it (lazy-loaded content, hover UI, an unsettled scrollbar thumb), so a
//! minimum bottom margin (`BOTTOM_MARGIN_FRAC`) is always held back from
//! per-step appends the same way a detected sticky footer is — re-attached
//! once at the end from the final, page-bottom-pinned frame only.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use image::RgbaImage;

use crate::capture_win;

/// True while a scrolling capture is running (read by the hotkey paths in
/// `hook_win` to decide whether a keypress should stop it).
static CAPTURING: AtomicBool = AtomicBool::new(false);
/// Set to end the in-progress scrolling capture at the next step boundary;
/// whatever has been stitched so far is returned as the (shorter) result.
static STOP: AtomicBool = AtomicBool::new(false);

/// Requests the running scrolling capture to stop after the current step.
/// Harmless when none is running — the flag is reset when a capture starts.
pub fn request_stop() {
    STOP.store(true, Ordering::SeqCst);
}

/// Stops the in-progress scrolling capture if one is running. Returns whether
/// there was one, so the caller can swallow the triggering keypress instead of
/// also acting on it (e.g. PrintScreen opening a new overlay mid-capture).
pub fn stop_if_capturing() -> bool {
    if CAPTURING.load(Ordering::SeqCst) {
        request_stop();
        true
    } else {
        false
    }
}

/// Whether a scrolling capture is running right now. Unlike `stop_if_capturing`
/// this only observes — used when deciding whether a long-held capture claim is
/// legitimately busy or leaked (`window::try_claim_capture`).
pub fn is_capturing() -> bool {
    CAPTURING.load(Ordering::SeqCst)
}

fn stop_requested() -> bool {
    STOP.load(Ordering::SeqCst)
}

/// Clears `CAPTURING` on every exit path of `capture_scrolling` (success,
/// error, early `?`), so a failed capture can never leave the hotkey paths
/// believing one is still running.
struct CapturingGuard;

impl Drop for CapturingGuard {
    fn drop(&mut self) {
        CAPTURING.store(false, Ordering::SeqCst);
    }
}

const MAX_FRAMES: usize = 80;
const MAX_TOTAL_HEIGHT: u32 = 20000;
const COL_SAMPLES: usize = 64; // columns sampled per row for the signature
const IDENTICAL_THRESH: u32 = 2; // mean per-sample diff <= this ⇒ no movement
const MATCH_THRESH: u32 = 24; // best match worse than this ⇒ unreliable ⇒ stop
const MIN_OVERLAP_DENOM: usize = 3; // require overlap >= content height / this
const SCROLLBAR_MARGIN: u32 = 32; // ignore this many right-edge px when matching (scrollbar)
const REFINE_RADIUS: i32 = 4; // full-res search window (± rows) around the coarse delta
const BAND_ROW_THRESH: u32 = 6; // per-row diff <= this ⇒ row counts as static (header/footer)
const MAX_BAND_FRACTION: f32 = 0.30; // never treat more than this fraction of the frame as fixed
const RESHOOT_GAP_MS: u64 = 40; // wait between settle-verification re-captures
const MAX_RESHOOTS: usize = 3; // settle retries before accepting the frame as-is
const BAND_DETECT_STEPS: usize = 3; // steps over which fixed bands are min-locked
const APPEND_COST_ABORT: u64 = 32; // refine cost above this ⇒ join would show ⇒ stop
const APPEND_COST_BLEND: u64 = 10; // refine cost above this ⇒ feather the join
const FEATHER_ROWS: u32 = 2; // feather height when blending kicks in
const NOTCHES: i32 = 3; // wheel "clicks" sent per scroll step
// How long the cursor must stay at the region center after `wheel_down` before
// it's safe to move away — the OS resolves WM_MOUSEWHEEL's target window by
// cursor position at *processing* time, not at `SendInput` call time, so
// moving too soon can route the scroll to wherever the cursor ends up instead
// of the intended window. This is deliberately much shorter than `settle_ms`:
// it only needs to cover message dispatch, not the page's re-render — see
// `capture_scrolling`, where the remaining settle time then elapses with the
// cursor already parked away, instead of sitting over the content.
const WHEEL_ROUTE_MS: u64 = 50;
const BOTTOM_MARGIN_FRAC: f32 = 0.12; // min fraction of the region height never taken from an intermediate frame's bottom edge

/// A compact per-row luminance signature: `data[row * samples + col]`.
struct Signature {
    rows: usize,
    samples: usize,
    data: Vec<u8>,
}

/// Captures `(x, y, w, h)` (physical px), scrolling and stitching until the
/// content stops advancing or limits are hit. Returns the tall stitched image.
/// `settle_ms` is how long to wait after each scroll for the page to finish
/// rendering before capturing. `crop_scrollbar` drops the right-edge
/// scrollbar strip from the output so the moving thumb can't leave a
/// discontinuity at every join. The wheel step size (`NOTCHES`) isn't
/// user-configurable: a larger fixed value used to leave too little overlap
/// for alignment and silently produced a truncated (sometimes 1-frame)
/// capture on tall pages — see `scroll_with_backoff` for the adaptive
/// fallback that now handles a single step still being too large.
pub fn capture_scrolling(
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    settle_ms: u64,
    crop_scrollbar: bool,
) -> Result<RgbaImage, String> {
    if w == 0 || h == 0 {
        return Err("Zero-size region".into());
    }

    CAPTURING.store(true, Ordering::SeqCst);
    STOP.store(false, Ordering::SeqCst);
    let _capturing = CapturingGuard;

    let saved_cursor = get_cursor();
    let cx = x + w as i32 / 2;
    let cy = y + h as i32 / 2;
    // Parked cursor position, used between scroll ticks so hover-triggered UI
    // (link status-bar previews, tooltips) isn't sitting in frame when we
    // capture. The pre-capture cursor position is reused since it's a valid
    // on-screen point that (unlike the region center) isn't over the content
    // being scrolled.
    let park = saved_cursor.unwrap_or((cx, y.saturating_sub(40)));
    // Only dwells at the region center for `WHEEL_ROUTE_MS` — just long enough
    // for the OS to deliver the wheel message to the right window — then
    // parks away immediately. Previously the cursor sat at dead center for
    // the *entire* settle sleep, hovering over whatever page element happened
    // to be there for hundreds of ms: long enough to trigger (and bake into
    // the capture) hover-only UI — dropdown menus, image lightbox previews,
    // link tooltips — that a real user's cursor would never linger on.
    let scroll = |notches: i32| {
        set_cursor(cx, cy);
        wheel_down(notches);
        std::thread::sleep(Duration::from_millis(WHEEL_ROUTE_MS));
        set_cursor(park.0, park.1);
    };
    // The park move already happened in `scroll`, right after the wheel
    // message had time to be delivered — so the rest of `settle_ms` (page
    // re-render + any hover UI reverting) elapses with the cursor already
    // safely away from the content, not sitting on it.
    let settle_and_capture = |x: i32, y: i32, w: u32, h: u32| -> Result<RgbaImage, String> {
        std::thread::sleep(Duration::from_millis(settle_ms.saturating_sub(WHEEL_ROUTE_MS)));
        capture_settled(x, y, w, h)
    };

    set_cursor(park.0, park.1);
    std::thread::sleep(Duration::from_millis(150));

    // Wheel "clicks" actually sent per step. Starts at NOTCHES but backs off
    // (halves) if a step overshoots the alignment search window — see
    // `scroll_with_backoff` — so an unusually tall per-notch scroll distance
    // (e.g. on some pages/zoom levels) degrades to "slower but still
    // stitches" instead of "only the first frame".
    let mut current_notches = NOTCHES;

    // ── Band lock-in (before any stitching) ──
    // Fixed header/footer rows (e.g. sticky nav, chat input box), min-locked
    // across the first few scroll pairs: a band estimated too long swallows
    // content, so of the per-pair estimates the shortest wins. The very first
    // append already depends on `footer`, so bands must be settled *before*
    // stitching starts — a footer over/under-estimated on the first pair
    // alone would skip or repeat rows at the first join (and only there).
    // Frames captured while locking in are buffered and stitched afterwards.
    let first = capture_settled(x, y, w, h)?;
    let mut header = 0u32;
    let mut footer = 0u32;
    let mut buffered: Vec<RgbaImage> = Vec::with_capacity(BAND_DETECT_STEPS);
    for step in 0..BAND_DETECT_STEPS {
        if stop_requested() {
            break;
        }
        let prev_frame = buffered.last().unwrap_or(&first);
        let prev_full_sig = signature(prev_frame, 0, h);
        let (cur, coarse) = scroll_with_backoff(
            &mut current_notches,
            &scroll,
            &|| settle_and_capture(x, y, w, h),
            &|img| signature(img, 0, h),
            &prev_full_sig,
        )?;
        // Page already stopped moving (short page / non-scrollable region),
        // or every step down to 1 notch still overshoots: no more pairs to
        // learn bands from.
        if coarse == 0 {
            break;
        }
        let (hr, fr) = detect_fixed_bands(prev_frame, &cur);
        if step == 0 {
            header = hr;
            footer = fr;
        } else {
            header = header.min(hr);
            footer = footer.min(fr);
        }
        buffered.push(cur);
    }

    // The bottom edge of a mid-scroll frame is the least trustworthy part of
    // it — lazy-loaded images/ads not painted yet, a link-hover status bar,
    // a not-yet-settled scrollbar thumb, etc. Rather than stitch from those
    // rows on every step, never take less than this margin off an
    // intermediate frame's bottom; the held-back rows get appended exactly
    // once at the very end, straight from the last (page-bottom-pinned)
    // frame. This reuses the sticky-footer mechanism above (which excludes
    // detected fixed bands from per-step appends and re-attaches them once
    // after the loop) — a plain margin floor is just a footer with a
    // guaranteed minimum size.
    footer = footer.max((h as f32 * BOTTOM_MARGIN_FRAC) as u32);

    let mut result = first.clone();
    let mut prev = first; // previous full frame, for pixel-exact refinement
    let mut prev_sig = signature(&prev, header, h - footer);
    // Whether any slice was appended — i.e. whether `result`'s bottom is the
    // (footer-stripped) stitched body rather than the untouched first frame.
    let mut appended = false;

    let mut pending = buffered.into_iter();
    for _ in 0..MAX_FRAMES {
        // Drain the frames buffered during band lock-in first, then go live.
        // Coarse estimate from the cheap signature, then nail it to the exact
        // pixel against the full-resolution frames so the join is seamless.
        // Both searches are restricted to the scrollable content band, so a
        // fixed header/footer can't bias the cost or get duplicated below.
        let (cur, coarse) = match pending.next() {
            Some(f) => {
                // Frames already captured before a stop request are still
                // stitched — only *new* scroll steps are cut short below.
                let sig = signature(&f, header, h - footer);
                let coarse = detect_scroll_delta(&prev_sig, &sig);
                (f, coarse)
            }
            None => {
                // User-requested stop (Esc / PrintScreen): end here and keep
                // everything stitched so far as the result.
                if stop_requested() {
                    break;
                }
                scroll_with_backoff(
                    &mut current_notches,
                    &scroll,
                    &|| settle_and_capture(x, y, w, h),
                    &|img| signature(img, header, h - footer),
                    &prev_sig,
                )?
            }
        };
        if coarse == 0 {
            break; // reached the bottom (or no reliable movement)
        }
        let (delta, cost) = refine_delta(&prev, &cur, coarse, header, footer);
        if delta == 0 {
            break;
        }
        // Even the best alignment doesn't really match ⇒ appending would
        // paint a visible seam (or worse, duplicated content). Prefer a
        // shorter capture over a broken one.
        if cost > APPEND_COST_ABORT {
            eprintln!("[scroll] stop: join cost {cost} > {APPEND_COST_ABORT}");
            break;
        }
        // The stitched body must not contain the sticky footer: the first
        // frame's copy is dropped before the first append (it would sit
        // embedded at the first join), and the footer is re-attached once at
        // the very bottom after the loop.
        if !appended && footer > 0 {
            truncate_bottom(&mut result, footer);
        }
        // Pixel-tight join ⇒ hard cut (a feather band's blurry stripe would
        // be more visible than sub-pixel capture noise). Residual mismatch
        // (ClearType re-rendering, fractional scroll offsets) ⇒ feather a
        // couple of rows so it fades instead of showing as a line.
        let blend = if cost > APPEND_COST_BLEND { FEATHER_ROWS } else { 0 };
        append_bottom(&mut result, &cur, delta, footer, blend);
        appended = true;
        if result.height() >= MAX_TOTAL_HEIGHT {
            break;
        }
        prev_sig = signature(&cur, header, h - footer);
        prev = cur;
    }

    // Sticky footer (stripped from the body above) appears exactly once, at
    // the bottom, taken from the last stitched frame.
    if appended && footer > 0 {
        append_rows(&mut result, &prev, h - footer, h);
    }

    if let Some((sx, sy)) = saved_cursor {
        set_cursor(sx, sy);
    }

    // The scrollbar column is already excluded from matching; drop it from
    // the output too — the thumb moves every step, so at each join it would
    // show as a hard discontinuity no alignment can fix.
    if crop_scrollbar && w > SCROLLBAR_MARGIN * 3 {
        result =
            image::imageops::crop_imm(&result, 0, 0, w - SCROLLBAR_MARGIN, result.height())
                .to_image();
    }

    Ok(result)
}

/// Scrolls forward by `*notches` and captures the settled frame. If the
/// content clearly changed but no shift within the alignment search window
/// matches it (`detect_scroll_delta` returns 0 while the frame isn't actually
/// identical to `prev_sig`), the step overshot the overlap budget the
/// stitcher needs (`MIN_OVERLAP_DENOM`) — too many wheel notches for the
/// capture region's height. The scroll is undone and retried at half the
/// notches (floor 1); once a working amount is found it's kept in `*notches`
/// for later steps too, since page geometry doesn't usually change mid-capture.
/// Returns the frame together with the coarse delta against `prev_sig`
/// (0 ⇒ page genuinely didn't move, or even 1 notch still overshoots).
fn scroll_with_backoff(
    notches: &mut i32,
    scroll: &dyn Fn(i32),
    capture: &dyn Fn() -> Result<RgbaImage, String>,
    sig_of: &dyn Fn(&RgbaImage) -> Signature,
    prev_sig: &Signature,
) -> Result<(RgbaImage, u32), String> {
    loop {
        scroll(*notches);
        let frame = capture()?;
        let sig = sig_of(&frame);
        if mean_diff(prev_sig, &sig, 0) <= IDENTICAL_THRESH {
            return Ok((frame, 0)); // genuinely no movement
        }
        let coarse = detect_scroll_delta(prev_sig, &sig);
        if coarse == 0 && *notches > 1 {
            scroll(-*notches); // undo the overshoot, then retry slower
            *notches = (*notches / 2).max(1);
            continue;
        }
        return Ok((frame, coarse));
    }
}

/// Captures the region, re-shooting until two consecutive frames are (near)
/// identical, so a frame is never taken mid smooth-scroll/inertia animation —
/// such a frame matches the previous one at no integer delta and paints a seam.
/// Pages that never settle (spinners, videos) exhaust MAX_RESHOOTS and the
/// newest frame is used as-is.
fn capture_settled(x: i32, y: i32, w: u32, h: u32) -> Result<RgbaImage, String> {
    let mut frame = capture_region(x, y, w, h)?;
    for _ in 0..MAX_RESHOOTS {
        std::thread::sleep(Duration::from_millis(RESHOOT_GAP_MS));
        let next = capture_region(x, y, w, h)?;
        let settled =
            mean_diff(&signature(&frame, 0, h), &signature(&next, 0, h), 0) <= IDENTICAL_THRESH;
        frame = next;
        if settled {
            break;
        }
    }
    Ok(frame)
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

/// Detects fixed header/footer rows by comparing `prev` and `cur` at the same
/// row index (no shift) — a row that's still identical after a real scroll
/// step is static UI (sticky nav, chat input box, etc.), not content. Capped
/// at `MAX_BAND_FRACTION` of the frame each so a page that hasn't scrolled at
/// all (every row "matches") can't be mistaken for an all-fixed frame.
fn detect_fixed_bands(prev: &RgbaImage, cur: &RgbaImage) -> (u32, u32) {
    let w = prev.width();
    let h = prev.height();
    if cur.width() != w || cur.height() != h || h == 0 {
        return (0, 0);
    }
    let mw = match_width(w) as usize;
    let wf = w as usize;
    let pr = prev.as_raw();
    let cr = cur.as_raw();

    let row_diff = |row: usize| -> u32 {
        let base = row * wf * 4;
        let mut total: u64 = 0;
        let mut count: u64 = 0;
        let mut col = 0usize;
        while col < mw {
            let i = base + col * 4;
            total += (pr[i] as i32 - cr[i] as i32).unsigned_abs() as u64;
            total += (pr[i + 1] as i32 - cr[i + 1] as i32).unsigned_abs() as u64;
            total += (pr[i + 2] as i32 - cr[i + 2] as i32).unsigned_abs() as u64;
            count += 3;
            col += 4;
        }
        if count == 0 { u32::MAX } else { (total / count) as u32 }
    };

    let max_band = ((h as f32) * MAX_BAND_FRACTION) as usize;
    let h = h as usize;

    let mut header = 0usize;
    while header < max_band && header < h && row_diff(header) <= BAND_ROW_THRESH {
        header += 1;
    }
    let mut footer = 0usize;
    while footer < max_band && footer < h.saturating_sub(header) && row_diff(h - 1 - footer) <= BAND_ROW_THRESH {
        footer += 1;
    }
    (header as u32, footer as u32)
}

/// Builds a signature from rows `[top, bottom_excl)` only, so a fixed
/// header/footer (passed as `top`/`h - footer`) never enters the alignment
/// search — a delta computed within this band is identical to the delta in
/// full-frame coordinates, since the excluded rows never move.
fn signature(img: &RgbaImage, top: u32, bottom_excl: u32) -> Signature {
    let w = img.width() as usize;
    let top = top as usize;
    let bottom_excl = (bottom_excl as usize).min(img.height() as usize);
    let h = bottom_excl.saturating_sub(top);
    let usable = match_width(img.width()) as usize;
    let samples = COL_SAMPLES.min(usable.max(1));
    let step = (usable / samples).max(1);
    let raw = img.as_raw();
    let mut data = vec![0u8; h * samples];
    for row in 0..h {
        let row_base = (top + row) * w * 4;
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
/// visible seam, so this final pass is what makes the join clean. `header`/
/// `footer` exclude the fixed bands from the comparison, same as `signature`.
/// Returns `(best_delta, best_cost)` where cost is the mean per-channel abs diff
/// at the winning alignment (lower = better match; used to decide whether to blend).
fn refine_delta(prev: &RgbaImage, cur: &RgbaImage, coarse: u32, header: u32, footer: u32) -> (u32, u64) {
    let w = prev.width();
    let h = prev.height();
    if cur.width() != w || cur.height() != h || h == 0 {
        return (coarse, u64::MAX);
    }
    let c = h.saturating_sub(header).saturating_sub(footer);
    if c == 0 {
        return (coarse, u64::MAX);
    }
    let mw = match_width(w) as usize;
    let wf = w as usize;
    let header = header as usize;
    let pr = prev.as_raw();
    let cr = cur.as_raw();

    let max_d = (c - c / MIN_OVERLAP_DENOM as u32) as i32;
    let lo = (coarse as i32 - REFINE_RADIUS).max(1);
    let hi = (coarse as i32 + REFINE_RADIUS).min(max_d);

    let mut best_d = coarse;
    let mut best_cost = u64::MAX;
    let mut d = lo;
    while d <= hi {
        let du = d as usize;
        let overlap = c as usize - du;
        let mut total: u64 = 0;
        let mut count: u64 = 0;
        // Compare content-band prev rows [d, c) against cur rows [0, c-d);
        // step rows/cols by 2. Both are offset by `header` into the full frame.
        let mut i = 0usize;
        while i < overlap {
            let prow = (header + du + i) * wf * 4;
            let crow = (header + i) * wf * 4;
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

/// Appends the newly revealed `d` rows of `cur`'s content band onto `result`
/// (i.e. the `d` rows immediately above the fixed footer, never the footer
/// itself — otherwise it would repeat in the output on every step). When
/// `blend_rows` is non-zero, feather-blends that many rows just above the join
/// so residual rendering differences fade out instead of showing as a hard
/// line; pass 0 for a clean hard cut (preferred when alignment is pixel-tight).
fn append_bottom(result: &mut RgbaImage, cur: &RgbaImage, d: u32, footer: u32, blend_rows: u32) {
    let w = result.width();
    let content_h = cur.height().saturating_sub(footer);
    if cur.width() != w || d == 0 || d > content_h {
        return;
    }
    let ch = content_h;
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
    let end = (ch as usize) * wf * 4;
    data.extend_from_slice(&cur.as_raw()[start..end]);
    if let Some(img) = RgbaImage::from_raw(w, rh + d, data) {
        *result = img;
    }
}

/// Drops `rows` from the bottom of `img` (no-op when 0 or the whole image).
fn truncate_bottom(img: &mut RgbaImage, rows: u32) {
    let w = img.width();
    let h = img.height();
    if rows == 0 || rows >= h {
        return;
    }
    let mut data = std::mem::replace(img, RgbaImage::new(0, 0)).into_raw();
    data.truncate(w as usize * (h - rows) as usize * 4);
    if let Some(out) = RgbaImage::from_raw(w, h - rows, data) {
        *img = out;
    }
}

/// Appends rows `[top, bottom_excl)` of `src` (same width) below `result`.
fn append_rows(result: &mut RgbaImage, src: &RgbaImage, top: u32, bottom_excl: u32) {
    let w = result.width();
    if src.width() != w || bottom_excl <= top || bottom_excl > src.height() {
        return;
    }
    let rows = bottom_excl - top;
    let rh = result.height();
    let wf = w as usize;
    let mut data = std::mem::replace(result, RgbaImage::new(0, 0)).into_raw();
    data.extend_from_slice(&src.as_raw()[top as usize * wf * 4..bottom_excl as usize * wf * 4]);
    if let Some(out) = RgbaImage::from_raw(w, rh + rows, data) {
        *result = out;
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
    let monitors = crate::monitors::enumerate()?.monitors;
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
