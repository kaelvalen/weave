use serde_json::Value;
use std::sync::Arc;
use runtime_kernel::execution_context::ExecutionContext;
use execution_runtime::execution_registry::ExecutionRegistry;
use crate::utils::errors::WeaveError;

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
        self.registry.execute(plugin_id, capability, params, ctx)
    }
}
