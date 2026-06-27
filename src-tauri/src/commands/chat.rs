use tauri::{Emitter, State};
use tracing::{error, info};
use serde::Serialize;

use crate::models::chat::ChatMessage;
use crate::AppState;
use crate::utils::errors::WeaveError;

#[derive(Debug, Clone, Serialize)]
struct StreamChunk {
    chunk: String,
    message_id: String,
    done: bool,
}

#[tauri::command]
pub async fn chat_send_message(
    message: String,
    model: Option<String>,
    app_handle: tauri::AppHandle,
    app_state: State<'_, AppState>,
) -> Result<String, WeaveError> {
    info!("Chat message received: {} (model: {:?})", message, model);

    let user_msg = ChatMessage::new_user(message.clone());
    let _msg_id = user_msg.id.clone();
    
    {
        let mut history = app_state.chat_history.write();
        history.push(user_msg);
    }

    let intent = {
        let intent_engine = &app_state.intent_engine;
        intent_engine.recognize(&message)
    };

    let mut assistant_msg = ChatMessage::new_assistant(String::new());
    assistant_msg.metadata = Some(crate::models::chat::MessageMetadata {
        model: model.clone(),
        tokens_used: None,
        plugin_calls: Vec::new(),
        intent: intent.clone(),
    });
    let assistant_id = assistant_msg.id.clone();

    {
        let mut history = app_state.chat_history.write();
        history.push(assistant_msg);
    }

    if let Some(ref intent_result) = intent {
        if intent_result.confidence > 0.5 {
            for _plugin_id in &intent_result.plugins {
                for _cap in &intent_result.plugins {
                }
            }
        }
    }

    let model_config = {
        let ai_config = app_state.ai_bridge.config.read().clone();
        model.map(|m| {
            let provider = if m.starts_with("claude") {
                crate::models::chat::Provider::Anthropic
            } else if m.starts_with("kimi") {
                crate::models::chat::Provider::Kimi
            } else if m.starts_with("llama") || m.starts_with("mistral") {
                crate::models::chat::Provider::Local
            } else {
                crate::models::chat::Provider::Openai
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
                crate::models::chat::Provider::Local => (
                    None,
                    ai_config.local.api_url.clone(),
                    ai_config.local.temperature,
                    ai_config.local.context_length,
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

    let history = {
        app_state.chat_history.read().clone()
    };

    let stream_result = app_state.ai_bridge.chat_stream(history, model_config).await;
    
    match stream_result {
        Ok(mut rx) => {
            while let Some(chunk) = rx.recv().await {
                let mut history = app_state.chat_history.write();
                if let Some(last) = history.last_mut() {
                    if last.id == assistant_id {
                        last.content.push_str(&chunk);
                    }
                }
                let _ = app_handle.emit("chat-stream-chunk", StreamChunk {
                    chunk: chunk.clone(),
                    message_id: assistant_id.clone(),
                    done: false,
                });
            }
            // Signal stream end
            let _ = app_handle.emit("chat-stream-chunk", StreamChunk {
                chunk: String::new(),
                message_id: assistant_id.clone(),
                done: true,
            });
        }
        Err(e) => {
            error!("Streaming error: {}", e);
            let mut history = app_state.chat_history.write();
            if let Some(last) = history.last_mut() {
                if last.id == assistant_id {
                    last.content = format!("Error: {}", e);
                }
            }
            let _ = app_handle.emit("chat-stream-chunk", StreamChunk {
                chunk: format!("Error: {}", e),
                message_id: assistant_id.clone(),
                done: true,
            });
            return Err(e);
        }
    }

    Ok(assistant_id)
}

#[tauri::command]
pub fn chat_get_history(
    app_state: State<'_, AppState>,
) -> Result<Vec<ChatMessage>, WeaveError> {
    let history = app_state.chat_history.read().clone();
    Ok(history)
}

#[tauri::command]
pub fn chat_clear_history(
    app_state: State<'_, AppState>,
) -> Result<(), WeaveError> {
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
