use reqwest::Client;
use serde_json::json;
use crate::core::ai::traits::{ChatModel, EmbeddingModel};
use crate::models::chat::ChatMessage;
use crate::utils::errors::WeaveError;

pub struct OllamaProvider {
    client: Client,
    base_url: String,
}

impl OllamaProvider {
    pub fn new(base_url: Option<String>) -> Self {
        Self {
            client: Client::new(),
            base_url: base_url.unwrap_or_else(|| "http://localhost:11434".to_string()),
        }
    }
}

#[async_trait::async_trait]
impl ChatModel for OllamaProvider {
    async fn chat_complete(
        &self,
        messages: &[ChatMessage],
        model: &str,
        temperature: f32,
    ) -> Result<String, WeaveError> {
        let url = format!("{}/api/chat", self.base_url);
        let formatted_messages: Vec<serde_json::Value> = messages
            .iter()
            .map(|m| {
                json!({
                    "role": format!("{:?}", m.role).to_lowercase(),
                    "content": m.content
                })
            })
            .collect();

        let response = self
            .client
            .post(&url)
            .json(&json!({
                "model": model,
                "messages": formatted_messages,
                "stream": false,
                "options": {
                    "temperature": temperature
                }
            }))
            .send()
            .await
            .map_err(|e| WeaveError::AiError(format!("Ollama HTTP error: {}", e)))?;

        let res_json: serde_json::Value = response
            .json()
            .await
            .map_err(|e| WeaveError::AiError(format!("Ollama JSON error: {}", e)))?;

        let content = res_json["message"]["content"]
            .as_str()
            .unwrap_or("")
            .to_string();

        Ok(content)
    }

    async fn chat_stream(
        &self,
        _messages: &[ChatMessage],
        _model: &str,
        _temperature: f32,
        _sender: tokio::sync::mpsc::Sender<String>,
    ) -> Result<(), WeaveError> {
        Ok(())
    }
}

#[async_trait::async_trait]
impl EmbeddingModel for OllamaProvider {
    async fn generate_embedding(&self, text: &str, model: &str) -> Result<Vec<f32>, WeaveError> {
        let url = format!("{}/api/embeddings", self.base_url);
        let response = self
            .client
            .post(&url)
            .json(&json!({
                "model": model,
                "prompt": text
            }))
            .send()
            .await
            .map_err(|e| WeaveError::AiError(format!("Ollama embedding HTTP error: {}", e)))?;

        let res_json: serde_json::Value = response
            .json()
            .await
            .map_err(|e| WeaveError::AiError(format!("Ollama embedding JSON error: {}", e)))?;

        if let Some(arr) = res_json["embedding"].as_array() {
            let vec: Vec<f32> = arr.iter().filter_map(|v| v.as_f64().map(|f| f as f32)).collect();
            Ok(vec)
        } else {
            Err(WeaveError::AiError("Invalid Ollama embedding format".into()))
        }
    }
}
