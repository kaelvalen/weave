//! Backend agent loop (phase1-spine-spec.md §3).
//!
//! Owns the turn state end-to-end: sends requests with native tool
//! definitions, streams text + tool-call deltas to the frontend, resolves
//! tool calls against the plugin registry, runs the approval gate, executes
//! capabilities, and appends provider-native tool results so the loop can
//! continue automatically until a turn produces no further tool calls.
//!
//! The frontend only relays approval decisions via `chat_approve_tool_call`.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::mpsc;
use tracing::{info, warn};

use crate::ai_bridge::{AgentStreamEvent, AiBridge};
use crate::models::chat::{
    CallStatus, ChatMessage, ChatRole, MessageMetadata, ModelConfig, PluginCall, Provider,
};
use crate::plugin_manager::PluginManager;
use crate::utils::capability_policy;
use crate::utils::config::AppConfig;
use crate::utils::errors::WeaveError;

use runtime_kernel::event_bus::EventBus;
use runtime_kernel::event_store::EventSourcingStore;
use runtime_kernel::execution_context::ExecutionContext;
use runtime_kernel::observability::Observability;
use runtime_kernel::runtime_event::{RuntimeEvent, RuntimeEventKind};

/// Registry of tool calls currently awaiting user approval. The agent loop
/// registers a oneshot receiver per pending call; `chat_approve_tool_call`
/// resolves it. A pending call blocks only its own turn.
#[derive(Default)]
pub struct ApprovalRegistry {
    pending: parking_lot::Mutex<HashMap<String, tokio::sync::oneshot::Sender<ApprovalDecision>>>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ApprovalDecision {
    Approved,
    Rejected,
}

impl ApprovalRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&self, call_id: String) -> tokio::sync::oneshot::Receiver<ApprovalDecision> {
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.pending.lock().insert(call_id, tx);
        rx
    }

    /// Resolve a pending approval. Returns an error when the call_id is not
    /// awaiting approval (already resolved, unknown, or the loop moved on).
    pub fn resolve(&self, call_id: &str, decision: ApprovalDecision) -> Result<(), WeaveError> {
        let tx = self.pending.lock().remove(call_id).ok_or_else(|| {
            WeaveError::PluginError(format!(
                "No tool call awaiting approval for call_id '{}'",
                call_id
            ))
        })?;
        tx.send(decision).map_err(|_| {
            WeaveError::PluginError(format!("Approval channel closed for '{}'", call_id))
        })
    }
}

/// Registry of question batches the agent loop is waiting on. The loop
/// registers a oneshot receiver per batch; `chat_submit_answers` resolves
/// it with the user's answers. Answers are free-form strings — a radio
/// holds one, a check holds the joined selections, a text holds the input.
#[derive(Default)]
pub struct QuestionsRegistry {
    pending: parking_lot::Mutex<HashMap<String, tokio::sync::oneshot::Sender<Vec<String>>>>,
}

impl QuestionsRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&self, id: String) -> tokio::sync::oneshot::Receiver<Vec<String>> {
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.pending.lock().insert(id, tx);
        rx
    }

    pub fn resolve(&self, id: &str, answers: Vec<String>) -> Result<(), WeaveError> {
        let tx = self.pending.lock().remove(id).ok_or_else(|| {
            WeaveError::PluginError(format!("No question batch awaiting answers for '{}'", id))
        })?;
        tx.send(answers)
            .map_err(|_| WeaveError::PluginError(format!("Questions channel closed for '{}'", id)))
    }
}

/// One structured clarifying question from the model, parsed from the native
/// `weave.ask_user` tool's arguments (previously a hand-rolled `<questions>`
/// XML block in assistant prose).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentQuestion {
    /// "radio" (single choice), "check" (multi choice), or "text" (free form).
    #[serde(rename = "type")]
    pub qtype: String,
    pub question: String,
    #[serde(default)]
    pub options: Vec<String>,
}

/// Arguments to `weave.ask_user`: one to three structured questions.
#[derive(Debug, Clone, Deserialize)]
struct AskUserArgs {
    #[serde(default)]
    questions: Vec<AgentQuestion>,
}

/// A fully-assembled native tool call from the provider stream.
#[derive(Debug, Clone)]
pub struct AgentToolCall {
    pub call_id: String,
    /// Provider-safe function name, preserved in the native assistant message.
    pub name: String,
    /// Canonical Weave capability id used for policy and execution.
    pub capability: String,
    pub args: Value,
}

#[derive(Debug, Clone)]
pub enum CallOutcome {
    Success(Value),
    Error(String),
    Rejected,
}

/// Events the agent loop emits for the Tauri command layer to forward.
#[derive(Debug, Clone)]
pub enum AgentEvent {
    Text {
        text: String,
    },
    /// A piece of the model's reasoning/thinking, streamed before content.
    /// The frontend renders it as an expandable trace — it is never part of
    /// the assistant's final text.
    Reasoning {
        text: String,
    },
    /// Reasoning has finished (first content token or end of stream).
    ReasoningDone {},
    /// A tool call was detected / executed. `status`: pending | success | error.
    ToolCall {
        call_id: String,
        plugin_id: String,
        capability: String,
        params: Value,
        status: String,
        result: Option<Value>,
    },
    /// A sensitive/destructive call is waiting for user approval.
    PendingApproval {
        call_id: String,
        plugin_id: String,
        capability: String,
        params: Value,
    },
    /// The model asked structured clarifying questions instead of acting —
    /// the frontend renders them as an approval-style card and the turn
    /// pauses until `chat_submit_answers` resolves the batch.
    QuestionsAsked {
        question_id: String,
        questions: Vec<AgentQuestion>,
    },
    RunComplete {
        final_text: String,
    },
    RunError {
        error: String,
    },
}

/// Maximum provider round-trips per `run` before the loop gives up (safety
/// net against model loops that never stop calling tools).
const MAX_ROUNDS: usize = 12;

/// Default hard cap (ms) on a single tool call's execution time. Executors run
/// on their own OS thread (see `execute_call`); this bounds how long a hung
/// tool can stall the turn, feeding the result back to the model as an error.
/// Public so the app shell and the test harness share the same default.
pub const DEFAULT_TOOL_TIMEOUT_MS: u64 = 120_000;

pub struct AgentLoop {
    pub ai_bridge: Arc<AiBridge>,
    pub plugin_manager: Arc<PluginManager>,
    pub approvals: Arc<ApprovalRegistry>,
    pub config: Arc<RwLock<AppConfig>>,
    pub chat_history: Arc<RwLock<Vec<ChatMessage>>>,
    /// When true the approval gate is fully bypassed: sensitive/destructive
    /// and MCP-sourced calls execute without a PendingApproval event
    /// (frontend "Auto-Approve" mode).
    pub approval_auto: Arc<AtomicBool>,
    /// Human-in-the-loop clarifying questions — the agent pauses its turn
    /// until the user answers via the `weave.ask_user` tool (resolved through
    /// `chat_submit_answers`).
    pub questions: Arc<QuestionsRegistry>,
    pub event_bus: Arc<EventBus>,
    pub observability: Arc<Observability>,
    pub event_store: Arc<EventSourcingStore>,
    /// Hard cap (ms) on each tool call's execution time (see `execute_call`).
    /// Atomic so it can be tuned at runtime (e.g. by tests) behind the shared
    /// `Arc<AgentLoop>`. Default is `DEFAULT_TOOL_TIMEOUT_MS`.
    pub tool_timeout_ms: std::sync::atomic::AtomicU64,
}

impl AgentLoop {
    fn create_execution_context(&self, session_id: &str) -> ExecutionContext {
        let workspace = std::env::current_dir().unwrap_or_default();
        let config_json = Arc::new(RwLock::new(
            serde_json::to_value(&*self.config.read()).unwrap_or_default(),
        ));
        ExecutionContext::new(
            session_id.to_string(),
            workspace,
            config_json,
            self.event_bus.clone(),
        )
        .with_subsystems(self.observability.clone(), self.event_store.clone())
    }

    /// Run the agent loop to completion for one user turn.
    ///
    /// `history` is the chat history snapshot used to build the first-round
    /// provider messages (the trailing empty assistant message is excluded).
    /// Returns once a turn produces no tool calls (or the round limit /
    /// abort is hit). The assistant message identified by `assistant_id` in
    /// `chat_history` is updated with streamed text and plugin-call metadata.
    pub async fn run(
        &self,
        model_config: ModelConfig,
        system_prompt: String,
        history: Vec<ChatMessage>,
        assistant_id: String,
        session_id: &str,
        event_tx: mpsc::Sender<AgentEvent>,
        run_abort: Arc<AtomicBool>,
    ) -> Result<(), WeaveError> {
        let provider = model_config.provider.clone();

        // Round-1 native messages: system prompt + history (minus the
        // trailing empty assistant message the command layer pre-pushed).
        let mut provider_history: Vec<ChatMessage> = Vec::new();
        provider_history.push(ChatMessage {
            id: "sys_tools".to_string(),
            role: ChatRole::System,
            content: system_prompt,
            timestamp: 0,
            metadata: None,
            images: None,
        });
        for m in history {
            if m.role == ChatRole::Assistant && m.content.trim().is_empty() {
                continue;
            }
            provider_history.push(m);
        }

        let mut native = AiBridge::build_native_messages(
            &provider,
            &model_config.model,
            model_config.api_url.as_deref(),
            provider_history,
        );

        let mut final_text = String::new();
        let session_id = session_id.to_string();

        // Tools actually invoked earlier in this session — the context-budget
        // trimmer keeps them ahead of never-used tools so the model can keep
        // doing what it was doing across rounds.
        let mut used_tools: HashSet<String> = HashSet::new();

        // VRAM-bound context window (llama-swap -c, Ollama context_length):
        // the tool catalog (MCP schemas are huge — github is ~33K tokens for
        // 47 tools) and history must fit in it, or the request is rejected
        // with 400 exceed_context_size_error. Cloud providers are untouched.
        let context_budget: Option<usize> = match provider {
            Provider::LlamaSwap => Some(crate::commands::llama_swap::context_size()),
            Provider::Local => {
                let ctx = self.config.read().ai.local.context_length;
                Some(if ctx == 0 { 8192 } else { ctx as usize })
            }
            _ => None,
        };
        if let Some(budget) = context_budget {
            trim_history_to_budget(&mut native, budget);
        }

        for _round in 0..MAX_ROUNDS {
            if run_abort.load(Ordering::SeqCst) {
                break;
            }

            // Native tools: OpenAI/Ollama envelope from the plugin registry.
            // Local provider falls back to prompt-based mode (no tools field)
            // when the static use_native_tools flag is off (spec §2 Q2).
            let mut tools = self.plugin_manager.tools_for_provider(&provider);
            if provider == Provider::Local {
                let use_native = self.config.read().ai.local.use_native_tools;
                if !use_native {
                    tools.clear();
                }
            } else if provider == Provider::LlamaSwap {
                // One OpenAI-compatible endpoint, many model families — tool
                // formatting can differ per family even under --jinja, so the
                // capability is probed once per model id on first real use and
                // cached in the per-model map (llama-swap spec §3).
                let model_id = model_config.model.clone();
                let use_native = {
                    let config = self.config.read();
                    config
                        .ai
                        .local
                        .use_native_tools_per_model
                        .get(&model_id)
                        .copied()
                };
                let use_native = match use_native {
                    Some(v) => v,
                    None => {
                        // First use of this model: probe it now (loads the
                        // model into VRAM; ttl:300 unloads it ~5min later).
                        let ok = self.ai_bridge.llama_swap_probe_tools(&model_id).await?;
                        {
                            let mut config = self.config.write();
                            config
                                .ai
                                .local
                                .use_native_tools_per_model
                                .insert(model_id.clone(), ok);
                        }
                        // Persist alongside use_native_tools (spec §3).
                        let config = self.config.read().clone();
                        if let Err(e) = config.save() {
                            tracing::warn!("failed to persist tool-capability probe result: {}", e);
                        }
                        ok
                    }
                };
                if !use_native {
                    tools.clear();
                }
            }
            // Context budget: order tools (session-used first, then smallest
            // schema first — keeps the most coverage per token) and drop the
            // tail that would overflow the context window.
            if let Some(budget) = context_budget {
                trim_tools_to_budget(&mut tools, budget, &used_tools);
            }
            let tools_opt = if tools.is_empty() { None } else { Some(tools) };

            let mut rx = self
                .ai_bridge
                .agent_stream(
                    provider.clone(),
                    model_config.model.clone(),
                    model_config.api_key.clone(),
                    model_config.api_url.clone(),
                    model_config.temperature,
                    model_config.max_tokens,
                    native.clone(),
                    tools_opt,
                )
                .await?;

            // ---- Consume the stream: text + tool-call deltas ----
            let mut round_text = String::new();
            let mut pending: Vec<PendingCall> = Vec::new();
            let mut finish_seen = false;
            let mut saw_reasoning = false;

            while let Some(event) = rx.recv().await {
                if run_abort.load(Ordering::SeqCst) {
                    break;
                }
                match event {
                    AgentStreamEvent::Reasoning(text) => {
                        saw_reasoning = true;
                        let _ = event_tx.send(AgentEvent::Reasoning { text }).await;
                    }
                    AgentStreamEvent::Text(text) => {
                        // Reasoning families stream thinking first, then the
                        // answer — the first content token closes the trace.
                        if saw_reasoning {
                            saw_reasoning = false;
                            let _ = event_tx.send(AgentEvent::ReasoningDone {}).await;
                        }
                        round_text.push_str(&text);
                        let _ = event_tx.send(AgentEvent::Text { text }).await;
                    }
                    AgentStreamEvent::ToolCall {
                        index,
                        id,
                        name,
                        args_fragment,
                    } => {
                        let entry = if let Some(e) = pending.iter_mut().find(|e| e.index == index) {
                            e
                        } else {
                            pending.push(PendingCall {
                                index,
                                call_id: id.clone().unwrap_or_default(),
                                name: name.clone().unwrap_or_default(),
                                fragments: String::new(),
                            });
                            pending.last_mut().unwrap()
                        };
                        if !args_fragment.is_empty() {
                            entry.fragments.push_str(&args_fragment);
                        }
                        if let Some(id) = id {
                            entry.call_id = id;
                        }
                        if let Some(name) = name {
                            entry.name = name;
                        }
                    }
                    AgentStreamEvent::Finish { tool_calls } => {
                        if saw_reasoning {
                            saw_reasoning = false;
                            let _ = event_tx.send(AgentEvent::ReasoningDone {}).await;
                        }
                        finish_seen = true;
                        if !tool_calls {
                            break;
                        }
                    }
                }
            }

            if !finish_seen && pending.is_empty() {
                // Stream ended without completion signal (error text path).
                break;
            }

            final_text.push_str(&round_text);
            self.update_assistant_text(&assistant_id, &final_text);

            if pending.is_empty() {
                break;
            }

            // ---- Resolve tool calls against the plugin registry ----
            for p in &pending {
                used_tools.insert(p.name.clone());
            }
            let calls: Vec<AgentToolCall> = pending
                .into_iter()
                .map(|p| {
                    let name = p.name;
                    let capability = if name
                        == PluginManager::provider_tool_name(PluginManager::ASK_USER_CAPABILITY)
                    {
                        // Reserved human-in-the-loop tool — not a plugin
                        // capability, handled directly below.
                        PluginManager::ASK_USER_CAPABILITY.to_string()
                    } else {
                        self.plugin_manager
                            .resolve_provider_tool_name(&name)
                            .unwrap_or_else(|| name.clone())
                    };
                    AgentToolCall {
                        call_id: if p.call_id.is_empty() {
                            format!("call_{}", p.index)
                        } else {
                            p.call_id
                        },
                        name,
                        capability,
                        args: serde_json::from_str(&p.fragments).unwrap_or_else(|_| json!({})),
                    }
                })
                .collect();

            let mut outcomes: Vec<CallOutcome> = Vec::with_capacity(calls.len());

            for call in &calls {
                // ---- Reserved human-in-the-loop tool: ask the user ----
                // `weave.ask_user` is not routed to a plugin and never runs the
                // approval gate (asking the user is not a side effect). It
                // pauses the turn, shows a structured card, and returns the
                // answers as a normal native tool result so the completion
                // rule below feeds them back to the model.
                if call.capability == PluginManager::ASK_USER_CAPABILITY {
                    let outcome = self.execute_ask_user(call, &event_tx, &run_abort).await;
                    self.record_call(&assistant_id, call, "weave".to_string(), &outcome);
                    let _ = event_tx
                        .send(AgentEvent::ToolCall {
                            call_id: call.call_id.clone(),
                            plugin_id: "weave".to_string(),
                            capability: call.capability.clone(),
                            params: call.args.clone(),
                            status: match &outcome {
                                CallOutcome::Success(_) => "success",
                                _ => "error",
                            }
                            .to_string(),
                            result: outcome_to_result(&outcome),
                        })
                        .await;
                    outcomes.push(outcome);
                    continue;
                }

                let plugin_id = match self.plugin_manager.resolve_capability(&call.capability) {
                    Some(id) => id,
                    None => {
                        warn!("No plugin provides capability: {}", call.capability);
                        let outcome = CallOutcome::Error(format!(
                            "No plugin provides capability '{}'",
                            call.capability
                        ));
                        self.record_call(&assistant_id, call, "unknown".to_string(), &outcome);
                        let _ = event_tx
                            .send(AgentEvent::ToolCall {
                                call_id: call.call_id.clone(),
                                plugin_id: "unknown".to_string(),
                                capability: call.capability.clone(),
                                params: call.args.clone(),
                                status: "error".to_string(),
                                result: outcome_to_result(&outcome),
                            })
                            .await;
                        outcomes.push(outcome);
                        continue;
                    }
                };

                // ---- Approval gate (spec §3 step 4; MCP default per
                //      phase8-mcp-spec.md Part 2 §2) ----
                let gated = match self.plugin_manager.get_plugin(&plugin_id) {
                    Some(plugin) => capability_policy::requires_approval_for_call(
                        &call.capability,
                        &plugin,
                        &self.config.read(),
                    ),
                    None => capability_policy::requires_approval(&call.capability),
                };
                // Auto-Approve (frontend toggle) bypasses the gate entirely —
                // no PendingApproval event, no banner, no wait.
                let gated = gated && !self.approval_auto.load(Ordering::SeqCst);
                if gated {
                    let receiver = self.approvals.register(call.call_id.clone());
                    let _ = event_tx
                        .send(AgentEvent::PendingApproval {
                            call_id: call.call_id.clone(),
                            plugin_id: plugin_id.clone(),
                            capability: call.capability.clone(),
                            params: call.args.clone(),
                        })
                        .await;

                    info!(
                        "Awaiting approval for {} ({})",
                        call.capability, call.call_id
                    );
                    let decision = match receiver.await {
                        Ok(decision) => decision,
                        Err(_) => {
                            // Channel dropped (e.g. run aborted).
                            break;
                        }
                    };

                    let outcome = match decision {
                        ApprovalDecision::Rejected => {
                            info!("User rejected tool call {}", call.call_id);
                            CallOutcome::Rejected
                        }
                        ApprovalDecision::Approved => {
                            info!("User approved tool call {}", call.call_id);
                            self.execute_call(plugin_id.clone(), call, &session_id, &assistant_id)
                                .await
                        }
                    };
                    self.record_call(&assistant_id, call, plugin_id.clone(), &outcome);
                    let _ = event_tx
                        .send(AgentEvent::ToolCall {
                            call_id: call.call_id.clone(),
                            plugin_id: plugin_id.clone(),
                            capability: call.capability.clone(),
                            params: call.args.clone(),
                            status: match &outcome {
                                CallOutcome::Success(_) => "success",
                                _ => "error",
                            }
                            .to_string(),
                            result: outcome_to_result(&outcome),
                        })
                        .await;
                    outcomes.push(outcome);
                } else {
                    let outcome = self
                        .execute_call(plugin_id.clone(), call, &session_id, &assistant_id)
                        .await;
                    self.record_call(&assistant_id, call, plugin_id.clone(), &outcome);
                    let _ = event_tx
                        .send(AgentEvent::ToolCall {
                            call_id: call.call_id.clone(),
                            plugin_id: plugin_id.clone(),
                            capability: call.capability.clone(),
                            params: call.args.clone(),
                            status: match &outcome {
                                CallOutcome::Success(_) => "success",
                                _ => "error",
                            }
                            .to_string(),
                            result: outcome_to_result(&outcome),
                        })
                        .await;
                    outcomes.push(outcome);
                }
            }

            // ---- Completion rule (spec §3 step 5, amendment #6) ----
            // Every call_id MUST receive a paired result in provider-native
            // format — success, plugin error, and rejection alike. A missing
            // result makes the next provider request fail with 400.
            native.push(assistant_message(&provider, &round_text, &calls));
            for (call, outcome) in calls.iter().zip(outcomes.iter()) {
                native.push(tool_result_message(&provider, &call.call_id, outcome));
            }

            let _ = event_tx
                .send(AgentEvent::Text {
                    text: "\n".to_string(),
                })
                .await;
        }

        let _ = event_tx
            .send(AgentEvent::RunComplete {
                final_text: final_text.clone(),
            })
            .await;
        Ok(())
    }

    /// Execute one tool call with a hard timeout, off the agent-loop worker.
    ///
    /// Capability executors (Python/WASM/PyO3 runtimes, HTTP, subprocess) run
    /// synchronously on the calling thread. Executing them inline would block
    /// the agent-loop tokio worker for the full duration — a hung tool would
    /// block it forever (SQLite lock, an HTTP client that never answers, a
    /// runaway Python runtime) and also starve cancellation, since the abort
    /// flag is only polled between tool calls. So the executor runs on its own
    /// OS thread and the result is awaited with a bounded timeout (the DSH
    /// `guard` loop-hygiene pattern). A timeout or panic surfaces as a normal
    /// `CallOutcome::Error` and still emits the trace StepFailed event.
    async fn execute_call(
        &self,
        plugin_id: String,
        call: &AgentToolCall,
        session_id: &str,
        goal_id: &str,
    ) -> CallOutcome {
        // Publish runtime step events (StepStarted/StepSucceeded/Failed) so
        // chat-driven tool calls show up in the execution trace — the
        // standalone plugin_execute path already does this, the agent loop
        // did not, which left the GoalTrace "STEPS" section permanently
        // empty for chat turns.
        let step_id = call.call_id.clone();
        let mut start = RuntimeEvent::new(
            RuntimeEventKind::StepStarted,
            step_id.clone(),
            format!("Executing {}::{}", plugin_id, call.capability),
        );
        start.goal_id = Some(goal_id.to_string());
        start.plugin_id = Some(plugin_id.clone());
        start.capability = Some(call.capability.clone());
        start.params = Some(truncate_value(&call.args));
        self.event_bus.publish_runtime(start);

        let started = std::time::Instant::now();
        let ctx = self.create_execution_context(session_id);
        let plugin_manager = self.plugin_manager.clone();
        let plugin_id_for_thread = plugin_id.clone();
        let capability_for_thread = call.capability.clone();
        let args_for_thread = call.args.clone();
        let (tx, rx) = tokio::sync::oneshot::channel();
        std::thread::spawn(move || {
            let result = plugin_manager.execute_capability(
                &plugin_id_for_thread,
                &capability_for_thread,
                args_for_thread,
                &ctx,
            );
            let _ = tx.send(result);
        });

        // Bounded wait: normalized to a String so timeout, panic, and real
        // failure all flow through one error surface.
        let tool_timeout =
            std::time::Duration::from_millis(self.tool_timeout_ms.load(Ordering::SeqCst));
        let result: Result<serde_json::Value, String> =
            match tokio::time::timeout(tool_timeout, rx).await {
                Ok(Ok(r)) => r.map_err(|e| e.to_string()),
                Ok(Err(_)) => Err(format!(
                    "{}::{} panicked during execution",
                    plugin_id, call.capability
                )),
                Err(_) => Err(format!(
                    "{}::{} timed out after {}ms",
                    plugin_id,
                    call.capability,
                    tool_timeout.as_millis()
                )),
            };
        let latency_ms = started.elapsed().as_millis() as u64;

        self.observability
            .record_tool_execution(&call.capability, latency_ms, result.is_ok());

        let mut end = RuntimeEvent::new(
            if result.is_ok() {
                RuntimeEventKind::StepSucceeded
            } else {
                RuntimeEventKind::StepFailed
            },
            step_id.clone(),
            match &result {
                Ok(_) => format!("Executed {}::{}", plugin_id, call.capability),
                Err(e) => format!("Failed {}::{}: {}", plugin_id, call.capability, e),
            },
        );
        end.goal_id = Some(goal_id.to_string());
        end.plugin_id = Some(plugin_id.clone());
        end.capability = Some(call.capability.clone());
        end.latency_ms = Some(latency_ms);
        match &result {
            Ok(output) => end.output = Some(truncate_value(output)),
            Err(e) => end.error = Some(e.clone()),
        }
        self.event_bus.publish_runtime(end);

        match result {
            Ok(result) => CallOutcome::Success(result),
            Err(e) => {
                warn!(
                    "Tool call {} ({}) failed: {}",
                    call.call_id, call.capability, e
                );
                CallOutcome::Error(e)
            }
        }
    }

    /// Append a PluginCall entry to the assistant message metadata so the
    /// session history and UI reflect what happened.
    fn record_call(
        &self,
        assistant_id: &str,
        call: &AgentToolCall,
        plugin_id: String,
        outcome: &CallOutcome,
    ) {
        let mut history = self.chat_history.write();
        if let Some(msg) = history.iter_mut().find(|m| m.id == assistant_id) {
            let metadata = msg.metadata.get_or_insert_with(|| MessageMetadata {
                model: None,
                tokens_used: None,
                plugin_calls: Vec::new(),
                intent: None,
                is_hidden: None,
                reasoning: None,
                reasoning_done: None,
                reasoning_seconds: None,
            });
            metadata.plugin_calls.push(PluginCall {
                call_id: Some(call.call_id.clone()),
                plugin_id,
                capability: call.capability.clone(),
                params: call.args.clone(),
                result: outcome_to_result(outcome),
                status: match outcome {
                    CallOutcome::Success(_) => CallStatus::Success,
                    _ => CallStatus::Error,
                },
            });
        }
    }

    fn update_assistant_text(&self, assistant_id: &str, text: &str) {
        let mut history = self.chat_history.write();
        if let Some(msg) = history.iter_mut().find(|m| m.id == assistant_id) {
            msg.content = text.to_string();
        }
    }

    /// Handle the reserved `weave.ask_user` native tool call: parse the model's
    /// structured questions, surface them as a `QuestionsAsked` card, and wait
    /// (polling the abort flag) for the user's answers via
    /// `chat_submit_answers`. The answers are returned as a readable tool result
    /// so the normal completion rule feeds them back to the model as a native
    /// `tool`/`tool_result` message — no hand-written XML protocol.
    async fn execute_ask_user(
        &self,
        call: &AgentToolCall,
        event_tx: &mpsc::Sender<AgentEvent>,
        run_abort: &Arc<AtomicBool>,
    ) -> CallOutcome {
        let args: AskUserArgs = serde_json::from_value(call.args.clone()).unwrap_or(AskUserArgs {
            questions: Vec::new(),
        });
        if args.questions.is_empty() {
            return CallOutcome::Error(
                "weave.ask_user requires a non-empty 'questions' array".to_string(),
            );
        }
        let questions: Vec<AgentQuestion> = args.questions.into_iter().take(3).collect();

        let question_id = format!("questions_{}", uuid::Uuid::new_v4());
        let _ = event_tx
            .send(AgentEvent::QuestionsAsked {
                question_id: question_id.clone(),
                questions: questions.clone(),
            })
            .await;

        let mut answers_rx = self.questions.register(question_id.clone());
        // Wait for the user's answers, polling the abort flag so Stop still
        // interrupts a paused turn.
        let answers: Vec<String> = loop {
            if run_abort.load(Ordering::SeqCst) {
                break Vec::new();
            }
            match answers_rx.try_recv() {
                Ok(answers) => break answers,
                Err(tokio::sync::oneshot::error::TryRecvError::Empty) => {
                    tokio::time::sleep(std::time::Duration::from_millis(80)).await;
                }
                Err(tokio::sync::oneshot::error::TryRecvError::Closed) => break Vec::new(),
            }
        };
        if run_abort.load(Ordering::SeqCst) || answers.is_empty() {
            // Dismissed or aborted — drop the registry entry so a late submit
            // doesn't error, and report the turn ended without answers.
            let _ = self.questions.resolve(&question_id, Vec::new());
            if run_abort.load(Ordering::SeqCst) {
                return CallOutcome::Rejected;
            }
            return CallOutcome::Error("User dismissed the clarifying questions.".to_string());
        }

        // Readable summary the model consumes as this tool's result.
        let mut qa = String::from("User answers:\n");
        for (i, (q, a)) in questions.iter().zip(answers.iter()).enumerate() {
            qa.push_str(&format!("Q{} — {}: A: {}\n", i + 1, q.question, a));
        }
        CallOutcome::Success(Value::String(qa.trim().to_string()))
    }
}

struct PendingCall {
    index: usize,
    call_id: String,
    name: String,
    fragments: String,
}

fn outcome_to_result(outcome: &CallOutcome) -> Option<Value> {
    match outcome {
        CallOutcome::Success(result) => Some(result.clone()),
        CallOutcome::Error(e) => Some(json!({"error": e})),
        CallOutcome::Rejected => Some(json!({"error": "User rejected the operation."})),
    }
}

/// Cap a tool input/output payload before publishing it as a runtime event,
/// mirroring the standalone plugin_execute path's truncation.
fn truncate_value(value: &Value) -> Value {
    const MAX_BYTES: usize = 32 * 1024;
    let text = match value {
        Value::String(s) => s.clone(),
        other => serde_json::to_string(other).unwrap_or_default(),
    };
    if text.len() <= MAX_BYTES {
        return value.clone();
    }
    Value::String(format!(
        "{}… [truncated {} bytes]",
        &text[..MAX_BYTES],
        text.len() - MAX_BYTES
    ))
}

fn outcome_content(outcome: &CallOutcome) -> String {
    match outcome {
        CallOutcome::Success(result) => {
            if result.is_string() {
                result.as_str().unwrap_or("").to_string()
            } else {
                result.to_string()
            }
        }
        CallOutcome::Error(e) => format!("[Error] {}", e),
        CallOutcome::Rejected => "User denied this action.".to_string(),
    }
}

/// Provider-native assistant message carrying text + tool calls.
fn assistant_message(provider: &Provider, text: &str, calls: &[AgentToolCall]) -> Value {
    match provider {
        Provider::Anthropic => {
            let mut content = vec![json!({
                "type": "text",
                "text": if text.is_empty() { "" } else { text },
            })];
            for call in calls {
                content.push(json!({
                    "type": "tool_use",
                    "id": call.call_id,
                    "name": call.name,
                    "input": call.args,
                }));
            }
            json!({"role": "assistant", "content": content})
        }
        _ => {
            let tool_calls: Vec<Value> = calls
                .iter()
                .map(|call| {
                    json!({
                        "id": call.call_id,
                        "type": "function",
                        "function": {
                            "name": call.name,
                            "arguments": call.args.to_string(),
                        },
                    })
                })
                .collect();
            json!({
                "role": "assistant",
                "content": if text.trim().is_empty() { Value::Null } else { Value::String(text.to_string()) },
                "tool_calls": tool_calls,
            })
        }
    }
}

/// Provider-native tool result for one call_id (completion rule: every
/// call_id gets exactly one paired result, never skipped).
fn tool_result_message(provider: &Provider, call_id: &str, outcome: &CallOutcome) -> Value {
    match provider {
        Provider::Anthropic => json!({
            "role": "user",
            "content": [{
                "type": "tool_result",
                "tool_use_id": call_id,
                "content": outcome_content(outcome),
                "is_error": !matches!(outcome, CallOutcome::Success(_)),
            }],
        }),
        Provider::Local => json!({
            "role": "tool",
            "content": outcome_content(outcome),
        }),
        _ => json!({
            "role": "tool",
            "tool_call_id": call_id,
            "content": outcome_content(outcome),
        }),
    }
}

// ---- Context-budget trimming (VRAM-bound providers) ----
//
// llama-swap models run behind a fixed `-c NNNN` (VRAM ceiling on the
// user's 8GB card); Ollama's context_length is config-owned. The MCP tool
// catalog alone can exceed it (github: 47 tools ≈ 33K tokens), so the
// request is rejected with 400 exceed_context_size_error before the model
// ever sees it. History trimming alone cannot fix that — the tool catalog
// must be budgeted too.

/// Conservative token estimate (bytes/4; JSON is ASCII-heavy). Undershoots
/// for CJK-heavy content, but the 10% headroom below absorbs that.
fn estimate_json_tokens(value: &Value) -> usize {
    serde_json::to_string(value)
        .map(|s| s.len() / 4)
        .unwrap_or(0)
}

/// Order `tools` for the context budget: tools already used this session
/// first (stable), then smallest-schema-first (max coverage per token),
/// then drop the tail that no longer fits. The 10% headroom protects the
/// estimate's undershoot.
fn trim_tools_to_budget(
    tools: &mut Vec<Value>,
    context_budget: usize,
    used_tools: &HashSet<String>,
) {
    if tools.is_empty() {
        return;
    }
    let original_len = tools.len();
    let budget = (context_budget * 9) / 10;
    let total: usize = tools.iter().map(estimate_json_tokens).sum();
    if total <= budget {
        return;
    }

    let mut indexed: Vec<(usize, bool, usize)> = tools
        .iter()
        .enumerate()
        .map(|(idx, t)| {
            let used = t["function"]["name"]
                .as_str()
                .map(|n| used_tools.contains(n))
                .unwrap_or(false);
            (idx, used, estimate_json_tokens(t))
        })
        .collect();
    // used-first, then size ascending (stable by original index).
    indexed.sort_by(|a, b| b.1.cmp(&a.1).then(a.2.cmp(&b.2)));

    let mut kept: Vec<usize> = Vec::new();
    let mut acc = 0usize;
    for (idx, _used, size) in indexed {
        if acc + size > budget && !kept.is_empty() {
            break;
        }
        acc += size;
        kept.push(idx);
    }
    if kept.is_empty() || kept.len() == tools.len() {
        return;
    }
    kept.sort_unstable();
    *tools = kept.into_iter().map(|i| tools[i].clone()).collect();
    tracing::info!(
        "context budget {}: {} tools → {} (≈{}K tokens)",
        context_budget,
        original_len,
        tools.len(),
        acc / 1024
    );
}

/// Drop the oldest user/assistant turns (never the system prompt at index 0)
/// so the newest messages that fit the budget stay. The last message is
/// always kept — better to send an oversized prompt (and get a clear
/// provider error) than an empty one. Runs once before the first round;
/// later rounds only append small tool results.
fn trim_history_to_budget(native: &mut Vec<Value>, context_budget: usize) {
    if native.len() <= 1 {
        return;
    }
    let budget = (context_budget * 9) / 10;
    let total: usize = native.iter().map(estimate_json_tokens).sum();
    if total <= budget {
        return;
    }
    let system = estimate_json_tokens(&native[0]);
    let mut acc = system;
    let mut keep_from = native.len();
    for i in (1..native.len()).rev() {
        let size = estimate_json_tokens(&native[i]);
        if acc + size > budget && i < native.len() - 1 {
            break;
        }
        acc += size;
        keep_from = i;
    }
    if keep_from <= 1 || keep_from == native.len() {
        return;
    }
    let dropped = keep_from - 1;
    native.drain(1..keep_from);
    tracing::info!("context budget: history trimmed by {} messages", dropped);
}

#[cfg(test)]
mod budget_tests {
    use super::*;

    fn tool(name: &str, payload: usize) -> Value {
        json!({
            "type": "function",
            "function": {
                "name": name,
                "description": "x".repeat(payload),
                "parameters": json!({"type": "object", "properties": {}}),
            },
        })
    }

    #[test]
    fn test_trim_tools_keeps_smallest() {
        let mut tools = vec![
            tool("big", 6000),
            tool("small1", 2000),
            tool("small2", 2000),
        ];
        // est: big ≈1500 tok, smalls ≈500 each; eff budget 1800 → big drops.
        trim_tools_to_budget(&mut tools, 2000, &HashSet::new());
        assert_eq!(tools.len(), 2);
        assert!(tools.iter().any(|t| t["function"]["name"] == "small1"));
        assert!(tools.iter().any(|t| t["function"]["name"] == "small2"));
        assert!(!tools.iter().any(|t| t["function"]["name"] == "big"));
    }

    #[test]
    fn test_trim_tools_prefers_used() {
        let mut tools = vec![tool("a", 4000), tool("b", 2400), tool("c", 1600)];
        let mut used = HashSet::new();
        used.insert("a".to_string());
        // est: a ≈1000, b ≈600, c ≈400; eff budget 1800 → a(used)+c fit,
        // b would overflow → the used tool survives despite being largest.
        trim_tools_to_budget(&mut tools, 2000, &used);
        assert_eq!(tools.len(), 2);
        assert!(tools.iter().any(|t| t["function"]["name"] == "a"));
        assert!(tools.iter().any(|t| t["function"]["name"] == "c"));
    }

    #[test]
    fn test_trim_tools_noop_within_budget() {
        let mut tools = vec![tool("x", 100), tool("y", 200)];
        trim_tools_to_budget(&mut tools, 10_000, &HashSet::new());
        assert_eq!(tools.len(), 2);
    }

    #[test]
    fn test_trim_history_keeps_system_and_recent() {
        let mk = |role: &str, n: usize| json!({"role": role, "content": "x".repeat(n)});
        let mut native = vec![
            mk("system", 4000), // est ≈1000
            mk("user", 6000),   // est ≈1500 — oldest turn, must go
            mk("assistant", 1000),
            mk("user", 500),
        ];
        // eff budget 1800: system+assistant+latest user ≈1375 fit; the
        // 6000-char user would overflow → dropped.
        trim_history_to_budget(&mut native, 2000);
        assert_eq!(native[0]["role"], "system");
        assert_eq!(native.len(), 3);
        assert_eq!(native[1]["role"], "assistant");
        assert_eq!(native[2]["content"].as_str().unwrap().len(), 500);
    }

    #[test]
    fn test_trim_history_noop_within_budget() {
        let mk = |role: &str| json!({"role": role, "content": "x".repeat(50)});
        let mut native = vec![mk("system"), mk("user"), mk("assistant")];
        trim_history_to_budget(&mut native, 100_000);
        assert_eq!(native.len(), 3);
    }

    // ─── weave.ask_user native-tool contract ───

    #[test]
    fn parses_ask_user_args_from_native_tool_call() {
        let args = json!({
            "questions": [
                {"type": "radio", "question": "How many flavors?", "options": ["Three", "Five"]},
                {"type": "check", "question": "Which mix-ins?", "options": ["Chips", "Sprinkles", "One hero"]},
                {"type": "text", "question": "Anything else?"}
            ]
        });
        let parsed: AskUserArgs = serde_json::from_value(args).unwrap();
        assert_eq!(parsed.questions.len(), 3);
        assert_eq!(parsed.questions[0].qtype, "radio");
        assert_eq!(parsed.questions[0].options, vec!["Three", "Five"]);
        assert_eq!(parsed.questions[1].qtype, "check");
        assert!(parsed.questions[2].options.is_empty());
        assert_eq!(parsed.questions[2].qtype, "text");
    }

    #[test]
    fn ask_user_args_defaults_missing_fields() {
        // options is optional; missing questions field defaults to empty.
        let parsed: AskUserArgs = serde_json::from_value(json!({})).unwrap();
        assert!(parsed.questions.is_empty());
        let parsed: AskUserArgs =
            serde_json::from_value(json!({"questions": [{"type": "text", "question": "Budget?"}]}))
                .unwrap();
        assert_eq!(parsed.questions.len(), 1);
        assert!(parsed.questions[0].options.is_empty());
    }

    #[test]
    fn ask_user_tool_is_the_provider_tool_name() {
        // The reserved tool must resolve to the ask_user capability and be
        // excluded from plugin resolution — i.e. it is a first-class tool.
        assert_eq!(
            PluginManager::provider_tool_name(PluginManager::ASK_USER_CAPABILITY),
            PluginManager::provider_tool_name("weave.ask_user")
        );
    }
}
