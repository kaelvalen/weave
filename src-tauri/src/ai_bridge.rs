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

/// A running llama-server child plus usage bookkeeping, so the idle reaper can
/// unload the model (freeing RAM/VRAM) once work with it is done.
pub struct LlamaServerHandle {
    model: String,
    child: tokio::process::Child,
    last_used: std::time::Instant,
    in_flight: usize,
}

/// Unload the local model after this much inactivity — the server must not sit
/// in RAM/VRAM forever once its work is done.
const LLAMA_IDLE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);
const LLAMA_REAPER_INTERVAL: std::time::Duration = std::time::Duration::from_secs(30);

pub struct AiBridge {
    client: reqwest::Client,
    pub config: Arc<RwLock<AiConfig>>,
    pub llama_server: Arc<tokio::sync::Mutex<Option<LlamaServerHandle>>>,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OpenAiMessage {
    role: String,
    content: serde_json::Value,
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
}

#[derive(Debug, Clone, Deserialize, Default)]
struct OpenAiDelta {
    content: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AnthropicRequest {
    model: String,
    messages: Vec<AnthropicMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    temperature: f64,
    stream: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AnthropicMessage {
    role: String,
    content: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
struct AnthropicStreamResponse {
    #[serde(rename = "type")]
    #[allow(dead_code)]
    response_type: String,
    delta: Option<AnthropicDelta>,
    #[allow(dead_code)]
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
    text: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct AnthropicContentBlock {
    #[allow(dead_code)]
    text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OllamaRequest {
    model: String,
    messages: Vec<OllamaMessage>,
    stream: bool,
    options: OllamaOptions,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OllamaMessage {
    role: String,
    content: String,
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

        let llama_server: Arc<tokio::sync::Mutex<Option<LlamaServerHandle>>> =
            Arc::new(tokio::sync::Mutex::new(None));

        // Idle reaper: once work with a model is done and it has been quiet for
        // LLAMA_IDLE_TIMEOUT, kill its server so RAM/VRAM is released.
        {
            let llama_server = llama_server.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(LLAMA_REAPER_INTERVAL).await;
                    let mut guard = llama_server.lock().await;
                    if let Some(handle) = guard.as_mut() {
                        if handle.in_flight == 0 && handle.last_used.elapsed() > LLAMA_IDLE_TIMEOUT
                        {
                            tracing::info!("llama-server idle — unloading model {}", handle.model);
                            let _ = handle.child.kill().await;
                            *guard = None;
                        }
                    }
                }
            });
        }

        Self {
            client,
            config,
            llama_server,
            observability,
            telemetry,
        }
    }

    pub fn get_local_models_dir() -> std::path::PathBuf {
        dirs::home_dir()
            .map(|h| h.join("Models").join("llama.cpp"))
            .unwrap_or_else(|| std::path::PathBuf::from("./models"))
    }

    /// Locate a matching multimodal projector (`mmproj*.gguf`) next to the models for
    /// vision-capable GGUFs so they can accept image input. Returns None when no matching
    /// projector is present or when the model is pure text (to avoid dimension mismatch errors).
    fn find_mmproj(models_dir: &std::path::Path, model_name: &str) -> Option<std::path::PathBuf> {
        let model_lower = model_name.to_lowercase();
        let model_stem = model_name
            .strip_suffix(".gguf")
            .unwrap_or(model_name)
            .to_lowercase();

        let entries = std::fs::read_dir(models_dir).ok()?;
        let mut candidates: Vec<std::path::PathBuf> = entries
            .filter_map(|entry| entry.ok().map(|e| e.path()))
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| {
                        let lower = n.to_lowercase();
                        lower.contains("mmproj") && lower.ends_with(".gguf")
                    })
                    .unwrap_or(false)
            })
            .collect();

        if candidates.is_empty() {
            return None;
        }

        // 1. Exact or stem match in mmproj filename (e.g. mmproj-qwen2.5-coder.gguf)
        for cand in &candidates {
            if let Some(name) = cand.file_name().and_then(|n| n.to_str()) {
                let lower = name.to_lowercase();
                if lower.contains(&model_stem) {
                    return Some(cand.clone());
                }
            }
        }

        // 2. Vision model heuristic: only attach mmproj if the model filename indicates it's a vision/multimodal model.
        let vision_keywords = [
            "llava",
            "moondream",
            "minicpm",
            "-vl",
            "_vl",
            "vision",
            "pixtral",
            "qvq",
            "mllama",
            "bakllava",
            "obsidian",
            "internvl",
        ];
        let is_vision_model = vision_keywords.iter().any(|&kw| model_lower.contains(kw));

        if !is_vision_model {
            // Text-only models (e.g. Qwen2.5-Coder, Llama-3-8B, Mistral) must NOT use mmproj.
            // Passing an arbitrary mmproj causes llama-server to fail loading with a dimension mismatch error.
            return None;
        }

        // 3. For vision models, prefer an mmproj sharing a keyword with the model name.
        for cand in &candidates {
            if let Some(name) = cand.file_name().and_then(|n| n.to_str()) {
                let lower = name.to_lowercase();
                for kw in vision_keywords {
                    if model_lower.contains(kw) && lower.contains(kw) {
                        return Some(cand.clone());
                    }
                }
            }
        }

        // Fallback for vision model: sort candidates and pick the first available projector.
        candidates.sort();
        candidates.into_iter().next()
    }

    /// Best-effort kill of whatever holds the llama-server port. `fuser` does
    /// not exist on every distro (e.g. NixOS), so fall back to lsof + kill.
    async fn kill_port_occupants(port: u16) {
        let _ = tokio::process::Command::new("fuser")
            .arg("-k")
            .arg(format!("{port}/tcp"))
            .output()
            .await;

        if let Ok(out) = tokio::process::Command::new("lsof")
            .arg("-t")
            .arg(format!("-i:{port}"))
            .output()
            .await
        {
            for pid in String::from_utf8_lossy(&out.stdout).split_whitespace() {
                let _ = tokio::process::Command::new("kill").arg(pid).output().await;
            }
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
                let (provider, model, api_key, api_url, temperature, max_tokens) =
                    match config.default_provider {
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
        };

        drop(config);
        result
    }

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
                let (provider, model, api_key, api_url, temperature, max_tokens) =
                    match config.default_provider {
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
                    };
                (provider, model, api_key, api_url, temperature, max_tokens)
            });

        let client = self.client.clone();
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

        let llama_server_clone = self.llama_server.clone();
        let observability = self.observability.clone();
        let telemetry = self.telemetry.clone();

        tokio::spawn(async move {
            let result = match provider {
                Provider::Openai => {
                    Self::stream_openai_internal(
                        client,
                        enhanced_messages,
                        &model,
                        api_key,
                        api_url.as_deref(),
                        temperature,
                        max_tokens,
                        tx.clone(),
                        observability.clone(),
                    )
                    .await
                }
                Provider::Anthropic => {
                    Self::stream_anthropic_internal(
                        client,
                        enhanced_messages,
                        &model,
                        api_key,
                        api_url.as_deref(),
                        temperature,
                        max_tokens,
                        tx.clone(),
                        observability.clone(),
                    )
                    .await
                }
                Provider::Kimi => {
                    Self::stream_kimi_internal(
                        client,
                        enhanced_messages,
                        &model,
                        api_key,
                        api_url.as_deref(),
                        temperature,
                        max_tokens,
                        tx.clone(),
                        observability.clone(),
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
                    Self::stream_openai_internal(
                        client,
                        enhanced_messages,
                        actual_model,
                        api_key,
                        Some(&url),
                        temperature,
                        max_tokens,
                        tx.clone(),
                        observability.clone(),
                    )
                    .await
                }
                Provider::Local => {
                    Self::stream_local_internal(
                        client,
                        llama_server_clone,
                        enhanced_messages,
                        &model,
                        api_url.as_deref(),
                        temperature,
                        max_tokens,
                        tx.clone(),
                        observability.clone(),
                        telemetry.clone(),
                    )
                    .await
                }
            };

            // Remember the last-used model regardless of stream outcome.
            telemetry.lock().last_model = Some(model.clone());

            if let Err(e) = result {
                let _ = tx.send(format!("\n[Stream Error: {}]", e)).await;
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
            })
            .collect();

        let request = OllamaRequest {
            model: model.to_string(),
            messages: ollama_messages,
            stream: false,
            options: OllamaOptions { temperature },
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

    fn build_openai_messages(
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
                }
            })
            .collect()
    }

    async fn stream_openai_internal(
        client: reqwest::Client,
        messages: Vec<ChatMessage>,
        model: &str,
        api_key: Option<String>,
        api_url: Option<&str>,
        temperature: f64,
        max_tokens: u32,
        tx: tokio::sync::mpsc::Sender<String>,
        observability: Arc<Observability>,
    ) -> Result<(), WeaveError> {
        let api_key =
            api_key.ok_or_else(|| WeaveError::ApiKeyNotConfigured("OpenAI".to_string()))?;
        let url = api_url.unwrap_or("https://api.openai.com/v1/chat/completions");

        let openai_messages = Self::build_openai_messages(&messages, model, api_url);

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
        };

        let response = client
            .post(url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;

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
        let mut generated_text = String::new();
        let mut stop_stream = false;
        let mut last_usage: Option<OpenAiUsage> = None;

        while let Some(chunk_result) = stream.next().await {
            if stop_stream {
                break;
            }
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
                        if let Some(content) =
                            json.choices.get(0).and_then(|c| c.delta.content.clone())
                        {
                            generated_text.push_str(&content);

                            let _ = tx.send(content).await;
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

        Ok(())
    }

    async fn stream_anthropic_internal(
        client: reqwest::Client,
        messages: Vec<ChatMessage>,
        model: &str,
        api_key: Option<String>,
        api_url: Option<&str>,
        temperature: f64,
        max_tokens: u32,
        tx: tokio::sync::mpsc::Sender<String>,
        observability: Arc<Observability>,
    ) -> Result<(), WeaveError> {
        let api_key =
            api_key.ok_or_else(|| WeaveError::ApiKeyNotConfigured("Anthropic".to_string()))?;
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
            stream: true,
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
                        if let Some(text_delta) = json.delta.and_then(|d| d.text) {
                            let _ = tx.send(text_delta).await;
                        }
                    }
                }
            }
        }

        if input_tokens + output_tokens > 0 {
            observability.record_tokens(input_tokens + output_tokens);
        }

        Ok(())
    }

    async fn stream_local_internal(
        client: reqwest::Client,
        llama_server: Arc<tokio::sync::Mutex<Option<LlamaServerHandle>>>,
        messages: Vec<ChatMessage>,
        model: &str,
        api_url: Option<&str>,
        temperature: f64,
        _max_tokens: u32,
        tx: tokio::sync::mpsc::Sender<String>,
        observability: Arc<Observability>,
        telemetry: Arc<Mutex<ModelTelemetry>>,
    ) -> Result<(), WeaveError> {
        if model.contains(".gguf") {
            let mut server_guard = llama_server.lock().await;

            // Swap: a different model (or a dead server) — the old one dies first.
            let needs_restart = match &mut *server_guard {
                Some(handle) => {
                    if handle.model != model {
                        tracing::info!(
                            "model swap: unloading {} → loading {}",
                            handle.model,
                            model
                        );
                        let _ = handle.child.kill().await;
                        true
                    } else {
                        // Check if it's still running
                        matches!(handle.child.try_wait(), Ok(Some(_)))
                    }
                }
                None => true,
            };

            if needs_restart {
                let model_path = Self::get_local_models_dir().join(model);

                // Kill any lingering process using port 8080 first
                Self::kill_port_occupants(8080).await;

                tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

                // Start new server — attach the multimodal projector when one is
                // present so vision-capable models accept image input.
                use tokio::process::Command;
                let mut cmd = Command::new("llama-server");
                cmd.arg("-m")
                    .arg(&model_path)
                    .arg("--port")
                    .arg("8080")
                    .arg("-c")
                    .arg("32768") // Large context window - no cost for local models
                    .arg("-n")
                    .arg("-1"); // No output token limit
                if let Some(mmproj) = Self::find_mmproj(&Self::get_local_models_dir(), model) {
                    tracing::info!("llama-server vision enabled via {}", mmproj.display());
                    cmd.arg("--mmproj").arg(mmproj);
                }
                let child = cmd.kill_on_drop(true).spawn().map_err(|e| {
                    WeaveError::LocalLlmNotAvailable(format!("Failed to start llama-server: {}", e))
                })?;

                *server_guard = Some(LlamaServerHandle {
                    model: model.to_string(),
                    child,
                    last_used: std::time::Instant::now(),
                    in_flight: 0,
                });

                // Active health check polling loop (up to 6s). If our child died
                // instantly (e.g. a stale server still holds the port), fail loudly
                // instead of silently proxying to that stale, mmproj-less server.
                let health_url = "http://localhost:8080/health";
                let mut ready = false;
                for _ in 0..20 {
                    tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
                    if let Some(handle) = server_guard.as_mut() {
                        if let Ok(Some(status)) = handle.child.try_wait() {
                            return Err(WeaveError::LocalLlmNotAvailable(format!(
                                "llama-server exited immediately ({status}). Another process may hold port 8080 — stop it and try again."
                            )));
                        }
                    }
                    if let Ok(resp) = client.get(health_url).send().await {
                        if resp.status().is_success() {
                            ready = true;
                            break;
                        }
                    }
                }

                if !ready {
                    tracing::warn!("llama-server started but health check timed out on port 8080");
                }
            }

            // Mark the request in-flight so the idle reaper cannot kill the
            // server mid-stream; released right after the stream completes.
            if let Some(handle) = server_guard.as_mut() {
                handle.in_flight += 1;
                handle.last_used = std::time::Instant::now();
            }
            drop(server_guard);

            let result = Self::stream_openai_internal(
                client,
                messages,
                model,
                Some("dummy_key".to_string()),
                Some("http://localhost:8080/v1/chat/completions"),
                temperature,
                0, // No token limit for local models
                tx,
                observability,
            )
            .await;

            // Work with the model is done — the idle reaper may now unload it
            // after LLAMA_IDLE_TIMEOUT to free RAM/VRAM.
            let mut server_guard = llama_server.lock().await;
            if let Some(handle) = server_guard.as_mut() {
                handle.in_flight = handle.in_flight.saturating_sub(1);
                handle.last_used = std::time::Instant::now();
            }
            drop(server_guard);

            return result;
        }

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
            })
            .collect();

        let request = OllamaRequest {
            model: model.to_string(),
            messages: ollama_messages,
            stream: true,
            options: OllamaOptions { temperature },
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
                        if let Some(content) = json.message.content {
                            let _ = tx.send(content).await;
                        }
                    } else {
                        // The final chunk carries the generation statistics.
                        final_prompt_eval_count = json.prompt_eval_count;
                        final_eval_count = json.eval_count;
                        final_eval_duration = json.eval_duration;
                    }
                }
            }
        }

        // Record token consumption and throughput from the final chunk.
        let prompt_tokens = final_prompt_eval_count.unwrap_or(0);
        let eval_tokens = final_eval_count.unwrap_or(0);
        if prompt_tokens + eval_tokens > 0 {
            observability.record_tokens(prompt_tokens + eval_tokens);
        }
        if let (Some(eval_count), Some(eval_duration)) = (final_eval_count, final_eval_duration) {
            if eval_duration > 0 {
                let tps = eval_count as f64 / (eval_duration as f64 / 1e9);
                telemetry.lock().record_tps(tps);
            }
        }

        Ok(())
    }

    async fn stream_kimi_internal(
        client: reqwest::Client,
        messages: Vec<ChatMessage>,
        model: &str,
        api_key: Option<String>,
        api_url: Option<&str>,
        temperature: f64,
        max_tokens: u32,
        tx: tokio::sync::mpsc::Sender<String>,
        observability: Arc<Observability>,
    ) -> Result<(), WeaveError> {
        let api_key = api_key.ok_or_else(|| WeaveError::ApiKeyNotConfigured("Kimi".to_string()))?;
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
            stream: true,
        };

        let response = client
            .post(url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(WeaveError::AiApiError(format!(
                "Kimi streaming error: {}",
                error_text
            )));
        }

        let mut stream = response.bytes_stream();
        use futures::StreamExt;

        let mut buffer = Vec::new();
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
                        if let Some(content) =
                            json.choices.get(0).and_then(|c| c.delta.content.clone())
                        {
                            let _ = tx.send(content).await;
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
                let url = config
                    .local
                    .api_url
                    .as_deref()
                    .unwrap_or("http://localhost:11434");
                let mut models = Vec::new();

                // 1. Check Ollama models
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

                // 2. Scan ~/Models/llama.cpp for .gguf files (including subdirectories)
                let gguf_root = Self::get_local_models_dir();
                if let Ok(entries) = std::fs::read_dir(&gguf_root) {
                    for entry in entries.filter_map(Result::ok) {
                        let path = entry.path();
                        if path.is_dir() {
                            // Recurse one level into subdirectories
                            if let Ok(sub_entries) = std::fs::read_dir(&path) {
                                let dir_name = entry.file_name();
                                for sub_entry in sub_entries.filter_map(Result::ok) {
                                    let sub_path = sub_entry.path();
                                    if sub_path.extension().map(|e| e == "gguf").unwrap_or(false) {
                                        if let Some(file_name) =
                                            sub_path.file_name().and_then(|n| n.to_str())
                                        {
                                            if let Some(dir) = dir_name.to_str() {
                                                models.push(format!("{}/{}", dir, file_name));
                                            }
                                        }
                                    }
                                }
                            }
                        } else if path.extension().map(|e| e == "gguf").unwrap_or(false) {
                            if let Some(name) = entry.file_name().to_str() {
                                models.push(name.to_string());
                            }
                        }
                    }
                }

                if models.is_empty() {
                    return Err(WeaveError::LocalLlmNotAvailable(
                        "No local models found (checked Ollama and local models directory)"
                            .to_string(),
                    ));
                }

                Ok(models)
            }
        }
    }

    pub fn update_config(&self, new_config: AiConfig) {
        let mut config = self.config.write();
        *config = new_config;
        info!("AI configuration updated");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_mmproj_rejects_text_model() {
        let temp_dir = std::env::temp_dir().join(format!("weave_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();

        // Create dummy mmproj-BF16.gguf
        let mmproj_path = temp_dir.join("mmproj-BF16.gguf");
        std::fs::File::create(&mmproj_path).unwrap();

        // Qwen2.5 Coder is a pure text model -> must return None
        let result = AiBridge::find_mmproj(&temp_dir, "qwen2.5-coder-7b-instruct-q4_k_m.gguf");
        assert!(
            result.is_none(),
            "Text model should not attach unrelated mmproj"
        );

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_find_mmproj_accepts_vision_model() {
        let temp_dir = std::env::temp_dir().join(format!("weave_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();

        let mmproj_path = temp_dir.join("mmproj-BF16.gguf");
        std::fs::File::create(&mmproj_path).unwrap();

        // Qwen2-VL is a vision model -> should return mmproj
        let result = AiBridge::find_mmproj(&temp_dir, "qwen2-vl-7b-instruct-q4_k_m.gguf");
        assert_eq!(result, Some(mmproj_path));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_find_mmproj_matches_stem() {
        let temp_dir = std::env::temp_dir().join(format!("weave_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();

        let specific_mmproj = temp_dir.join("mmproj-qwen2.5-coder-7b.gguf");
        std::fs::File::create(&specific_mmproj).unwrap();

        // Model with explicit model-specific mmproj -> should return specific mmproj
        let result = AiBridge::find_mmproj(&temp_dir, "qwen2.5-coder-7b.gguf");
        assert_eq!(result, Some(specific_mmproj));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
