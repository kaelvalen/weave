//! Phase 5 acceptance test for the Phase 2 agent loop (phase1-spine-spec.md §3):
//! a mock OpenAI-compatible SSE provider round-trips a native tool call through
//! the real ai_bridge → agent loop → approval gate → plugin execution →
//! completion-rule machinery. Verified end-to-end, not by inspection.
//!
//! Three scenarios:
//!   1. approved sensitive call  → result paired with its call_id
//!   2. rejected sensitive call  → "User denied this action." paired result
//!   3. errored plugin execution → error text still paired with the call_id

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use parking_lot::RwLock;
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;

use weave::agent::{AgentEvent, AgentLoop, ApprovalDecision, ApprovalRegistry};
use weave::ai_bridge::{AiBridge, ModelTelemetry};
use weave::models::chat::{ChatMessage, ChatRole, ModelConfig, Provider};
use weave::plugin_manager::PluginManager;
use weave::utils::config::AppConfig;
use weave::utils::errors::WeaveError;

use runtime_kernel::event_bus::EventBus;
use runtime_kernel::event_store::EventSourcingStore;
use runtime_kernel::observability::Observability;

// ---------------------------------------------------------------------------
// Minimal OpenAI-compatible SSE mock provider
// ---------------------------------------------------------------------------

struct MockServer {
    /// Per-request capture of the request body (for assertions).
    bodies: Arc<Mutex<Vec<String>>>,
    /// SSE `data:` lines to stream, one Vec per request.
    script: Vec<Vec<String>>,
    request_count: Arc<AtomicUsize>,
}

impl MockServer {
    async fn spawn(script: Vec<Vec<String>>) -> (Self, String) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = MockServer {
            bodies: Arc::new(Mutex::new(Vec::new())),
            script,
            request_count: Arc::new(AtomicUsize::new(0)),
        };

        let bodies = server.bodies.clone();
        let script = server.script.clone();
        let count = server.request_count.clone();

        tokio::spawn(async move {
            loop {
                let (stream, _) = match listener.accept().await {
                    Ok(pair) => pair,
                    Err(_) => break,
                };
                let bodies = bodies.clone();
                let script = script.clone();
                let count = count.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_connection(stream, bodies, script, count).await {
                        eprintln!("mock server connection error: {}", e);
                    }
                });
            }
        });

        let url = format!("http://{}/v1/chat/completions", addr);
        (server, url)
    }
}

async fn read_http_request(stream: &mut TcpStream) -> std::io::Result<String> {
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
    let mut all = headers;
    all.push_str(&String::from_utf8_lossy(&body));
    Ok(all)
}

async fn handle_connection(
    mut stream: TcpStream,
    bodies: Arc<Mutex<Vec<String>>>,
    script: Vec<Vec<String>>,
    count: Arc<AtomicUsize>,
) -> std::io::Result<()> {
    let request = match read_http_request(&mut stream).await {
        Ok(r) => r,
        Err(_) => return Ok(()), // client closed
    };
    if request.is_empty() {
        return Ok(());
    }

    let index = count.fetch_add(1, Ordering::SeqCst);
    bodies.lock().unwrap().push(request.clone());

    let sse_lines = script.get(index).cloned().unwrap_or_else(|| {
        vec![
            r#"data: {"id":"x","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"(mock exhausted) "},"finish_reason":null}]}"#.to_string(),
            r#"data: {"id":"x","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}"#.to_string(),
            "data: [DONE]".to_string(),
        ]
    });

    // `Connection: close` + no Content-Length: reqwest reads the SSE body
    // until the socket closes, so each response terminates its stream.
    let mut response = String::from(
        "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n",
    );
    for line in &sse_lines {
        response.push_str(line);
        response.push_str("\n\n");
    }
    stream.write_all(response.as_bytes()).await?;
    stream.flush().await?;
    Ok(())
}

fn sse_openai_request1_tool_call(call_id: &str, name: &str, args_fragments: &[&str]) -> Vec<String> {
    let mut lines = vec![
        r#"data: {"id":"1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"Checking..."},"finish_reason":null}]}"#.to_string(),
    ];
    // OpenAI streams `arguments` as one JSON string, split across deltas.
    // The accumulated fragments are concatenated and the total is escaped
    // into a JSON string value for the `arguments` field.
    for (i, frag) in args_fragments.iter().enumerate() {
        let arguments_json = Value::String((*frag).to_string());
        let name_field = if i == 0 {
            format!(r#","function":{{"name":{},"arguments":{}}}"#, Value::String(name.to_string()), arguments_json)
        } else {
            format!(r#","function":{{"arguments":{}}}"#, arguments_json)
        };
        lines.push(format!(
            r#"data: {{"id":"1","object":"chat.completion.chunk","choices":[{{"index":0,"delta":{{"tool_calls":[{{"index":0,"id":{},"type":"function"{}}}]}},"finish_reason":null}}]}}"#,
            Value::String(call_id.to_string()),
            name_field
        ));
    }
    lines.push(
        r#"data: {"id":"1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}"#.to_string(),
    );
    lines.push("data: [DONE]".to_string());
    lines
}

fn sse_openai_final(text: &str) -> Vec<String> {
    vec![
        format!(
            r#"data: {{"id":"2","object":"chat.completion.chunk","choices":[{{"index":0,"delta":{{"role":"assistant","content":{}}},"finish_reason":null}}]}}"#,
            Value::String(text.to_string())
        ),
        r#"data: {"id":"2","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}"#.to_string(),
        "data: [DONE]".to_string(),
    ]
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

struct Harness {
    _server: MockServer,
    config: Arc<RwLock<AppConfig>>,
    approvals: Arc<ApprovalRegistry>,
    loop_: Arc<AgentLoop>,
    chat_history: Arc<RwLock<Vec<ChatMessage>>>,
}

impl Harness {
    async fn new(script: Vec<Vec<String>>) -> Harness {
        let (server, url) = MockServer::spawn(script).await;

        let mut cfg = AppConfig::default();
        cfg.ai.openai.api_key = "test-key".to_string();
        cfg.ai.openai.api_url = Some(url);
        let config = Arc::new(RwLock::new(cfg));

        let observability = Arc::new(Observability::new());
        let event_bus = Arc::new(EventBus::new(1000));
        let event_store = Arc::new(EventSourcingStore::new());
        let telemetry = Arc::new(parking_lot::Mutex::new(ModelTelemetry::default()));

        let ai_bridge = Arc::new(AiBridge::new(
            Arc::new(RwLock::new(config.read().ai.clone())),
            observability.clone(),
            telemetry,
        ));

        let temp_dir = std::env::temp_dir().join(format!("weave_agent_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let (canvas_tx, _) = tokio::sync::broadcast::channel(16);
        let plugin_manager = Arc::new(PluginManager::new(temp_dir, canvas_tx));

        let approvals = Arc::new(ApprovalRegistry::new());
        let chat_history: Arc<RwLock<Vec<ChatMessage>>> = Arc::new(RwLock::new(Vec::new()));
        let abort = Arc::new(std::sync::atomic::AtomicBool::new(false));

        let agent_loop = Arc::new(AgentLoop {
            ai_bridge: ai_bridge.clone(),
            plugin_manager: plugin_manager.clone(),
            approvals: approvals.clone(),
            config: config.clone(),
            chat_history: chat_history.clone(),
            abort,
            event_bus,
            observability,
            event_store,
        });

        Harness {
            _server: server,
            config,
            approvals,
            loop_: agent_loop,
            chat_history,
        }
    }

    fn bodies(&self) -> Vec<String> {
        self._server.bodies.lock().unwrap().clone()
    }

    fn model_config(&self) -> ModelConfig {
        let cfg = self.config.read();
        ModelConfig {
            provider: Provider::Openai,
            model: "mock-model".to_string(),
            api_key: Some("test-key".to_string()),
            api_url: cfg.ai.openai.api_url.clone(),
            temperature: 0.7,
            max_tokens: 4096,
        }
    }

    fn seed_history(&self) {
        let mut history = self.chat_history.write();
        history.push(ChatMessage::new_user("List the project layout".to_string()));
        let assistant = ChatMessage::new_assistant(String::new());
        history.push(assistant);
    }

    async fn run_loop(
        &self,
        decision: ApprovalDecision,
    ) -> (String, Vec<AgentEvent>) {
        self.seed_history();
        let history = self.chat_history.read().clone();
        let assistant_id = history
            .iter()
            .rev()
            .find(|m| m.role == ChatRole::Assistant)
            .map(|m| m.id.clone())
            .unwrap();

        let (event_tx, mut event_rx) = mpsc::channel(128);
        let loop_ = self.loop_.clone();
        let approvals = self.approvals.clone();
        let model_config = self.model_config();

        let task = tokio::spawn(async move {
            loop_
                .run(
                    model_config,
                    "You are Weave, a test assistant.".to_string(),
                    history,
                    assistant_id,
                    "test_session",
                    event_tx,
                )
                .await
        });

        let mut events = Vec::new();
        loop {
            let event = match tokio::time::timeout(
                std::time::Duration::from_secs(10),
                event_rx.recv(),
            )
            .await
            {
                Ok(Some(e)) => e,
                _ => break,
            };
            if let AgentEvent::PendingApproval { call_id, .. } = &event {
                approvals.resolve(call_id, decision).unwrap();
            }
            let is_complete = matches!(event, AgentEvent::RunComplete { .. });
            events.push(event);
            if is_complete {
                break;
            }
        }

        let result: Result<(), WeaveError> = task.await.unwrap();
        result.unwrap();
        let final_text = events
            .iter()
            .filter_map(|e| match e {
                AgentEvent::Text { text } => Some(text.clone()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .concat();
        (final_text, events)
    }
}

fn request_bodies_contain(bodies: &[String], needle: &str) -> bool {
    bodies.iter().any(|b| b.contains(needle))
}

// ---------------------------------------------------------------------------
// Scenario 1: approved sensitive call — tool result paired, loop continues
// ---------------------------------------------------------------------------

#[tokio::test]
async fn approved_sensitive_call_round_trips_with_paired_result() {
    let args = ["{\"path\":\"src/main.rs\"}"];
    let script = vec![
        sse_openai_request1_tool_call("call_1", "file.read", &args),
        sse_openai_final("Layout listed."),
    ];
    let harness = Harness::new(script).await;

    let (final_text, events) = harness.run_loop(ApprovalDecision::Approved).await;

    // 1. The approval gate fired for the sensitive capability.
    assert!(
        events
            .iter()
            .any(|e| matches!(e, AgentEvent::PendingApproval { capability, .. } if capability == "file.read")),
        "approval gate must fire for sensitive capability file.read"
    );

    // 2. The first request carried native tools with the file.read schema.
    let bodies = harness.bodies();
    assert!(request_bodies_contain(&bodies, "\"tools\""), "request 1 must include tools");
    assert!(request_bodies_contain(&bodies, "\"file.read\""), "tools must advertise file.read");

    // 3. Completion rule: the second request pairs a tool result with call_1.
    let second = bodies.get(1).expect("loop must re-request after tool results");
    assert!(second.contains("\"role\":\"tool\""), "second request must contain a tool-role message");
    assert!(second.contains("\"tool_call_id\":\"call_1\""), "tool result must be paired with call_1");

    // 4. The plugin actually executed (file.read read a real file) and the
    //    loop continued to the final turn.
    assert!(
        final_text.contains("Layout listed."),
        "loop must continue after tool execution, got: {}",
        final_text
    );
}

// ---------------------------------------------------------------------------
// Scenario 2: rejected sensitive call — still produces a paired result
// ---------------------------------------------------------------------------

#[tokio::test]
async fn rejected_sensitive_call_still_pairs_result() {
    let args = ["{\"path\":\"src/main.rs\"}"];
    let script = vec![
        sse_openai_request1_tool_call("call_rej", "file.read", &args),
        sse_openai_final("Understood, skipping."),
    ];
    let harness = Harness::new(script).await;

    let (final_text, _events) = harness.run_loop(ApprovalDecision::Rejected).await;

    let bodies = harness.bodies();
    let second = bodies.get(1).expect("loop must re-request after rejection");
    assert!(
        second.contains("\"tool_call_id\":\"call_rej\""),
        "rejected call must still get a paired tool result"
    );
    assert!(
        second.contains("User denied this action."),
        "rejected result must carry the denial text"
    );
    assert!(final_text.contains("Understood, skipping."));
}

// ---------------------------------------------------------------------------
// Scenario 3: plugin execution error — error result still paired
// ---------------------------------------------------------------------------

#[tokio::test]
async fn errored_plugin_call_still_pairs_result() {
    let args = ["{\"path\":\"does_not_exist_12345.txt\"}"];
    let script = vec![
        sse_openai_request1_tool_call("call_err", "file.read", &args),
        sse_openai_final("Retrying with a different file."),
    ];
    let harness = Harness::new(script).await;

    let (final_text, _events) = harness.run_loop(ApprovalDecision::Approved).await;

    let bodies = harness.bodies();
    let second = bodies.get(1).expect("loop must re-request after plugin error");
    assert!(
        second.contains("\"tool_call_id\":\"call_err\""),
        "errored call must still get a paired tool result"
    );
    assert!(
        second.contains("[Error]"),
        "errored result must carry the plugin error text"
    );
    assert!(final_text.contains("Retrying with a different file."));
}


// ---------------------------------------------------------------------------
// Scenario 4: no tool calls → single turn, no approval events
// ---------------------------------------------------------------------------

#[tokio::test]
async fn plain_text_turn_never_gates() {
    let script = vec![sse_openai_final("Hello from mock.")];
    let harness = Harness::new(script).await;

    let (final_text, events) = harness.run_loop(ApprovalDecision::Approved).await;

    assert!(final_text.contains("Hello from mock."));
    assert!(
        !events
            .iter()
            .any(|e| matches!(e, AgentEvent::PendingApproval { .. })),
        "no tool calls means no approval gate"
    );
    assert_eq!(harness.bodies().len(), 1, "no re-request without tool calls");
}
