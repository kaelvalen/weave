use serde::Serialize;
use std::sync::atomic::Ordering;
use tauri::{Emitter, State};
use tracing::{error, info};

use crate::agent::{AgentEvent, ApprovalDecision};
use crate::models::chat::ChatMessage;
use crate::utils::errors::WeaveError;
use crate::AppState;

#[derive(Debug, Clone, Serialize)]
struct StreamChunk {
    chunk: String,
    message_id: String,
    done: bool,
}

#[derive(Debug, Clone, Serialize)]
struct ToolCallDetected {
    call_id: String,
    message_id: String,
    plugin_id: String,
    capability: String,
    params: serde_json::Value,
    status: String,
    result: Option<serde_json::Value>,
}

#[tauri::command]
pub async fn chat_send_message(
    message: String,
    model: Option<String>,
    provider: Option<String>,
    ui_context: Option<String>,
    images: Option<Vec<String>>,
    app_handle: tauri::AppHandle,
    app_state: State<'_, AppState>,
) -> Result<String, WeaveError> {
    info!("Chat message received: {} (model: {:?})", message, model);

    // A previous Stop (chat_abort_generation) leaves the shared abort flag
    // set; it must be cleared for THIS generation or the agent loop and the
    // event-forwarding loop below both break immediately and the chat goes
    // permanently silent after the first interrupt.
    app_state.abort_generation.store(false, Ordering::SeqCst);

    let mut user_msg = ChatMessage::new_user(message.clone());
    user_msg.images = images.clone();
    let _msg_id = user_msg.id.clone();

    {
        let mut history = app_state.chat_history.write();
        history.push(user_msg);
    }

    let mut assistant_msg = ChatMessage::new_assistant(String::new());
    assistant_msg.metadata = Some(crate::models::chat::MessageMetadata {
        model: model.clone(),
        tokens_used: None,
        plugin_calls: Vec::new(),
        intent: None,
        is_hidden: None,
    });
    let assistant_id = assistant_msg.id.clone();

    {
        let mut history = app_state.chat_history.write();
        history.push(assistant_msg);
    }

    let model_config = {
        let ai_config = app_state.ai_bridge.config.read().clone();
        model.map(|m| {
            let provider = if let Some(ref prov) = provider {
                match prov.as_str() {
                    "anthropic" => crate::models::chat::Provider::Anthropic,
                    "kimi" => crate::models::chat::Provider::Kimi,
                    "opencode" => crate::models::chat::Provider::Opencode,
                    "local" => crate::models::chat::Provider::Local,
                    _ => crate::models::chat::Provider::Openai,
                }
            } else {
                if m.starts_with("claude") {
                    crate::models::chat::Provider::Anthropic
                } else if m.starts_with("kimi") {
                    crate::models::chat::Provider::Kimi
                } else if m.starts_with("opencode") {
                    crate::models::chat::Provider::Opencode
                } else if m.starts_with("llama") || m.starts_with("mistral") || m.ends_with(".gguf")
                {
                    crate::models::chat::Provider::Local
                } else {
                    crate::models::chat::Provider::Openai
                }
            };

            let (api_key, api_url, temperature, max_tokens) = match provider {
                crate::models::chat::Provider::Anthropic => (
                    Some(ai_config.anthropic.api_key.clone()),
                    ai_config.anthropic.api_url.clone(),
                    ai_config.anthropic.temperature,
                    ai_config.anthropic.max_tokens,
                ),
                crate::models::chat::Provider::Kimi => (
                    Some(ai_config.kimi.api_key.clone()),
                    ai_config.kimi.api_url.clone(),
                    ai_config.kimi.temperature,
                    ai_config.kimi.max_tokens,
                ),
                crate::models::chat::Provider::Opencode => (
                    Some(ai_config.opencode.api_key.clone()),
                    ai_config.opencode.api_url.clone(),
                    ai_config.opencode.temperature,
                    ai_config.opencode.max_tokens,
                ),
                crate::models::chat::Provider::Local => (
                    None,
                    ai_config.local.api_url.clone(),
                    ai_config.local.temperature,
                    0, // No token limit for local models
                ),
                crate::models::chat::Provider::Openai => (
                    Some(ai_config.openai.api_key.clone()),
                    ai_config.openai.api_url.clone(),
                    ai_config.openai.temperature,
                    ai_config.openai.max_tokens,
                ),
            };

            crate::models::chat::ModelConfig {
                provider,
                model: m,
                api_key,
                api_url,
                temperature,
                max_tokens,
            }
        })
    };

    let history: Vec<ChatMessage> = {
        let h = app_state.chat_history.read().clone();
        h.into_iter()
            .filter(|m| !m.content.trim().is_empty())
            .collect()
    };

    let mut system_prompt = app_state.plugin_manager.get_system_prompt();

    if let Some(ctx) = ui_context {
        system_prompt.push_str(&format!("\n\n[SYSTEM CONTEXT: The user is currently viewing the '{}' screen in the application. Tailor your context-aware suggestions accordingly.]", ctx));
    }

    let model_config = match model_config {
        Some(cfg) => cfg,
        None => {
            error!("No model configuration available");
            return Err(WeaveError::AiError("No model configured".to_string()));
        }
    };

    // ---- Agent loop (phase1-spine-spec.md §3) ----
    let (event_tx, mut event_rx) = tokio::sync::mpsc::channel(128);
    let agent_loop = app_state.agent_loop.clone();
    let history_for_loop = history.clone();
    let abort = app_state.abort_generation.clone();
    let loop_assistant_id = assistant_id.clone();

    let loop_handle = tauri::async_runtime::spawn(async move {
        agent_loop
            .run(
                model_config,
                system_prompt,
                history_for_loop,
                loop_assistant_id,
                "ipc_session",
                event_tx,
            )
            .await
    });

    while let Some(event) = event_rx.recv().await {
        if abort.load(Ordering::SeqCst) {
            break;
        }
        match event {
            AgentEvent::Text { text } => {
                let mut history = app_state.chat_history.write();
                if let Some(last) = history.last_mut() {
                    if last.id == assistant_id {
                        last.content.push_str(&text);
                    }
                }
                let _ = app_handle.emit(
                    "chat-stream-chunk",
                    StreamChunk {
                        chunk: text,
                        message_id: assistant_id.clone(),
                        done: false,
                    },
                );
            }
            AgentEvent::ToolCall {
                call_id,
                plugin_id,
                capability,
                params,
                status,
                result,
            } => {
                let _ = app_handle.emit(
                    "chat-tool-call-detected",
                    ToolCallDetected {
                        call_id,
                        message_id: assistant_id.clone(),
                        plugin_id,
                        capability,
                        params,
                        status,
                        result,
                    },
                );
            }
            AgentEvent::PendingApproval {
                call_id,
                plugin_id,
                capability,
                params,
            } => {
                let _ = app_handle.emit(
                    "chat-tool-call-detected",
                    ToolCallDetected {
                        call_id,
                        message_id: assistant_id.clone(),
                        plugin_id,
                        capability,
                        params,
                        status: "pending_approval".to_string(),
                        result: None,
                    },
                );
            }
            AgentEvent::RunComplete { final_text: _ } => {
                let _ = app_handle.emit(
                    "chat-stream-chunk",
                    StreamChunk {
                        chunk: String::new(),
                        message_id: assistant_id.clone(),
                        done: true,
                    },
                );
            }
            AgentEvent::RunError { error } => {
                error!("Agent run error: {}", error);
                let _ = app_handle.emit(
                    "chat-stream-chunk",
                    StreamChunk {
                        chunk: format!("Error: {}", error),
                        message_id: assistant_id.clone(),
                        done: true,
                    },
                );
            }
        }
    }

    match loop_handle.await {
        Ok(Ok(())) => {}
        Ok(Err(e)) => {
            error!("Agent loop error: {}", e);
            let _ = app_handle.emit(
                "chat-stream-chunk",
                StreamChunk {
                    chunk: format!("Error: {}", e),
                    message_id: assistant_id.clone(),
                    done: true,
                },
            );
        }
        Err(e) => {
            error!("Agent loop task panicked: {}", e);
            let _ = app_handle.emit(
                "chat-stream-chunk",
                StreamChunk {
                    chunk: "Error: agent loop panicked".to_string(),
                    message_id: assistant_id.clone(),
                    done: true,
                },
            );
        }
    }

    Ok(assistant_id)
}

/// Resolve a pending tool-call approval. The agent loop halts its turn on
/// sensitive/destructive calls and only continues once every pending call in
/// the turn has been resolved through this command (or rejected).
#[tauri::command]
pub fn chat_approve_tool_call(
    call_id: String,
    approved: bool,
    app_state: State<'_, AppState>,
) -> Result<(), WeaveError> {
    let decision = if approved {
        ApprovalDecision::Approved
    } else {
        ApprovalDecision::Rejected
    };
    info!(
        "Tool call {} approval decision: {}",
        call_id,
        if approved { "approved" } else { "rejected" }
    );
    app_state.approvals.resolve(&call_id, decision)
}

#[tauri::command]
pub fn chat_get_history(app_state: State<'_, AppState>) -> Result<Vec<ChatMessage>, WeaveError> {
    let history = app_state.chat_history.read().clone();
    Ok(history)
}

#[tauri::command]
pub fn chat_set_history(
    history: Vec<ChatMessage>,
    app_state: State<'_, AppState>,
) -> Result<(), WeaveError> {
    let mut state_history = app_state.chat_history.write();
    *state_history = history;
    Ok(())
}

#[tauri::command]
pub fn chat_clear_history(app_state: State<'_, AppState>) -> Result<(), WeaveError> {
    let mut history = app_state.chat_history.write();
    history.clear();
    info!("Chat history cleared");
    Ok(())
}

#[tauri::command]
pub fn chat_get_message(
    message_id: String,
    app_state: State<'_, AppState>,
) -> Result<Option<ChatMessage>, WeaveError> {
    let history = app_state.chat_history.read();
    let msg = history.iter().find(|m| m.id == message_id).cloned();
    Ok(msg)
}

#[tauri::command]
pub fn chat_abort_generation(app_state: State<'_, AppState>) -> Result<(), WeaveError> {
    app_state.abort_generation.store(true, Ordering::SeqCst);
    info!("Generation aborted by user");
    Ok(())
}
