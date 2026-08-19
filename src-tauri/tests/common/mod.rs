//! Shared Phase-5 test harness: a mock OpenAI-compatible SSE provider plus
//! the agent-loop scaffolding, used by every per-plugin migration test.
//!
//! `#![allow(dead_code)]`: this module is `mod common;`-included into several
//! separate test binaries, each of which uses only a subset of the shared
//! helpers. A helper unused by one binary is not dead — it is used by another.
#![allow(dead_code)]

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use parking_lot::RwLock;
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;

use weave::agent::{AgentEvent, AgentLoop, ApprovalRegistry, QuestionsRegistry};
use weave::ai_bridge::{AiBridge, ModelTelemetry};
use weave::models::chat::{ChatMessage, ChatRole, ModelConfig, Provider};
pub use weave::plugin_manager::PluginManager;
use weave::utils::config::AppConfig;
use weave::utils::errors::WeaveError;

use runtime_kernel::event_bus::EventBus;
use runtime_kernel::event_store::EventSourcingStore;
use runtime_kernel::observability::Observability;

// ---------------------------------------------------------------------------
// Mock OpenAI-compatible SSE provider
// ---------------------------------------------------------------------------

pub struct MockServer {
    /// Per-request capture of the request body (for assertions).
    pub bodies: Arc<Mutex<Vec<String>>>,
    /// SSE `data:` lines to stream, one Vec per request.
    script: Vec<Vec<String>>,
    request_count: Arc<AtomicUsize>,
}

impl MockServer {
    pub async fn spawn(script: Vec<Vec<String>>) -> (Self, String) {
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

/// SSE script: request 1 asks the model to call `capability` with `args_json`
/// (streamed as one arguments fragment), request 2 returns plain text.
pub fn tool_call_script(capability: &str, args_json: &str, final_text: &str) -> Vec<Vec<String>> {
    let mut lines = vec![
        r#"data: {"id":"1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"Running..."},"finish_reason":null}]}"#.to_string(),
    ];
    let arguments_json = Value::String(args_json.to_string());
    let provider_name = PluginManager::provider_tool_name(capability);
    lines.push(format!(
        r#"data: {{"id":"1","object":"chat.completion.chunk","choices":[{{"index":0,"delta":{{"tool_calls":[{{"index":0,"id":"call_p","type":"function","function":{{"name":{},"arguments":{}}}}}]}},"finish_reason":null}}]}}"#,
        Value::String(provider_name),
        arguments_json
    ));
    lines.push(
        r#"data: {"id":"1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}"#.to_string(),
    );
    lines.push("data: [DONE]".to_string());

    vec![
        lines,
        vec![
            format!(
                r#"data: {{"id":"2","object":"chat.completion.chunk","choices":[{{"index":0,"delta":{{"role":"assistant","content":{}}},"finish_reason":null}}]}}"#,
                Value::String(final_text.to_string())
            ),
            r#"data: {"id":"2","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}"#.to_string(),
            "data: [DONE]".to_string(),
        ],
    ]
}

/// SSE script for a single plain-text turn (no tool calls).
pub fn plain_text_script(text: &str) -> Vec<Vec<String>> {
    vec![vec![
        format!(
            r#"data: {{"id":"2","object":"chat.completion.chunk","choices":[{{"index":0,"delta":{{"role":"assistant","content":{}}},"finish_reason":null}}]}}"#,
            Value::String(text.to_string())
        ),
        r#"data: {"id":"2","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}"#.to_string(),
        "data: [DONE]".to_string(),
    ]]
}

/// SSE script for the reserved `weave.ask_user` native tool: request 1 asks
/// the model to call ask_user with one structured question, request 2 returns
/// plain text.
pub fn ask_user_script(final_text: &str) -> Vec<Vec<String>> {
    let args = r#"{"questions":[{"type":"radio","question":"Which plan?","options":["a","b"]}]}"#;
    tool_call_script(PluginManager::ASK_USER_CAPABILITY, args, final_text)
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

pub struct Harness {
    pub server: MockServer,
    pub config: Arc<RwLock<AppConfig>>,
    pub approvals: Arc<ApprovalRegistry>,
    pub questions: Arc<QuestionsRegistry>,
    pub loop_: Arc<AgentLoop>,
    pub chat_history: Arc<RwLock<Vec<ChatMessage>>>,
}

impl Harness {
    pub async fn new(script: Vec<Vec<String>>) -> Harness {
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

        let temp_dir =
            std::env::temp_dir().join(format!("weave_agent_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let (canvas_tx, _) = tokio::sync::broadcast::channel(16);
        let plugin_manager = Arc::new(PluginManager::new(temp_dir, canvas_tx));

        let approvals = Arc::new(ApprovalRegistry::new());
        let questions = Arc::new(QuestionsRegistry::new());
        let chat_history: Arc<RwLock<Vec<ChatMessage>>> = Arc::new(RwLock::new(Vec::new()));
        let agent_loop = Arc::new(AgentLoop {
            ai_bridge: ai_bridge.clone(),
            plugin_manager: plugin_manager.clone(),
            approvals: approvals.clone(),
            config: config.clone(),
            chat_history: chat_history.clone(),
            approval_auto: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            questions: questions.clone(),
            event_bus,
            observability,
            event_store,
        });

        Harness {
            server,
            config,
            approvals,
            questions,
            loop_: agent_loop,
            chat_history,
        }
    }

    pub fn bodies(&self) -> Vec<String> {
        self.server.bodies.lock().unwrap().clone()
    }

    pub fn model_config(&self) -> ModelConfig {
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

    pub fn seed_history(&self) {
        let mut history = self.chat_history.write();
        history.push(ChatMessage::new_user("Run the tool".to_string()));
        let assistant = ChatMessage::new_assistant(String::new());
        history.push(assistant);
    }

    /// Run the agent loop, auto-resolving every pending approval with
    /// `decision`. Returns the accumulated final text and the events.
    pub async fn run_loop(&self, decision: ApprovalDecision) -> (String, Vec<AgentEvent>) {
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
        let run_abort = Arc::new(std::sync::atomic::AtomicBool::new(false));

        let task = tokio::spawn(async move {
            loop_
                .run(
                    model_config,
                    "You are Weave, a test assistant.".to_string(),
                    history,
                    assistant_id,
                    "test_session",
                    event_tx,
                    run_abort,
                )
                .await
        });

        let mut events = Vec::new();
        loop {
            let event = match tokio::time::timeout(std::time::Duration::from_secs(10), event_rx.recv())
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

    /// Like `run_loop`, but also resolves every `QuestionsAsked` event with the
    /// next batch of answers (in order), so a `weave.ask_user` tool call can
    /// proceed. Approvals are auto-approved.
    pub async fn run_loop_with_question_answers(
        &self,
        answers: Vec<Vec<String>>,
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
        let questions = self.questions.clone();
        let answers = Arc::new(Mutex::new(answers));
        let model_config = self.model_config();
        let run_abort = Arc::new(std::sync::atomic::AtomicBool::new(false));

        let task = tokio::spawn(async move {
            loop_
                .run(
                    model_config,
                    "You are Weave, a test assistant.".to_string(),
                    history,
                    assistant_id,
                    "test_session",
                    event_tx,
                    run_abort,
                )
                .await
        });

        let mut events = Vec::new();
        loop {
            let event = match tokio::time::timeout(std::time::Duration::from_secs(10), event_rx.recv())
                .await
            {
                Ok(Some(e)) => e,
                _ => break,
            };
            if let AgentEvent::PendingApproval { call_id, .. } = &event {
                approvals.resolve(call_id, ApprovalDecision::Approved).unwrap();
            }
            if let AgentEvent::QuestionsAsked { question_id, .. } = &event {
                let next = answers.lock().unwrap().pop().unwrap_or_default();
                questions.resolve(question_id, next).unwrap();
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

/// Result of a full tool-call round trip through the spine.
pub struct RoundTrip {
    pub final_text: String,
    pub events: Vec<AgentEvent>,
    pub bodies: Vec<String>,
}

/// One full spine round trip: mock provider asks for `capability` with
/// `args_json`, the agent loop executes it (approving pending calls with
/// `decision`), and the second request carries the paired tool result.
pub async fn round_trip(
    capability: &str,
    args_json: &str,
    decision: ApprovalDecision,
) -> RoundTrip {
    let harness = Harness::new(tool_call_script(capability, args_json, "Done.")).await;
    let (final_text, events) = harness.run_loop(decision).await;
    RoundTrip {
        final_text,
        events,
        bodies: harness.bodies(),
    }
}

pub fn saw_approval(events: &[AgentEvent], capability: &str) -> bool {
    events.iter().any(|e| {
        matches!(e, AgentEvent::PendingApproval { capability: c, .. } if c == capability)
    })
}

/// The second request body — the one that must carry the paired tool result.
pub fn second_request_body(rt: &RoundTrip) -> &str {
    rt.bodies
        .get(1)
        .expect("loop must re-request after tool execution")
}

/// Completion-rule proof at the protocol level (phase1-spine-spec.md §3
/// amendment #6): parse the second request body's JSON and assert that the
/// set of assistant `tool_calls` ids EXACTLY equals the set of `tool`-role
/// result `tool_call_id`s — a dangling id would make the provider reject the
/// request with 400, so this is the "next request is not malformed" proof.
pub fn assert_completion_rule(body: &str) {
    let json_start = body
        .find('{')
        .expect("request body must contain JSON");
    let json: Value = serde_json::from_str(&body[json_start..])
        .expect("second request must be valid JSON");
    let messages = json["messages"]
        .as_array()
        .expect("second request must carry messages");

    let mut call_ids: Vec<String> = Vec::new();
    let mut result_ids: Vec<String> = Vec::new();

    for msg in messages {
        let role = msg["role"].as_str().unwrap_or("");
        if role == "assistant" {
            if let Some(calls) = msg["tool_calls"].as_array() {
                for call in calls {
                    if let Some(id) = call["id"].as_str() {
                        call_ids.push(id.to_string());
                    }
                }
            }
        } else if role == "tool" {
            if let Some(id) = msg["tool_call_id"].as_str() {
                result_ids.push(id.to_string());
            }
        }
    }

    assert!(
        !call_ids.is_empty(),
        "completion rule: assistant message must carry tool_calls"
    );
    let mut sorted_calls = call_ids.clone();
    let mut sorted_results = result_ids.clone();
    sorted_calls.sort();
    sorted_results.sort();
    assert_eq!(
        sorted_calls, sorted_results,
        "completion rule: every tool_call id must have exactly one paired tool result \
         (assistant ids: {:?}, tool results: {:?})",
        call_ids, result_ids
    );
}

pub use weave::agent::ApprovalDecision;
