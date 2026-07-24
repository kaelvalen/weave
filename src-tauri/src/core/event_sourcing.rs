use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use std::time::SystemTime;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AuditEventType {
    TaskCreated { task_id: String, goal: String },
    TaskPlanned { plan_id: String, node_count: usize },
    CapabilitySelected { capability_id: String, tool_name: String },
    PermissionGranted { resource: String },
    ExecutionStarted { task_id: String, capability_id: String },
    ExecutionFinished { task_id: String, success: bool, duration_ms: u64 },
    ReflectionCompleted { task_id: String, score: f32 },
    RollbackTriggered { plan_id: String, failed_node: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditRecord {
    pub id: String,
    pub timestamp: u64,
    pub event: AuditEventType,
    pub metadata: Value,
}

pub struct EventSourcingStore {
    records: Arc<RwLock<Vec<AuditRecord>>>,
}

impl EventSourcingStore {
    pub fn new() -> Self {
        Self {
            records: Arc::new(RwLock::new(Vec::new())),
        }
    }

    pub fn append(&self, event: AuditEventType, metadata: Value) {
        let record = AuditRecord {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            event,
            metadata,
        };
        self.records.write().push(record);
    }

    pub fn list_records(&self) -> Vec<AuditRecord> {
        self.records.read().clone()
    }

    pub fn replay_events(&self) -> Vec<AuditRecord> {
        self.list_records()
    }
}
