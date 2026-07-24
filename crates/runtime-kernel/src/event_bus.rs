use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

use crate::runtime_event::RuntimeEvent;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SystemEvent {
    TaskStatusChanged { task_id: String, status: String },
    TaskCompleted { task_id: String, success: bool },
    ComponentLoaded { name: String },
    ComponentFailed { name: String, reason: String },
}

pub struct EventBus {
    sender: broadcast::Sender<SystemEvent>,
    runtime_sender: broadcast::Sender<RuntimeEvent>,
}

impl EventBus {
    pub fn new(capacity: usize) -> Self {
        let (sender, _) = broadcast::channel(capacity);
        let (runtime_sender, _) = broadcast::channel(capacity);
        Self {
            sender,
            runtime_sender,
        }
    }

    pub fn publish(&self, event: SystemEvent) {
        // Ignore send errors, which occur when there are no active receivers
        let _ = self.sender.send(event);
    }

    pub fn subscribe(&self) -> broadcast::Receiver<SystemEvent> {
        self.sender.subscribe()
    }

    /// Publish a structured runtime event on the dedicated runtime topic.
    /// Never fails the caller: send errors (no active receivers) are ignored.
    pub fn publish_runtime(&self, event: RuntimeEvent) {
        let _ = self.runtime_sender.send(event);
    }

    pub fn subscribe_runtime(&self) -> broadcast::Receiver<RuntimeEvent> {
        self.runtime_sender.subscribe()
    }
}
