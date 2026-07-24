use parking_lot::RwLock;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tracing::info;

use crate::utils::errors::WeaveError;
use capabilities::tool_registry::RegisteredPlugin;
use runtime_kernel::event_bus::SystemEvent;
use runtime_kernel::execution_context::ExecutionContext;
use runtime_kernel::runtime_event::{RuntimeEvent, RuntimeEventKind};

pub struct ExecutionRegistry {
    executors: Arc<RwLock<HashMap<String, Arc<dyn RegisteredPlugin>>>>,
}

impl ExecutionRegistry {
    pub fn new() -> Self {
        Self {
            executors: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn register<T: RegisteredPlugin + 'static>(&self, plugin: T) {
        let plugin_arc = Arc::new(plugin);
        let id = plugin_arc.id().to_string();
        self.executors.write().insert(id.clone(), plugin_arc);
        info!("ExecutionRegistry registered plugin executor: {}", id);
    }

    pub fn execute(
        &self,
        plugin_id: &str,
        capability: &str,
        params: Value,
        ctx: &ExecutionContext,
    ) -> Result<Value, WeaveError> {
        // Policy checks should happen in the Executor, before calling the Registry.

        let start_time = Instant::now();
        let executors = self.executors.read();

        let res = if let Some(exec) = executors.get(plugin_id) {
            exec.execute(capability, params, ctx)
        } else {
            Err(WeaveError::PluginError(format!(
                "No registered executor found for id: {}",
                plugin_id
            )))
        };

        let duration_ms = start_time.elapsed().as_millis() as u64;

        // Emit an event that the plugin executed, decoupled subsystems (Observability, PlannerIndex)
        // will listen and update themselves.
        // NOTE: ComponentLoaded is a legacy misuse kept for compatibility;
        // the structured runtime topic below is the canonical signal.
        ctx.event_bus.publish(SystemEvent::ComponentLoaded {
            name: format!("PluginExecution:{}", capability),
        });

        let mut event = RuntimeEvent::new(
            if res.is_ok() {
                RuntimeEventKind::StepSucceeded
            } else {
                RuntimeEventKind::StepFailed
            },
            uuid::Uuid::new_v4().to_string(),
            format!("Executed {}::{}", plugin_id, capability),
        );
        event.plugin_id = Some(plugin_id.to_string());
        event.capability = Some(capability.to_string());
        event.latency_ms = Some(duration_ms);
        ctx.event_bus.publish_runtime(event);

        res
    }
}
