use reqwest::Client;
use serde_json::json;
use crate::traits::ChatModel;
use crate::models::chat::ChatMessage;
use crate::utils::errors::WeaveError;

pub struct AnthropicProvider {
    client: Client,
    api_key: String,
    base_url: String,
}

impl AnthropicProvider {
    pub fn new(api_key: String, base_url: Option<String>) -> Self {
        Self {
            client: Client::new(),
            api_key,
            base_url: base_url.unwrap_or_else(|| "https://api.anthropic.com/v1".to_string()),
        }
    }
}

#[async_trait::async_trait]
impl ChatModel for AnthropicProvider {
    async fn chat_complete(
        &self,
        messages: &[ChatMessage],
        model: &str,
        temperature: f32,
    ) -> Result<String, WeaveError> {
        let url = format!("{}/messages", self.base_url);
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
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&json!({
                "model": model,
                "messages": formatted_messages,
                "max_tokens": 4096,
                "temperature": temperature
            }))
            .send()
            .await
            .map_err(|e| WeaveError::AiError(format!("Anthropic HTTP error: {}", e)))?;

        let res_json: serde_json::Value = response
            .json()
            .await
            .map_err(|e| WeaveError::AiError(format!("Anthropic JSON error: {}", e)))?;

        let content = res_json["content"][0]["text"]
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
