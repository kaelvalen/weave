use tauri::State;
use tracing::info;

use crate::models::plugin::Plugin;
use crate::AppState;
use crate::utils::config::AppConfig;
use crate::utils::errors::WeaveError;

const VERSION: &str = env!("CARGO_PKG_VERSION");

#[tauri::command]
pub fn system_get_config() -> Result<AppConfig, WeaveError> {
    AppConfig::load()
}

#[tauri::command]
pub fn system_set_config(config: AppConfig) -> Result<(), WeaveError> {
    config.validate()?;
    config.save()?;
    info!("Configuration updated");
    Ok(())
}

#[tauri::command]
pub fn system_get_plugin_dir() -> Result<String, WeaveError> {
    let dir = AppConfig::plugin_dir()?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn system_get_version() -> String {
    VERSION.to_string()
}

#[tauri::command]
pub fn system_open_plugin_dir() -> Result<(), WeaveError> {
    let dir = AppConfig::plugin_dir()?;
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(&dir).spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer").arg(&dir).spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open").arg(&dir).spawn();
    }
    Ok(())
}
