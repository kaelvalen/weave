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
