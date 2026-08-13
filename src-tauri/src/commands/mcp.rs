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
    /// True while the server has challenged 401 but no token has been
    /// obtained yet — the UI surfaces an "Authorize" affordance.
    pub auth_required: bool,
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
            auth_required: cfg.auth_required && cfg.access_token.is_none(),
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
/// (docs/phase8-mcp-spec.md Part 2 §5).
///
/// Servers that challenge 401 are NOT rejected: they register in an
/// unauthenticated state (`auth_required`, no tools) with their
/// authorization-server metadata discovered via RFC 8414, and the
/// Marketplace UI drives `mcp_oauth_authorize` to complete the flow.
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
    // A 401 challenge (WeaveError::AuthRequired) is not a protocol failure —
    // it's the signal that OAuth is required, handled below.
    let mut auth_required: Option<crate::utils::errors::AuthChallenge> = match mcp_client::discover(&url, None).await {
        Ok(_) => None,
        Err(WeaveError::AuthRequired(challenge)) => Some(challenge),
        Err(e) => return Err(e),
    };
    let listed = match mcp_client::list_tools(&url, None).await {
        Ok(l) => l,
        Err(WeaveError::AuthRequired(challenge)) => {
            auth_required.get_or_insert(challenge);
            mcp_client::ToolsListResult {
                tools: Vec::new(),
                ttl_ms: None,
            }
        }
        Err(e) => return Err(e),
    };

    let (issuer, authorization_endpoint, token_endpoint, oauth_scopes) = match &auth_required {
        Some(challenge) => {
            // RFC 9728: a resource_metadata URL is a metadata *document*,
            // not the AS base — resolve it before RFC 8414 discovery.
            let resolved =
                mcp_client::resolve_authorization_server(challenge).await?;
            let mut md = mcp_client::discover_authorization_server(&resolved.base_url).await?;
            if md.scopes_supported.is_empty() {
                md.scopes_supported = resolved.scopes_supported;
            }
            info!(
                "MCP server {} requires OAuth; discovered authorization server {:?}",
                display_name, md.issuer
            );
            (
                md.issuer,
                md.authorization_endpoint,
                md.token_endpoint,
                md.scopes_supported,
            )
        }
        None => (None, None, None, Vec::new()),
    };

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
                auth_required: auth_required.is_some(),
                issuer,
                authorization_endpoint,
                token_endpoint,
                oauth_scopes,
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

/// Outcome of the authorization round trip, for the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OauthResult {
    pub server_id: String,
    pub authorized: bool,
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex_digit(bytes[i + 1]), hex_digit(bytes[i + 2])) {
                out.push((h << 4) | l);
                i += 3;
                continue;
            }
        }
        if bytes[i] == b'+' {
            out.push(b' ');
        } else {
            out.push(bytes[i]);
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn hex_digit(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// Reads one HTTP request from the loopback redirect listener and extracts
/// the `code`/`state` query parameters, responding with a closing HTML page.
async fn read_redirect_request(
    stream: &mut tokio::net::TcpStream,
) -> Result<(String, String), WeaveError> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let mut buf = Vec::new();
    let mut byte = [0u8; 1];
    let mut header_end = None;
    while header_end.is_none() {
        stream
            .read_exact(&mut byte)
            .await
            .map_err(|e| WeaveError::PluginError(format!("OAuth redirect read failed: {}", e)))?;
        buf.push(byte[0]);
        if buf.len() >= 4 && &buf[buf.len() - 4..] == b"\r\n\r\n" {
            header_end = Some(buf.len());
        }
    }
    let text = String::from_utf8_lossy(&buf).to_string();
    let request_line = text.lines().next().unwrap_or("");
    let path = request_line.split_whitespace().nth(1).unwrap_or("");
    let query = path.split('?').nth(1).unwrap_or("");
    let mut code = String::new();
    let mut state = String::new();
    for pair in query.split('&') {
        let mut it = pair.splitn(2, '=');
        let key = it.next().unwrap_or("");
        let value = percent_decode(it.next().unwrap_or(""));
        match key {
            "code" => code = value,
            "state" => state = value,
            _ => {}
        }
    }

    let body = "<html><body><p>Weave authorization complete — you can close this window.</p></body></html>";
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.flush().await;

    if code.is_empty() || state.is_empty() {
        return Err(WeaveError::PluginError(
            "OAuth redirect arrived without code/state".to_string(),
        ));
    }
    Ok((code, state))
}

/// Runs the OAuth 2.1 (CIMD client identity + PKCE) authorization flow for
/// a server, end to end: binds the loopback redirect listener, opens the
/// authorization URL in the system browser, waits for the redirect (120s),
/// exchanges the code for tokens at the token endpoint, persists them, and
/// re-registers the server's tools with the access token.
///
/// Blocker-aware: binds the listener BEFORE opening the browser so the
/// redirect cannot arrive early, and `state` round-trip is verified against
/// CSRF.
#[tauri::command]
pub async fn mcp_oauth_authorize(
    server_id: String,
    app: tauri::AppHandle,
    app_state: State<'_, AppState>,
) -> Result<OauthResult, WeaveError> {
    use tauri_plugin_shell::ShellExt;

    let cfg = app_state
        .config
        .read()
        .mcp_servers
        .get(&server_id)
        .cloned()
        .ok_or_else(|| WeaveError::PluginError(format!("MCP server '{}' not found", server_id)))?;

    if cfg.access_token.is_some() {
        return Ok(OauthResult {
            server_id,
            authorized: true,
        });
    }
    if cfg.authorization_endpoint.is_none() || cfg.token_endpoint.is_none() {
        return Err(WeaveError::PluginError(format!(
            "server '{}' has no discovered authorization endpoints — remove and re-add it",
            cfg.name
        )));
    }
    // Older config entries were created before protected-resource scopes
    // were persisted. Re-probe once so an already-added server (including
    // the current GitHub entry) does not fall back to the invented `mcp`
    // scope after the app is upgraded.
    let mut oauth_scopes = cfg.oauth_scopes.clone();
    if oauth_scopes.is_empty() {
        if let Err(WeaveError::AuthRequired(challenge)) =
            mcp_client::discover(&cfg.url, None).await
        {
            oauth_scopes = mcp_client::resolve_authorization_server(&challenge)
                .await?
                .scopes_supported;
        }
    }
    let md = mcp_client::AuthorizationServerMetadata {
        issuer: cfg.issuer.clone(),
        authorization_endpoint: cfg.authorization_endpoint.clone(),
        token_endpoint: cfg.token_endpoint.clone(),
        scopes_supported: oauth_scopes.clone(),
    };

    let pkce = mcp_client::new_pkce();
    let state = uuid::Uuid::new_v4().simple().to_string();
    // Bind the listener on the redirect URI's own port BEFORE opening the
    // browser so the redirect cannot arrive early. Port comes from the
    // (possibly overridden) redirect URI, not a hardcoded constant.
    let redirect = mcp_client::oauth_redirect_uri();
    let redirect_url = reqwest::Url::parse(&redirect)
        .map_err(|e| WeaveError::PluginError(format!("invalid OAuth redirect URI {}: {}", redirect, e)))?;
    let bind_host = redirect_url
        .host_str()
        .unwrap_or("127.0.0.1")
        .to_string();
    let bind_port = redirect_url
        .port()
        .ok_or_else(|| {
            WeaveError::PluginError(format!(
                "OAuth redirect URI {} must include a loopback port",
                redirect
            ))
        })?;
    let bind_addr = format!("{}:{}", bind_host, bind_port);
    let listener = tokio::net::TcpListener::bind(&bind_addr)
        .await
        .map_err(|e| {
            WeaveError::PluginError(format!(
                "cannot bind OAuth redirect listener on {}: {}",
                bind_addr, e
            ))
        })?;
    let authorization_url = mcp_client::authorization_url(&md, &state, &pkce)?;

    info!(
        "Opening OAuth authorization page for {} (client_id={}): {}",
        cfg.name,
        mcp_client::oauth_client_id(&md)?,
        authorization_url
    );
    app.shell().open(&authorization_url, None).map_err(|e| {
        WeaveError::PluginError(format!("cannot open browser for OAuth: {}", e))
    })?;

    let (code, state_back) = tokio::time::timeout(
        std::time::Duration::from_secs(120),
        async {
            let (mut stream, _peer) = listener
                .accept()
                .await
                .map_err(|e| WeaveError::PluginError(format!("OAuth redirect accept failed: {}", e)))?;
            read_redirect_request(&mut stream).await
        },
    )
    .await
    .map_err(|_| {
        WeaveError::PluginError(format!(
            "OAuth authorization timed out after 120s — no redirect received. If the browser showed an error, the release may lack its built-in OAuth client credentials: {}",
            authorization_url
        ))
    })??;

    if state_back != state {
        return Err(WeaveError::PluginError(
            "OAuth state mismatch — the redirect did not come from our authorization request".to_string(),
        ));
    }

    let tokens = mcp_client::exchange_code(&md, &code, &pkce).await?;
    info!("OAuth tokens received for {}", cfg.name);

    {
        let mut config = app_state.config.write();
        if let Some(server) = config.mcp_servers.get_mut(&server_id) {
            server.oauth_scopes = oauth_scopes.clone();
            server.access_token = Some(tokens.access_token.clone());
            server.refresh_token = tokens.refresh_token.clone();
            server.token_expires_at = tokens
                .expires_in
                .map(|secs| chrono::Utc::now().timestamp() + secs as i64);
            server.auth_required = false;
        }
        config.save()?;
    }

    // Tools could not be listed without a token; re-list and re-register
    // them now that the executor carries one.
    let listed = mcp_client::list_tools(&cfg.url, Some(&tokens.access_token)).await?;
    app_state
        .plugin_manager
        .mcp_tool_cache()
        .store(&server_id, listed.clone());
    app_state.plugin_manager.add_mcp_server(
        &server_id,
        &cfg.name,
        &cfg.url,
        Some(tokens.access_token),
        listed.tools,
    );

    Ok(OauthResult {
        server_id,
        authorized: true,
    })
}

/// Refreshes a server's access token via its stored refresh token and
/// re-registers the executor with the fresh token. Fails cleanly when the
/// server has no refresh token (then re-authorize instead).
#[tauri::command]
pub async fn mcp_oauth_refresh(
    server_id: String,
    app_state: State<'_, AppState>,
) -> Result<OauthResult, WeaveError> {
    let cfg = app_state
        .config
        .read()
        .mcp_servers
        .get(&server_id)
        .cloned()
        .ok_or_else(|| WeaveError::PluginError(format!("MCP server '{}' not found", server_id)))?;

    let refresh_token = cfg.refresh_token.clone().ok_or_else(|| {
        WeaveError::PluginError(format!(
            "server '{}' has no refresh token — authorize it again",
            cfg.name
        ))
    })?;
    let md = mcp_client::AuthorizationServerMetadata {
        issuer: cfg.issuer.clone(),
        authorization_endpoint: cfg.authorization_endpoint.clone(),
        token_endpoint: cfg.token_endpoint.clone(),
        scopes_supported: cfg.oauth_scopes.clone(),
    };

    let tokens = mcp_client::refresh_access_token(&md, &refresh_token).await?;
    info!("Refreshed OAuth token for {}", cfg.name);

    {
        let mut config = app_state.config.write();
        if let Some(server) = config.mcp_servers.get_mut(&server_id) {
            server.access_token = Some(tokens.access_token.clone());
            server.refresh_token = tokens.refresh_token.clone();
            server.token_expires_at = tokens
                .expires_in
                .map(|secs| chrono::Utc::now().timestamp() + secs as i64);
        }
        config.save()?;
    }

    app_state.plugin_manager.add_mcp_server(
        &server_id,
        &cfg.name,
        &cfg.url,
        Some(tokens.access_token),
        app_state
            .plugin_manager
            .mcp_tool_cache()
            .get_fresh(&server_id)
            .unwrap_or_default(),
    );

    Ok(OauthResult {
        server_id,
        authorized: true,
    })
}
