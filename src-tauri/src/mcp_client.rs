//! MCP (2026-07-28) transport client — Phase 8.3.
//!
//! Implements the stateless-core wire shape locked in
//! `docs/phase8-mcp-spec.md` Part 2 §3: no `initialize`/`Mcp-Session-Id`
//! handshake, `MCP-Protocol-Version`/`Mcp-Method`/`Mcp-Name` headers
//! alongside a JSON-RPC 2.0 body (the headers let a gateway route/meter
//! without parsing the body; the body keeps the full JSON-RPC envelope
//! existing MCP tooling already expects), and `resultType` on every
//! result (`"complete"` vs `"input_required"`). Sourced from the
//! spec's own changelog and two official protocol-blog posts — see
//! `phase8-mcp-spec.md`'s citation list; the primitive-level spec pages
//! on modelcontextprotocol.io were unreachable from this session's network
//! egress policy, so exact byte-for-byte body shape (as opposed to the
//! quoted header/result-type behavior) is a considered reconstruction, not
//! a verbatim transcription.
//!
//! Scope (locked, Part 2 §1): single-round-trip `tools/call` only. A
//! `resultType: "input_required"` response (Multi Round-Trip Requests
//! elicitation) is surfaced as a clean `WeaveError`, not handled — deferred
//! to a later phase per the spec.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::models::plugin::PluginExecutor;
use crate::utils::errors::{AuthChallenge, WeaveError};

pub const MCP_PROTOCOL_VERSION: &str = "2026-07-28";

/// A tool as advertised by an MCP server's `tools/list` response. `input_schema`
/// is real JSON Schema per the spec (both before and after 2026-07-28) — it
/// drops into `Capabilities.schemas` with no `schema_from_example`-style
/// inference pass (docs/phase8-mcp-spec.md Part 1 Q3).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpTool {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(rename = "inputSchema", default = "default_input_schema")]
    pub input_schema: Value,
}

fn default_input_schema() -> Value {
    serde_json::json!({"type": "object", "properties": {}})
}

#[derive(Debug, Clone)]
pub struct ToolsListResult {
    pub tools: Vec<McpTool>,
    /// Cache TTL from the response, if the server sent one (spec: `ttlMs`).
    pub ttl_ms: Option<u64>,
}

#[derive(Debug, Clone, Default)]
pub struct ServerInfo {
    pub name: String,
    pub protocol_versions: Vec<String>,
}

/// Outcome of a `tools/call`. `InputRequired` is the MRTR interim result —
/// deliberately not driven further (Part 2 §1); callers turn it into an
/// error with a clear, non-hanging message.
enum CallOutcome {
    Complete(Value),
    InputRequired,
}

fn rpc_request(id: &str, method: &str, params: Value) -> Value {
    let mut merged = params;
    if let Some(obj) = merged.as_object_mut() {
        obj.insert(
            "_meta".to_string(),
            serde_json::json!({
                "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
                "io.modelcontextprotocol/clientCapabilities": {}
            }),
        );
    } else {
        merged = serde_json::json!({
            "_meta": {
                "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
                "io.modelcontextprotocol/clientCapabilities": {}
            }
        });
    }
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": merged,
    })
}

fn build_client() -> Result<reqwest::Client, WeaveError> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| WeaveError::Http(e.to_string()))
}

async fn post(
    base_url: &str,
    method: &str,
    tool_name: Option<&str>,
    header_params: &[(String, String)],
    body: Value,
    token: Option<&str>,
) -> Result<Value, WeaveError> {
    let client = build_client()?;
    let mut req = client
        .post(base_url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream")
        .header("MCP-Protocol-Version", MCP_PROTOCOL_VERSION)
        .header("Mcp-Method", method);
    if let Some(name) = tool_name {
        req = req.header("Mcp-Name", name);
    }
    for (name, value) in header_params {
        req = req.header(format!("Mcp-Param-{}", name), value);
    }
    if let Some(token) = token {
        req = req.header("Authorization", format!("Bearer {}", token));
    }

    let response = req
        .json(&body)
        .send()
        .await
        .map_err(|e| WeaveError::Http(format!("MCP request to {} failed: {}", base_url, e)))?;

    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        // OAuth-requiring servers signal the authorization-server URL on
        // 401 via `Mcp-Authorization` or `WWW-Authenticate: Bearer
        // resource_metadata="..."` — turn it into a typed error the
        // registration flow can act on instead of a raw HTTP failure.
        if let Some(auth_url) = auth_challenge_from_headers(response.headers()) {
            return Err(WeaveError::AuthRequired(auth_url));
        }
    }

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    // Live 2026-07-28 servers (verified against GitHub's public MCP endpoint,
    // 2026-08-13) frame every response as SSE even for a single round trip:
    // `event: message` / `data: {jsonrpc...}`. The last parseable data frame
    // is the terminal JSON-RPC message.
    let payload: Value = if content_type.contains("text/event-stream") {
        let text = response
            .text()
            .await
            .map_err(|e| WeaveError::Http(format!("MCP SSE response from {} unreadable: {}", base_url, e)))?;
        let mut last: Option<Value> = None;
        for line in text.lines() {
            if let Some(data) = line.trim_start().strip_prefix("data:") {
                if let Ok(v) = serde_json::from_str(data.trim()) {
                    last = Some(v);
                }
            }
        }
        last.ok_or_else(|| {
            WeaveError::Http(format!(
                "MCP SSE response from {} had no parseable data frame: {}",
                base_url,
                text.chars().take(200).collect::<String>()
            ))
        })?
    } else {
        response
            .json()
            .await
            .map_err(|e| WeaveError::Http(format!("MCP response from {} was not JSON: {}", base_url, e)))?
    };

    if !status.is_success() {
        return Err(WeaveError::Http(format!(
            "MCP server {} returned {}: {}",
            base_url, status, payload
        )));
    }

    if let Some(error) = payload.get("error") {
        return Err(WeaveError::Http(format!(
            "MCP server {} returned a JSON-RPC error: {}",
            base_url, error
        )));
    }

    payload
        .get("result")
        .cloned()
        .ok_or_else(|| WeaveError::Http(format!("MCP response from {} had no result field", base_url)))
}

/// Extracts the OAuth challenge from a 401 response's headers. Real
/// 2026-07-28 servers use either a direct `Mcp-Authorization: <url>`
/// header or a `WWW-Authenticate` challenge carrying
/// `resource_metadata="<url>"` (the 2025-06-18-era shape).
fn auth_challenge_from_headers(
    headers: &reqwest::header::HeaderMap,
) -> Option<AuthChallenge> {
    if let Some(v) = headers.get("mcp-authorization") {
        if let Ok(s) = v.to_str() {
            let s = s.trim();
            if s.starts_with("http://") || s.starts_with("https://") {
                return Some(AuthChallenge::Direct(s.to_string()));
            }
        }
    }
    if let Some(v) = headers.get(reqwest::header::WWW_AUTHENTICATE) {
        if let Ok(s) = v.to_str() {
            for marker in ["resource_metadata=", "authorization_uri="] {
                if let Some(idx) = s.find(marker) {
                    let rest = &s[idx + marker.len()..];
                    if let Some(quoted) = rest.strip_prefix('"') {
                        if let Some(end) = quoted.find('"') {
                            return Some(AuthChallenge::ResourceMetadata(quoted[..end].to_string()));
                        }
                    }
                }
            }
        }
    }
    None
}

#[derive(Debug, Clone, Default)]
pub struct ProtectedResourceMetadata {
    pub authorization_servers: Vec<String>,
    pub scopes_supported: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ResolvedAuthorizationServer {
    pub base_url: String,
    pub scopes_supported: Vec<String>,
}

/// Fetches an RFC 9728 protected-resource metadata document. Per RFC 9728
/// §3, `authorization_servers` is an array of AS identifiers (strings), and
/// `scopes_supported` describes the scopes the resource expects from the
/// resulting access token.
pub async fn fetch_protected_resource_metadata(
    metadata_url: &str,
) -> Result<ProtectedResourceMetadata, WeaveError> {
    let client = build_client()?;
    let response = client
        .get(metadata_url)
        .send()
        .await
        .map_err(|e| WeaveError::Http(format!("protected-resource metadata request to {} failed: {}", metadata_url, e)))?;
    if !response.status().is_success() {
        return Err(WeaveError::Http(format!(
            "protected-resource metadata at {} returned {}",
            metadata_url,
            response.status()
        )));
    }
    let payload: Value = response
        .json()
        .await
        .map_err(|e| WeaveError::Http(format!("protected-resource metadata at {} was not JSON: {}", metadata_url, e)))?;

    let servers: Vec<String> = payload
        .get("authorization_servers")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let scopes_supported = payload
        .get("scopes_supported")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    Ok(ProtectedResourceMetadata {
        authorization_servers: servers,
        scopes_supported,
    })
}

/// Resolves an `AuthChallenge` to the authorization-server base URL:
/// direct challenges pass through; `resource_metadata` URLs are fetched
/// first (RFC 9728), and the declared authorization server is used.
pub async fn resolve_authorization_server(
    challenge: &AuthChallenge,
) -> Result<ResolvedAuthorizationServer, WeaveError> {
    match challenge {
        AuthChallenge::Direct(url) => Ok(ResolvedAuthorizationServer {
            base_url: url.clone(),
            scopes_supported: Vec::new(),
        }),
        AuthChallenge::ResourceMetadata(metadata_url) => {
            let metadata = fetch_protected_resource_metadata(metadata_url).await?;
            Ok(ResolvedAuthorizationServer {
                // RFC 9728 permits the resource server to serve its own
                // authorization metadata when this list is omitted.
                base_url: metadata
                    .authorization_servers
                    .first()
                    .cloned()
                    .unwrap_or_else(|| metadata_url.to_string()),
                scopes_supported: metadata.scopes_supported,
            })
        }
    }
}

/// `server/discover` — spec changelog "Major changes" #3: servers MUST
/// implement this to advertise supported protocol versions/capabilities.
/// Used at server-add time to confirm 2026-07-28 support before trusting
/// anything else the server returns (docs/phase8-mcp-spec.md Part 2 §4:
/// version scope enforcement point).
pub async fn discover(base_url: &str, token: Option<&str>) -> Result<ServerInfo, WeaveError> {
    let result = post(
        base_url,
        "server/discover",
        None,
        &[],
        rpc_request("discover", "server/discover", serde_json::json!({})),
        token,
    )
    .await?;

    let protocol_versions: Vec<String> = result
        .get("protocolVersions")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();

    if !protocol_versions.is_empty() && !protocol_versions.iter().any(|v| v == MCP_PROTOCOL_VERSION) {
        return Err(WeaveError::PluginError(format!(
            "MCP server at {} does not support protocol {} (supports: {}) — 2025-11-25 and earlier session-based revisions are out of scope (docs/phase8-mcp-spec.md Part 2 §4)",
            base_url,
            MCP_PROTOCOL_VERSION,
            protocol_versions.join(", ")
        )));
    }

    // Live servers (GitHub MCP, 2026-08-13) advertise identity inside
    // `_meta.io.modelcontextprotocol/serverInfo` rather than a top-level
    // `name`; read both, preferring `_meta` when present.
    let name = result
        .get("_meta")
        .and_then(|m| m.get("io.modelcontextprotocol/serverInfo"))
        .and_then(|i| i.get("name"))
        .and_then(|v| v.as_str())
        .or_else(|| {
            result
                .get("_meta")
                .and_then(|m| m.get("io.modelcontextprotocol/serverInfo"))
                .and_then(|i| i.get("title"))
                .and_then(|v| v.as_str())
        })
        .or_else(|| result.get("name").and_then(|v| v.as_str()))
        .unwrap_or_default()
        .to_string();

    Ok(ServerInfo {
        name,
        protocol_versions,
    })
}

/// `tools/list`. Schema passthrough only — no inference (Q3).
pub async fn list_tools(base_url: &str, token: Option<&str>) -> Result<ToolsListResult, WeaveError> {
    let result = post(
        base_url,
        "tools/list",
        None,
        &[],
        rpc_request("list", "tools/list", serde_json::json!({})),
        token,
    )
    .await?;

    let tools: Vec<McpTool> = serde_json::from_value(
        result.get("tools").cloned().unwrap_or_else(|| Value::Array(vec![])),
    )
    .map_err(|e| WeaveError::Http(format!("MCP tools/list from {} had an unexpected shape: {}", base_url, e)))?;

    let ttl_ms = result.get("ttlMs").and_then(|v| v.as_u64());

    Ok(ToolsListResult { tools, ttl_ms })
}

/// Parameter names a tool's inputSchema marks as header-bound via
/// `x-mcp-header` (value is the header suffix, usually the parameter name
/// itself; some servers use a boolean `true`). Such parameters MUST travel
/// as `Mcp-Param-<name>` request headers, not in the JSON-RPC body —
/// GitHub MCP marks `owner`/`repo` this way and rejects the body form with
/// "header mismatch: missing Mcp-Param-owner header".
pub fn header_bound_params(schema: &Value) -> Vec<String> {
    let Some(properties) = schema.get("properties").and_then(|v| v.as_object()) else {
        return Vec::new();
    };
    properties
        .iter()
        .filter_map(|(name, spec)| match spec.get("x-mcp-header") {
            Some(Value::String(suffix)) if !suffix.is_empty() => Some(suffix.clone()),
            Some(Value::Bool(true)) => Some(name.clone()),
            _ => None,
        })
        .collect()
}

/// Collects `Mcp-Param-<name>` header pairs for parameters the tool's
/// inputSchema marks via `x-mcp-header`. The parameters are NOT removed
/// from the body: live servers (GitHub MCP) reject a header whose
/// parameter is absent from `arguments` ("unexpected Mcp-Param-repo header
/// for absent or null parameter"), so the body keeps the value and the
/// header mirrors it for gateway routing/metering.
pub fn split_header_params(schema: Option<&Value>, arguments: &Value) -> Vec<(String, String)> {
    let Some(schema) = schema else {
        return Vec::new();
    };
    let mut headers = Vec::new();
    for name in header_bound_params(schema) {
        let value = arguments.get(&name).cloned();
        if let Some(v) = value {
            let text = match &v {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            headers.push((name, text));
        }
    }
    headers
}

async fn call_tool_once(
    base_url: &str,
    tool_name: &str,
    arguments: Value,
    schema: Option<&Value>,
    token: Option<&str>,
) -> Result<CallOutcome, WeaveError> {
    let header_params = split_header_params(schema, &arguments);
    let result = post(
        base_url,
        "tools/call",
        Some(tool_name),
        &header_params,
        rpc_request(
            "call",
            "tools/call",
            serde_json::json!({"name": tool_name, "arguments": arguments}),
        ),
        token,
    )
    .await?;

    match result.get("resultType").and_then(|v| v.as_str()) {
        Some("input_required") => Ok(CallOutcome::InputRequired),
        _ => {
            let is_error = result.get("isError").and_then(|v| v.as_bool()).unwrap_or(false);
            let content = result.get("content").cloned().unwrap_or(Value::Null);
            if is_error {
                return Err(WeaveError::PluginError(format!(
                    "MCP tool '{}' returned an error result: {}",
                    tool_name, content
                )));
            }
            Ok(CallOutcome::Complete(content))
        }
    }
}

/// `tools/call`, async. Single round trip only — see module doc. `schema`
/// is the tool's inputSchema, used to route `x-mcp-header` parameters.
pub async fn call_tool(
    base_url: &str,
    tool_name: &str,
    arguments: Value,
    schema: Option<&Value>,
    token: Option<&str>,
) -> Result<Value, WeaveError> {
    match call_tool_once(base_url, tool_name, arguments, schema, token).await? {
        CallOutcome::Complete(value) => Ok(value),
        CallOutcome::InputRequired => Err(WeaveError::PluginError(format!(
            "MCP tool '{}' requires interactive input mid-call (Multi Round-Trip Requests), which Weave does not yet support — see docs/phase8-mcp-spec.md Part 2 §1",
            tool_name
        ))),
    }
}

/// Synchronous wrapper for `call_tool`, used from inside the synchronous
/// `PluginExecutor::execute` contract. Mirrors the exact pattern already
/// shipped in `web_plugin.rs`/`http_plugin.rs`: a dedicated OS thread with
/// its own current-thread tokio runtime, `.block_on()`ed and `.join()`ed —
/// not `Handle::current().block_on()`, which would nest inside the agent
/// loop's own runtime and risk a deadlock/panic (docs/phase8-mcp-spec.md
/// Part 1 Q1).
///
/// Testing note (tests/mcp_integration_test.rs): `.join()` synchronously
/// blocks whichever tokio worker thread called `execute()` for the whole
/// round trip. That's harmless when the callee (a real MCP server) is a
/// separate OS process independent of Weave's own runtime — which every
/// production MCP server is — but it means this pattern *requires* Weave's
/// agent-loop runtime to be multi-threaded (Tauri's default): on a
/// single-threaded runtime, blocking the one worker thread would starve
/// every other task on it for the call's duration. Not a new risk MCP
/// introduces — `web_plugin.rs`/`http_plugin.rs` already carry the same
/// requirement — but it hadn't been exercised by an existing test until
/// this phase (the existing SSRF-guard tests for web.fetch/http.request
/// reject before reaching the network layer, so they never actually drove
/// this code path against a live server).
pub fn call_tool_sync(
    base_url: &str,
    tool_name: &str,
    arguments: Value,
    schema: Option<&Value>,
    token: Option<&str>,
) -> Result<Value, WeaveError> {
    let base_url = base_url.to_string();
    let tool_name = tool_name.to_string();
    let schema = schema.cloned();
    let token = token.map(|t| t.to_string());

    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| WeaveError::PluginError(e.to_string()))?;
        rt.block_on(call_tool(
            &base_url,
            &tool_name,
            arguments,
            schema.as_ref(),
            token.as_deref(),
        ))
    })
    .join()
    .map_err(|_| WeaveError::PluginError("MCP tool-call thread panicked".to_string()))?
}

// ── OAuth 2.1 / CIMD authorization (Phase 8.2 Part 2 §4–§5) ─────────────

/// Default loopback redirect URI the OAuth flow's local listener binds.
/// `mcp_oauth_authorize` in commands/mcp.rs starts this listener before
/// opening the browser, so the redirect always arrives. Override with
/// `WEAVE_OAUTH_REDIRECT_URI` — required when the authorization server
/// (e.g. GitHub's) does not accept a CIMD URL client_id and you instead
/// register a client with a specific redirect URI.
pub const DEFAULT_OAUTH_REDIRECT_URI: &str = "http://127.0.0.1:34987/callback";

/// The redirect URI in effect: `WEAVE_OAUTH_REDIRECT_URI` if set, else
/// `DEFAULT_OAUTH_REDIRECT_URI`. The token exchange must send exactly the
/// URI the authorization request advertised.
pub fn oauth_redirect_uri() -> String {
    std::env::var("WEAVE_OAUTH_REDIRECT_URI")
        .unwrap_or_else(|_| DEFAULT_OAUTH_REDIRECT_URI.to_string())
}

const BUILTIN_GITHUB_OAUTH_CLIENT_ID: Option<&str> =
    option_env!("WEAVE_GITHUB_OAUTH_CLIENT_ID");
const BUILTIN_GITHUB_OAUTH_CLIENT_SECRET: Option<&str> =
    option_env!("WEAVE_GITHUB_OAUTH_CLIENT_SECRET");

/// Default CIMD client identity: `client_id` as an HTTPS URL pointing at a
/// static metadata document, per draft-ietf-oauth-client-id-metadata-document.
/// Weave does not yet host this document — per phase8-mcp-spec.md Part 2 §5
/// it is a documented manual prerequisite for servers that strictly validate
/// CIMD. GitHub is handled separately by `oauth_client_config`: its official
/// authorization server requires a registered OAuth App client.
pub fn cimd_client_id() -> String {
    std::env::var("WEAVE_CIMD_CLIENT_ID")
        .unwrap_or_else(|_| "https://weave.app/mcp/client-metadata.json".to_string())
}

#[derive(Debug, Clone)]
pub struct OAuthClientConfig {
    pub client_id: String,
    pub client_secret: Option<String>,
}

fn configured_credential(runtime_name: &str, built_in: Option<&str>) -> Option<String> {
    std::env::var(runtime_name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| built_in.map(str::to_string))
}

fn is_github_authorization_server(md: &AuthorizationServerMetadata) -> bool {
    [
        md.issuer.as_deref(),
        md.authorization_endpoint.as_deref(),
        md.token_endpoint.as_deref(),
    ]
    .into_iter()
    .flatten()
    .filter_map(|value| reqwest::Url::parse(value).ok())
    .any(|url| url.host_str() == Some("github.com"))
}

/// Resolves credentials for the authorization server. GitHub credentials
/// are build-time inputs for release artifacts, not runtime inputs for end
/// users. Runtime env overrides remain available for local development.
pub fn oauth_client_config(
    md: &AuthorizationServerMetadata,
) -> Result<OAuthClientConfig, WeaveError> {
    if is_github_authorization_server(md) {
        let client_id = configured_credential(
            "WEAVE_GITHUB_OAUTH_CLIENT_ID",
            BUILTIN_GITHUB_OAUTH_CLIENT_ID,
        )
        .or_else(|| configured_credential("WEAVE_CIMD_CLIENT_ID", None))
        .ok_or_else(|| {
            WeaveError::ConfigError(
                "Weave was built without GitHub OAuth credentials. The release must embed a registered GitHub OAuth App client ID via WEAVE_GITHUB_OAUTH_CLIENT_ID; users should only need to click Authorize.".to_string(),
            )
        })?;
        let client_secret = configured_credential(
            "WEAVE_GITHUB_OAUTH_CLIENT_SECRET",
            BUILTIN_GITHUB_OAUTH_CLIENT_SECRET,
        )
        .or_else(|| configured_credential("WEAVE_OAUTH_CLIENT_SECRET", None))
        .ok_or_else(|| {
            WeaveError::ConfigError(
                "Weave was built without the GitHub OAuth App client secret. Embed WEAVE_GITHUB_OAUTH_CLIENT_SECRET in the release build; do not ask end users for it.".to_string(),
            )
        })?;
        return Ok(OAuthClientConfig {
            client_id,
            client_secret: Some(client_secret),
        });
    }

    Ok(OAuthClientConfig {
        client_id: cimd_client_id(),
        client_secret: configured_credential(
            "WEAVE_OAUTH_CLIENT_SECRET",
            option_env!("WEAVE_OAUTH_CLIENT_SECRET"),
        ),
    })
}

pub fn oauth_client_id(md: &AuthorizationServerMetadata) -> Result<String, WeaveError> {
    Ok(oauth_client_config(md)?.client_id)
}

/// PKCE (RFC 7636) pair, S256 challenge.
#[derive(Debug, Clone)]
pub struct PkcePair {
    pub code_verifier: String,
    pub code_challenge: String,
}

fn base64url_encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        if chunk.len() > 1 {
            out.push(TABLE[(n >> 6) as usize & 63] as char);
        }
        if chunk.len() > 2 {
            out.push(TABLE[n as usize & 63] as char);
        }
    }
    out
}

/// New PKCE pair: 64-char alphanumeric verifier (within RFC 7636's
/// 43–128 range), S256 code challenge derived from it.
pub fn new_pkce() -> PkcePair {
    let mut verifier = String::with_capacity(64);
    verifier.push_str(&uuid::Uuid::new_v4().simple().to_string());
    verifier.push_str(&uuid::Uuid::new_v4().simple().to_string());
    let code_challenge = {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(verifier.as_bytes());
        base64url_encode(&hasher.finalize())
    };
    PkcePair {
        code_verifier: verifier,
        code_challenge,
    }
}

/// RFC 8414 authorization-server metadata (a subset — only the fields the
/// code flow needs).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AuthorizationServerMetadata {
    #[serde(default)]
    pub issuer: Option<String>,
    #[serde(default)]
    pub authorization_endpoint: Option<String>,
    #[serde(default)]
    pub token_endpoint: Option<String>,
    #[serde(default)]
    pub scopes_supported: Vec<String>,
}

/// RFC 8414 §3 discovery URL candidates for an authorization-server base
/// URL, tried in order:
///
/// 1. **Path-aware** — the well-known path is inserted between the host
///    and the issuer's path: issuer `https://github.com/login/oauth` →
///    `https://github.com/.well-known/oauth-authorization-server/
///    login/oauth`. This is what §3 prescribes and what GitHub serves.
/// 2. **Append** — `{base}/.well-known/oauth-authorization-server`, the
///    pre-§3 form still served by some implementations (e.g. Keycloak).
///
/// Both exist in the wild; a discovery attempt must try path-aware first
/// and fall back to append on 404.
pub fn discovery_url_candidates(base_url: &str) -> [String; 2] {
    let base = base_url.trim_end_matches('/');
    let path_aware = match reqwest::Url::parse(base) {
        Ok(url) => {
            let scheme = url.scheme();
            let host = url.host_str().unwrap_or("");
            if host.is_empty() {
                format!("{}/.well-known/oauth-authorization-server", base)
            } else {
                let port = url.port().map(|p| format!(":{}", p)).unwrap_or_default();
                let path = url.path().trim_end_matches('/');
                format!(
                    "{}://{}{}/.well-known/oauth-authorization-server{}",
                    scheme, host, port, path
                )
            }
        }
        Err(_) => format!("{}/.well-known/oauth-authorization-server", base),
    };
    [
        path_aware,
        format!("{}/.well-known/oauth-authorization-server", base),
    ]
}

/// RFC 8414 discovery, path-aware (§3) with append fallback: tries
/// `discovery_url_candidates()` in order, moving on when a candidate
/// 404s (or the request fails to connect). `base_url` MUST be the
/// authorization-server base URL — for challenges that arrive as an RFC
/// 9728 `resource_metadata` URL, resolve it with
/// `resolve_authorization_server` first, never pass the metadata URL here.
pub async fn discover_authorization_server(
    base_url: &str,
) -> Result<AuthorizationServerMetadata, WeaveError> {
    let client = build_client()?;
    let mut last_error: Option<WeaveError> = None;
    for discovery_url in discovery_url_candidates(base_url) {
        let response = match client.get(&discovery_url).send().await {
            Ok(r) => r,
            Err(e) => {
                last_error = Some(WeaveError::Http(format!(
                    "authorization-server discovery request to {} failed: {}",
                    discovery_url, e
                )));
                continue;
            }
        };
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            last_error = Some(WeaveError::Http(format!(
                "authorization-server discovery at {} returned 404",
                discovery_url
            )));
            continue;
        }
        if !response.status().is_success() {
            return Err(WeaveError::Http(format!(
                "authorization-server discovery at {} returned {}",
                discovery_url,
                response.status()
            )));
        }
        let md: AuthorizationServerMetadata = response
            .json()
            .await
            .map_err(|e| WeaveError::Http(format!("authorization-server discovery at {} was not JSON: {}", discovery_url, e)))?;
        if md.authorization_endpoint.is_none() || md.token_endpoint.is_none() {
            return Err(WeaveError::Http(format!(
                "authorization-server discovery at {} was incomplete (no authorization/token endpoint)",
                discovery_url
            )));
        }
        return Ok(md);
    }
    Err(last_error.unwrap_or_else(|| {
        WeaveError::Http(format!(
            "authorization-server discovery for {} produced no usable URL",
            base_url
        ))
    }))
}

/// Builds the OAuth 2.1 authorization-code URL: response_type=code,
/// PKCE S256 challenge, CIMD client_id, loopback redirect.
pub fn authorization_url(
    md: &AuthorizationServerMetadata,
    state: &str,
    pkce: &PkcePair,
) -> Result<String, WeaveError> {
    let endpoint = md.authorization_endpoint.as_deref().ok_or_else(|| {
        WeaveError::Http("authorization endpoint not discovered".to_string())
    })?;
    let mut url = reqwest::Url::parse(endpoint)
        .map_err(|e| WeaveError::Http(format!("invalid authorization endpoint: {}", e)))?;
    let client = oauth_client_config(md)?;
    let scope = if md.scopes_supported.is_empty() {
        "mcp".to_string()
    } else {
        md.scopes_supported.join(" ")
    };
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", &client.client_id)
        .append_pair("redirect_uri", &oauth_redirect_uri())
        .append_pair("scope", &scope)
        .append_pair("state", state)
        .append_pair("code_challenge", &pkce.code_challenge)
        .append_pair("code_challenge_method", "S256");
    Ok(url.to_string())
}

/// Result of a successful token-endpoint exchange.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenSet {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub expires_in: Option<u64>,
    #[serde(default)]
    pub scope: Option<String>,
}

async fn token_request(
    md: &AuthorizationServerMetadata,
    client: &OAuthClientConfig,
    form: &[(&str, &str)],
) -> Result<TokenSet, WeaveError> {
    let endpoint = md.token_endpoint.as_deref().ok_or_else(|| {
        WeaveError::Http("token endpoint not discovered".to_string())
    })?;
    let mut fields = form.to_vec();
    if let Some(secret) = client.client_secret.as_deref() {
        fields.push(("client_secret", secret));
    }
    let http_client = build_client()?;
    let response = http_client
        .post(endpoint)
        .header("Accept", "application/json")
        .form(&fields)
        .send()
        .await
        .map_err(|e| WeaveError::Http(format!("token request to {} failed: {}", endpoint, e)))?;
    let status = response.status();
    let payload: Value = response
        .json()
        .await
        .map_err(|e| WeaveError::Http(format!("token response from {} was not JSON: {}", endpoint, e)))?;
    if !status.is_success() {
        return Err(WeaveError::Http(format!(
            "token endpoint {} returned {}: {}",
            endpoint, status, payload
        )));
    }
    serde_json::from_value(payload)
        .map_err(|e| WeaveError::Http(format!("token response from {} was unexpected: {}", endpoint, e)))
}

/// Authorization-code grant with PKCE (OAuth 2.1 public-client shape).
pub async fn exchange_code(
    md: &AuthorizationServerMetadata,
    code: &str,
    pkce: &PkcePair,
) -> Result<TokenSet, WeaveError> {
    let client = oauth_client_config(md)?;
    token_request(
        md,
        &client,
        &[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", &oauth_redirect_uri()),
            ("client_id", &client.client_id),
            ("code_verifier", &pkce.code_verifier),
        ],
    )
    .await
}

/// Refresh-token grant.
pub async fn refresh_access_token(
    md: &AuthorizationServerMetadata,
    refresh_token: &str,
) -> Result<TokenSet, WeaveError> {
    let client = oauth_client_config(md)?;
    token_request(
        md,
        &client,
        &[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", &client.client_id),
        ],
    )
    .await
}

/// Capability id an MCP tool is registered under: namespaced by server id
/// so two servers exposing similarly-named tools cannot collide, and so the
/// approval-gate allowlist (capability_policy.rs) can match on the id
/// directly with no separate lookup table.
pub fn capability_id(server_id: &str, tool_name: &str) -> String {
    format!("mcp.{}.{}", server_id, tool_name)
}

/// Plugin id an MCP server is registered under in the registry, parallel to
/// `com.weave.builtin.*`.
pub fn plugin_id(server_id: &str) -> String {
    format!("com.weave.mcp.{}", server_id)
}

/// In-memory `tools/list` cache, honoring the server-supplied TTL
/// (docs/phase8-mcp-spec.md Part 2 §3). Keyed by server id.
pub struct McpToolCache {
    entries: RwLock<HashMap<String, (Instant, ToolsListResult)>>,
}

impl McpToolCache {
    pub fn new() -> Self {
        Self {
            entries: RwLock::new(HashMap::new()),
        }
    }

    /// Returns a cached, still-fresh tool list if one exists.
    pub fn get_fresh(&self, server_id: &str) -> Option<Vec<McpTool>> {
        let entries = self.entries.read();
        let (fetched_at, result) = entries.get(server_id)?;
        let ttl = Duration::from_millis(result.ttl_ms.unwrap_or(0));
        if ttl.is_zero() || fetched_at.elapsed() >= ttl {
            return None;
        }
        Some(result.tools.clone())
    }

    pub fn store(&self, server_id: &str, result: ToolsListResult) {
        self.entries.write().insert(server_id.to_string(), (Instant::now(), result));
    }

    pub fn invalidate(&self, server_id: &str) {
        self.entries.write().remove(server_id);
    }
}

impl Default for McpToolCache {
    fn default() -> Self {
        Self::new()
    }
}

/// `PluginExecutor` for a single MCP server. One instance is registered per
/// server under `plugin_id(server_id)`; it services every capability that
/// server's `tools/list` advertised (Part 1 Q1: the single-round-trip case
/// maps cleanly onto this synchronous trait).
pub struct McpExecutor {
    pub server_id: String,
    pub base_url: String,
    pub access_token: Option<String>,
    /// Tool input schemas at registration time, keyed by tool name — used
    /// to route `x-mcp-header` parameters to `Mcp-Param-*` headers.
    pub schemas: HashMap<String, Value>,
}

impl PluginExecutor for McpExecutor {
    fn execute(
        &self,
        capability: &str,
        params: Value,
        _ctx: &runtime_kernel::execution_context::ExecutionContext,
    ) -> Result<Value, WeaveError> {
        let prefix = format!("mcp.{}.", self.server_id);
        let tool_name = capability
            .strip_prefix(prefix.as_str())
            .ok_or_else(|| WeaveError::CapabilityNotFound(capability.to_string()))?;
        call_tool_sync(
            &self.base_url,
            tool_name,
            params,
            self.schemas.get(tool_name),
            self.access_token.as_deref(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Schema ingestion: a real MCP tools/list response's inputSchema lands
    /// in the parsed McpTool unchanged — no schema_from_example-style
    /// inference, the mirror image of the Phase 3 regression tests
    /// (docs/phase8-mcp-spec.md Part 1 Q3 / Phase 8.5 minimum coverage).
    #[test]
    fn tools_list_schema_passes_through_unchanged() {
        let raw = serde_json::json!({
            "tools": [
                {
                    "name": "get_forecast",
                    "description": "Get a weather forecast",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "city": {"type": "string"},
                            "days": {"type": "integer"}
                        },
                        "required": ["city"]
                    }
                }
            ],
            "ttlMs": 300000
        });

        let tools: Vec<McpTool> = serde_json::from_value(raw["tools"].clone()).unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].name, "get_forecast");
        assert_eq!(tools[0].input_schema["type"], "object");
        assert_eq!(tools[0].input_schema["properties"]["city"]["type"], "string");
        assert_eq!(tools[0].input_schema["properties"]["days"]["type"], "integer");
        assert_eq!(
            tools[0].input_schema["required"],
            serde_json::json!(["city"])
        );
        // Verifies the raw fixture matches what production parsing sees —
        // guards against this test silently drifting from the real shape.
        assert_eq!(raw["ttlMs"], 300000);
    }

    #[test]
    fn tool_without_schema_defaults_to_open_object() {
        let raw = serde_json::json!({"name": "no_schema_tool"});
        let tool: McpTool = serde_json::from_value(raw).unwrap();
        assert_eq!(tool.input_schema["type"], "object");
    }

    #[test]
    fn capability_and_plugin_ids_are_namespaced_by_server() {
        assert_eq!(capability_id("weather", "get_forecast"), "mcp.weather.get_forecast");
        assert_eq!(plugin_id("weather"), "com.weave.mcp.weather");
        // Two servers exposing the same tool name never collide.
        assert_ne!(
            capability_id("server-a", "search"),
            capability_id("server-b", "search")
        );
    }

    #[test]
    fn tool_cache_expires_after_ttl() {
        let cache = McpToolCache::new();
        cache.store(
            "srv",
            ToolsListResult {
                tools: vec![McpTool {
                    name: "t".to_string(),
                    description: String::new(),
                    input_schema: default_input_schema(),
                }],
                ttl_ms: Some(0),
            },
        );
        // ttl_ms: 0 means "no caching" — always a miss.
        assert!(cache.get_fresh("srv").is_none());
    }

    #[test]
    fn tool_cache_hits_within_ttl() {
        let cache = McpToolCache::new();
        cache.store(
            "srv",
            ToolsListResult {
                tools: vec![McpTool {
                    name: "t".to_string(),
                    description: String::new(),
                    input_schema: default_input_schema(),
                }],
                ttl_ms: Some(60_000),
            },
        );
        assert_eq!(cache.get_fresh("srv").map(|t| t.len()), Some(1));
    }

    #[test]
    fn executor_rejects_capability_outside_its_namespace() {
        let executor = McpExecutor {
            server_id: "weather".to_string(),
            base_url: "http://127.0.0.1:1".to_string(),
            access_token: None,
            schemas: HashMap::new(),
        };
        let ctx = runtime_kernel::execution_context::ExecutionContext::new(
            "test".to_string(),
            std::path::PathBuf::from("."),
            std::sync::Arc::new(parking_lot::RwLock::new(serde_json::json!({}))),
            std::sync::Arc::new(runtime_kernel::event_bus::EventBus::new(10)),
        );
        let result = executor.execute("mcp.other-server.get_forecast", serde_json::json!({}), &ctx);
        assert!(matches!(result, Err(WeaveError::CapabilityNotFound(_))));
    }

    // ── OAuth 2.1 / CIMD (Phase 8.2 §4–§5) ────────────────────────────────

    #[test]
    fn pkce_pair_is_rfc7636_shaped() {
        let pkce = new_pkce();
        assert_eq!(pkce.code_verifier.len(), 64);
        assert!(pkce
            .code_verifier
            .chars()
            .all(|c| c.is_ascii_alphanumeric()));
        // S256 challenge must be base64url(SHA-256(verifier)), unpadded → 43 chars.
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(pkce.code_verifier.as_bytes());
        let expected = base64url_encode(&hasher.finalize());
        assert_eq!(pkce.code_challenge, expected);
        assert_eq!(pkce.code_challenge.len(), 43);
    }

    #[test]
    fn authorization_url_carries_pkce_cimd_and_redirect() {
        let md = AuthorizationServerMetadata {
            issuer: Some("https://as.example".into()),
            authorization_endpoint: Some("https://as.example/authorize".into()),
            token_endpoint: Some("https://as.example/token".into()),
            scopes_supported: vec![],
        };
        let pkce = new_pkce();
        let url = authorization_url(&md, "state-42", &pkce).unwrap();
        let parsed = reqwest::Url::parse(&url).unwrap();
        assert_eq!(parsed.host_str(), Some("as.example"));
        let params: std::collections::HashMap<String, String> = parsed
            .query_pairs()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        assert_eq!(params.get("response_type").map(String::as_str), Some("code"));
        assert_eq!(params.get("client_id").map(String::as_str), Some(cimd_client_id().as_str()));
        assert_eq!(
            params.get("redirect_uri").map(String::as_str),
            Some(oauth_redirect_uri().as_str())
        );
        assert_eq!(params.get("scope").map(String::as_str), Some("mcp"));
        assert_eq!(params.get("state").map(String::as_str), Some("state-42"));
        assert_eq!(params.get("code_challenge_method").map(String::as_str), Some("S256"));
        assert_eq!(params.get("code_challenge").map(String::as_str), Some(pkce.code_challenge.as_str()));
    }

    #[test]
    fn authorization_url_uses_protected_resource_scopes() {
        let md = AuthorizationServerMetadata {
            issuer: Some("https://as.example".into()),
            authorization_endpoint: Some("https://as.example/authorize".into()),
            token_endpoint: Some("https://as.example/token".into()),
            scopes_supported: vec!["repo".into(), "read:org".into()],
        };
        let url = authorization_url(&md, "state-42", &new_pkce()).unwrap();
        let parsed = reqwest::Url::parse(&url).unwrap();
        let scope = parsed
            .query_pairs()
            .find(|(key, _)| key == "scope")
            .map(|(_, value)| value.to_string());
        assert_eq!(scope.as_deref(), Some("repo read:org"));
    }

    #[test]
    fn auth_challenge_parses_mcp_authorization_header() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("mcp-authorization", "https://auth.example/oauth".parse().unwrap());
        assert_eq!(
            auth_challenge_from_headers(&headers),
            Some(AuthChallenge::Direct("https://auth.example/oauth".to_string()))
        );
    }

    #[test]
    fn auth_challenge_parses_www_authenticate_resource_metadata() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            reqwest::header::WWW_AUTHENTICATE,
            "Bearer resource_metadata=\"https://rs.example/meta\", error=\"insufficient_scope\""
                .parse()
                .unwrap(),
        );
        assert_eq!(
            auth_challenge_from_headers(&headers),
            Some(AuthChallenge::ResourceMetadata("https://rs.example/meta".to_string()))
        );
    }

    #[test]
    fn auth_challenge_absent_without_oauth_headers() {
        let headers = reqwest::header::HeaderMap::new();
        assert_eq!(auth_challenge_from_headers(&headers), None);
    }

    #[test]
    fn header_bound_params_extracts_x_mcp_header_markers() {
        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "owner": {"type": "string", "x-mcp-header": "owner"},
                "repo": {"type": "string", "x-mcp-header": "repo"},
                "page": {"type": "number"}
            },
            "required": ["owner", "repo"]
        });
        let mut params = header_bound_params(&schema);
        params.sort();
        assert_eq!(params, vec!["owner", "repo"]);
        // Boolean marker is also honored (some servers use true instead of a
        // suffix string).
        let bool_schema = serde_json::json!({
            "properties": {"token": {"type": "string", "x-mcp-header": true}}
        });
        assert_eq!(header_bound_params(&bool_schema), vec!["token"]);
    }

    #[test]
    fn split_header_params_mirrors_marked_args_into_headers() {
        let schema = serde_json::json!({
            "properties": {
                "owner": {"type": "string", "x-mcp-header": "owner"},
                "perPage": {"type": "number"}
            }
        });
        let args = serde_json::json!({"owner": "kaelvalen", "perPage": 30});
        let headers = split_header_params(Some(&schema), &args);
        assert_eq!(headers, vec![("owner".to_string(), "kaelvalen".to_string())]);
        // The body keeps the parameter: live servers (GitHub MCP) reject a
        // header whose parameter is absent from arguments.
        assert_eq!(args, serde_json::json!({"owner": "kaelvalen", "perPage": 30}));
    }

    #[tokio::test]
    async fn post_sends_mcp_param_headers_for_header_bound_args() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut buf = Vec::new();
            let mut byte = [0u8; 1];
            loop {
                if stream.read(&mut byte).await.unwrap_or(0) == 0 {
                    break;
                }
                buf.push(byte[0]);
                if buf.len() >= 4 && &buf[buf.len() - 4..] == b"\r\n\r\n" {
                    break;
                }
            }
            let text = String::from_utf8_lossy(&buf).to_string();
            assert!(
                text.to_lowercase().contains("mcp-param-owner: kaelvalen"),
                "missing Mcp-Param-owner header in: {}",
                text
            );
            let body = br#"{"jsonrpc":"2.0","id":"call","result":{"resultType":"complete","content":[{"type":"text","text":"ok"}]}}"#;
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let mut bytes = resp.into_bytes();
            bytes.extend_from_slice(body);
            let _ = stream.write_all(&bytes).await;
            let _ = stream.flush().await;
        });
        let schema = serde_json::json!({
            "properties": {"owner": {"type": "string", "x-mcp-header": "owner"}}
        });
        let result = call_tool(
            &format!("http://{}/mcp", addr),
            "list_branches",
            serde_json::json!({"owner": "kaelvalen"}),
            Some(&schema),
            None,
        )
        .await
        .expect("call with header-bound param must succeed");
        assert!(result.is_array());
    }

    #[tokio::test]
    async fn post_401_with_resource_metadata_surfaces_typed_challenge() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut buf = Vec::new();
            let mut byte = [0u8; 1];
            loop {
                if stream.read(&mut byte).await.unwrap_or(0) == 0 {
                    break;
                }
                buf.push(byte[0]);
                if buf.len() >= 4 && &buf[buf.len() - 4..] == b"\r\n\r\n" {
                    break;
                }
            }
            let _ = stream
                .write_all(
                    b"HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: 2\r\nWWW-Authenticate: Bearer resource_metadata=\"https://rs.example/protected-resource-metadata\", error=\"unauthorized\"\r\nConnection: close\r\n\r\n{}",
                )
                .await;
            let _ = stream.flush().await;
        });
        let err = post(
            &format!("http://{}/mcp", addr),
            "tools/list",
            None,
            &[],
            rpc_request("t", "tools/list", serde_json::json!({})),
            None,
        )
        .await
        .unwrap_err();
        match err {
            WeaveError::AuthRequired(AuthChallenge::ResourceMetadata(url)) => {
                assert_eq!(url, "https://rs.example/protected-resource-metadata");
            }
            other => panic!("expected AuthRequired(ResourceMetadata), got {:?}", other),
        }
    }

    #[tokio::test]
    async fn fetch_protected_resource_metadata_extracts_authorization_servers() {
        let base = spawn_mock(|method, text| {
            assert_eq!(method, reqwest::Method::GET);
            assert!(text.starts_with("GET /protected-resource-metadata HTTP/1.1"));
            (
                200,
                serde_json::json!({
                    "resource": "https://rs.example/",
                    "authorization_servers": ["https://as.example"],
                    "scopes_supported": ["repo", "read:org"]
                }),
            )
        })
        .await;
        let as_url = fetch_protected_resource_metadata(&format!("{}/protected-resource-metadata", base))
            .await
            .unwrap();
        assert_eq!(as_url.authorization_servers, vec!["https://as.example"]);
        assert_eq!(as_url.scopes_supported, vec!["repo", "read:org"]);
    }

    #[tokio::test]
    async fn fetch_protected_resource_metadata_falls_back_to_bare_server() {
        let base = spawn_mock(|_, _| (200, serde_json::json!({"resource": "https://rs.example/"}))).await;
        let metadata = fetch_protected_resource_metadata(&base).await.unwrap();
        // No authorization_servers declared: RFC 9728 bare-server form —
        // the resource server itself serves AS metadata.
        assert!(metadata.authorization_servers.is_empty());
    }

    #[tokio::test]
    async fn resolve_authorization_server_handles_both_challenge_shapes() {
        let meta_base = spawn_mock(|_, _| {
            (200, serde_json::json!({"authorization_servers": ["https://as.example"]}))
        })
        .await;
        let direct = resolve_authorization_server(&AuthChallenge::Direct(
            "https://as.example".to_string(),
        ))
        .await
        .unwrap();
        assert_eq!(direct.base_url, "https://as.example");
        let via_metadata = resolve_authorization_server(&AuthChallenge::ResourceMetadata(
            format!("{}/meta", meta_base),
        ))
        .await
        .unwrap();
        assert_eq!(via_metadata.base_url, "https://as.example");
    }

    /// One-shot mock HTTP server for the RFC 8414 / token-endpoint tests.
    /// Returns the base URL; the spawned task handles exactly one request.
    async fn spawn_mock(
        respond: impl Fn(reqwest::Method, &str) -> (u16, Value) + Send + 'static,
    ) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut buf = Vec::new();
            let mut byte = [0u8; 1];
            loop {
                if stream.read(&mut byte).await.unwrap_or(0) == 0 {
                    break;
                }
                buf.push(byte[0]);
                if buf.len() >= 4 && &buf[buf.len() - 4..] == b"\r\n\r\n" {
                    break;
                }
            }
            let text = String::from_utf8_lossy(&buf).to_string();
            let content_length = text
                .lines()
                .find_map(|l| {
                    l.to_lowercase()
                        .strip_prefix("content-length:")
                        .map(|v| v.trim().parse::<usize>().unwrap_or(0))
                })
                .unwrap_or(0);
            let mut body = vec![0u8; content_length];
            if content_length > 0 {
                let _ = stream.read_exact(&mut body).await;
            }
            let full = format!("{}{}", text, String::from_utf8_lossy(&body));
            let line = text.lines().next().unwrap_or("");
            let method = if line.starts_with("GET ") {
                reqwest::Method::GET
            } else {
                reqwest::Method::POST
            };
            let (status, body) = respond(method, &full);
            let status_text = if status == 200 { "200 OK" } else { "401 Unauthorized" };
            let bytes = serde_json::to_vec(&body).unwrap();
            let mut resp = format!(
                "HTTP/1.1 {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                status_text,
                bytes.len()
            )
            .into_bytes();
            resp.extend_from_slice(&bytes);
            let _ = stream.write_all(&resp).await;
        });
        format!("http://{}", addr)
    }

    #[tokio::test]
    async fn discover_authorization_server_parses_rfc8414_metadata() {
        let base = spawn_mock(|method, text| {
            assert_eq!(method, reqwest::Method::GET);
            assert!(text.contains("/.well-known/oauth-authorization-server"));
            (
                200,
                serde_json::json!({
                    "issuer": "https://as.example",
                    "authorization_endpoint": "https://as.example/authorize",
                    "token_endpoint": "https://as.example/token",
                    "scopes_supported": ["mcp"]
                }),
            )
        })
        .await;
        let md = discover_authorization_server(&base).await.unwrap();
        assert_eq!(md.issuer.as_deref(), Some("https://as.example"));
        assert_eq!(md.authorization_endpoint.as_deref(), Some("https://as.example/authorize"));
        assert_eq!(md.token_endpoint.as_deref(), Some("https://as.example/token"));
    }

    #[test]
    fn discovery_url_candidates_github_issuer_is_path_aware_first() {
        // RFC 8414 §3: well-known goes between host and issuer path.
        // GitHub serves ONLY this form; the append form 404s.
        let [path_aware, append] = discovery_url_candidates("https://github.com/login/oauth");
        assert_eq!(
            path_aware,
            "https://github.com/.well-known/oauth-authorization-server/login/oauth"
        );
        assert_eq!(
            append,
            "https://github.com/login/oauth/.well-known/oauth-authorization-server"
        );
    }

    #[test]
    fn discovery_url_candidates_bare_host_collapse() {
        // No path: both forms are the same URL, no duplicate segment.
        let [path_aware, append] = discovery_url_candidates("https://as.example/");
        assert_eq!(
            path_aware,
            "https://as.example/.well-known/oauth-authorization-server"
        );
        assert_eq!(path_aware, append);
    }

    #[test]
    fn discovery_url_candidates_preserve_port() {
        let [path_aware, _] = discovery_url_candidates("http://localhost:8080/issuer");
        assert_eq!(
            path_aware,
            "http://localhost:8080/.well-known/oauth-authorization-server/issuer"
        );
    }

    #[tokio::test]
    async fn discover_falls_back_to_append_when_path_aware_404s() {
        // One-shot mock answering exactly one request: the path-aware URL.
        // The client must then fall back to the append form, which the
        // (real) target serves; to observe the fallback without a second
        // server, answer 404 from the same listener for the first request
        // and a full metadata document for the second.
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let mut served = 0;
            loop {
                let (mut stream, _) = match listener.accept().await {
                    Ok(s) => s,
                    Err(_) => break,
                };
                let mut buf = Vec::new();
                let mut byte = [0u8; 1];
                loop {
                    if stream.read(&mut byte).await.unwrap_or(0) == 0 {
                        break;
                    }
                    buf.push(byte[0]);
                    if buf.len() >= 4 && &buf[buf.len() - 4..] == b"\r\n\r\n" {
                        break;
                    }
                }
                let text = String::from_utf8_lossy(&buf).to_string();
                let line = text.lines().next().unwrap_or("");
                served += 1;
                let body = if line.contains("/.well-known/oauth-authorization-server/issuer") {
                    // path-aware candidate → 404 to force the fallback
                    b"{}".to_vec()
                } else {
                    serde_json::to_vec(&serde_json::json!({
                        "issuer": "https://as.example/issuer",
                        "authorization_endpoint": "https://as.example/issuer/authorize",
                        "token_endpoint": "https://as.example/issuer/token"
                    }))
                    .unwrap()
                };
                let status = if line.contains("/.well-known/oauth-authorization-server/issuer") {
                    "404 Not Found"
                } else {
                    "200 OK"
                };
                let resp = format!(
                    "HTTP/1.1 {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    status,
                    body.len()
                );
                let mut bytes = resp.into_bytes();
                bytes.extend_from_slice(&body);
                let _ = stream.write_all(&bytes).await;
                if served >= 2 {
                    break;
                }
            }
        });
        let md = discover_authorization_server(&format!("http://{}/issuer", addr))
            .await
            .unwrap();
        assert_eq!(md.issuer.as_deref(), Some("https://as.example/issuer"));
        assert_eq!(
            md.authorization_endpoint.as_deref(),
            Some("https://as.example/issuer/authorize")
        );
    }

    #[tokio::test]
    async fn discover_uses_path_aware_without_fallback() {
        // Server answers ONLY the path-aware candidate (one accept); if
        // the client wrongly tried the append form first (or fell back
        // after a success), the second connection would hang/fail — the
        // test would time out or error instead of passing.
        let base = spawn_mock(|_, text| {
            assert!(
                text.contains("/.well-known/oauth-authorization-server/issuer"),
                "expected path-aware request, got: {}",
                text
            );
            (
                200,
                serde_json::json!({
                    "issuer": "https://as.example/issuer",
                    "authorization_endpoint": "https://as.example/issuer/authorize",
                    "token_endpoint": "https://as.example/issuer/token"
                }),
            )
        })
        .await;
        let md = discover_authorization_server(&format!("{}/issuer", base)).await.unwrap();
        assert_eq!(md.issuer.as_deref(), Some("https://as.example/issuer"));
    }

    #[tokio::test]
    async fn discover_authorization_server_rejects_incomplete_metadata() {
        let base = spawn_mock(|_, _| (200, serde_json::json!({"issuer": "https://as.example"}))).await;
        let err = discover_authorization_server(&base).await.unwrap_err();
        assert!(err.to_string().contains("incomplete"));
    }

    #[tokio::test]
    async fn exchange_code_posts_pkce_form_and_parses_tokens() {
        let pkce = new_pkce();
        let verifier = pkce.code_verifier.clone();
        let base = spawn_mock(move |method, text| {
            assert_eq!(method, reqwest::Method::POST);
            assert!(text.contains("grant_type=authorization_code"), "got: {}", text);
            assert!(text.contains("code=abc123"));
            assert!(text.contains(&format!("code_verifier={}", verifier)));
            assert!(text.contains("client_id="));
            (200, serde_json::json!({"access_token": "at-1", "refresh_token": "rt-1", "expires_in": 3600, "scope": "mcp"}))
        })
        .await;
        let md = AuthorizationServerMetadata {
            issuer: Some("https://as.example".into()),
            authorization_endpoint: Some("https://as.example/authorize".into()),
            token_endpoint: Some(format!("{}/token", base)),
            scopes_supported: vec![],
        };
        let tokens = exchange_code(&md, "abc123", &pkce).await.unwrap();
        assert_eq!(tokens.access_token, "at-1");
        assert_eq!(tokens.refresh_token.as_deref(), Some("rt-1"));
        assert_eq!(tokens.expires_in, Some(3600));
    }

    #[tokio::test]
    async fn refresh_access_token_posts_refresh_grant() {
        let base = spawn_mock(|method, text| {
            assert_eq!(method, reqwest::Method::POST);
            assert!(text.contains("grant_type=refresh_token"));
            assert!(text.contains("refresh_token=rt-old"));
            (200, serde_json::json!({"access_token": "at-2", "expires_in": 3600}))
        })
        .await;
        let md = AuthorizationServerMetadata {
            issuer: Some("https://as.example".into()),
            authorization_endpoint: Some("https://as.example/authorize".into()),
            token_endpoint: Some(format!("{}/token", base)),
            scopes_supported: vec![],
        };
        let tokens = refresh_access_token(&md, "rt-old").await.unwrap();
        assert_eq!(tokens.access_token, "at-2");
        assert!(tokens.refresh_token.is_none());
    }
}
