use reqwest::Client;
use serde_json::json;
use crate::traits::ChatModel;
use crate::models::chat::ChatMessage;
use crate::utils::errors::WeaveError;

pub struct VLLMProvider {
    client: Client,
    base_url: String,
}

impl VLLMProvider {
    pub fn new(base_url: Option<String>) -> Self {
        Self {
            client: Client::new(),
            base_url: base_url.unwrap_or_else(|| "http://localhost:8000/v1".to_string()),
        }
    }
}

#[async_trait::async_trait]
impl ChatModel for VLLMProvider {
    async fn chat_complete(
        &self,
        messages: &[ChatMessage],
        model: &str,
        temperature: f32,
    ) -> Result<String, WeaveError> {
        let url = format!("{}/chat/completions", self.base_url);
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
                "temperature": temperature
            }))
            .send()
            .await
            .map_err(|e| WeaveError::AiError(format!("vLLM HTTP error: {}", e)))?;

        let res_json: serde_json::Value = response
            .json()
            .await
            .map_err(|e| WeaveError::AiError(format!("vLLM JSON error: {}", e)))?;

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
