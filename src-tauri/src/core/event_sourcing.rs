use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CQRSReadModel {
    pub total_tasks: u64,
    pub total_successes: u64,
    pub total_failures: u64,
    pub active_plans: HashMap<String, usize>,
    pub capability_usage_counts: HashMap<String, u64>,
}

pub struct EventSourcingStore {
    records: Arc<RwLock<Vec<AuditRecord>>>,
    read_model: Arc<RwLock<CQRSReadModel>>,
}

impl EventSourcingStore {
    pub fn new() -> Self {
        Self {
            records: Arc::new(RwLock::new(Vec::new())),
            read_model: Arc::new(RwLock::new(CQRSReadModel::default())),
        }
    }

    pub fn append(&self, event: AuditEventType, metadata: Value) {
        let record = AuditRecord {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            event: event.clone(),
            metadata,
        };

        self.records.write().push(record);
        self.project_event(&event);
    }

    fn project_event(&self, event: &AuditEventType) {
        let mut model = self.read_model.write();
        match event {
            AuditEventType::TaskCreated { .. } => {
                model.total_tasks += 1;
            }
            AuditEventType::ExecutionFinished { success, .. } => {
                if *success {
                    model.total_successes += 1;
                } else {
                    model.total_failures += 1;
                }
            }
            AuditEventType::CapabilitySelected { capability_id, .. } => {
                *model.capability_usage_counts.entry(capability_id.clone()).or_default() += 1;
            }
            AuditEventType::TaskPlanned { plan_id, node_count } => {
                model.active_plans.insert(plan_id.clone(), *node_count);
            }
            _ => {}
        }
    }

    pub fn list_records(&self) -> Vec<AuditRecord> {
        self.records.read().clone()
    }

    pub fn get_read_model(&self) -> CQRSReadModel {
        self.read_model.read().clone()
    }

    pub fn replay_events(&self) -> Vec<AuditRecord> {
        self.list_records()
    }
}
