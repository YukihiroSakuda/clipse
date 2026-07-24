mod commands;
mod diag;
mod settings;
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

            // PrintScreen is grabbed via a low-level keyboard hook instead of
            // RegisterHotKey, so it works even when the OS Snipping Tool or
            // another app holds the key. Windows-only.
            #[cfg(target_os = "windows")]
            hook_win::install(app.handle().clone());

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
                window::show_panel(app.handle(), None);
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
            commands::capture::get_virtual_screen_origin,
            commands::capture::get_windows_info,
            commands::capture::get_element_rects,
            commands::capture::open_region_overlay,
            commands::capture::open_region_overlay_scroll,
            commands::capture::get_scroll_mode,
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
            commands::capture::capture_fullscreen,
            commands::capture::capture_active_window,
            commands::capture::capture_region,
            // Clipboard
            commands::clipboard::copy_image_to_clipboard,
            commands::clipboard::copy_image_bytes_to_clipboard,
            commands::clipboard::copy_capture_to_clipboard,
            commands::clipboard::copy_file_to_clipboard,
            // Storage
            commands::storage::save_image,
            commands::storage::overwrite_image,
            commands::storage::auto_save_image,
            commands::storage::list_captures,
            commands::storage::delete_capture,
            commands::storage::rename_capture,
            commands::storage::get_captures_dir,
            commands::storage::open_captures_folder,
            commands::storage::open_capture_in_editor,
            commands::storage::open_file,
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
            settings::open_about,
            settings::get_app_version,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
