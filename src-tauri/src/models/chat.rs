use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: String,
    pub role: ChatRole,
    pub content: String,
    pub timestamp: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<MessageMetadata>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub images: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ChatRole {
    User,
    Assistant,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens_used: Option<u32>,
    #[serde(default)]
    pub plugin_calls: Vec<PluginCall>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub intent: Option<IntentResult>,
    #[serde(rename = "isHidden", skip_serializing_if = "Option::is_none")]
    pub is_hidden: Option<bool>,
    /// The model's reasoning/thinking trace, streamed before content
    /// (DeepSeek, Qwen3, Kimi, thinking-enabled Claude). Rendered as an
    /// expandable trace; persisted so reloaded sessions keep it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
    #[serde(rename = "reasoningDone", skip_serializing_if = "Option::is_none")]
    pub reasoning_done: Option<bool>,
    #[serde(rename = "reasoningSeconds", skip_serializing_if = "Option::is_none")]
    pub reasoning_seconds: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginCall {
    /// Provider-side tool-call id (backend agent loop pairs results by this).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub call_id: Option<String>,
    pub plugin_id: String,
    pub capability: String,
    pub params: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    pub status: CallStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntentResult {
    pub intent: String,
    pub confidence: f64,
    pub plugins: Vec<String>,
    pub params: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum CallStatus {
    Pending,
    #[serde(rename = "pending_approval")]
    PendingApproval,
    Success,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfig {
    pub provider: Provider,
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_url: Option<String>,
    pub temperature: f64,
    pub max_tokens: u32,
}

pub use crate::utils::config::Provider;

impl ChatMessage {
    pub fn new_user(content: String) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            role: ChatRole::User,
            content,
            timestamp: current_timestamp(),
            metadata: None,
            images: None,
        }
    }

    pub fn new_assistant(content: String) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            role: ChatRole::Assistant,
            content,
            timestamp: current_timestamp(),
            metadata: Some(MessageMetadata {
                model: None,
                tokens_used: None,
                plugin_calls: Vec::new(),
                intent: None,
                is_hidden: None,
                reasoning: None,
                reasoning_done: None,
                reasoning_seconds: None,
            }),
            images: None,
        }
    }

    pub fn append_content(&mut self, chunk: &str) {
        self.content.push_str(chunk);
    }
}

impl MessageMetadata {
    pub fn add_plugin_call(&mut self, call: PluginCall) {
        self.plugin_calls.push(call);
    }
}

fn current_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
