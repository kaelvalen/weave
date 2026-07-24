use reqwest::Client;
use serde_json::json;
use crate::core::ai::traits::{ChatModel, EmbeddingModel};
use crate::models::chat::ChatMessage;
use crate::utils::errors::WeaveError;

pub struct OpenAIProvider {
    client: Client,
    api_key: String,
    base_url: String,
}

impl OpenAIProvider {
    pub fn new(api_key: String, base_url: Option<String>) -> Self {
        Self {
            client: Client::new(),
            api_key,
            base_url: base_url.unwrap_or_else(|| "https://api.openai.com/v1".to_string()),
        }
    }
}

#[async_trait::async_trait]
impl ChatModel for OpenAIProvider {
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
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&json!({
                "model": model,
                "messages": formatted_messages,
                "temperature": temperature
            }))
            .send()
            .await
            .map_err(|e| WeaveError::AiError(format!("OpenAI HTTP error: {}", e)))?;

        let res_json: serde_json::Value = response
            .json()
            .await
            .map_err(|e| WeaveError::AiError(format!("OpenAI JSON decode error: {}", e)))?;

        if let Some(error) = res_json.get("error") {
            return Err(WeaveError::AiError(format!("OpenAI API error: {:?}", error)));
        }

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
        // Stream implementation stub
        Ok(())
    }
}

#[async_trait::async_trait]
impl EmbeddingModel for OpenAIProvider {
    async fn generate_embedding(&self, text: &str, model: &str) -> Result<Vec<f32>, WeaveError> {
        let url = format!("{}/embeddings", self.base_url);
        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&json!({
                "model": model,
                "input": text
            }))
            .send()
            .await
            .map_err(|e| WeaveError::AiError(format!("OpenAI Embedding HTTP error: {}", e)))?;

        let res_json: serde_json::Value = response
            .json()
            .await
            .map_err(|e| WeaveError::AiError(format!("OpenAI Embedding JSON error: {}", e)))?;

        let embedding_val = &res_json["data"][0]["embedding"];
        if let Some(arr) = embedding_val.as_array() {
            let vec: Vec<f32> = arr.iter().filter_map(|v| v.as_f64().map(|f| f as f32)).collect();
            Ok(vec)
        } else {
            Err(WeaveError::AiError("Invalid embedding response format".into()))
        }
    }
}
