//! Tauri commands for the "Add MCP Server" entry point
//! (docs/phase8-mcp-spec.md Part 1 Q5 / Part 2 §6: Plugin Marketplace,
//! not a new surface).

use serde::{Deserialize, Serialize};
use tauri::State;
use tracing::info;

use crate::mcp_client;
use crate::models::plugin::Plugin;
use crate::utils::config::McpServerConfig;
use crate::utils::errors::WeaveError;
use crate::AppState;

/// Frontend-facing view of a configured MCP server — deliberately omits
/// `access_token`/`refresh_token` so they never round-trip to the webview.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerSummary {
    pub id: String,
    pub name: String,
    pub url: String,
    pub enabled: bool,
    pub allowlisted_tools: Vec<String>,
    pub has_token: bool,
}

impl From<&McpServerConfig> for McpServerSummary {
    fn from(cfg: &McpServerConfig) -> Self {
        Self {
            id: cfg.id.clone(),
            name: cfg.name.clone(),
            url: cfg.url.clone(),
            enabled: cfg.enabled,
            allowlisted_tools: {
                let mut tools: Vec<String> = cfg.allowlisted_tools.iter().cloned().collect();
                tools.sort();
                tools
            },
            has_token: cfg.access_token.is_some(),
        }
    }
}

fn slugify(name: &str) -> String {
    let slug: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let trimmed = slug.trim_matches('-');
    if trimmed.is_empty() {
        "server".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Discover a server's protocol support and tool list, register it into
/// the plugin registry, and persist it to `~/.weave/config.json`
/// (docs/phase8-mcp-spec.md Part 2 §5). No auth token is sent — servers
/// that require OAuth are a documented follow-up (Part 1 Q4 named the CIMD
/// flow as new infrastructure, not something this command implements).
#[tauri::command]
pub async fn mcp_add_server(
    url: String,
    name: String,
    app_state: State<'_, AppState>,
) -> Result<Plugin, WeaveError> {
    if url.trim().is_empty() {
        return Err(WeaveError::PluginError("Server URL is required".to_string()));
    }
    let display_name = if name.trim().is_empty() {
        url.clone()
    } else {
        name.trim().to_string()
    };

    info!("Adding MCP server: {} ({})", display_name, url);

    // Version-scope enforcement point (Part 2 §4): reject anything that
    // doesn't declare 2026-07-28 support before touching the registry.
    mcp_client::discover(&url, None).await?;
    let listed = mcp_client::list_tools(&url, None).await?;

    let base_id = slugify(&display_name);
    let server_id = {
        let existing = app_state.config.read().mcp_servers.contains_key(&base_id);
        if existing {
            format!("{}-{}", base_id, uuid::Uuid::new_v4().simple())
        } else {
            base_id
        }
    };

    app_state
        .plugin_manager
        .mcp_tool_cache()
        .store(&server_id, mcp_client::ToolsListResult {
            tools: listed.tools.clone(),
            ttl_ms: listed.ttl_ms,
        });

    let plugin = app_state.plugin_manager.add_mcp_server(
        &server_id,
        &display_name,
        &url,
        None,
        listed.tools,
    );

    {
        let mut config = app_state.config.write();
        config.mcp_servers.insert(
            server_id.clone(),
            McpServerConfig {
                id: server_id.clone(),
                name: display_name,
                url,
                enabled: true,
                ..Default::default()
            },
        );
        config.save()?;
    }

    Ok(plugin)
}

#[tauri::command]
pub fn mcp_remove_server(
    server_id: String,
    app_state: State<'_, AppState>,
) -> Result<(), WeaveError> {
    app_state.plugin_manager.remove_mcp_server(&server_id)?;
    let mut config = app_state.config.write();
    config.mcp_servers.remove(&server_id);
    config.save()?;
    Ok(())
}

#[tauri::command]
pub fn mcp_list_servers(app_state: State<'_, AppState>) -> Result<Vec<McpServerSummary>, WeaveError> {
    let config = app_state.config.read();
    let mut servers: Vec<McpServerSummary> = config.mcp_servers.values().map(McpServerSummary::from).collect();
    servers.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(servers)
}

/// Add or remove a single capability id from a server's approval allowlist
/// (docs/phase8-mcp-spec.md Part 2 §2 — the only way an MCP-sourced call
/// stops being gated).
#[tauri::command]
pub fn mcp_set_tool_allowlisted(
    server_id: String,
    capability: String,
    allowlisted: bool,
    app_state: State<'_, AppState>,
) -> Result<(), WeaveError> {
    let mut config = app_state.config.write();
    let server = config
        .mcp_servers
        .get_mut(&server_id)
        .ok_or_else(|| WeaveError::ConfigError(format!("Unknown MCP server: {}", server_id)))?;
    if allowlisted {
        server.allowlisted_tools.insert(capability);
    } else {
        server.allowlisted_tools.remove(&capability);
    }
    config.save()
}
