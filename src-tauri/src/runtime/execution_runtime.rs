use crate::utils::errors::WeaveError;
use execution_runtime::execution_registry::ExecutionRegistry;
use runtime_kernel::execution_context::ExecutionContext;
use serde_json::Value;
use std::sync::Arc;

pub struct ExecutionRuntime {
    registry: Arc<ExecutionRegistry>,
}

impl ExecutionRuntime {
    pub fn new(registry: Arc<ExecutionRegistry>) -> Self {
        Self { registry }
    }

    pub fn dispatch(
        &self,
        plugin_id: &str,
        capability: &str,
        params: Value,
        ctx: &ExecutionContext,
    ) -> Result<Value, WeaveError> {
        self.registry
            .execute(plugin_id, capability, params, ctx)
            .map_err(|e| WeaveError::ExecutionError(e.to_string()))
    }
}
