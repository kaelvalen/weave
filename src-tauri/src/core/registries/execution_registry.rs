use parking_lot::RwLock;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tracing::info;

use crate::core::execution_context::ExecutionContext;
use crate::core::policy_engine::PolicyDecision;
use crate::core::tool_registry::RegisteredPlugin;
use crate::utils::errors::WeaveError;

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
        // 1. Centralized Policy Engine check
        if let Some(ref permission_registry) = ctx.permission {
            if capability == "shell.exec" || capability == "shell.execute" {
                if let Some(cmd) = params.get("command").and_then(|v| v.as_str()) {
                    match permission_registry.check_command(cmd) {
                        PolicyDecision::Allow => {}
                        PolicyDecision::RequiresConfirmation { reason } => {
                            return Err(WeaveError::PermissionDenied(format!(
                                "Policy requires confirmation: {}",
                                reason
                            )));
                        }
                        PolicyDecision::Deny { reason } => {
                            return Err(WeaveError::PermissionDenied(format!(
                                "Policy denied execution: {}",
                                reason
                            )));
                        }
                    }
                }
            }
        }

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

        // 2. Centralized Observability & Telemetry record
        if let Some(ref obs) = ctx.observability {
            obs.record_tool_execution(capability, duration_ms, res.is_ok());
        }

        // 3. Centralized Tool Score Feedback record
        if let Some(ref planner_idx) = ctx.planner_index {
            planner_idx.record_feedback(capability, duration_ms, res.is_ok());
        }

        res
    }
}
