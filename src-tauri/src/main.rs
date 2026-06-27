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

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(app_state)
        .invoke_handler(weave::tauri_commands())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
