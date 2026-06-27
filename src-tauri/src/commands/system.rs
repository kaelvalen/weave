use tracing::info;

use crate::AppState;
use crate::utils::config::AppConfig;
use crate::utils::errors::WeaveError;

const VERSION: &str = env!("CARGO_PKG_VERSION");

#[tauri::command]
pub fn system_get_config() -> Result<AppConfig, WeaveError> {
    AppConfig::load()
}

#[tauri::command]
pub fn system_set_config(
    config: AppConfig,
    app_state: tauri::State<'_, AppState>,
) -> Result<(), WeaveError> {
    config.validate()?;
    config.save()?;
    app_state.ai_bridge.update_config(config.ai.clone());
    info!("Configuration updated and AI bridge refreshed");
    Ok(())
}

#[tauri::command]
pub async fn list_provider_models(
    provider: String,
    app_state: tauri::State<'_, AppState>,
) -> Result<Vec<String>, WeaveError> {
    use crate::utils::config::Provider;

    let provider = match provider.as_str() {
        "openai" => Provider::Openai,
        "anthropic" => Provider::Anthropic,
        "kimi" => Provider::Kimi,
        "opencode" => Provider::Opencode,
        "local" => Provider::Local,
        _ => return Err(WeaveError::ConfigError(format!("Unknown provider: {}", provider))),
    };

    app_state.ai_bridge.list_models(provider).await
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
pub fn system_set_cwd(path: String) -> Result<(), WeaveError> {
    std::env::set_current_dir(&path)
        .map_err(|e| WeaveError::Io(format!("Failed to set CWD to {}: {}", path, e)))?;
    info!("Changed working directory to: {}", path);
    Ok(())
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
