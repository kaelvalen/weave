use std::path::PathBuf;
use std::sync::Arc;
use parking_lot::RwLock;
use tokio_util::sync::CancellationToken;
use serde::{Deserialize, Serialize};

use crate::utils::config::AppConfig;
use crate::core::event_bus::EventBus;
use crate::core::event_sourcing::EventSourcingStore;
use crate::core::memory::memory_engine::MemoryEngine;
use crate::core::observability::Observability;
use crate::core::registries::permission_registry::PermissionRegistry;
use crate::core::registries::planner_index::PlannerIndex;
use crate::core::scheduler::Scheduler;

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
    pub memory: Option<Arc<MemoryEngine>>,
    pub observability: Option<Arc<Observability>>,
    pub permission: Option<Arc<PermissionRegistry>>,
    pub scheduler: Option<Arc<Scheduler>>,
    pub planner_index: Option<Arc<PlannerIndex>>,
    pub event_store: Option<Arc<EventSourcingStore>>,
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
            memory: None,
            observability: None,
            permission: None,
            scheduler: None,
            planner_index: None,
            event_store: None,
            cancellation_token: CancellationToken::new(),
            progress_tx: None,
        }
    }

    pub fn with_subsystems(
        mut self,
        memory: Arc<MemoryEngine>,
        observability: Arc<Observability>,
        permission: Arc<PermissionRegistry>,
        scheduler: Arc<Scheduler>,
        planner_index: Arc<PlannerIndex>,
        event_store: Arc<EventSourcingStore>,
    ) -> Self {
        self.memory = Some(memory);
        self.observability = Some(observability);
        self.permission = Some(permission);
        self.scheduler = Some(scheduler);
        self.planner_index = Some(planner_index);
        self.event_store = Some(event_store);
        self
    }

    pub fn memory(&self) -> Option<&Arc<MemoryEngine>> {
        self.memory.as_ref()
    }

    pub fn events(&self) -> &Arc<EventBus> {
        &self.event_bus
    }

    pub fn policy(&self) -> Option<&Arc<PermissionRegistry>> {
        self.permission.as_ref()
    }

    pub fn metrics(&self) -> Option<&Arc<Observability>> {
        self.observability.as_ref()
    }

    pub fn scheduler(&self) -> Option<&Arc<Scheduler>> {
        self.scheduler.as_ref()
    }

    pub fn planner_index(&self) -> Option<&Arc<PlannerIndex>> {
        self.planner_index.as_ref()
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
            let _ = tx.send(ProgressMessage {
                task_id: task_id.to_string(),
                step: step.to_string(),
                progress_percent: percent,
                message: msg.to_string(),
            }).await;
        }
    }
}
