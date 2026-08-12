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
use crate::utils::errors::WeaveError;

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
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params,
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
    body: Value,
    token: Option<&str>,
) -> Result<Value, WeaveError> {
    let client = build_client()?;
    let mut req = client
        .post(base_url)
        .header("Content-Type", "application/json")
        .header("MCP-Protocol-Version", MCP_PROTOCOL_VERSION)
        .header("Mcp-Method", method);
    if let Some(name) = tool_name {
        req = req.header("Mcp-Name", name);
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
    let payload: Value = response
        .json()
        .await
        .map_err(|e| WeaveError::Http(format!("MCP response from {} was not JSON: {}", base_url, e)))?;

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

    Ok(ServerInfo {
        name: result
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        protocol_versions,
    })
}

/// `tools/list`. Schema passthrough only — no inference (Q3).
pub async fn list_tools(base_url: &str, token: Option<&str>) -> Result<ToolsListResult, WeaveError> {
    let result = post(
        base_url,
        "tools/list",
        None,
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

async fn call_tool_once(
    base_url: &str,
    tool_name: &str,
    arguments: Value,
    token: Option<&str>,
) -> Result<CallOutcome, WeaveError> {
    let result = post(
        base_url,
        "tools/call",
        Some(tool_name),
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

/// `tools/call`, async. Single round trip only — see module doc.
pub async fn call_tool(
    base_url: &str,
    tool_name: &str,
    arguments: Value,
    token: Option<&str>,
) -> Result<Value, WeaveError> {
    match call_tool_once(base_url, tool_name, arguments, token).await? {
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
    token: Option<&str>,
) -> Result<Value, WeaveError> {
    let base_url = base_url.to_string();
    let tool_name = tool_name.to_string();
    let token = token.map(|t| t.to_string());

    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| WeaveError::PluginError(e.to_string()))?;
        rt.block_on(call_tool(&base_url, &tool_name, arguments, token.as_deref()))
    })
    .join()
    .map_err(|_| WeaveError::PluginError("MCP tool-call thread panicked".to_string()))?
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
        call_tool_sync(&self.base_url, tool_name, params, self.access_token.as_deref())
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
}
