use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use crate::core::capability_registry::CapabilityRegistry;
use crate::core::execution_context::ExecutionContext;
use crate::utils::errors::WeaveError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowStep {
    pub id: String,
    pub plugin_id: String,
    pub capability: String,
    pub params: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowDefinition {
    pub id: String,
    pub name: String,
    pub description: String,
    pub steps: Vec<WorkflowStep>,
}

pub struct WorkflowEngine {
    capability_registry: Arc<CapabilityRegistry>,
    workflows: parking_lot::RwLock<HashMap<String, WorkflowDefinition>>,
}

impl WorkflowEngine {
    pub fn new(capability_registry: Arc<CapabilityRegistry>) -> Self {
        Self {
            capability_registry,
            workflows: parking_lot::RwLock::new(HashMap::new()),
        }
    }

    pub fn register_workflow(&self, wf: WorkflowDefinition) {
        self.workflows.write().insert(wf.id.clone(), wf);
    }

    pub async fn run_workflow(
        &self,
        workflow_id: &str,
        ctx: &ExecutionContext,
    ) -> Result<Vec<Value>, WeaveError> {
        let wf = {
            let guard = self.workflows.read();
            guard.get(workflow_id).cloned().ok_or_else(|| {
                WeaveError::PluginError(format!("Workflow not found: {}", workflow_id))
            })?
        };

        let mut results = Vec::new();
        for step in wf.steps {
            let res = self.capability_registry.execute(
                &step.plugin_id,
                &step.capability,
                step.params,
                ctx,
            )?;
            results.push(res);
        }

        Ok(results)
    }
}
