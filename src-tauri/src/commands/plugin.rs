use tauri::State;
use tracing::{debug, info};

use crate::models::plugin::Plugin;
use crate::AppState;
use crate::utils::errors::WeaveError;

#[tauri::command]
pub async fn plugin_discover(
    app_state: State<'_, AppState>,
) -> Result<Vec<Plugin>, WeaveError> {
    info!("Plugin discovery requested");
    app_state.plugin_manager.discover()
}

/// Install a plugin from a local `.wpk` file by copying it into the plugin directory
/// and re-running discovery. Returns the freshly discovered plugin list.
#[tauri::command]
pub async fn plugin_install_from_file(
    source_path: String,
    app_state: State<'_, AppState>,
) -> Result<Vec<Plugin>, WeaveError> {
    let source = std::path::PathBuf::from(&source_path);
    if !source.exists() {
        return Err(WeaveError::PluginError(format!(
            "Source file does not exist: {}",
            source_path
        )));
    }

    // Validate extension — accept .wpk (zipped) or a directory containing manifest.toml.
    let is_wpk = source.extension().and_then(|s| s.to_str()) == Some("wpk");
    let is_dir_with_manifest = source.is_dir() && source.join("manifest.toml").exists();
    if !is_wpk && !is_dir_with_manifest {
        return Err(WeaveError::PluginError(
            "Path must point to a .wpk file or a directory containing manifest.toml".to_string(),
        ));
    }

    let plugin_dir = crate::utils::config::AppConfig::plugin_dir()?;
    std::fs::create_dir_all(&plugin_dir)?;

    let dest_filename = source
        .file_name()
        .ok_or_else(|| WeaveError::PluginError("Could not determine file name".to_string()))?
        .to_string_lossy()
        .to_string();
    let dest = plugin_dir.join(&dest_filename);

    if is_wpk {
        std::fs::copy(&source, &dest)?;
        info!("Installed .wpk plugin from {} to {:?}", source_path, dest);
    } else {
        // Copy directory recursively (simple implementation)
        copy_dir_recursive(&source, &dest)?;
        info!("Installed plugin directory from {} to {:?}", source_path, dest);
    }

    app_state.plugin_manager.discover()
}

fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> Result<(), WeaveError> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let dest_path = dst.join(entry.file_name());
        if path.is_dir() {
            copy_dir_recursive(&path, &dest_path)?;
        } else {
            std::fs::copy(&path, &dest_path)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn plugin_load(
    plugin_id: String,
    app_state: State<'_, AppState>,
) -> Result<Plugin, WeaveError> {
    info!("Loading plugin: {}", plugin_id);
    app_state.plugin_manager.load(&plugin_id)?;
    app_state.plugin_manager.activate(&plugin_id)
}

#[tauri::command]
pub async fn plugin_unload(
    plugin_id: String,
    app_state: State<'_, AppState>,
) -> Result<(), WeaveError> {
    info!("Unloading plugin: {}", plugin_id);
    app_state.plugin_manager.unload(&plugin_id)
}

#[tauri::command]
pub async fn plugin_execute(
    plugin_id: String,
    capability: String,
    params: serde_json::Value,
    app_state: State<'_, AppState>,
) -> Result<serde_json::Value, WeaveError> {
    debug!("Executing: {}::{} with params: {:?}", plugin_id, capability, params);
    app_state.plugin_manager.execute_capability(&plugin_id, &capability, params)
}

#[tauri::command]
pub fn plugin_get_all(
    app_state: State<'_, AppState>,
) -> Result<Vec<Plugin>, WeaveError> {
    Ok(app_state.plugin_manager.get_all())
}

#[tauri::command]
pub fn plugin_get_loaded(
    app_state: State<'_, AppState>,
) -> Result<Vec<Plugin>, WeaveError> {
    Ok(app_state.plugin_manager.get_loaded())
}

#[tauri::command]
pub fn plugin_get_by_id(
    plugin_id: String,
    app_state: State<'_, AppState>,
) -> Result<Option<Plugin>, WeaveError> {
    Ok(app_state.plugin_manager.get_plugin(&plugin_id))
}

#[tauri::command]
pub async fn workflow_execute_chain(
    steps: Vec<crate::core::workflow_engine::WorkflowStep>,
    app_state: State<'_, AppState>,
) -> Result<crate::core::workflow_engine::WorkflowResult, WeaveError> {
    info!("Executing workflow chain with {} steps", steps.len());
    app_state.workflow_engine.execute_chain(steps).await
}
