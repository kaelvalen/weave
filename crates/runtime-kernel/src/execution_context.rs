use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

use crate::event_bus::EventBus;
use crate::event_store::EventSourcingStore;
use crate::observability::Observability;

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
    pub trace_id: String,
    pub span_id: String,
    pub scoped_task_id: Option<String>,
    pub workspace_root: PathBuf,
    pub config: Arc<RwLock<serde_json::Value>>,
    pub event_bus: Arc<EventBus>,
    pub observability: Option<Arc<Observability>>,
    pub event_store: Option<Arc<EventSourcingStore>>,
    pub cancellation_token: CancellationToken,
    pub progress_tx: Option<tokio::sync::mpsc::Sender<ProgressMessage>>,
}

impl ExecutionContext {
    pub fn new(
        session_id: String,
        workspace_root: PathBuf,
        config: Arc<RwLock<serde_json::Value>>,
        event_bus: Arc<EventBus>,
    ) -> Self {
        Self {
            session_id,
            trace_id: uuid::Uuid::new_v4().to_string(),
            span_id: uuid::Uuid::new_v4().to_string(),
            scoped_task_id: None,
            workspace_root,
            config,
            event_bus,
            observability: None,
            event_store: None,
            cancellation_token: CancellationToken::new(),
            progress_tx: None,
        }
    }

    pub fn with_subsystems(
        mut self,
        observability: Arc<Observability>,
        event_store: Arc<EventSourcingStore>,
    ) -> Self {
        self.observability = Some(observability);
        self.event_store = Some(event_store);
        self
    }

    pub fn child_span(&self) -> Self {
        let mut child = self.clone();
        child.span_id = uuid::Uuid::new_v4().to_string();
        child
    }

    pub fn child_scope(&self, task_id: &str) -> Self {
        let mut child = self.child_span();
        child.scoped_task_id = Some(task_id.to_string());
        child
    }

    pub fn events(&self) -> &Arc<EventBus> {
        &self.event_bus
    }

    pub fn metrics(&self) -> Option<&Arc<Observability>> {
        self.observability.as_ref()
    }

    pub fn event_store(&self) -> Option<&Arc<EventSourcingStore>> {
        self.event_store.as_ref()
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
            let _ = tx
                .send(ProgressMessage {
                    task_id: task_id.to_string(),
                    step: step.to_string(),
                    progress_percent: percent,
                    message: msg.to_string(),
                })
                .await;
        }
    }
}
