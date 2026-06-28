// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tracing::info;

fn main() {
    tracing_subscriber::fmt::init();
    info!("Starting Weave...");

    let app_state = match weave::AppState::new() {
        Ok(state) => state,
        Err(e) => {
            tracing::error!("Failed to initialize app state: {}", e);
            std::process::exit(1);
        }
    };

    let mut canvas_rx = app_state.canvas_tx.subscribe();

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                use tauri::Emitter;
                while let Ok(msg) = canvas_rx.recv().await {
                    let _ = app_handle.emit("canvas-action", msg);
                }
            });
            Ok(())
        })
        .manage(app_state)
        .manage(weave::commands::models::SysinfoState::default())
        .invoke_handler(tauri::generate_handler![
            weave::commands::chat::chat_send_message,
            weave::commands::chat::chat_get_history,
            weave::commands::chat::chat_set_history,
            weave::commands::chat::chat_clear_history,
            weave::commands::chat::chat_get_message,
            weave::commands::chat::chat_abort_generation,
            weave::commands::session::chat_list_sessions,
            weave::commands::session::chat_load_session,
            weave::commands::session::chat_save_session,
            weave::commands::session::chat_update_session_meta,
            weave::commands::session::chat_delete_session,
            weave::commands::plugin::plugin_discover,
            weave::commands::plugin::plugin_load,
            weave::commands::plugin::plugin_unload,
            weave::commands::plugin::plugin_execute,
            weave::commands::plugin::plugin_get_all,
            weave::commands::plugin::plugin_get_loaded,
            weave::commands::plugin::plugin_get_by_id,
            weave::commands::system::system_get_config,
            weave::commands::system::system_set_config,
            weave::commands::system::list_provider_models,
            weave::commands::system::system_get_plugin_dir,
            weave::commands::system::system_get_version,
            weave::commands::system::system_open_plugin_dir,
            weave::commands::system::system_set_cwd,
            weave::commands::models::list_local_models,
            weave::commands::models::delete_local_model,
            weave::commands::models::download_local_model,
            weave::commands::models::get_system_stats,
            weave::commands::knowledge::list_knowledge_files,
            weave::commands::knowledge::upload_knowledge_file,
            weave::commands::knowledge::delete_knowledge_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
