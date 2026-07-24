use tauri::State;
use tracing::{debug, info};

use crate::AppState;
use crate::github_plugin::{GithubPluginClient, GithubRepo};
use crate::models::plugin::Plugin;
use crate::utils::errors::WeaveError;
use runtime_kernel::runtime_event::{RuntimeEvent, RuntimeEventKind};

#[tauri::command]
pub async fn plugin_discover(app_state: State<'_, AppState>) -> Result<Vec<Plugin>, WeaveError> {
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
        info!(
            "Installed plugin directory from {} to {:?}",
            source_path, dest
        );
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

/// List public repositories for a GitHub organization.
#[tauri::command]
pub async fn plugin_list_github_repos(
    org: String,
    _app_state: State<'_, AppState>,
) -> Result<Vec<GithubRepo>, WeaveError> {
    info!("Listing GitHub plugins for organization: {}", org);
    // Validate org name to avoid injection / unexpected API calls.
    if org.is_empty()
        || !org
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        return Err(WeaveError::PluginError(
            "Invalid GitHub organization name".to_string(),
        ));
    }
    let client = GithubPluginClient::new();
    let repos = client.list_org_repos(&org).await?;
    Ok(repos)
}

/// Install a plugin by cloning a GitHub repository into the plugin directory.
#[tauri::command]
pub async fn plugin_install_from_github_repo(
    repo_url: String,
    app_state: State<'_, AppState>,
) -> Result<Vec<Plugin>, WeaveError> {
    info!("Installing plugin from GitHub repo: {}", repo_url);
    let client = GithubPluginClient::new();
    client
        .install_from_repo(&app_state.plugin_manager, &repo_url)
        .await
}

/// Install a plugin by downloading a `.wpk` asset from a GitHub release.
#[tauri::command]
pub async fn plugin_install_from_github_release(
    repo_url: String,
    tag: Option<String>,
    asset_name: Option<String>,
    app_state: State<'_, AppState>,
) -> Result<Vec<Plugin>, WeaveError> {
    info!(
        "Installing plugin from GitHub release: {} (tag: {:?}, asset: {:?})",
        repo_url, tag, asset_name
    );
    let client = GithubPluginClient::new();
    client
        .install_from_release(
            &app_state.plugin_manager,
            &repo_url,
            tag.as_deref(),
            asset_name.as_deref(),
        )
        .await
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
    trace_id: Option<String>,
    app_state: State<'_, AppState>,
) -> Result<serde_json::Value, WeaveError> {
    debug!(
        "Executing: {}::{} with params: {:?}",
        plugin_id, capability, params
    );
    let ctx = app_state.create_execution_context("ipc_session");

    // Candidate artifact reference, detectable from params alone.
    let artifact_ref = params
        .get("path")
        .or_else(|| params.get("title"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let step_id = uuid::Uuid::new_v4().to_string();
    let mut start_event = RuntimeEvent::new(
        RuntimeEventKind::StepStarted,
        step_id.clone(),
        format!("Executing {}::{}", plugin_id, capability),
    );
    start_event.goal_id = trace_id.clone();
    start_event.plugin_id = Some(plugin_id.clone());
    start_event.capability = Some(capability.clone());
    app_state.event_bus.publish_runtime(start_event);

    let start = std::time::Instant::now();
    let result = app_state
        .plugin_manager
        .execute_capability(&plugin_id, &capability, params, &ctx);
    let latency_ms = start.elapsed().as_millis() as u64;

    app_state
        .observability
        .record_tool_execution(&capability, latency_ms, result.is_ok());

    let mut end_event = RuntimeEvent::new(
        if result.is_ok() {
            RuntimeEventKind::StepSucceeded
        } else {
            RuntimeEventKind::StepFailed
        },
        step_id.clone(),
        match &result {
            Ok(_) => format!("Executed {}::{}", plugin_id, capability),
            Err(e) => format!("Failed {}::{}: {}", plugin_id, capability, e),
        },
    );
    end_event.goal_id = trace_id.clone();
    end_event.plugin_id = Some(plugin_id.clone());
    end_event.capability = Some(capability.clone());
    end_event.latency_ms = Some(latency_ms);
    app_state.event_bus.publish_runtime(end_event);

    // Secondary signals, only where trivially detectable at this layer.
    if result.is_ok() {
        const ARTIFACT_CAPABILITIES: &[&str] = &[
            "note.create",
            "file.write",
            "coder.write_file",
            "coder.apply_diff",
            "coder.apply_patch",
        ];
        if ARTIFACT_CAPABILITIES.contains(&capability.as_str()) {
            if let Some(ref artifact_ref) = artifact_ref {
                let mut event = RuntimeEvent::new(
                    RuntimeEventKind::ArtifactProduced,
                    step_id.clone(),
                    format!("Produced artifact {}", artifact_ref),
                );
                event.goal_id = trace_id.clone();
                event.plugin_id = Some(plugin_id.clone());
                event.capability = Some(capability.clone());
                event.artifact_ref = Some(artifact_ref.clone());
                app_state.event_bus.publish_runtime(event);
            }
        }

        const MEMORY_CAPABILITIES: &[&str] =
            &["memory.store", "memory.delete", "memory.update_profile"];
        if plugin_id == "com.weave.builtin.memory"
            && MEMORY_CAPABILITIES.contains(&capability.as_str())
        {
            let mut event = RuntimeEvent::new(
                RuntimeEventKind::MemoryUpdated,
                step_id,
                format!("Memory updated via {}", capability),
            );
            event.goal_id = trace_id;
            event.plugin_id = Some(plugin_id);
            event.capability = Some(capability);
            app_state.event_bus.publish_runtime(event);
        }
    }

    result
}

#[tauri::command]
pub fn plugin_get_all(app_state: State<'_, AppState>) -> Result<Vec<Plugin>, WeaveError> {
    Ok(app_state.plugin_manager.get_all())
}

#[tauri::command]
pub fn plugin_get_loaded(app_state: State<'_, AppState>) -> Result<Vec<Plugin>, WeaveError> {
    Ok(app_state.plugin_manager.get_loaded())
}

#[tauri::command]
pub fn plugin_get_by_id(
    plugin_id: String,
    app_state: State<'_, AppState>,
) -> Result<Option<Plugin>, WeaveError> {
    Ok(app_state.plugin_manager.get_plugin(&plugin_id))
}
