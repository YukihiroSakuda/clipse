mod commands;
mod diag;
mod settings;
mod shortcuts;
mod state;
mod tray;
mod uia_win;
mod window;
#[cfg(target_os = "windows")]
mod capture_win;
#[cfg(target_os = "windows")]
mod hook_win;
#[cfg(target_os = "windows")]
mod scroll_win;
#[cfg(target_os = "windows")]
mod startup_win;
#[cfg(target_os = "windows")]
mod record_win;

pub fn run() {
    tauri::Builder::default()
        .manage(state::AppState::new())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            use tauri::Manager;

            // Resolve the diagnostics log path before anything can want to log
            // (the keyboard hook and its display watcher install just below).
            diag::init(app.handle());

            // Load persisted settings into AppState before anything reads them.
            let loaded = settings::load(app.handle());
            if let Ok(mut guard) = app.state::<state::AppState>().settings.lock() {
                *guard = loaded.clone();
            }

            // Reconcile the OS autostart entry with the persisted setting.
            // `update_settings` only touches the registry when the toggle
            // changes, so a stale/missing entry (e.g. enabled from a dev
            // build, then installed to a different path; or removed by an
            // uninstaller) would otherwise never be repaired. `enable()`
            // rewrites the entry with the *current* exe path. Release-only:
            // a dev build would register the dev exe, which is useless at
            // boot (no dev server) and shadows the installed app.
            #[cfg(not(debug_assertions))]
            {
                // Inside an MSIX package the registry entry is meaningless
                // (see `startup_win`) and there is nothing to repair — the
                // manifest's StartupTask is the state, and Windows owns it. All
                // that's wanted here is to notice the user turning it off in
                // Task Manager, so the toggle in Settings doesn't keep claiming
                // it's on.
                #[cfg(target_os = "windows")]
                let packaged = startup_win::is_packaged();
                #[cfg(not(target_os = "windows"))]
                let packaged = false;

                if packaged {
                    #[cfg(target_os = "windows")]
                    if let Some(state) = startup_win::state() {
                        let on = state == startup_win::StartupState::Enabled;
                        if on != loaded.launch_on_startup {
                            let mut synced = loaded.clone();
                            synced.launch_on_startup = on;
                            if let Ok(mut guard) =
                                app.state::<state::AppState>().settings.lock()
                            {
                                guard.launch_on_startup = on;
                            }
                            let _ = settings::persist(app.handle(), &synced);
                            diag::log(&format!("startup: adopted OS state (enabled={on})"));
                        }
                    }
                } else {
                    use tauri_plugin_autostart::ManagerExt;
                    let autolaunch = app.autolaunch();
                    let result = if loaded.launch_on_startup {
                        autolaunch.enable()
                    } else if autolaunch.is_enabled().unwrap_or(false) {
                        autolaunch.disable()
                    } else {
                        Ok(())
                    };
                    if let Err(e) = result {
                        eprintln!("[setup] autostart sync failed: {e}");
                    }
                }
            }

            // PrintScreen is grabbed via a low-level keyboard hook instead of
            // RegisterHotKey, so it works even when the OS Snipping Tool or
            // another app holds the key. Windows-only.
            #[cfg(target_os = "windows")]
            {
                // Load the user's accelerators before installing the hook, so
                // the very first keystroke is already matched against them
                // rather than against the built-in defaults.
                hook_win::apply_shortcuts(&loaded.shortcuts);
                hook_win::install(app.handle().clone());
            }

            // Drop orphaned thumbnail cache files (sources since deleted/edited).
            // Runs off-thread so disk work never delays startup.
            let prune_handle = app.handle().clone();
            std::thread::spawn(move || commands::storage::prune_thumb_cache(&prune_handle));

            // System-tray residency (Screenpresso-style).
            tray::build_tray(app.handle())?;

            // First launch: the app is otherwise silent (tray-resident, no
            // window, no notification) — show the gallery once so a new user
            // sees it's running and reads its empty-state hint ("Press
            // PrintScreen to capture") instead of the app vanishing with zero
            // explanation.
            if !loaded.onboarded {
                window::show_panel(app.handle());
                let mut onboarded_settings = loaded.clone();
                onboarded_settings.onboarded = true;
                if let Ok(mut guard) = app.state::<state::AppState>().settings.lock() {
                    *guard = onboarded_settings.clone();
                }
                let _ = settings::persist(app.handle(), &onboarded_settings);
            }

            // Prewarm the hidden overlay window pool so the very first
            // PrintScreen only has to *show* the overlays instead of building
            // one webview per monitor (hundreds of ms). Runs off the setup
            // path so startup isn't delayed.
            let prewarm_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                window::prewarm_overlays(&prewarm_handle);
                // Same reasoning for Ctrl+PrintScreen's menu — it's on a global
                // hotkey, so its first open must not pay for webview creation.
                window::prewarm_quick_menu(&prewarm_handle);
            });

            // The main panel hides instead of closing (tray-resident app),
            // and stays open otherwise — it must not vanish just because
            // another Clipse window (editor, settings, …) took focus, or a
            // gallery action (copy, open) briefly shifts focus away.
            if let Some(main) = app.get_webview_window("main") {
                // See `window::disable_browser_accelerator_keys` — without
                // this, WebView2's own F12/F5/etc. handling can reload this
                // window before our JS ever sees the keystroke.
                #[cfg(target_os = "windows")]
                window::disable_browser_accelerator_keys(&main);
                // Exclude the gallery from every screen-capture path (DXGI Desktop
                // Duplication, GDI, Windows.Graphics.Capture) at the OS/compositor
                // level — the same mechanism `open_fixed_capture`'s control window
                // and the recorder's mini control bar use to keep themselves out of
                // their own capture output. Without this, the gallery only stays out
                // of Clipse's own screenshots by being hidden in time for the
                // PrintScreen-time frozen snapshot (`freeze_desktop`) — a race that,
                // on some systems, lets a residual frame of the just-hidden gallery
                // get baked into that snapshot and "ghost" in the background for the
                // whole selection drag. Exclusion makes this unconditional: the
                // gallery can never end up in a capture regardless of hide() timing.
                #[cfg(target_os = "windows")]
                window::set_excluded_from_capture(&main, true);
                let main_for_event = main.clone();
                main.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = main_for_event.hide();
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Capture
            commands::capture::get_monitors,
            commands::capture::get_windows_info,
            commands::capture::get_element_rects,
            commands::capture::open_region_overlay,
            commands::capture::open_region_overlay_scroll,
            commands::capture::get_scroll_mode,
            commands::capture::open_region_overlay_fixed,
            commands::capture::get_fixed_region,
            commands::capture::cancel_overlay,
            commands::capture::complete_region_capture,
            commands::capture::complete_scroll_capture,
            commands::capture::complete_window_capture_by_id,
            commands::capture::complete_monitor_capture,
            commands::capture::do_window_capture,
            commands::capture::do_fullscreen_capture,
            commands::capture::get_pending_image,
            commands::capture::get_pending_path,
            commands::capture::get_frozen_frame,
            commands::capture::do_cursor_monitor_capture,
            commands::capture::do_repeat_region_capture,
            commands::capture::do_virtual_desktop_capture,
            commands::capture::toast_open_editor,
            commands::capture::toast_dismiss,
            // Quick menu (Ctrl+PrintScreen) — shares its action list with the tray
            commands::actions::open_quick_menu,
            commands::actions::quick_menu_run,
            commands::actions::quick_menu_close,
            // Clipboard
            commands::clipboard::copy_image_to_clipboard,
            commands::clipboard::copy_image_bytes_to_clipboard,
            commands::clipboard::copy_capture_to_clipboard,
            commands::clipboard::copy_file_to_clipboard,
            commands::clipboard::set_annotation_clipboard,
            commands::clipboard::get_annotation_clipboard,
            // Pin to Screen
            commands::pin::pin_image_bytes,
            commands::pin::pin_capture_by_path,
            commands::pin::get_pinned_image,
            // Storage
            commands::storage::save_image,
            commands::storage::overwrite_image,
            commands::storage::list_captures,
            commands::storage::delete_capture,
            commands::storage::rename_capture,
            commands::storage::toggle_favorite,
            commands::storage::open_captures_folder,
            commands::storage::open_capture_in_editor,
            commands::storage::open_file,
            commands::storage::save_sidecar,
            commands::storage::get_pending_annotations,
            commands::storage::delete_sidecar,
            // Diagnostics
            diag::log_diag,
            // OCR
            commands::ocr::run_ocr,
            // Recording
            commands::record::list_recording_monitors,
            commands::record::open_recorder,
            commands::record::start_recording,
            commands::record::stop_recording,
            commands::record::is_recording,
            // Settings
            settings::get_settings,
            settings::open_settings,
            settings::update_settings,
            settings::pick_directory,
            settings::set_shortcut_recording,
            settings::open_about,
            settings::get_app_version,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
