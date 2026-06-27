use std::sync::Arc;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tracing::info;

use crate::models::chat::{ChatMessage, ChatRole, ModelConfig, Provider};
use crate::utils::config::AiConfig;
use crate::utils::errors::WeaveError;

pub struct AiBridge {
    client: reqwest::Client,
    pub config: Arc<RwLock<AiConfig>>,
    pub llama_server: Arc<tokio::sync::Mutex<Option<(String, tokio::process::Child)>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OpenAiRequest {
    model: String,
    messages: Vec<OpenAiMessage>,
    temperature: f64,
    max_tokens: u32,
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
    max_tokens: u32,
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
}

#[derive(Debug, Clone, Deserialize, Default)]
struct OllamaResponseMessage {
    content: Option<String>,
}

impl AiBridge {
    pub fn new(config: Arc<RwLock<AiConfig>>) -> Self {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .unwrap_or_default();
        
        Self { 
            client, 
            config,
            llama_server: Arc::new(tokio::sync::Mutex::new(None)),
        }
    }

    pub async fn chat(
        &self,
        messages: Vec<ChatMessage>,
        model_config: Option<ModelConfig>,
        system_prompt: String,
    ) -> Result<String, WeaveError> {
        let config = self.config.read();
        let provider_config = model_config.as_ref().map(|mc| {
            (mc.provider.clone(), mc.model.clone(), mc.api_key.clone(), mc.api_url.clone(), mc.temperature, mc.max_tokens)
        }).unwrap_or_else(|| {
            let (provider, model, api_key, api_url, temperature, max_tokens) = match config.default_provider {
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
                self.chat_openai(enhanced_messages, &model, api_key, api_url.as_deref(), temperature, max_tokens).await
            }
            Provider::Anthropic => {
                self.chat_anthropic(enhanced_messages, &model, api_key, api_url.as_deref(), temperature, max_tokens).await
            }
            Provider::Kimi => {
                self.chat_kimi(enhanced_messages, &model, api_key, api_url.as_deref(), temperature, max_tokens).await
            }
            Provider::Opencode => {
                let mut url = api_url.unwrap_or_else(|| "https://opencode.ai/zen/v1/chat/completions".to_string());
                if url == "https://api.opencode.ai/v1" || url == "https://api.opencode.ai/v1/chat/completions" {
                    url = "https://opencode.ai/zen/v1/chat/completions".to_string();
                } else if !url.ends_with("/chat/completions") {
                    url = format!("{}/chat/completions", url.trim_end_matches('/'));
                }
                let actual_model = model.strip_prefix("opencode/").unwrap_or(&model);
                self.chat_openai(enhanced_messages, actual_model, api_key, Some(&url), temperature, max_tokens).await
            }
            Provider::Local => {
                self.chat_local(enhanced_messages, &model, api_url.as_deref(), temperature).await
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
        
        let provider_config = model_config.as_ref().map(|mc| {
            (mc.provider.clone(), mc.model.clone(), mc.api_key.clone(), mc.api_url.clone(), mc.temperature, mc.max_tokens)
        }).unwrap_or_else(|| {
            let (provider, model, api_key, api_url, temperature, max_tokens) = match config.default_provider {
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

        tokio::spawn(async move {
            let result = match provider {
                Provider::Openai => {
                    Self::stream_openai_internal(
                        client, enhanced_messages, &model, api_key, api_url.as_deref(),
                        temperature, max_tokens, tx.clone(),
                    ).await
                }
                Provider::Anthropic => {
                    Self::stream_anthropic_internal(
                        client, enhanced_messages, &model, api_key, api_url.as_deref(),
                        temperature, max_tokens, tx.clone(),
                    ).await
                }
                Provider::Kimi => {
                    Self::stream_kimi_internal(
                        client, enhanced_messages, &model, api_key, api_url.as_deref(),
                        temperature, max_tokens, tx.clone(),
                    ).await
                }
                Provider::Opencode => {
                    let mut url = api_url.unwrap_or_else(|| "https://opencode.ai/zen/v1/chat/completions".to_string());
                    if url == "https://api.opencode.ai/v1" || url == "https://api.opencode.ai/v1/chat/completions" {
                        url = "https://opencode.ai/zen/v1/chat/completions".to_string();
                    } else if !url.ends_with("/chat/completions") {
                        url = format!("{}/chat/completions", url.trim_end_matches('/'));
                    }
                    let actual_model = model.strip_prefix("opencode/").unwrap_or(&model);
                    Self::stream_openai_internal(
                        client, enhanced_messages, actual_model, api_key, Some(&url),
                        temperature, max_tokens, tx.clone(),
                    ).await
                }
                Provider::Local => {
                    Self::stream_local_internal(
                        client, llama_server_clone, enhanced_messages, &model, api_url.as_deref(),
                        temperature, max_tokens, tx.clone(),
                    ).await
                }
            };

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
        let api_key = api_key.ok_or_else(|| WeaveError::ApiKeyNotConfigured("OpenAI".to_string()))?;
        if api_key.is_empty() {
            return Err(WeaveError::ApiKeyNotConfigured("OpenAI".to_string()));
        }

        let url = api_url.unwrap_or("https://api.openai.com/v1/chat/completions");
        let openai_messages: Vec<OpenAiMessage> = messages.iter().map(|m| {
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
        }).collect();

        let request = OpenAiRequest {
            model: model.to_string(),
            messages: openai_messages,
            temperature,
            max_tokens,
            stream: false,
        };

        let response = self.client
            .post(url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(WeaveError::AiApiError(format!("OpenAI API error: {}", error_text)));
        }

        let response_json: serde_json::Value = response.json().await?;
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
        let api_key = api_key.ok_or_else(|| WeaveError::ApiKeyNotConfigured("Anthropic".to_string()))?;
        if api_key.is_empty() {
            return Err(WeaveError::ApiKeyNotConfigured("Anthropic".to_string()));
        }

        let url = api_url.unwrap_or("https://api.anthropic.com/v1/messages");
        let anthropic_messages: Vec<AnthropicMessage> = messages.iter().map(|m| {
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
        }).collect();

        let request = AnthropicRequest {
            model: model.to_string(),
            messages: anthropic_messages,
            max_tokens,
            temperature,
            stream: false,
        };

        let response = self.client
            .post(url)
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(WeaveError::AiApiError(format!("Anthropic API error: {}", error_text)));
        }

        let response_json: serde_json::Value = response.json().await?;
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
        
        let ollama_messages: Vec<OllamaMessage> = messages.iter().map(|m| OllamaMessage {
            role: match m.role {
                ChatRole::User => "user".to_string(),
                ChatRole::Assistant => "assistant".to_string(),
                ChatRole::System => "system".to_string(),
            },
            content: m.content.clone(),
        }).collect();

        let request = OllamaRequest {
            model: model.to_string(),
            messages: ollama_messages,
            stream: false,
            options: OllamaOptions { temperature },
        };

        let response = self.client
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

        let mut url = api_url.unwrap_or("https://api.moonshot.cn/v1/chat/completions").to_string();
        if !url.ends_with("/chat/completions") {
            url = format!("{}/chat/completions", url.trim_end_matches('/'));
        }
        let kimi_messages: Vec<OpenAiMessage> = messages.iter().map(|m| {
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
        }).collect();

        let request = OpenAiRequest {
            model: model.to_string(),
            messages: kimi_messages,
            temperature,
            max_tokens,
            stream: false,
        };

        let response = self.client
            .post(url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(WeaveError::AiApiError(format!("Kimi API error: {}", error_text)));
        }

        let response_json: serde_json::Value = response.json().await?;
        let content = response_json["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("")
            .to_string();

        Ok(content)
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
    ) -> Result<(), WeaveError> {
        let api_key = api_key.ok_or_else(|| WeaveError::ApiKeyNotConfigured("OpenAI".to_string()))?;
        let url = api_url.unwrap_or("https://api.openai.com/v1/chat/completions");
        
        let openai_messages: Vec<OpenAiMessage> = messages.iter().map(|m| {
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
        }).collect();

        let request = OpenAiRequest {
            model: model.to_string(),
            messages: openai_messages,
            temperature,
            max_tokens,
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
            return Err(WeaveError::AiApiError(format!("OpenAI streaming error: {}", error_text)));
        }

        let mut stream = response.bytes_stream();
        use futures::StreamExt;
        
        let mut buffer = Vec::new();
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
                        if let Some(content) = json.choices.get(0)
                            .and_then(|c| c.delta.content.clone()) {
                            let _ = tx.send(content).await;
                        }
                    }
                }
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
    ) -> Result<(), WeaveError> {
        let api_key = api_key.ok_or_else(|| WeaveError::ApiKeyNotConfigured("Anthropic".to_string()))?;
        let url = api_url.unwrap_or("https://api.anthropic.com/v1/messages");
        
        let anthropic_messages: Vec<AnthropicMessage> = messages.iter().map(|m| {
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
        }).collect();

        let request = AnthropicRequest {
            model: model.to_string(),
            messages: anthropic_messages,
            max_tokens,
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
            return Err(WeaveError::AiApiError(format!("Anthropic streaming error: {}", error_text)));
        }

        let mut stream = response.bytes_stream();
        use futures::StreamExt;
        
        let mut buffer = Vec::new();
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
                    if data == "[DONE]" { continue; }
                    
                    if let Ok(json) = serde_json::from_str::<AnthropicStreamResponse>(data) {
                        if let Some(text_delta) = json.delta.and_then(|d| d.text) {
                            let _ = tx.send(text_delta).await;
                        }
                    }
                }
            }
        }

        Ok(())
    }

    async fn stream_local_internal(
        client: reqwest::Client,
        llama_server: Arc<tokio::sync::Mutex<Option<(String, tokio::process::Child)>>>,
        messages: Vec<ChatMessage>,
        model: &str,
        api_url: Option<&str>,
        temperature: f64,
        max_tokens: u32,
        tx: tokio::sync::mpsc::Sender<String>,
    ) -> Result<(), WeaveError> {
        if model.ends_with(".gguf") {
            let mut server_guard = llama_server.lock().await;
            
            let needs_restart = match &mut *server_guard {
                Some((current_model, ref mut child)) => {
                    if current_model != model {
                        let _ = child.kill().await;
                        true
                    } else {
                        // Check if it's still running
                        if let Ok(Some(_status)) = child.try_wait() {
                            true
                        } else {
                            false
                        }
                    }
                }
                None => true,
            };

            if needs_restart {
                let model_path = format!("/home/kael/Models/llama.cpp/{}", model);
                
                // Start new server
                use tokio::process::Command;
                let child = Command::new("llama-server")
                    .arg("-m")
                    .arg(&model_path)
                    .arg("--port")
                    .arg("8080")
                    .arg("-c")
                    .arg("8192")
                    .kill_on_drop(true)
                    .spawn()
                    .map_err(|e| WeaveError::LocalLlmNotAvailable(format!("Failed to start llama-server: {}", e)))?;
                
                *server_guard = Some((model.to_string(), child));
                
                // Wait for server to start (simple 3 second sleep for now)
                tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
            }
            
            drop(server_guard);

            return Self::stream_openai_internal(
                client,
                messages,
                model,
                Some("dummy_key".to_string()),
                Some("http://localhost:8080/v1/chat/completions"),
                temperature,
                max_tokens,
                tx
            ).await;
        }

        let url = api_url.unwrap_or("http://localhost:11434/api/chat");
        
        let ollama_messages: Vec<OllamaMessage> = messages.iter().map(|m| OllamaMessage {
            role: match m.role {
                ChatRole::User => "user".to_string(),
                ChatRole::Assistant => "assistant".to_string(),
                ChatRole::System => "system".to_string(),
            },
            content: m.content.clone(),
        }).collect();

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
                    }
                }
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
    ) -> Result<(), WeaveError> {
        let api_key = api_key.ok_or_else(|| WeaveError::ApiKeyNotConfigured("Kimi".to_string()))?;
        let mut url = api_url.unwrap_or("https://api.moonshot.cn/v1/chat/completions").to_string();
        if !url.ends_with("/chat/completions") {
            url = format!("{}/chat/completions", url.trim_end_matches('/'));
        }

        let kimi_messages: Vec<OpenAiMessage> = messages.iter().map(|m| {
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
        }).collect();

        let request = OpenAiRequest {
            model: model.to_string(),
            messages: kimi_messages,
            temperature,
            max_tokens,
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
            return Err(WeaveError::AiApiError(format!("Kimi streaming error: {}", error_text)));
        }

        let mut stream = response.bytes_stream();
        use futures::StreamExt;

        let mut buffer = Vec::new();
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
                        if let Some(content) = json.choices.get(0)
                            .and_then(|c| c.delta.content.clone()) {
                            let _ = tx.send(content).await;
                        }
                    }
                }
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
                let url = config.openai.api_url.as_deref().unwrap_or("https://api.openai.com/v1");
                let response = self.client
                    .get(format!("{}/models", url))
                    .header("Authorization", format!("Bearer {}", api_key))
                    .send()
                    .await?;

                if !response.status().is_success() {
                    let error_text = response.text().await.unwrap_or_default();
                    return Err(WeaveError::AiApiError(format!("OpenAI models error: {}", error_text)));
                }

                let json: serde_json::Value = response.json().await?;
                let models: Vec<String> = json["data"]
                    .as_array()
                    .unwrap_or(&Vec::new())
                    .iter()
                    .filter_map(|m| m["id"].as_str().map(|s| s.to_string()))
                    .filter(|id| {
                        let id_lower = id.to_lowercase();
                        id_lower.starts_with("gpt") || id_lower.starts_with("o1") || id_lower.starts_with("o3") || id_lower.starts_with("chatgpt")
                    })
                    .collect();
                Ok(models)
            }
            Provider::Anthropic => {
                let api_key = config.anthropic.api_key.clone();
                if api_key.is_empty() {
                    return Err(WeaveError::ApiKeyNotConfigured("Anthropic".to_string()));
                }
                let url = config.anthropic.api_url.as_deref().unwrap_or("https://api.anthropic.com/v1");
                let response = self.client
                    .get(format!("{}/models", url))
                    .header("x-api-key", api_key)
                    .header("anthropic-version", "2023-06-01")
                    .send()
                    .await?;

                if !response.status().is_success() {
                    let error_text = response.text().await.unwrap_or_default();
                    return Err(WeaveError::AiApiError(format!("Anthropic models error: {}", error_text)));
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
                let url = config.kimi.api_url.as_deref().unwrap_or("https://api.moonshot.cn/v1");
                let response = self.client
                    .get(format!("{}/models", url))
                    .header("Authorization", format!("Bearer {}", api_key))
                    .send()
                    .await?;

                if !response.status().is_success() {
                    let error_text = response.text().await.unwrap_or_default();
                    return Err(WeaveError::AiApiError(format!("Kimi models error: {}", error_text)));
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
                
                Err(WeaveError::AiApiError("Failed to fetch models from opencode CLI".to_string()))
            }
            Provider::Local => {
                let url = config.local.api_url.as_deref().unwrap_or("http://localhost:11434");
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

                // 2. Scan /home/kael/Models/llama.cpp for .gguf files
                if let Ok(entries) = std::fs::read_dir("/home/kael/Models/llama.cpp") {
                    for entry in entries.filter_map(Result::ok) {
                        if let Some(ext) = entry.path().extension() {
                            if ext == "gguf" {
                                if let Some(name) = entry.file_name().to_str() {
                                    models.push(name.to_string());
                                }
                            }
                        }
                    }
                }

                if models.is_empty() {
                    return Err(WeaveError::LocalLlmNotAvailable("No local models found (checked Ollama and /home/kael/Models/llama.cpp)".to_string()));
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
