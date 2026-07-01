mod commands;
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

            // Load persisted settings into AppState before anything reads them.
            let loaded = settings::load(app.handle());
            if let Ok(mut guard) = app.state::<state::AppState>().settings.lock() {
                *guard = loaded.clone();
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

            // The main panel hides instead of closing (tray-resident app).
            // Also auto-hides when it loses focus (Screenpresso-style popup).
            if let Some(main) = app.get_webview_window("main") {
                let main_for_event = main.clone();
                main.on_window_event(move |event| {
                    match event {
                        tauri::WindowEvent::CloseRequested { api, .. } => {
                            api.prevent_close();
                            let _ = main_for_event.hide();
                        }
                        tauri::WindowEvent::Focused(false) => {
                            let _ = main_for_event.hide();
                        }
                        _ => {}
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
            commands::capture::capture_fullscreen,
            commands::capture::capture_active_window,
            commands::capture::capture_region,
            // Clipboard
            commands::clipboard::copy_image_to_clipboard,
            commands::clipboard::copy_capture_to_clipboard,
            // Storage
            commands::storage::save_image,
            commands::storage::overwrite_image,
            commands::storage::auto_save_image,
            commands::storage::list_captures,
            commands::storage::delete_capture,
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
            settings::update_settings,
            settings::pick_directory,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
