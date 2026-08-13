//! Phase 8.3/8.5 end-to-end round trip: an MCP (2026-07-28) server as the
//! tool source instead of a builtin plugin, through the exact same spine
//! `agent_loop_test.rs` proves for builtins — mock AI provider → agent loop
//! → approval gate → plugin execution → paired tool result.
//!
//! The mock MCP server runs on its OWN dedicated OS thread with its own
//! tokio runtime, deliberately NOT `tokio::spawn`ed onto the test's ambient
//! `#[tokio::test]` runtime. This matters and isn't cosmetic: a real MCP
//! server is a separate process, independent of Weave's own async runtime.
//! `McpExecutor::execute` (docs/phase8-mcp-spec.md Part 1 Q1) runs the
//! `web_plugin.rs`/`http_plugin.rs` thread+`block_on` pattern, which
//! synchronously blocks the calling tokio worker thread for the call's
//! duration — if the mock server were a task on that SAME runtime instead
//! of a genuinely independent thread, blocking that runtime would prevent
//! the mock server's own accept loop from ever being polled (verified by
//! hitting exactly this failure while drafting this test, then fixing the
//! test's fidelity rather than the code under test — a real, external MCP
//! server has no such dependency on Weave's runtime, so this has no
//! production analogue).

mod common;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

use common::{
    assert_completion_rule, saw_approval, tool_call_script, ApprovalDecision, Harness,
    PluginManager, RoundTrip,
};
use weave::mcp_client;

async fn read_json_request(stream: &mut TcpStream) -> std::io::Result<serde_json::Value> {
    let mut buf = Vec::new();
    let mut byte = [0u8; 1];
    let mut header_end = None;
    while header_end.is_none() {
        stream.read_exact(&mut byte).await?;
        buf.push(byte[0]);
        if buf.len() >= 4 && &buf[buf.len() - 4..] == b"\r\n\r\n" {
            header_end = Some(buf.len());
        }
    }
    let headers = String::from_utf8_lossy(&buf).to_string();
    let content_length = headers
        .lines()
        .find_map(|l| {
            let lower = l.to_lowercase();
            lower
                .strip_prefix("content-length:")
                .map(|v| v.trim().parse::<usize>().unwrap_or(0))
        })
        .unwrap_or(0);
    let mut body = vec![0u8; content_length];
    if content_length > 0 {
        stream.read_exact(&mut body).await?;
    }
    Ok(serde_json::from_slice(&body).unwrap_or(serde_json::Value::Null))
}

/// Spawns a mock MCP (2026-07-28) server on its own OS thread + runtime.
/// Scripts one JSON-RPC "result" per method name; a weather-forecast tool
/// with a real JSON Schema is served for `tools/list`.
fn spawn_mock_mcp_server() -> (String, Arc<AtomicUsize>) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let addr = listener.local_addr().unwrap();
    let request_count = Arc::new(AtomicUsize::new(0));
    let count = request_count.clone();

    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async move {
            let listener = tokio::net::TcpListener::from_std(listener).unwrap();
            loop {
                let (mut stream, _) = match listener.accept().await {
                    Ok(pair) => pair,
                    Err(_) => break,
                };
                let count = count.clone();
                tokio::spawn(async move {
                    let request = match read_json_request(&mut stream).await {
                        Ok(r) => r,
                        Err(_) => return,
                    };
                    count.fetch_add(1, Ordering::SeqCst);
                    let method = request.get("method").and_then(|v| v.as_str()).unwrap_or("");
                    let id = request.get("id").cloned().unwrap_or(serde_json::json!("0"));

                    let result = match method {
                        "server/discover" => serde_json::json!({
                            "resultType": "complete",
                            "name": "weather-mock",
                            "protocolVersions": ["2026-07-28"]
                        }),
                        "tools/list" => serde_json::json!({
                            "resultType": "complete",
                            "tools": [{
                                "name": "get_forecast",
                                "description": "Get a weather forecast for a city",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {"city": {"type": "string"}},
                                    "required": ["city"]
                                }
                            }],
                            "ttlMs": 300000
                        }),
                        "tools/call" => serde_json::json!({
                            "resultType": "complete",
                            "isError": false,
                            "content": [{"type": "text", "text": "Sunny, 22C in Ankara"}]
                        }),
                        _ => serde_json::json!({"resultType": "complete"}),
                    };

                    let response_body = serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": result,
                    })
                    .to_string();
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        response_body.len(),
                        response_body
                    );
                    let _ = stream.write_all(response.as_bytes()).await;
                    let _ = stream.flush().await;
                });
            }
        });
    });

    (format!("http://{}/mcp", addr), request_count)
}

#[tokio::test]
async fn mcp_tool_call_round_trips_through_agent_loop() {
    let (mcp_url, request_count) = spawn_mock_mcp_server();

    // Real client calls against the mock server — discovery + tools/list,
    // exactly what commands/mcp.rs::mcp_add_server does.
    let info = mcp_client::discover(&mcp_url, None).await.unwrap();
    assert_eq!(info.name, "weather-mock");
    let listed = mcp_client::list_tools(&mcp_url, None).await.unwrap();
    assert_eq!(listed.tools.len(), 1);

    let capability = mcp_client::capability_id("weather", "get_forecast");
    assert_eq!(capability, "mcp.weather.get_forecast");

    let harness = Harness::new(tool_call_script(
        &capability,
        r#"{"city":"Ankara"}"#,
        "Done.",
    ))
    .await;

    // Register the MCP server into the same registry create_builtin_plugins()
    // populates (docs/phase8-mcp-spec.md Part 2 §1) — no allowlist entry, so
    // the default-sensitive rule (§2) must gate this call.
    let plugin = harness.loop_.plugin_manager.add_mcp_server(
        "weather",
        "Weather",
        &mcp_url,
        None,
        listed.tools,
    );
    assert_eq!(plugin.id, "com.weave.mcp.weather");

    let (final_text, events) = harness.run_loop(ApprovalDecision::Approved).await;

    // 1. MCP-sourced capability with no allowlist entry gates by default.
    assert!(
        saw_approval(&events, &capability),
        "MCP-sourced capability with no allowlist entry must require approval"
    );

    // 2. The first request advertised the MCP tool's real JSON Schema
    //    (Part 1 Q3: schema passthrough, no transformation).
    let bodies = harness.bodies();
    let safe_name = PluginManager::provider_tool_name(&capability);
    assert!(
        bodies[0].contains(&format!("\"name\":\"{}\"", safe_name)),
        "tools must advertise the MCP capability with a provider-safe name"
    );
    assert!(bodies[0].contains("\"city\""), "the real MCP inputSchema must reach the provider request");

    // 3. The approved call actually executed against the mock MCP server
    //    (single-round-trip tools/call, Part 2 §1) and the result is paired.
    let rt = RoundTrip {
        final_text: final_text.clone(),
        events,
        bodies,
    };
    let second = &rt.bodies[1];
    assert!(second.contains("Sunny, 22C in Ankara"), "tool result must carry the MCP server's content, got: {}", second);
    assert_completion_rule(second);

    // 4. Loop continued to the final turn.
    assert!(final_text.contains("Done."));

    // 5. The mock MCP server actually received discover + tools/list +
    //    tools/call — three real round trips, not a stub returning early.
    assert_eq!(request_count.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn mcp_tool_call_rejected_still_pairs_result() {
    // Sanity check on the rejection path with an MCP-sourced capability:
    // even gated + user-rejected, the completion rule (every call_id gets a
    // paired result) must still hold — mirrors
    // agent_loop_test.rs::rejected_sensitive_call_still_pairs_result but
    // for an MCP-sourced capability instead of a builtin one.
    let (mcp_url, _count) = spawn_mock_mcp_server();
    mcp_client::discover(&mcp_url, None).await.unwrap();
    let listed = mcp_client::list_tools(&mcp_url, None).await.unwrap();
    let capability = mcp_client::capability_id("weather", "get_forecast");

    let harness = Harness::new(tool_call_script(&capability, r#"{"city":"Ankara"}"#, "Done.")).await;
    harness
        .loop_
        .plugin_manager
        .add_mcp_server("weather", "Weather", &mcp_url, None, listed.tools);

    let (_final_text, events) = harness.run_loop(ApprovalDecision::Rejected).await;
    assert!(saw_approval(&events, &capability));

    let bodies = harness.bodies();
    let second = &bodies[1];
    assert!(
        second.contains("User denied this action."),
        "rejected MCP call must still get a paired denial result, got: {}",
        second
    );
    assert_completion_rule(second);
}


/// Phase 8.4 — live-server round trip. Proves the client talks to a real
/// 2026-07-28 MCP server over real HTTP with no mock in the path:
/// `server/discover` → `tools/list` → `tools/call`, all through
/// `weave::mcp_client`. Target: GitHub's official public MCP endpoint
/// (api.githubcopilot.com/mcp, "GitHub MCP Server").
///
/// `#[ignore]`d so offline/CI runs stay hermetic. Run with:
///
/// ```sh
/// GITHUB_TOKEN=$(gh auth token) cargo test --test mcp_integration_test \
///   -- --ignored --nocapture
/// ```
///
/// The 2026-08-13 run's transcript (discover server identity, tool count,
/// `get_me` result) is recorded in `docs/probes/mcp-live-github-2026-08-13/`.
#[tokio::test]
#[ignore = "requires network egress + GITHUB_TOKEN"]
async fn live_round_trip_against_github_mcp_server() {
    let token = std::env::var("GITHUB_TOKEN")
        .or_else(|_| std::env::var("GH_TOKEN"))
        .expect("GITHUB_TOKEN or GH_TOKEN must be set for the live MCP test");
    let base = "https://api.githubcopilot.com/mcp/";

    let info = mcp_client::discover(base, Some(&token))
        .await
        .expect("server/discover against a live 2026-07-28 server");
    println!("discover: server={:?} protocol_versions={:?}", info.name, info.protocol_versions);
    assert_eq!(info.name, "github-mcp-server", "expected GitHub MCP identity from _meta.serverInfo");

    let listed = mcp_client::list_tools(base, Some(&token))
        .await
        .expect("tools/list against a live 2026-07-28 server");
    println!("tools/list: {} tools advertised", listed.tools.len());
    assert!(listed.tools.len() > 10, "expected a real tool surface, got {}", listed.tools.len());

    let get_me = listed
        .tools
        .iter()
        .find(|t| t.name == "get_me")
        .expect("github-mcp-server advertises get_me");
    println!("get_me schema: {}", serde_json::to_string(&get_me.input_schema).unwrap());

    let result = mcp_client::call_tool(
        base,
        "get_me",
        serde_json::json!({}),
        Some(&get_me.input_schema),
        Some(&token),
    )
        .await
        .expect("tools/call against a live 2026-07-28 server");
    let text = serde_json::to_string(&result).unwrap();
    println!("tools/call get_me -> {}", &text.chars().take(400).collect::<String>());
    assert!(result.is_array(), "get_me result should be a content array, got: {}", &text.chars().take(200).collect::<String>());
    let content = result.as_array().unwrap();
    assert!(
        content.iter().any(|c| c.get("text").is_some()),
        "get_me content should carry text blocks"
    );
}

/// Live OAuth challenge resolution (RFC 9728 + RFC 8414) against a real
/// public MCP server that 401s with `resource_metadata` — Puter MCP
/// (mcp.puter.com). Exercises the exact chain `mcp_add_server` uses:
/// 401 challenge → metadata fetch → authorization_servers[0] → RFC 8414
/// discovery. This is the regression guard for the double-`.well-known`
/// bug: naively treating the metadata URL as the AS base yields a 404,
/// this must yield real endpoints.
///
/// ```sh
/// cargo test --test mcp_integration_test -- --ignored --nocapture live_oauth
/// ```
#[tokio::test]
#[ignore = "requires network egress"]
async fn live_oauth_challenge_resolution_against_puter_mcp() {
    use weave::mcp_client;
    use weave::utils::errors::AuthChallenge;

    let base = "https://mcp.puter.com";
    let challenge = match mcp_client::discover(base, None).await {
        Err(weave::utils::errors::WeaveError::AuthRequired(c)) => c,
        other => panic!("expected AuthRequired from a live OAuth server, got: {:?}", other),
    };
    assert!(
        matches!(challenge, AuthChallenge::ResourceMetadata(_)),
        "Puter challenges with an RFC 9728 resource_metadata URL"
    );
    println!("challenge: {:?}", challenge);

    let as_base = mcp_client::resolve_authorization_server(&challenge)
        .await
        .expect("RFC 9728 metadata must yield an authorization server");
    println!("resolved AS base: {}", as_base.base_url);
    assert!(
        as_base.base_url.contains("puter"),
        "authorization_servers[0] should name Puter's AS, got: {}",
        as_base.base_url
    );

    let md = mcp_client::discover_authorization_server(&as_base.base_url)
        .await
        .expect("RFC 8414 discovery on the resolved AS base");
    println!("discovered: {:?}", md);
    assert!(md.authorization_endpoint.is_some());
    assert!(md.token_endpoint.is_some());
    assert!(
        md.authorization_endpoint.as_deref().unwrap().ends_with("/authorize"),
        "expected an authorization endpoint, got {:?}",
        md.authorization_endpoint
    );
}

/// Live RFC 8414 §3 path-aware discovery against GitHub's real issuer
/// (`https://github.com/login/oauth`). GitHub serves ONLY the path-aware
/// form (`https://github.com/.well-known/oauth-authorization-server/
/// login/oauth`) and 404s the naive append form — the regression guard
/// for the path-insertion bug.
///
/// ```sh
/// cargo test --test mcp_integration_test -- --ignored --nocapture live_github_discovery
/// ```
#[tokio::test]
#[ignore = "requires network egress"]
async fn live_github_discovery_is_path_aware() {
    use weave::mcp_client;

    let [path_aware, append] = mcp_client::discovery_url_candidates("https://github.com/login/oauth");
    assert_eq!(
        path_aware,
        "https://github.com/.well-known/oauth-authorization-server/login/oauth"
    );

    let md = mcp_client::discover_authorization_server("https://github.com/login/oauth")
        .await
        .expect("RFC 8414 §3 path-aware discovery against GitHub");
    println!("github issuer: {:?}", md.issuer);
    assert_eq!(md.issuer.as_deref(), Some("https://github.com/login/oauth"));
    assert_eq!(
        md.authorization_endpoint.as_deref(),
        Some("https://github.com/login/oauth/authorize")
    );
    assert_eq!(
        md.token_endpoint.as_deref(),
        Some("https://github.com/login/oauth/access_token")
    );
    println!("append form 404s (expected): {}", append);
}
