use std::sync::Arc;
use std::time::SystemTime;
use ai_runtime::traits::{ChatModel, EmbeddingModel};
use crate::models::chat::{ChatMessage, ChatRole};
use crate::utils::errors::WeaveError;

fn now_ts() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub struct ReasonerService {
    chat_model: Arc<dyn ChatModel>,
}

impl ReasonerService {
    pub fn new(chat_model: Arc<dyn ChatModel>) -> Self {
        Self { chat_model }
    }

    pub async fn reason(&self, goal: &str, context: &str) -> Result<String, WeaveError> {
        let messages = vec![
            ChatMessage {
                id: uuid::Uuid::new_v4().to_string(),
                role: ChatRole::System,
                content: "You are an AI Reasoning Engine. Analyze the goal and context, think step by step, and output a structured reasoning plan.".into(),
                timestamp: now_ts(),
                metadata: None,
                images: None,
            },
            ChatMessage {
                id: uuid::Uuid::new_v4().to_string(),
                role: ChatRole::User,
                content: format!("Goal: {}\nContext: {}", goal, context),
                timestamp: now_ts(),
                metadata: None,
                images: None,
            },
        ];

        self.chat_model.chat_complete(&messages, "gpt-4o", 0.2).await
    }
}

pub struct SummarizerService {
    chat_model: Arc<dyn ChatModel>,
}

impl SummarizerService {
    pub fn new(chat_model: Arc<dyn ChatModel>) -> Self {
        Self { chat_model }
    }

    pub async fn summarize(&self, text: &str) -> Result<String, WeaveError> {
        let messages = vec![
            ChatMessage {
                id: uuid::Uuid::new_v4().to_string(),
                role: ChatRole::User,
                content: format!("Summarize the following text concisely:\n{}", text),
                timestamp: now_ts(),
                metadata: None,
                images: None,
            },
        ];

        self.chat_model.chat_complete(&messages, "gpt-4o-mini", 0.3).await
    }
}

pub struct EmbedderService {
    embedding_model: Arc<dyn EmbeddingModel>,
}

impl EmbedderService {
    pub fn new(embedding_model: Arc<dyn EmbeddingModel>) -> Self {
        Self { embedding_model }
    }

    pub async fn embed(&self, text: &str) -> Result<Vec<f32>, WeaveError> {
        self.embedding_model.generate_embedding(text, "text-embedding-3-small").await
    }
}
