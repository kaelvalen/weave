use reqwest::Client;
use serde_json::json;
use crate::core::ai::traits::ChatModel;
use crate::models::chat::ChatMessage;
use crate::utils::errors::WeaveError;

pub struct LlamaCppProvider {
    client: Client,
    base_url: String,
}

impl LlamaCppProvider {
    pub fn new(base_url: Option<String>) -> Self {
        Self {
            client: Client::new(),
            base_url: base_url.unwrap_or_else(|| "http://localhost:8080".to_string()),
        }
    }
}

#[async_trait::async_trait]
impl ChatModel for LlamaCppProvider {
    async fn chat_complete(
        &self,
        messages: &[ChatMessage],
        _model: &str,
        temperature: f32,
    ) -> Result<String, WeaveError> {
        let url = format!("{}/v1/chat/completions", self.base_url);
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
                "messages": formatted_messages,
                "temperature": temperature
            }))
            .send()
            .await
            .map_err(|e| WeaveError::AiError(format!("llama.cpp HTTP error: {}", e)))?;

        let res_json: serde_json::Value = response
            .json()
            .await
            .map_err(|e| WeaveError::AiError(format!("llama.cpp JSON error: {}", e)))?;

        let content = res_json["choices"][0]["message"]["content"]
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
