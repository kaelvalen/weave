use tracing::info;

use crate::utils::config::AppConfig;
use crate::utils::errors::WeaveError;
use crate::AppState;

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
        "llama-swap" => Provider::LlamaSwap,
        _ => {
            return Err(WeaveError::ConfigError(format!(
                "Unknown provider: {}",
                provider
            )))
        }
    };

    app_state.ai_bridge.list_models(provider).await
}

#[tauri::command]
pub fn system_get_version() -> String {
    VERSION.to_string()
}

#[tauri::command]
pub fn system_set_cwd(
    path: String,
    _app_state: tauri::State<'_, AppState>,
) -> Result<(), WeaveError> {
    std::env::set_current_dir(&path)
        .map_err(|e| WeaveError::Io(format!("Failed to set CWD to {}: {}", path, e)))?;
    info!("Changed working directory to: {}", path);

    // Persist the workspace root so the AI sees the same folder after a
    // restart — the File Manager syncs it, but the backend must own it too.
    if let Ok(mut config) = AppConfig::load() {
        if config.workspace_root.as_deref() != Some(path.as_str()) {
            config.workspace_root = Some(path.clone());
            if let Err(e) = config.save() {
                tracing::warn!("Failed to persist workspace root: {}", e);
            }
        }
    }
    Ok(())
}
