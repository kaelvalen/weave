use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::broadcast;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum SystemEvent {
    PluginLoaded {
        plugin_id: String,
        name: String,
    },
    PluginUnloaded {
        plugin_id: String,
    },
    TaskStatusChanged {
        task_id: String,
        status: String,
    },
    PluginExecuted {
        plugin_id: String,
        capability: String,
        success: bool,
        duration_ms: u128,
        output: Value,
    },
    ToolExecuted {
        tool_id: String,
        capability: String,
        success: bool,
        duration_ms: u64,
    },
    WorkflowStarted {
        workflow_id: String,
    },
    WorkflowNodeCompleted {
        workflow_id: String,
        node_id: String,
        success: bool,
    },
    CanvasUpdated {
        action: String,
        payload: Value,
    },
    MemoryAdded {
        key: String,
        memory_type: String,
    },
    MemoryUpdated {
        key: String,
        operation: String,
    },
    SessionChanged {
        session_id: String,
    },
    PlanCreated {
        plan_id: String,
        step_count: usize,
    },
    TaskCompleted {
        task_id: String,
        success: bool,
    },
    LLMFinished {
        model: String,
        tokens_used: Option<u32>,
    },
    PolicyViolation {
        resource: String,
        reason: String,
    },
}

#[derive(Clone)]
pub struct EventBus {
    sender: broadcast::Sender<SystemEvent>,
}

impl EventBus {
    pub fn new(capacity: usize) -> Self {
        let (sender, _) = broadcast::channel(capacity);
        Self { sender }
    }

    pub fn publish(&self, event: SystemEvent) {
        let _ = self.sender.send(event);
    }

    pub fn subscribe(&self) -> broadcast::Receiver<SystemEvent> {
        self.sender.subscribe()
    }
}
