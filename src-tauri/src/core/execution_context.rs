use std::path::PathBuf;
use std::sync::Arc;
use parking_lot::RwLock;
use tokio_util::sync::CancellationToken;
use serde::{Deserialize, Serialize};

use crate::utils::config::AppConfig;
use crate::core::event_bus::EventBus;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgressMessage {
    pub task_id: String,
    pub step: String,
    pub progress_percent: f32,
    pub message: String,
}

#[derive(Clone)]
pub struct ExecutionContext {
    pub session_id: String,
    pub workspace_root: PathBuf,
    pub config: Arc<RwLock<AppConfig>>,
    pub event_bus: Arc<EventBus>,
    pub cancellation_token: CancellationToken,
    pub progress_tx: Option<tokio::sync::mpsc::Sender<ProgressMessage>>,
}

impl ExecutionContext {
    pub fn new(
        session_id: String,
        workspace_root: PathBuf,
        config: Arc<RwLock<AppConfig>>,
        event_bus: Arc<EventBus>,
    ) -> Self {
        Self {
            session_id,
            workspace_root,
            config,
            event_bus,
            cancellation_token: CancellationToken::new(),
            progress_tx: None,
        }
    }

    pub fn with_cancellation(mut self, token: CancellationToken) -> Self {
        self.cancellation_token = token;
        self
    }

    pub fn with_progress(mut self, tx: tokio::sync::mpsc::Sender<ProgressMessage>) -> Self {
        self.progress_tx = Some(tx);
        self
    }

    pub async fn report_progress(&self, task_id: &str, step: &str, percent: f32, msg: &str) {
        if let Some(ref tx) = self.progress_tx {
            let _ = tx.send(ProgressMessage {
                task_id: task_id.to_string(),
                step: step.to_string(),
                progress_percent: percent,
                message: msg.to_string(),
            }).await;
        }
    }
}
