use parking_lot::{Mutex, RwLock};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::info;

use crate::models::chat::{ChatMessage, ChatRole, ModelConfig, Provider};
use crate::utils::config::AiConfig;
use crate::utils::errors::WeaveError;
use runtime_kernel::observability::Observability;

/// Rolling model-usage telemetry collected from streaming responses.
#[derive(Debug, Clone, Default)]
pub struct ModelTelemetry {
    /// Name of the model used by the most recent stream.
    pub last_model: Option<String>,
    /// Tokens/second of the most recent stream (local provider only).
    pub last_tps: Option<f64>,
    /// Running mean of tokens/second across all measured streams.
    pub avg_tps: Option<f64>,
    tps_samples: u64,
}

impl ModelTelemetry {
    pub fn record_tps(&mut self, tps: f64) {
        if !tps.is_finite() || tps <= 0.0 {
            return;
        }
        self.tps_samples += 1;
        self.last_tps = Some(tps);
        self.avg_tps = Some(match self.avg_tps {
            Some(avg) => avg + (tps - avg) / self.tps_samples as f64,
            None => tps,
        });
    }
}

pub struct AiBridge {
    client: reqwest::Client,
    pub config: Arc<RwLock<AiConfig>>,
    observability: Arc<Observability>,
    telemetry: Arc<Mutex<ModelTelemetry>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OpenAiRequest {
    model: String,
    messages: Vec<OpenAiMessage>,
    temperature: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    frequency_penalty: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    presence_penalty: Option<f64>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<OpenAiTool>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OpenAiTool {
    #[serde(rename = "type")]
    tool_type: String,
    function: OpenAiFunction,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OpenAiFunction {
    name: String,
    description: String,
    parameters: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub(crate) struct OpenAiMessage {
    role: String,
    content: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_calls: Option<Vec<serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_call_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct OpenAiStreamResponse {
    choices: Vec<OpenAiStreamChoice>,
    #[serde(default)]
    usage: Option<OpenAiUsage>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct OpenAiUsage {
    prompt_tokens: Option<u64>,
    completion_tokens: Option<u64>,
    total_tokens: Option<u64>,
}

impl OpenAiUsage {
    fn total(&self) -> u64 {
        self.total_tokens.unwrap_or_else(|| {
            self.prompt_tokens.unwrap_or(0) + self.completion_tokens.unwrap_or(0)
        })
    }
}

#[derive(Debug, Clone, Deserialize)]
struct OpenAiStreamChoice {
    delta: OpenAiDelta,
    #[serde(default)]
    finish_reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct OpenAiDelta {
    content: Option<String>,
    /// Reasoning/thinking tokens (DeepSeek-R1/V4, Qwen3, Kimi K2 — emitted
    /// before `content`; OpenAI ignores the field for non-reasoning models).
    #[serde(default)]
    reasoning_content: Option<String>,
    #[serde(default)]
    tool_calls: Option<Vec<OpenAiToolCallDelta>>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct OpenAiToolCallDelta {
    index: usize,
    id: Option<String>,
    function: Option<OpenAiFunctionDelta>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct OpenAiFunctionDelta {
    name: Option<String>,
    arguments: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AnthropicRequest {
    model: String,
    messages: Vec<AnthropicMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    temperature: f64,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<AnthropicTool>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AnthropicTool {
    name: String,
    description: String,
    input_schema: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct AnthropicMessage {
    role: String,
    content: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
struct AnthropicStreamResponse {
    #[serde(rename = "type")]
    response_type: String,
    /// content block index — present on `content_block_start` /
    /// `content_block_delta` / `content_block_stop` events.
    index: Option<usize>,
    delta: Option<AnthropicDelta>,
    content_block: Option<AnthropicContentBlock>,
    #[serde(default)]
    usage: Option<AnthropicUsage>,
    #[serde(default)]
    message: Option<AnthropicMessageUsage>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct AnthropicUsage {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
struct AnthropicMessageUsage {
    usage: Option<AnthropicUsage>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct AnthropicDelta {
    #[serde(rename = "type")]
    delta_type: Option<String>,
    text: Option<String>,
    /// Fragments of the tool input JSON, accumulated across
    /// `input_json_delta` events.
    partial_json: Option<String>,
    /// Present on `message_delta` events (`stop_reason: "tool_use"`).
    stop_reason: Option<String>,
    /// Thinking-token fragments (`thinking_delta` events) from extended
    /// thinking models.
    thinking: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct AnthropicContentBlock {
    #[serde(rename = "type")]
    block_type: Option<String>,
    id: Option<String>,
    name: Option<String>,
    input: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OllamaRequest {
    model: String,
    messages: Vec<OllamaMessage>,
    stream: bool,
    options: OllamaOptions,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct OllamaMessage {
    role: String,
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_calls: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OllamaOptions {
    temperature: f64,
}

#[derive(Debug, Clone, Deserialize)]
struct OllamaStreamResponse {
    message: OllamaResponseMessage,
    done: bool,
    #[serde(default)]
    prompt_eval_count: Option<u64>,
    #[serde(default)]
    eval_count: Option<u64>,
    #[serde(default)]
    eval_duration: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct OllamaResponseMessage {
    content: Option<String>,
    /// Thinking/reasoning tokens (qwen3, deepseek-r1, etc. — Ollama exposes
    /// them separately from `content` on the message).
    #[serde(default)]
    reasoning_content: Option<String>,
    #[serde(default)]
    tool_calls: Option<Vec<OllamaToolCall>>,
}

#[derive(Debug, Clone, Deserialize)]
struct OllamaToolCall {
    function: OllamaToolCallFunction,
}

#[derive(Debug, Clone, Deserialize)]
struct OllamaToolCallFunction {
    name: String,
    arguments: serde_json::Value,
}

/// Streamed events from a provider request, carrying both free text and
/// native tool-call deltas. Consumed by the agent loop (agent/mod.rs) and by
/// the text-only `chat_stream` wrapper (which ignores tool events).
#[derive(Debug, Clone)]
pub enum AgentStreamEvent {
    /// A piece of assistant text.
    Text(String),
    /// A piece of the model's reasoning/thinking (streamed before content
    /// for reasoning families — DeepSeek, Qwen3, Kimi, thinking-enabled
    /// Claude). Rendered as an expandable "thinking" trace, never as
    /// assistant output.
    Reasoning(String),
    /// A tool-call delta: `index` identifies the call (accumulate fragments
    /// by index; `id`/`name` arrive on the first delta), `args_fragment` is
    /// an incremental JSON string to be concatenated.
    ToolCall {
        index: usize,
        id: Option<String>,
        name: Option<String>,
        args_fragment: String,
    },
    /// Stream ended. `tool_calls` is true when the provider signalled tool
    /// calls (finish_reason "tool_calls" / stop_reason "tool_use" / Ollama
    /// final chunk carried tool_calls).
    Finish { tool_calls: bool },
}

impl AiBridge {
    pub fn new(
        config: Arc<RwLock<AiConfig>>,
        observability: Arc<Observability>,
        telemetry: Arc<Mutex<ModelTelemetry>>,
    ) -> Self {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .unwrap_or_default();

        Self {
            client,
            config,
            observability,
            telemetry,
        }
    }

    pub async fn chat(
        &self,
        messages: Vec<ChatMessage>,
        model_config: Option<ModelConfig>,
        system_prompt: String,
    ) -> Result<String, WeaveError> {
        let config = self.config.read();
        let provider_config = model_config
            .as_ref()
            .map(|mc| {
                (
                    mc.provider.clone(),
                    mc.model.clone(),
                    mc.api_key.clone(),
                    mc.api_url.clone(),
                    mc.temperature,
                    mc.max_tokens,
                )
            })
            .unwrap_or_else(|| {
                let (provider, model, api_key, api_url, temperature, max_tokens) = match config
                    .default_provider
                {
                    Provider::Openai => (
                        Provider::Openai,
                        config.openai.model.clone(),
                        Some(config.openai.api_key.clone()),
                        config.openai.api_url.clone(),
                        config.openai.temperature,
                        config.openai.max_tokens,
                    ),
                    Provider::Anthropic => (
                        Provider::Anthropic,
                        config.anthropic.model.clone(),
                        Some(config.anthropic.api_key.clone()),
                        config.anthropic.api_url.clone(),
                        config.anthropic.temperature,
                        config.anthropic.max_tokens,
                    ),
                    Provider::Kimi => (
                        Provider::Kimi,
                        config.kimi.model.clone(),
                        Some(config.kimi.api_key.clone()),
                        config.kimi.api_url.clone(),
                        config.kimi.temperature,
                        config.kimi.max_tokens,
                    ),
                    Provider::Opencode => (
                        Provider::Opencode,
                        config.opencode.model.clone(),
                        Some(config.opencode.api_key.clone()),
                        config.opencode.api_url.clone(),
                        config.opencode.temperature,
                        config.opencode.max_tokens,
                    ),
                    Provider::Local => (
                        Provider::Local,
                        config.local.model_alias.clone(),
                        None,
                        config.local.api_url.clone(),
                        config.local.temperature,
                        4096,
                    ),
                    Provider::LlamaSwap => (
                        Provider::LlamaSwap,
                        // First model in the router catalog (authoritative
                        // id source); empty catalog = the router has never
                        // started, so fall back to a known-good id.
                        crate::commands::llama_swap::list_models()
                            .ok()
                            .and_then(|m| m.into_iter().next())
                            .unwrap_or_else(|| "deepseek-v4-pro-qwen3.5-9b-mtp-q4_k_m".to_string()),
                        None,
                        Some(crate::commands::llama_swap::LLAMA_SWAP_BASE_URL.to_string()),
                        config.local.temperature,
                        0,
                    ),
                };
                (provider, model, api_key, api_url, temperature, max_tokens)
            });

        let (provider, model, api_key, api_url, temperature, max_tokens) = provider_config;

        let system_msg = ChatMessage {
            id: "sys_tools".to_string(),
            role: ChatRole::System,
            content: system_prompt.clone(),
            timestamp: 0,
            metadata: None,
            images: None,
        };
        let mut enhanced_messages = vec![system_msg];
        enhanced_messages.extend(messages);

        let result = match provider {
            Provider::Openai => {
                self.chat_openai(
                    enhanced_messages,
                    &model,
                    api_key,
                    api_url.as_deref(),
                    temperature,
                    max_tokens,
                )
                .await
            }
            Provider::Anthropic => {
                self.chat_anthropic(
                    enhanced_messages,
                    &model,
                    api_key,
                    api_url.as_deref(),
                    temperature,
                    max_tokens,
                )
                .await
            }
            Provider::Kimi => {
                self.chat_kimi(
                    enhanced_messages,
                    &model,
                    api_key,
                    api_url.as_deref(),
                    temperature,
                    max_tokens,
                )
                .await
            }
            Provider::Opencode => {
                let mut url = api_url.unwrap_or_else(|| {
                    "https://opencode.ai/zen/go/v1/chat/completions".to_string()
                });
                if url == "https://api.opencode.ai/v1"
                    || url == "https://api.opencode.ai/v1/chat/completions"
                    || url == "https://opencode.ai/go/v1"
                    || url == "https://opencode.ai/go/v1/chat/completions"
                {
                    url = "https://opencode.ai/zen/go/v1/chat/completions".to_string();
                } else if !url.ends_with("/chat/completions") {
                    url = format!("{}/chat/completions", url.trim_end_matches('/'));
                }
                let actual_model = model
                    .strip_prefix("opencode-go/")
                    .or_else(|| model.strip_prefix("opencode-zen/"))
                    .or_else(|| model.strip_prefix("opencode/"))
                    .or_else(|| model.strip_prefix("zen/"))
                    .unwrap_or(&model);
                self.chat_openai(
                    enhanced_messages,
                    actual_model,
                    api_key,
                    Some(&url),
                    temperature,
                    max_tokens,
                )
                .await
            }
            Provider::Local => {
                self.chat_local(enhanced_messages, &model, api_url.as_deref(), temperature)
                    .await
            }
            Provider::LlamaSwap => {
                self.chat_openai(
                    enhanced_messages,
                    &model,
                    None,
                    Some(crate::commands::llama_swap::LLAMA_SWAP_CHAT_URL),
                    temperature,
                    max_tokens,
                )
                .await
            }
        };

        drop(config);
        result
    }

    /// Text-only streaming, kept for callers that do not need tool calls.
    /// Builds provider-native messages from the ChatMessage history and
    /// forwards only `AgentStreamEvent::Text` chunks.
    pub async fn chat_stream(
        &self,
        messages: Vec<ChatMessage>,
        model_config: Option<ModelConfig>,
        system_prompt: String,
    ) -> Result<tokio::sync::mpsc::Receiver<String>, WeaveError> {
        let (tx, rx) = tokio::sync::mpsc::channel(100);
        let config = self.config.read().clone();

        let provider_config = model_config
            .as_ref()
            .map(|mc| {
                (
                    mc.provider.clone(),
                    mc.model.clone(),
                    mc.api_key.clone(),
                    mc.api_url.clone(),
                    mc.temperature,
                    mc.max_tokens,
                )
            })
            .unwrap_or_else(|| {
                let (provider, model, api_key, api_url, temperature, max_tokens) = match config
                    .default_provider
                {
                    Provider::Openai => (
                        Provider::Openai,
                        config.openai.model.clone(),
                        Some(config.openai.api_key.clone()),
                        config.openai.api_url.clone(),
                        config.openai.temperature,
                        config.openai.max_tokens,
                    ),
                    Provider::Anthropic => (
                        Provider::Anthropic,
                        config.anthropic.model.clone(),
                        Some(config.anthropic.api_key.clone()),
                        config.anthropic.api_url.clone(),
                        config.anthropic.temperature,
                        config.anthropic.max_tokens,
                    ),
                    Provider::Kimi => (
                        Provider::Kimi,
                        config.kimi.model.clone(),
                        Some(config.kimi.api_key.clone()),
                        config.kimi.api_url.clone(),
                        config.kimi.temperature,
                        config.kimi.max_tokens,
                    ),
                    Provider::Opencode => (
                        Provider::Opencode,
                        config.opencode.model.clone(),
                        Some(config.opencode.api_key.clone()),
                        config.opencode.api_url.clone(),
                        config.opencode.temperature,
                        config.opencode.max_tokens,
                    ),
                    Provider::Local => (
                        Provider::Local,
                        config.local.model_alias.clone(),
                        None,
                        config.local.api_url.clone(),
                        config.local.temperature,
                        0, // No token limit for local models
                    ),
                    Provider::LlamaSwap => (
                        Provider::LlamaSwap,
                        // First model in the router catalog (authoritative
                        // id source); empty catalog = the router has never
                        // started, so fall back to a known-good id.
                        crate::commands::llama_swap::list_models()
                            .ok()
                            .and_then(|m| m.into_iter().next())
                            .unwrap_or_else(|| "deepseek-v4-pro-qwen3.5-9b-mtp-q4_k_m".to_string()),
                        None,
                        Some(crate::commands::llama_swap::LLAMA_SWAP_BASE_URL.to_string()),
                        config.local.temperature,
                        0,
                    ),
                };
                (provider, model, api_key, api_url, temperature, max_tokens)
            });

        let (provider, model, api_key, api_url, temperature, max_tokens) = provider_config;

        let system_msg = ChatMessage {
            id: "sys_tools".to_string(),
            role: ChatRole::System,
            content: system_prompt,
            timestamp: 0,
            metadata: None,
            images: None,
        };
        let mut enhanced_messages = vec![system_msg];
        enhanced_messages.extend(messages);

        let native =
            Self::build_native_messages(&provider, &model, api_url.as_deref(), enhanced_messages);
        let mut events = self
            .agent_stream(
                provider,
                model,
                api_key,
                api_url,
                temperature,
                max_tokens,
                native,
                None,
            )
            .await?;

        tokio::spawn(async move {
            while let Some(event) = events.recv().await {
                if let AgentStreamEvent::Text(text) = event {
                    if tx.send(text).await.is_err() {
                        break;
                    }
                }
            }
        });

        Ok(rx)
    }

    /// Stream a request with (optional) native tool definitions, emitting
    /// structured events. `native_messages` must be provider-native
    /// (built via `build_native_messages`; subsequent rounds append native
    /// tool results produced by the agent loop).
    ///
    /// Phase-2 spine entry point (phase1-spine-spec.md §2/§3).
    pub async fn agent_stream(
        &self,
        provider: Provider,
        model: String,
        api_key: Option<String>,
        api_url: Option<String>,
        temperature: f64,
        max_tokens: u32,
        native_messages: Vec<serde_json::Value>,
        tools: Option<Vec<serde_json::Value>>,
    ) -> Result<tokio::sync::mpsc::Receiver<AgentStreamEvent>, WeaveError> {
        let (tx, rx) = tokio::sync::mpsc::channel(100);
        let client = self.client.clone();
        let observability = self.observability.clone();
        let telemetry = self.telemetry.clone();

        tokio::spawn(async move {
            let result = match provider {
                Provider::Openai | Provider::Kimi => {
                    Self::stream_openai_agent(
                        client,
                        native_messages,
                        &model,
                        api_key,
                        api_url.as_deref(),
                        temperature,
                        max_tokens,
                        tools,
                        tx.clone(),
                        observability.clone(),
                    )
                    .await
                }
                Provider::LlamaSwap => {
                    // The router may be down (no autostart); bring it up before
                    // the request so the error is actionable if it fails.
                    if let Err(e) = crate::commands::llama_swap::ensure_ready().await {
                        let _ = tx
                            .send(AgentStreamEvent::Text(format!("\n[Stream Error: {}]", e)))
                            .await;
                        return;
                    }
                    Self::stream_openai_agent(
                        client,
                        native_messages,
                        &model,
                        None,
                        Some(crate::commands::llama_swap::LLAMA_SWAP_CHAT_URL),
                        temperature,
                        max_tokens,
                        tools,
                        tx.clone(),
                        observability.clone(),
                    )
                    .await
                }
                Provider::Opencode => {
                    let mut url = api_url
                        .clone()
                        .unwrap_or("https://opencode.ai/zen/go/v1/chat/completions".to_string());
                    if url == "https://api.opencode.ai/v1"
                        || url == "https://api.opencode.ai/v1/chat/completions"
                        || url == "https://opencode.ai/go/v1"
                        || url == "https://opencode.ai/go/v1/chat/completions"
                    {
                        url = "https://opencode.ai/zen/go/v1/chat/completions".to_string();
                    } else if !url.ends_with("/chat/completions") {
                        url = format!("{}/chat/completions", url.trim_end_matches('/'));
                    }
                    let actual_model = model
                        .strip_prefix("opencode-go/")
                        .or_else(|| model.strip_prefix("opencode-zen/"))
                        .or_else(|| model.strip_prefix("opencode/"))
                        .or_else(|| model.strip_prefix("zen/"))
                        .unwrap_or(&model)
                        .to_string();
                    Self::stream_openai_agent(
                        client,
                        native_messages,
                        &actual_model,
                        api_key,
                        Some(&url),
                        temperature,
                        max_tokens,
                        tools,
                        tx.clone(),
                        observability.clone(),
                    )
                    .await
                }
                Provider::Anthropic => {
                    Self::stream_anthropic_agent(
                        client,
                        native_messages,
                        &model,
                        api_key,
                        api_url.as_deref(),
                        temperature,
                        max_tokens,
                        tools,
                        tx.clone(),
                        observability.clone(),
                    )
                    .await
                }
                Provider::Local => {
                    Self::stream_local_agent(
                        client,
                        native_messages,
                        &model,
                        api_url.as_deref(),
                        temperature,
                        tools,
                        tx.clone(),
                        observability.clone(),
                        telemetry.clone(),
                    )
                    .await
                }
            };

            telemetry.lock().last_model = Some(model);

            if let Err(e) = result {
                let _ = tx
                    .send(AgentStreamEvent::Text(format!("\n[Stream Error: {}]", e)))
                    .await;
            }
        });

        Ok(rx)
    }

    async fn chat_openai(
        &self,
        messages: Vec<ChatMessage>,
        model: &str,
        api_key: Option<String>,
        api_url: Option<&str>,
        temperature: f64,
        max_tokens: u32,
    ) -> Result<String, WeaveError> {
        let api_key =
            api_key.ok_or_else(|| WeaveError::ApiKeyNotConfigured("OpenAI".to_string()))?;
        if api_key.is_empty() {
            return Err(WeaveError::ApiKeyNotConfigured("OpenAI".to_string()));
        }

        let url = api_url.unwrap_or("https://api.openai.com/v1/chat/completions");
        let openai_messages = Self::build_openai_messages(&messages, model, api_url);

        let request = OpenAiRequest {
            model: model.to_string(),
            messages: openai_messages,
            temperature,
            max_tokens: if max_tokens == 0 {
                None
            } else {
                Some(max_tokens)
            },
            frequency_penalty: Some(0.3),
            presence_penalty: Some(0.3),
            stream: false,
            tools: None,
        };

        let response = self
            .client
            .post(url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(WeaveError::AiApiError(format!(
                "OpenAI API error: {}",
                error_text
            )));
        }

        let response_json: serde_json::Value = response.json().await?;
        self.record_openai_style_usage(&response_json);
        let content = response_json["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("")
            .to_string();

        Ok(content)
    }

    async fn chat_anthropic(
        &self,
        messages: Vec<ChatMessage>,
        model: &str,
        api_key: Option<String>,
        api_url: Option<&str>,
        temperature: f64,
        max_tokens: u32,
    ) -> Result<String, WeaveError> {
        let api_key =
            api_key.ok_or_else(|| WeaveError::ApiKeyNotConfigured("Anthropic".to_string()))?;
        if api_key.is_empty() {
            return Err(WeaveError::ApiKeyNotConfigured("Anthropic".to_string()));
        }

        let url = api_url.unwrap_or("https://api.anthropic.com/v1/messages");
        let anthropic_messages: Vec<AnthropicMessage> = messages
            .iter()
            .map(|m| {
                let content = if let Some(images) = &m.images {
                    let mut content_arr = vec![serde_json::json!({
                        "type": "text",
                        "text": m.content
                    })];
                    for img in images {
                        let parts: Vec<&str> = img.split(',').collect();
                        if parts.len() == 2 {
                            let meta = parts[0];
                            let data = parts[1];
                            let mime_type = meta.replace("data:", "").replace(";base64", "");
                            content_arr.push(serde_json::json!({
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": mime_type,
                                    "data": data
                                }
                            }));
                        }
                    }
                    serde_json::Value::Array(content_arr)
                } else {
                    serde_json::Value::String(m.content.clone())
                };

                AnthropicMessage {
                    role: match m.role {
                        ChatRole::User => "user".to_string(),
                        ChatRole::Assistant => "assistant".to_string(),
                        ChatRole::System => "user".to_string(),
                    },
                    content,
                }
            })
            .collect();

        let request = AnthropicRequest {
            model: model.to_string(),
            messages: anthropic_messages,
            max_tokens: if max_tokens == 0 {
                Some(8192)
            } else {
                Some(max_tokens)
            },
            temperature,
            stream: false,
            tools: None,
        };

        let response = self
            .client
            .post(url)
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(WeaveError::AiApiError(format!(
                "Anthropic API error: {}",
                error_text
            )));
        }

        let response_json: serde_json::Value = response.json().await?;
        let usage = &response_json["usage"];
        let total_tokens = usage["input_tokens"].as_u64().unwrap_or(0)
            + usage["output_tokens"].as_u64().unwrap_or(0);
        if total_tokens > 0 {
            self.observability.record_tokens(total_tokens);
        }
        let content = response_json["content"][0]["text"]
            .as_str()
            .unwrap_or("")
            .to_string();

        Ok(content)
    }

    async fn chat_local(
        &self,
        messages: Vec<ChatMessage>,
        model: &str,
        api_url: Option<&str>,
        temperature: f64,
    ) -> Result<String, WeaveError> {
        let url = api_url.unwrap_or("http://localhost:11434/api/chat");

        let ollama_messages: Vec<OllamaMessage> = messages
            .iter()
            .map(|m| OllamaMessage {
                role: match m.role {
                    ChatRole::User => "user".to_string(),
                    ChatRole::Assistant => "assistant".to_string(),
                    ChatRole::System => "system".to_string(),
                },
                content: m.content.clone(),
                tool_calls: None,
            })
            .collect();

        let request = OllamaRequest {
            model: model.to_string(),
            messages: ollama_messages,
            stream: false,
            options: OllamaOptions { temperature },
            tools: None,
        };

        let response = self
            .client
            .post(url)
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(WeaveError::LocalLlmNotAvailable(error_text));
        }

        let response_json: serde_json::Value = response.json().await?;
        let total_tokens = response_json["prompt_eval_count"].as_u64().unwrap_or(0)
            + response_json["eval_count"].as_u64().unwrap_or(0);
        if total_tokens > 0 {
            self.observability.record_tokens(total_tokens);
        }
        let content = response_json["message"]["content"]
            .as_str()
            .unwrap_or("")
            .to_string();

        Ok(content)
    }

    async fn chat_kimi(
        &self,
        messages: Vec<ChatMessage>,
        model: &str,
        api_key: Option<String>,
        api_url: Option<&str>,
        temperature: f64,
        max_tokens: u32,
    ) -> Result<String, WeaveError> {
        let api_key = api_key.ok_or_else(|| WeaveError::ApiKeyNotConfigured("Kimi".to_string()))?;
        if api_key.is_empty() {
            return Err(WeaveError::ApiKeyNotConfigured("Kimi".to_string()));
        }

        let mut url = api_url
            .unwrap_or("https://api.moonshot.cn/v1/chat/completions")
            .to_string();
        if !url.ends_with("/chat/completions") {
            url = format!("{}/chat/completions", url.trim_end_matches('/'));
        }
        let kimi_messages: Vec<OpenAiMessage> = messages
            .iter()
            .map(|m| {
                let content = if let Some(images) = &m.images {
                    let mut content_arr = vec![serde_json::json!({
                        "type": "text",
                        "text": m.content
                    })];
                    for img in images {
                        content_arr.push(serde_json::json!({
                            "type": "image_url",
                            "image_url": {
                                "url": img
                            }
                        }));
                    }
                    serde_json::Value::Array(content_arr)
                } else {
                    serde_json::Value::String(m.content.clone())
                };

                OpenAiMessage {
                    role: match m.role {
                        ChatRole::User => "user".to_string(),
                        ChatRole::Assistant => "assistant".to_string(),
                        ChatRole::System => "system".to_string(),
                    },
                    content,
                    tool_calls: None,
                    tool_call_id: None,
                }
            })
            .collect();

        let request = OpenAiRequest {
            model: model.to_string(),
            messages: kimi_messages,
            temperature,
            max_tokens: if max_tokens == 0 {
                None
            } else {
                Some(max_tokens)
            },
            frequency_penalty: None,
            presence_penalty: None,
            stream: false,
            tools: None,
        };

        let response = self
            .client
            .post(url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(WeaveError::AiApiError(format!(
                "Kimi API error: {}",
                error_text
            )));
        }

        let response_json: serde_json::Value = response.json().await?;
        self.record_openai_style_usage(&response_json);
        let content = response_json["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("")
            .to_string();

        Ok(content)
    }

    /// Best-effort token accounting from an OpenAI-style response body.
    fn record_openai_style_usage(&self, response_json: &serde_json::Value) {
        let usage = &response_json["usage"];
        let total = usage["total_tokens"].as_u64().unwrap_or_else(|| {
            usage["prompt_tokens"].as_u64().unwrap_or(0)
                + usage["completion_tokens"].as_u64().unwrap_or(0)
        });
        if total > 0 {
            self.observability.record_tokens(total);
        }
    }

    fn prune_chat_messages(messages: &[ChatMessage], max_tokens: usize) -> Vec<ChatMessage> {
        if messages.is_empty() {
            return Vec::new();
        }

        let system_msgs: Vec<ChatMessage> = messages
            .iter()
            .filter(|m| m.role == ChatRole::System)
            .cloned()
            .collect();
        let non_system: Vec<ChatMessage> = messages
            .iter()
            .filter(|m| m.role != ChatRole::System)
            .cloned()
            .collect();

        let sys_tokens: usize = system_msgs.iter().map(|m| m.content.len() / 3).sum();
        let budget = if max_tokens > sys_tokens {
            max_tokens - sys_tokens
        } else {
            3000
        };

        let mut kept_non_system: Vec<ChatMessage> = Vec::new();
        let mut current_tokens = 0;

        for m in non_system.into_iter().rev() {
            let m_tokens = m.content.len() / 3 + 20;
            if current_tokens + m_tokens > budget && !kept_non_system.is_empty() {
                break;
            }
            current_tokens += m_tokens;
            kept_non_system.push(m);
        }

        kept_non_system.reverse();
        let mut result = system_msgs;
        result.extend(kept_non_system);
        result
    }

    pub(crate) fn build_openai_messages(
        messages: &[ChatMessage],
        model: &str,
        api_url: Option<&str>,
    ) -> Vec<OpenAiMessage> {
        let model_lower = model.to_lowercase();
        let is_gemma = model_lower.contains("gemma");
        let is_local = model_lower.contains(".gguf")
            || api_url
                .map(|u| {
                    u.contains("8080")
                        || u.contains("11434")
                        || u.contains("localhost")
                        || u.contains("127.0.0.1")
                })
                .unwrap_or(false);

        let max_budget = if is_local { 18000 } else { 100000 };
        let pruned_input = Self::prune_chat_messages(messages, max_budget);

        if is_gemma || is_local {
            let mut sys_text = String::new();
            let mut filtered: Vec<ChatMessage> = Vec::new();

            for m in &pruned_input {
                if m.content.trim().is_empty() {
                    continue;
                }
                if m.role == ChatRole::System {
                    if !sys_text.is_empty() {
                        sys_text.push_str("\n\n");
                    }
                    sys_text.push_str(&m.content);
                } else {
                    filtered.push(m.clone());
                }
            }

            if !sys_text.is_empty() {
                if let Some(first_user) = filtered.iter_mut().find(|m| m.role == ChatRole::User) {
                    first_user.content = format!(
                        "[System Instructions]\n{}\n\n{}",
                        sys_text, first_user.content
                    );
                } else {
                    filtered.insert(
                        0,
                        ChatMessage {
                            id: "sys_as_user".to_string(),
                            role: ChatRole::User,
                            content: format!("[System Instructions]\n{}", sys_text),
                            timestamp: 0,
                            metadata: None,
                            images: None,
                        },
                    );
                }
            }

            return filtered
                .into_iter()
                .map(|m| {
                    let content = if let Some(images) = &m.images {
                        let mut content_arr = vec![serde_json::json!({
                            "type": "text",
                            "text": m.content
                        })];
                        for img in images {
                            content_arr.push(serde_json::json!({
                                "type": "image_url",
                                "image_url": { "url": img }
                            }));
                        }
                        serde_json::Value::Array(content_arr)
                    } else {
                        serde_json::Value::String(m.content.clone())
                    };

                    OpenAiMessage {
                        role: match m.role {
                            ChatRole::User => "user".to_string(),
                            ChatRole::Assistant => "assistant".to_string(),
                            ChatRole::System => "user".to_string(),
                        },
                        content,
                        tool_calls: None,
                        tool_call_id: None,
                    }
                })
                .collect();
        }

        messages
            .iter()
            .filter(|m| !m.content.trim().is_empty())
            .map(|m| {
                let content = if let Some(images) = &m.images {
                    let mut content_arr = vec![serde_json::json!({
                        "type": "text",
                        "text": m.content
                    })];
                    for img in images {
                        content_arr.push(serde_json::json!({
                            "type": "image_url",
                            "image_url": { "url": img }
                        }));
                    }
                    serde_json::Value::Array(content_arr)
                } else {
                    serde_json::Value::String(m.content.clone())
                };

                OpenAiMessage {
                    role: match m.role {
                        ChatRole::User => "user".to_string(),
                        ChatRole::Assistant => "assistant".to_string(),
                        ChatRole::System => "system".to_string(),
                    },
                    content,
                    tool_calls: None,
                    tool_call_id: None,
                }
            })
            .collect()
    }

    pub(crate) fn build_anthropic_messages(messages: &[ChatMessage]) -> Vec<serde_json::Value> {
        messages
            .iter()
            .map(|m| {
                let content = if let Some(images) = &m.images {
                    let mut content_arr = vec![serde_json::json!({
                        "type": "text",
                        "text": m.content
                    })];
                    for img in images {
                        let parts: Vec<&str> = img.split(',').collect();
                        if parts.len() == 2 {
                            let meta = parts[0];
                            let data = parts[1];
                            let mime_type = meta.replace("data:", "").replace(";base64", "");
                            content_arr.push(serde_json::json!({
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": mime_type,
                                    "data": data
                                }
                            }));
                        }
                    }
                    serde_json::Value::Array(content_arr)
                } else {
                    serde_json::Value::String(m.content.clone())
                };

                serde_json::json!({
                    "role": match m.role {
                        ChatRole::User => "user",
                        ChatRole::Assistant => "assistant",
                        ChatRole::System => "user",
                    },
                    "content": content,
                })
            })
            .collect()
    }

    pub(crate) fn build_ollama_messages(messages: &[ChatMessage]) -> Vec<serde_json::Value> {
        messages
            .iter()
            .map(|m| {
                serde_json::json!({
                    "role": match m.role {
                        ChatRole::User => "user",
                        ChatRole::Assistant => "assistant",
                        ChatRole::System => "system",
                    },
                    "content": m.content,
                })
            })
            .collect()
    }

    /// Convert ChatMessage history into provider-native messages for the
    /// agent loop's first round. Subsequent rounds append native tool results
    /// built by agent/mod.rs.
    pub(crate) fn build_native_messages(
        provider: &Provider,
        model: &str,
        api_url: Option<&str>,
        messages: Vec<ChatMessage>,
    ) -> Vec<serde_json::Value> {
        match provider {
            Provider::Anthropic => Self::build_anthropic_messages(&messages),
            // Ollama-only: GGUF models are served by the llama-swap router
            // (Provider::LlamaSwap), which speaks OpenAI-compatible JSON.
            Provider::Local => Self::build_ollama_messages(&messages),
            _ => Self::build_openai_messages(&messages, model, api_url)
                .into_iter()
                .map(|m| serde_json::to_value(&m).unwrap_or_default())
                .collect(),
        }
    }

    async fn stream_openai_agent(
        client: reqwest::Client,
        native_messages: Vec<serde_json::Value>,
        model: &str,
        api_key: Option<String>,
        api_url: Option<&str>,
        temperature: f64,
        max_tokens: u32,
        tools: Option<Vec<serde_json::Value>>,
        tx: tokio::sync::mpsc::Sender<AgentStreamEvent>,
        observability: Arc<Observability>,
    ) -> Result<(), WeaveError> {
        let url = api_url.unwrap_or("https://api.openai.com/v1/chat/completions");

        let openai_messages: Vec<OpenAiMessage> = native_messages
            .into_iter()
            .map(|v| serde_json::from_value(v).unwrap_or_default())
            .collect();

        let temp = if temperature == 0.0 { 0.7 } else { temperature };
        let request = OpenAiRequest {
            model: model.to_string(),
            messages: openai_messages,
            temperature: temp,
            max_tokens: if max_tokens == 0 {
                None
            } else {
                Some(max_tokens)
            },
            frequency_penalty: Some(0.3),
            presence_penalty: Some(0.3),
            stream: true,
            tools: tools.map(|t| {
                t.into_iter()
                    .filter_map(|v| serde_json::from_value(v).ok())
                    .collect()
            }),
        };

        let mut request_builder = client.post(url).header("Content-Type", "application/json");
        if let Some(key) = api_key {
            request_builder = request_builder.header("Authorization", format!("Bearer {}", key));
        }
        let response = request_builder.json(&request).send().await?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(WeaveError::AiApiError(format!(
                "OpenAI streaming error: {}",
                error_text
            )));
        }

        let mut stream = response.bytes_stream();
        use futures::StreamExt;

        let mut buffer = Vec::new();
        let mut saw_tool_call = false;
        let mut last_usage: Option<OpenAiUsage> = None;

        while let Some(chunk_result) = stream.next().await {
            let chunk = chunk_result?;
            buffer.extend_from_slice(&chunk);

            while let Some(pos) = buffer.iter().position(|&b| b == b'\n') {
                let line_bytes: Vec<u8> = buffer.drain(..=pos).collect();
                let text = String::from_utf8_lossy(&line_bytes);
                let line = text.trim();

                if line.is_empty() || line == "data: [DONE]" {
                    continue;
                }

                if let Some(data) = line.strip_prefix("data: ") {
                    if let Ok(json) = serde_json::from_str::<OpenAiStreamResponse>(data) {
                        if let Some(usage) = json.usage {
                            last_usage = Some(usage);
                        }
                        if let Some(delta) = json.choices.first() {
                            if let Some(reasoning) = &delta.delta.reasoning_content {
                                if !reasoning.is_empty() {
                                    let _ = tx
                                        .send(AgentStreamEvent::Reasoning(reasoning.clone()))
                                        .await;
                                }
                            }
                            if let Some(content) = &delta.delta.content {
                                let _ = tx.send(AgentStreamEvent::Text(content.clone())).await;
                            }
                            if let Some(tool_calls) = &delta.delta.tool_calls {
                                for tc in tool_calls {
                                    saw_tool_call = true;
                                    let _ = tx
                                        .send(AgentStreamEvent::ToolCall {
                                            index: tc.index,
                                            id: tc.id.clone(),
                                            name: tc.function.as_ref().and_then(|f| f.name.clone()),
                                            args_fragment: tc
                                                .function
                                                .as_ref()
                                                .and_then(|f| f.arguments.clone())
                                                .unwrap_or_default(),
                                        })
                                        .await;
                                }
                            }
                            if delta.finish_reason.as_deref() == Some("tool_calls") {
                                saw_tool_call = true;
                            }
                        }
                    }
                }
            }
        }

        // Record usage when the stream exposes it (best-effort).
        if let Some(usage) = last_usage {
            let total = usage.total();
            if total > 0 {
                observability.record_tokens(total);
            }
        }

        let _ = tx
            .send(AgentStreamEvent::Finish {
                tool_calls: saw_tool_call,
            })
            .await;
        Ok(())
    }

    async fn stream_anthropic_agent(
        client: reqwest::Client,
        native_messages: Vec<serde_json::Value>,
        model: &str,
        api_key: Option<String>,
        api_url: Option<&str>,
        temperature: f64,
        max_tokens: u32,
        tools: Option<Vec<serde_json::Value>>,
        tx: tokio::sync::mpsc::Sender<AgentStreamEvent>,
        observability: Arc<Observability>,
    ) -> Result<(), WeaveError> {
        let api_key =
            api_key.ok_or_else(|| WeaveError::ApiKeyNotConfigured("Anthropic".to_string()))?;
        let url = api_url.unwrap_or("https://api.anthropic.com/v1/messages");

        let anthropic_messages: Vec<AnthropicMessage> = native_messages
            .into_iter()
            .map(|v| serde_json::from_value(v).unwrap_or_default())
            .collect();

        let request = AnthropicRequest {
            model: model.to_string(),
            messages: anthropic_messages,
            max_tokens: if max_tokens == 0 {
                Some(8192)
            } else {
                Some(max_tokens)
            },
            temperature,
            stream: true,
            tools: tools.map(|t| {
                t.into_iter()
                    .filter_map(|v| serde_json::from_value(v).ok())
                    .collect()
            }),
        };

        let response = client
            .post(url)
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(WeaveError::AiApiError(format!(
                "Anthropic streaming error: {}",
                error_text
            )));
        }

        let mut stream = response.bytes_stream();
        use futures::StreamExt;

        let mut buffer = Vec::new();
        let mut input_tokens: u64 = 0;
        let mut output_tokens: u64 = 0;
        let mut saw_tool_call = false;
        let mut stop_reason_tool_use = false;
        let mut partial_json: Vec<String> = Vec::new();
        let mut current_index: Option<usize> = None;
        let mut current_id: Option<String> = None;
        let mut current_name: Option<String> = None;

        while let Some(chunk_result) = stream.next().await {
            let chunk = chunk_result?;
            buffer.extend_from_slice(&chunk);

            while let Some(pos) = buffer.iter().position(|&b| b == b'\n') {
                let line_bytes: Vec<u8> = buffer.drain(..=pos).collect();
                let text = String::from_utf8_lossy(&line_bytes);
                let line = text.trim();

                if line.is_empty() || !line.starts_with("data: ") {
                    continue;
                }

                if let Some(data) = line.strip_prefix("data: ") {
                    if data == "[DONE]" {
                        continue;
                    }

                    if let Ok(json) = serde_json::from_str::<AnthropicStreamResponse>(data) {
                        // Usage arrives on message_start (input) and
                        // message_delta (output); accumulate best-effort.
                        if let Some(usage) = json.message.and_then(|m| m.usage) {
                            input_tokens += usage.input_tokens.unwrap_or(0);
                            output_tokens += usage.output_tokens.unwrap_or(0);
                        }
                        if let Some(usage) = json.usage {
                            input_tokens += usage.input_tokens.unwrap_or(0);
                            output_tokens += usage.output_tokens.unwrap_or(0);
                        }

                        match json.response_type.as_str() {
                            "content_block_start" => {
                                if let Some(block) = &json.content_block {
                                    if block.block_type.as_deref() == Some("tool_use") {
                                        saw_tool_call = true;
                                        current_index = json.index;
                                        current_id = block.id.clone();
                                        current_name = block.name.clone();
                                        partial_json.clear();
                                        if let Some(input) = &block.input {
                                            if !input.is_null() {
                                                partial_json.push(input.to_string());
                                            }
                                        }
                                    }
                                }
                            }
                            "content_block_delta" => {
                                if let Some(delta) = &json.delta {
                                    if delta.delta_type.as_deref() == Some("input_json_delta") {
                                        if let Some(fragment) = &delta.partial_json {
                                            partial_json.push(fragment.clone());
                                        }
                                    } else if delta.delta_type.as_deref() == Some("thinking_delta")
                                    {
                                        if let Some(fragment) = &delta.thinking {
                                            if !fragment.is_empty() {
                                                let _ = tx
                                                    .send(AgentStreamEvent::Reasoning(
                                                        fragment.clone(),
                                                    ))
                                                    .await;
                                            }
                                        }
                                    } else if let Some(text_delta) = &delta.text {
                                        let _ = tx
                                            .send(AgentStreamEvent::Text(text_delta.clone()))
                                            .await;
                                    }
                                }
                            }
                            "content_block_stop" => {
                                if saw_tool_call && current_index == json.index {
                                    let _ = tx
                                        .send(AgentStreamEvent::ToolCall {
                                            index: json.index.unwrap_or(0),
                                            id: current_id.clone(),
                                            name: current_name.clone(),
                                            args_fragment: partial_json.concat(),
                                        })
                                        .await;
                                    current_index = None;
                                }
                            }
                            "message_delta" => {
                                if let Some(delta) = &json.delta {
                                    if delta.stop_reason.as_deref() == Some("tool_use") {
                                        stop_reason_tool_use = true;
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
        }

        if input_tokens + output_tokens > 0 {
            observability.record_tokens(input_tokens + output_tokens);
        }

        let _ = tx
            .send(AgentStreamEvent::Finish {
                tool_calls: saw_tool_call || stop_reason_tool_use,
            })
            .await;
        Ok(())
    }

    async fn stream_local_agent(
        client: reqwest::Client,
        native_messages: Vec<serde_json::Value>,
        model: &str,
        api_url: Option<&str>,
        temperature: f64,
        tools: Option<Vec<serde_json::Value>>,
        tx: tokio::sync::mpsc::Sender<AgentStreamEvent>,
        observability: Arc<Observability>,
        telemetry: Arc<Mutex<ModelTelemetry>>,
    ) -> Result<(), WeaveError> {
        let url = api_url.unwrap_or("http://localhost:11434/api/chat");

        let ollama_messages: Vec<OllamaMessage> = native_messages
            .into_iter()
            .map(|v| serde_json::from_value(v).unwrap_or_default())
            .collect();

        let request = OllamaRequest {
            model: model.to_string(),
            messages: ollama_messages,
            stream: true,
            options: OllamaOptions { temperature },
            tools,
        };

        let response = client
            .post(url)
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(WeaveError::LocalLlmNotAvailable(error_text));
        }

        let mut stream = response.bytes_stream();
        use futures::StreamExt;

        let mut buffer = Vec::new();
        let mut final_prompt_eval_count: Option<u64> = None;
        let mut final_eval_count: Option<u64> = None;
        let mut final_eval_duration: Option<u64> = None;
        let mut saw_tool_call = false;
        while let Some(chunk_result) = stream.next().await {
            let chunk = chunk_result?;
            buffer.extend_from_slice(&chunk);

            while let Some(pos) = buffer.iter().position(|&b| b == b'\n') {
                let line_bytes: Vec<u8> = buffer.drain(..=pos).collect();
                let text = String::from_utf8_lossy(&line_bytes);
                let line = text.trim();

                if line.is_empty() {
                    continue;
                }

                if let Ok(json) = serde_json::from_str::<OllamaStreamResponse>(line) {
                    if !json.done {
                        if let Some(reasoning) = json.message.reasoning_content {
                            if !reasoning.is_empty() {
                                let _ = tx.send(AgentStreamEvent::Reasoning(reasoning)).await;
                            }
                        }
                        if let Some(content) = json.message.content {
                            let _ = tx.send(AgentStreamEvent::Text(content)).await;
                        }
                    } else {
                        // The final chunk carries the generation statistics and
                        // any tool calls the model made.
                        final_prompt_eval_count = json.prompt_eval_count;
                        final_eval_count = json.eval_count;
                        final_eval_duration = json.eval_duration;
                        if let Some(tool_calls) = &json.message.tool_calls {
                            for (index, tc) in tool_calls.iter().enumerate() {
                                saw_tool_call = true;
                                let _ = tx
                                    .send(AgentStreamEvent::ToolCall {
                                        index,
                                        id: Some(format!("ollama_call_{}", index)),
                                        name: Some(tc.function.name.clone()),
                                        args_fragment: tc.function.arguments.to_string(),
                                    })
                                    .await;
                            }
                        }
                    }
                }
            }
        }

        // Record usage and throughput from the final chunk (best-effort).
        let (prompt_tokens, completion_tokens, duration_ns) = (
            final_prompt_eval_count.unwrap_or(0),
            final_eval_count.unwrap_or(0),
            final_eval_duration.unwrap_or(0),
        );
        observability.record_tokens(prompt_tokens + completion_tokens);
        let mut t = telemetry.lock();
        t.last_model = Some(model.to_string());
        let tps = (completion_tokens as f64) / (duration_ns as f64 / 1_000_000_000.0).max(0.001);
        t.record_tps(tps);
        let _ = saw_tool_call;
        Ok(())
    }

    pub async fn list_models(&self, provider: Provider) -> Result<Vec<String>, WeaveError> {
        let config = self.config.read().clone();

        match provider {
            Provider::Openai => {
                let api_key = config.openai.api_key.clone();
                if api_key.is_empty() {
                    return Err(WeaveError::ApiKeyNotConfigured("OpenAI".to_string()));
                }
                let url = config
                    .openai
                    .api_url
                    .as_deref()
                    .unwrap_or("https://api.openai.com/v1");
                let response = self
                    .client
                    .get(format!("{}/models", url))
                    .header("Authorization", format!("Bearer {}", api_key))
                    .send()
                    .await?;

                if !response.status().is_success() {
                    let error_text = response.text().await.unwrap_or_default();
                    return Err(WeaveError::AiApiError(format!(
                        "OpenAI models error: {}",
                        error_text
                    )));
                }

                let json: serde_json::Value = response.json().await?;
                let models: Vec<String> = json["data"]
                    .as_array()
                    .unwrap_or(&Vec::new())
                    .iter()
                    .filter_map(|m| m["id"].as_str().map(|s| s.to_string()))
                    .filter(|id| {
                        let id_lower = id.to_lowercase();
                        id_lower.starts_with("gpt")
                            || id_lower.starts_with("o1")
                            || id_lower.starts_with("o3")
                            || id_lower.starts_with("chatgpt")
                    })
                    .collect();
                Ok(models)
            }
            Provider::Anthropic => {
                let api_key = config.anthropic.api_key.clone();
                if api_key.is_empty() {
                    return Err(WeaveError::ApiKeyNotConfigured("Anthropic".to_string()));
                }
                let url = config
                    .anthropic
                    .api_url
                    .as_deref()
                    .unwrap_or("https://api.anthropic.com/v1");
                let response = self
                    .client
                    .get(format!("{}/models", url))
                    .header("x-api-key", api_key)
                    .header("anthropic-version", "2023-06-01")
                    .send()
                    .await?;

                if !response.status().is_success() {
                    let error_text = response.text().await.unwrap_or_default();
                    return Err(WeaveError::AiApiError(format!(
                        "Anthropic models error: {}",
                        error_text
                    )));
                }

                let json: serde_json::Value = response.json().await?;
                let models: Vec<String> = json["data"]
                    .as_array()
                    .unwrap_or(&Vec::new())
                    .iter()
                    .filter_map(|m| m["id"].as_str().map(|s| s.to_string()))
                    .filter(|id| id.starts_with("claude-"))
                    .collect();
                Ok(models)
            }
            Provider::Kimi => {
                let api_key = config.kimi.api_key.clone();
                if api_key.is_empty() {
                    return Err(WeaveError::ApiKeyNotConfigured("Kimi".to_string()));
                }
                let url = config
                    .kimi
                    .api_url
                    .as_deref()
                    .unwrap_or("https://api.moonshot.cn/v1");
                let response = self
                    .client
                    .get(format!("{}/models", url))
                    .header("Authorization", format!("Bearer {}", api_key))
                    .send()
                    .await?;

                if !response.status().is_success() {
                    let error_text = response.text().await.unwrap_or_default();
                    return Err(WeaveError::AiApiError(format!(
                        "Kimi models error: {}",
                        error_text
                    )));
                }

                let json: serde_json::Value = response.json().await?;
                let models: Vec<String> = json["data"]
                    .as_array()
                    .unwrap_or(&Vec::new())
                    .iter()
                    .filter_map(|m| m["id"].as_str().map(|s| s.to_string()))
                    .filter(|id| id.starts_with("kimi"))
                    .collect();
                Ok(models)
            }
            Provider::Opencode => {
                let api_key = config.opencode.api_key.clone();
                if api_key.is_empty() {
                    return Err(WeaveError::ApiKeyNotConfigured("Opencode".to_string()));
                }
                let output = std::process::Command::new("opencode")
                    .arg("models")
                    .output();

                if let Ok(output) = output {
                    if output.status.success() {
                        let stdout = String::from_utf8_lossy(&output.stdout);
                        let models: Vec<String> = stdout
                            .lines()
                            .map(|s| s.trim().to_string())
                            .filter(|s| !s.is_empty())
                            // `local/*` entries are the user's GGUF catalog, which
                            // the opencode gateway does not serve — they live
                            // under the llama-swap provider instead. Surfacing
                            // them here would re-create the "not supported"
                            // failure from a second entry point.
                            .filter(|s| !s.starts_with("local/"))
                            .collect();
                        if !models.is_empty() {
                            return Ok(models);
                        }
                    }
                }

                Err(WeaveError::AiApiError(
                    "Failed to fetch models from opencode CLI".to_string(),
                ))
            }
            Provider::Local => {
                // Ollama-only. GGUF models live under the llama-swap provider.
                // Server down → empty, not error: the picker must degrade
                // gracefully instead of failing the whole model list.
                let url = config
                    .local
                    .api_url
                    .as_deref()
                    .unwrap_or("http://localhost:11434");
                let mut models = Vec::new();

                if let Ok(response) = self.client.get(format!("{}/api/tags", url)).send().await {
                    if response.status().is_success() {
                        if let Ok(json) = response.json::<serde_json::Value>().await {
                            if let Some(arr) = json["models"].as_array() {
                                for m in arr {
                                    if let Some(name) = m["name"].as_str() {
                                        models.push(name.to_string());
                                    }
                                }
                            }
                        }
                    }
                }

                Ok(models)
            }
            Provider::LlamaSwap => {
                // Authoritative catalog = the router's generated config.yaml
                // (live read, never cached; see commands::llama_swap).
                crate::commands::llama_swap::list_models()
            }
        }
    }

    /// Probe one llama-swap model's native tool-call capability — once per
    /// model id, on first real use (never eagerly for the whole catalog: a
    /// probe loads the model into VRAM, and ttl:300 keeps it there for ~5min).
    /// Sends a minimal tool-envelope request; a native `tool_calls` answer
    /// means the family formats tools correctly under `--jinja`. The caller
    /// (agent loop) caches the result in the per-model probe map.
    pub async fn llama_swap_probe_tools(&self, model: &str) -> Result<bool, WeaveError> {
        crate::commands::llama_swap::ensure_ready().await?;

        let url = crate::commands::llama_swap::LLAMA_SWAP_CHAT_URL;
        let request = OpenAiRequest {
            model: model.to_string(),
            messages: vec![OpenAiMessage {
                role: "user".to_string(),
                content: serde_json::Value::String(
                    "Do not think. Respond by calling the provided tool with no arguments."
                        .to_string(),
                ),
                tool_calls: None,
                tool_call_id: None,
            }],
            temperature: 0.0,
            // Reasoning families (DeepSeek-R1/V4) spend tokens on
            // `reasoning_content` before emitting the call — a small budget
            // would end with finish_reason=length and a false "prompt-based"
            // verdict (verified live 2026-08-14). 1024 covers thinking + call.
            max_tokens: Some(1024),
            frequency_penalty: None,
            presence_penalty: None,
            stream: false,
            tools: Some(vec![OpenAiTool {
                tool_type: "function".to_string(),
                function: OpenAiFunction {
                    name: "__weave_probe".to_string(),
                    description: "Tool-format probe.".to_string(),
                    parameters: serde_json::json!({
                        "type": "object",
                        "properties": {},
                        "required": []
                    }),
                },
            }]),
        };

        let response = self.client.post(url).json(&request).send().await?;
        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(WeaveError::LocalLlmNotAvailable(format!(
                "llama-swap probe failed: {}",
                error_text
            )));
        }

        let json: serde_json::Value = response.json().await?;
        let has_tool_call = json["choices"][0]["message"]["tool_calls"]
            .as_array()
            .map(|a| !a.is_empty())
            .unwrap_or(false)
            || json["choices"][0]["finish_reason"].as_str() == Some("tool_calls");
        tracing::info!(
            "llama-swap tool probe for {}: {}",
            model,
            if has_tool_call {
                "native"
            } else {
                "prompt-based"
            }
        );
        Ok(has_tool_call)
    }

    pub fn update_config(&self, new_config: AiConfig) {
        let mut config = self.config.write();
        *config = new_config;
        info!("AI configuration updated");
    }
}
