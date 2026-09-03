//! Single source of truth for monitor enumeration.
//!
//! **`xcap::Monitor::all()` (0.0.15) silently drops monitors it fails to
//! describe.** `EnumDisplayMonitors` hands it every `HMONITOR`, but each one
//! then goes through `EnumDisplaySettingsW(ENUM_CURRENT_SETTINGS)`, and a
//! monitor that fails there is left out of the returned list entirely — with
//! only a `log::error!` that goes nowhere, since no log backend is installed.
//! `EnumDisplaySettingsW` fails *transiently* while a display is mid-mode
//! change: DPMS wake, a GPU driver reset, RDP/VDI reconnect, a cable being
//! plugged in. (Upstream xcap has since made this path infallible — 0.9.x
//! pushes every `HMONITOR` unconditionally — which is the same bug, fixed.)
//!
//! The symptom is a list reporting only the primary monitor while a second one
//! is very much attached, and every consumer believing it: overlays get built
//! for one display (so the other cannot be selected on at all),
//! `virtual_screen_bounds` shrinks to it, and `capture_rect_composited`
//! zero-fills — i.e. leaves fully transparent — whatever the missing monitor
//! covered. "Only the main display gets captured."
//!
//! `GetSystemMetrics(SM_CMONITORS)` answers the same question without going
//! anywhere near `EnumDisplaySettingsW`, so it is an *independent* ground truth
//! for how many monitors should have come back. When the two disagree, we retry
//! briefly — the failure is a race by nature and clears in milliseconds — and
//! if the list is still short we say so, in the returned `complete` flag and in
//! `clipse.log`. Nothing here can conjure the missing monitor back; the point is
//! that a degraded list stops being indistinguishable from a real one-monitor
//! desktop.
//!
//! Note on the retry cost: the normal path compares two integers and returns.
//! The sleeps below are only ever paid when the list really is short, which
//! matters because this sits on the PrintScreen-to-overlay path that the whole
//! overlay-pool design exists to keep fast.

use std::time::{Duration, Instant};

/// How many times to re-enumerate when the OS reports more monitors than xcap
/// described. The race this works around resolves on its own in milliseconds;
/// what matters is not giving up on the first look.
const RETRY_ATTEMPTS: usize = 3;
/// Gap between retries. Worst case `RETRY_ATTEMPTS * RETRY_GAP_MS`, and only on
/// a desktop that is genuinely mid-transition.
const RETRY_GAP_MS: u64 = 50;

/// A monitor list, plus whether it can be trusted to be the whole desktop.
pub struct Enumeration {
    pub monitors: Vec<xcap::Monitor>,
    /// False when `SM_CMONITORS` still reports more monitors than xcap could
    /// describe after the retries.
    ///
    /// Callers that **persist** a layout — the overlay pool signature — must
    /// refuse to store one that isn't complete, or the degraded layout is
    /// latched in and every later capture fast-paths onto a pool that is
    /// missing a display. Callers that merely need pixels right now carry on
    /// with whatever came back: a partial capture beats no capture.
    pub complete: bool,
}

/// Enumerates the desktop's monitors, cross-checked against `SM_CMONITORS` and
/// retried briefly if the list came back short. Only the first
/// `xcap::Monitor::all()` failure is propagated as an error — after that there
/// is always a list to return, however incomplete.
pub fn enumerate() -> Result<Enumeration, String> {
    let mut monitors = xcap::Monitor::all().map_err(|e| e.to_string())?;

    // No independent count to compare against (non-Windows, or the call
    // failed) — take the list at face value rather than invent a doubt.
    let Some(expected) = expected_count() else {
        return Ok(Enumeration { monitors, complete: true });
    };
    // `>=` rather than `==` deliberately: only a *short* list is the failure
    // being guarded against here. Any counting difference in the other
    // direction is xcap seeing more than `SM_CMONITORS` counts, which is not
    // this bug and must not be turned into a spurious degraded verdict.
    if monitors.len() >= expected {
        return Ok(Enumeration { monitors, complete: true });
    }

    let started = Instant::now();
    for attempt in 1..=RETRY_ATTEMPTS {
        std::thread::sleep(Duration::from_millis(RETRY_GAP_MS));
        // A hard failure on a retry is not fatal: keep the list we already have
        // and let the remaining attempts try again.
        let Ok(next) = xcap::Monitor::all() else { continue };
        let recovered = next.len() >= expected;
        monitors = next;
        if recovered {
            crate::diag::log(&format!(
                "monitors: recovered {} of {} on retry {attempt} ({}ms)",
                monitors.len(),
                expected,
                started.elapsed().as_millis(),
            ));
            return Ok(Enumeration { monitors, complete: true });
        }
    }

    // The load-bearing line for any "only my main display gets captured" field
    // report: it is the one place the mismatch is visible at all.
    crate::diag::log(&format!(
        "monitors: DEGRADED — {} enumerated, {} attached (gave up after {}ms)",
        monitors.len(),
        expected,
        started.elapsed().as_millis(),
    ));
    Ok(Enumeration { monitors, complete: false })
}

/// How many display monitors the OS says are on the desktop, or `None` when it
/// won't say. Deliberately *not* routed through xcap: this is the cross-check,
/// and it is only worth anything because it doesn't share xcap's failing call.
#[cfg(target_os = "windows")]
fn expected_count() -> Option<usize> {
    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CMONITORS};

    // Mirrored ("duplicate these displays") monitors are one HMONITOR to
    // Windows and one entry to `SM_CMONITORS` alike, so the two agree there.
    match unsafe { GetSystemMetrics(SM_CMONITORS) } {
        n if n > 0 => Some(n as usize),
        // Documented to return 0 on failure — and a desktop with zero monitors
        // isn't one we could be running on. Either way: nothing to compare.
        _ => None,
    }
}

#[cfg(not(target_os = "windows"))]
fn expected_count() -> Option<usize> {
    None
}
