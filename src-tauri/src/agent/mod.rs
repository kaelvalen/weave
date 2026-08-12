//! Backend agent loop (phase1-spine-spec.md §3).
//!
//! Owns the turn state end-to-end: sends requests with native tool
//! definitions, streams text + tool-call deltas to the frontend, resolves
//! tool calls against the plugin registry, runs the approval gate, executes
//! capabilities, and appends provider-native tool results so the loop can
//! continue automatically until a turn produces no further tool calls.
//!
//! The frontend only relays approval decisions via `chat_approve_tool_call`.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use parking_lot::RwLock;
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
    pub fn resolve(
        &self,
        call_id: &str,
        decision: ApprovalDecision,
    ) -> Result<(), WeaveError> {
        let tx = self
            .pending
            .lock()
            .remove(call_id)
            .ok_or_else(|| {
                WeaveError::PluginError(format!(
                    "No tool call awaiting approval for call_id '{}'",
                    call_id
                ))
            })?;
        tx.send(decision)
            .map_err(|_| WeaveError::PluginError(format!("Approval channel closed for '{}'", call_id)))
    }
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
    Text { text: String },
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
    RunComplete { final_text: String },
    RunError { error: String },
}

/// Maximum provider round-trips per `run` before the loop gives up (safety
/// net against model loops that never stop calling tools).
const MAX_ROUNDS: usize = 12;

pub struct AgentLoop {
    pub ai_bridge: Arc<AiBridge>,
    pub plugin_manager: Arc<PluginManager>,
    pub approvals: Arc<ApprovalRegistry>,
    pub config: Arc<RwLock<AppConfig>>,
    pub chat_history: Arc<RwLock<Vec<ChatMessage>>>,
    pub abort: Arc<AtomicBool>,
    pub event_bus: Arc<EventBus>,
    pub observability: Arc<Observability>,
    pub event_store: Arc<EventSourcingStore>,
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

        for _round in 0..MAX_ROUNDS {
            if self.abort.load(Ordering::SeqCst) {
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

            while let Some(event) = rx.recv().await {
                if self.abort.load(Ordering::SeqCst) {
                    break;
                }
                match event {
                    AgentStreamEvent::Text(text) => {
                        round_text.push_str(&text);
                        let _ = event_tx
                            .send(AgentEvent::Text { text })
                            .await;
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
            let calls: Vec<AgentToolCall> = pending
                .into_iter()
                .map(|p| {
                    let name = p.name;
                    let capability = self
                        .plugin_manager
                        .resolve_provider_tool_name(&name)
                        .unwrap_or_else(|| name.clone());
                    AgentToolCall {
                        call_id: if p.call_id.is_empty() {
                            format!("call_{}", p.index)
                        } else {
                            p.call_id
                        },
                        name,
                        capability,
                        args: serde_json::from_str(&p.fragments)
                            .unwrap_or_else(|_| json!({})),
                    }
                })
                .collect();

            let mut outcomes: Vec<CallOutcome> = Vec::with_capacity(calls.len());

            for call in &calls {
                let plugin_id = match self.plugin_manager.resolve_capability(&call.capability) {
                    Some(id) => id,
                    None => {
                        warn!("No plugin provides capability: {}", call.capability);
                        let outcome = CallOutcome::Error(format!(
                            "No plugin provides capability '{}'",
                            call.capability
                        ));
                        self.record_call(
                            &assistant_id,
                            call,
                            "unknown".to_string(),
                            &outcome,
                        );
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

                    info!("Awaiting approval for {} ({})", call.capability, call.call_id);
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
                            self.execute_call(plugin_id.clone(), call, &session_id)
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
                    let outcome = self.execute_call(plugin_id.clone(), call, &session_id);
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

            let _ = event_tx.send(AgentEvent::Text { text: "\n".to_string() }).await;
        }

        let _ = event_tx
            .send(AgentEvent::RunComplete {
                final_text: final_text.clone(),
            })
            .await;
        Ok(())
    }

    fn execute_call(
        &self,
        plugin_id: String,
        call: &AgentToolCall,
        session_id: &str,
    ) -> CallOutcome {
        let ctx = self.create_execution_context(session_id);
        match self
            .plugin_manager
            .execute_capability(&plugin_id, &call.capability, call.args.clone(), &ctx)
        {
            Ok(result) => CallOutcome::Success(result),
            Err(e) => {
                warn!("Tool call {} ({}) failed: {}", call.call_id, call.capability, e);
                CallOutcome::Error(e.to_string())
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
