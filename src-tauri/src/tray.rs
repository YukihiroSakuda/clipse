//! System-tray icon and menu — keeps Clipse resident like Screenpresso.
//! Left-click opens the gallery; the menu exposes capture actions and Quit.

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

use crate::{commands, state::AppState, window};

/// Shows the gallery panel without a specific tray position (e.g. from menu).
fn show_main(app: &AppHandle) {
    window::show_panel(app, None);
}

/// Clears the OS chrome the user just went through to reach this menu, before
/// any capture path snapshots the desktop.
///
/// Two different things are in the way. The native context menu closes itself,
/// but only after an animation — hence the settle delay, without which a capture
/// can freeze a frame where it is still mid-close. The taskbar's "hidden icons"
/// overflow flyout does **not** close itself: reaching a tray icon that lives in
/// it means opening it first, and it then stays on screen right through the
/// capture and gets baked into the image. No amount of waiting fixes that, so it
/// is dismissed explicitly.
async fn dismiss_tray_menu() {
    #[cfg(target_os = "windows")]
    hide_tray_overflow_flyout();
    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
}

/// Hides the taskbar's overflow ("hidden icons") flyout if it is on screen.
///
/// No undo needed: this is a transient shell surface, and Explorer re-shows it
/// itself the next time the chevron is clicked.
///
/// The class name has changed across Windows versions, and on current Windows 11
/// builds the flyout is hosted in `XamlExplorerHostIslandWindow` — a *generic*
/// shell class shared with the Start menu, Widgets and the notification centre.
/// Hiding one of those by mistake would be a real (if temporary) annoyance, so a
/// window only qualifies when it is both visible and small enough to be a grid of
/// tray icons rather than a full panel. What was hidden is logged, so a misfire
/// is visible in a field report instead of being a mystery.
/// Window classes the overflow flyout has used across Windows versions. The last
/// one is generic — see `hide_tray_overflow_flyout` for why that matters.
#[cfg(target_os = "windows")]
const OVERFLOW_FLYOUT_CLASSES: [&str; 3] = [
    "NotifyIconOverflowWindow",            // Windows 10
    "TopLevelWindowForOverflowXamlIsland", // Windows 11, earlier builds
    "XamlExplorerHostIslandWindow",        // Windows 11, current builds
];

/// Biggest a window may be and still be taken for the icon flyout. The Start
/// menu, Widgets and the notification centre share the generic XAML host class
/// and are all far larger than a grid of tray icons.
#[cfg(target_os = "windows")]
const MAX_FLYOUT_PX: i32 = 600;

#[cfg(target_os = "windows")]
fn hide_tray_overflow_flyout() {
    use windows::Win32::Foundation::LPARAM;
    use windows::Win32::UI::WindowsAndMessaging::EnumWindows;

    // Every top-level window is walked rather than `FindWindowW`-ing each class:
    // that only ever returns the *first* window of a class, and several shell
    // surfaces share `XamlExplorerHostIslandWindow` — so it would happily return
    // a hidden one and miss the flyout that is actually on screen.
    unsafe {
        let _ = EnumWindows(Some(hide_if_overflow_flyout), LPARAM(0));
    }
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn hide_if_overflow_flyout(
    hwnd: windows::Win32::Foundation::HWND,
    _lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::BOOL {
    use windows::Win32::Foundation::{BOOL, RECT};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetWindowRect, IsWindowVisible, ShowWindow, SW_HIDE,
    };

    // Non-zero keeps the enumeration going; this callback never wants to stop
    // early, since more than one matching surface could be up.
    const CONTINUE: BOOL = BOOL(1);

    if !IsWindowVisible(hwnd).as_bool() {
        return CONTINUE;
    }
    let mut buf = [0u16; 128];
    let len = GetClassNameW(hwnd, &mut buf);
    if len <= 0 {
        return CONTINUE;
    }
    let class = String::from_utf16_lossy(&buf[..len as usize]);
    if !OVERFLOW_FLYOUT_CLASSES.contains(&class.as_str()) {
        return CONTINUE;
    }
    let mut r = RECT::default();
    if GetWindowRect(hwnd, &mut r).is_err() {
        return CONTINUE;
    }
    let (w_px, h_px) = (r.right - r.left, r.bottom - r.top);
    if w_px <= 0 || h_px <= 0 || w_px > MAX_FLYOUT_PX || h_px > MAX_FLYOUT_PX {
        return CONTINUE;
    }
    let _ = ShowWindow(hwnd, SW_HIDE);
    crate::diag::log(&format!(
        "tray: hid overflow flyout before capturing ({class} {w_px}x{h_px})"
    ));
    CONTINUE
}

/// Builds the tray icon and attaches its menu + click handlers.
pub fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let capture = MenuItem::with_id(app, "capture", "Take Screenshot", true, None::<&str>)?;
    let repeat =
        MenuItem::with_id(app, "cap_repeat", "Repeat Last Region", true, None::<&str>)?;
    let all_monitors =
        MenuItem::with_id(app, "cap_all", "Capture All Monitors", true, None::<&str>)?;
    let scroll =
        MenuItem::with_id(app, "cap_scroll", "Scrolling Capture", true, None::<&str>)?;
    let fixed =
        MenuItem::with_id(app, "cap_fixed", "Fixed-Size Capture", true, None::<&str>)?;
    let record = MenuItem::with_id(app, "record", "Record Screen", true, None::<&str>)?;
    let gallery = MenuItem::with_id(app, "gallery", "Open Gallery", true, None::<&str>)?;
    let about = MenuItem::with_id(app, "about", "About Clipse", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;

    // Stashed so record.rs can flip its label to "Stop Recording" while active.
    if let Ok(mut guard) = app.state::<AppState>().record_menu_item.lock() {
        *guard = Some(record.clone());
    }

    let menu = Menu::with_items(
        app,
        &[
            &capture,
            &repeat,
            &all_monitors,
            &scroll,
            &fixed,
            &record,
            &sep1,
            &gallery,
            &about,
            &settings,
            &sep2,
            &quit,
        ],
    )?;

    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().expect("default window icon").clone())
        .tooltip("Clipse — PrintScreen to capture")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "capture" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    dismiss_tray_menu().await;
                    if let Err(e) = window::open_overlay(&app) {
                        eprintln!("[tray] overlay error: {e}");
                    }
                });
            }
            "cap_repeat" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    dismiss_tray_menu().await;
                    if let Err(e) = commands::capture::do_repeat_region_capture(app).await {
                        eprintln!("[tray] repeat-region error: {e}");
                    }
                });
            }
            "cap_all" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    dismiss_tray_menu().await;
                    if let Err(e) = commands::capture::do_virtual_desktop_capture(app).await {
                        eprintln!("[tray] all-monitors error: {e}");
                    }
                });
            }
            "cap_scroll" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    dismiss_tray_menu().await;
                    if let Err(e) = commands::capture::open_region_overlay_scroll(app).await {
                        eprintln!("[tray] scroll overlay error: {e}");
                    }
                });
            }
            "cap_fixed" => {
                if let Err(e) = window::open_fixed_capture(app) {
                    eprintln!("[tray] fixed-capture window error: {e}");
                }
            }
            "record" => {
                // While a recording is in progress, the recorder window is hidden
                // (so its own UI doesn't show up in the capture) — this menu item
                // is the one always-reachable way to stop it. Otherwise, open the
                // recorder window to start a new one.
                if !commands::record::hotkey_stop_if_recording(app) {
                    if let Err(e) = window::open_recorder(app) {
                        eprintln!("[tray] recorder error: {e}");
                    }
                }
            }
            "gallery" => show_main(app),
            "about" => {
                if let Err(e) = window::open_about(app) {
                    eprintln!("[tray] about error: {e}");
                }
            }
            "settings" => {
                if let Err(e) = window::open_settings(app) {
                    eprintln!("[tray] settings error: {e}");
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                position,
                ..
            } = event
            {
                window::show_panel(tray.app_handle(), Some((position.x, position.y)));
            }
        })
        .build(app)?;

    Ok(())
}
