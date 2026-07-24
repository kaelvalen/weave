use crate::models::chat::ChatMessage;
use crate::utils::errors::WeaveError;
use serde_json::Value;

#[async_trait::async_trait]
pub trait ChatModel: Send + Sync {
    async fn chat_complete(
        &self,
        messages: &[ChatMessage],
        model: &str,
        temperature: f32,
    ) -> Result<String, WeaveError>;

    async fn chat_stream(
        &self,
        messages: &[ChatMessage],
        model: &str,
        temperature: f32,
        sender: tokio::sync::mpsc::Sender<String>,
    ) -> Result<(), WeaveError>;
}

#[async_trait::async_trait]
pub trait EmbeddingModel: Send + Sync {
    async fn generate_embedding(&self, text: &str, model: &str) -> Result<Vec<f32>, WeaveError>;
}

#[async_trait::async_trait]
pub trait VisionModel: Send + Sync {
    async fn analyze_image(
        &self,
        image_data_base64: &str,
        prompt: &str,
    ) -> Result<String, WeaveError>;
}

#[async_trait::async_trait]
pub trait SpeechModel: Send + Sync {
    async fn text_to_speech(&self, text: &str, voice: &str) -> Result<Vec<u8>, WeaveError>;
    async fn speech_to_text(&self, audio_data: &[u8]) -> Result<String, WeaveError>;
}

#[async_trait::async_trait]
pub trait ReasoningModel: Send + Sync {
    async fn reason(&self, context: &str, goal: &str) -> Result<Value, WeaveError>;
}
