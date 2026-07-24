use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::time::sleep;
use tracing::info;

use runtime_kernel::event_bus::{EventBus, SystemEvent};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduledTask {
    pub id: String,
    pub name: String,
    pub payload: serde_json::Value,
    pub interval_secs: Option<u64>,
}

#[derive(Clone)]
pub struct Scheduler {
    tasks: Arc<RwLock<HashMap<String, ScheduledTask>>>,
    event_bus: Arc<EventBus>,
}

impl Scheduler {
    pub fn new(event_bus: Arc<EventBus>) -> Self {
        Self {
            tasks: Arc::new(RwLock::new(HashMap::new())),
            event_bus,
        }
    }

    pub fn schedule_task(&self, task: ScheduledTask) {
        let task_id = task.id.clone();
        let name = task.name.clone();
        self.tasks.write().insert(task_id.clone(), task.clone());
        info!("Scheduler registered task: {} ({})", name, task_id);

        if let Some(interval) = task.interval_secs {
            let event_bus = self.event_bus.clone();
            tokio::spawn(async move {
                loop {
                    sleep(Duration::from_secs(interval)).await;
                    event_bus.publish(SystemEvent::TaskCompleted {
                        task_id: task_id.clone(),
                        success: true,
                    });
                }
            });
        }
    }

    pub fn schedule_once(&self, task: ScheduledTask, delay_secs: u64) {
        let task_id = task.id.clone();
        let event_bus = self.event_bus.clone();
        tokio::spawn(async move {
            sleep(Duration::from_secs(delay_secs)).await;
            event_bus.publish(SystemEvent::TaskCompleted {
                task_id,
                success: true,
            });
        });
    }

    pub fn list_tasks(&self) -> Vec<ScheduledTask> {
        self.tasks.read().values().cloned().collect()
    }
}
