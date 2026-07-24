use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use crate::core::execution_context::ExecutionContext;
use crate::core::registries::execution_registry::ExecutionRegistry;
use crate::utils::errors::WeaveError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtifactBinding {
    pub name: String,
    pub source_step: Option<String>,
    pub source_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeclarativeStep {
    pub id: String,
    pub plugin_id: String,
    pub capability: String,
    pub params: Value,
    pub inputs: Vec<ArtifactBinding>,
    pub outputs: Vec<ArtifactBinding>,
    pub preconditions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeclarativeWorkflow {
    pub id: String,
    pub name: String,
    pub description: String,
    pub steps: Vec<DeclarativeStep>,
    pub parallel_branches: HashMap<String, Vec<String>>,
}

pub struct WorkflowEngine {
    execution_registry: Arc<ExecutionRegistry>,
    workflows: parking_lot::RwLock<HashMap<String, DeclarativeWorkflow>>,
}

impl WorkflowEngine {
    pub fn new(execution_registry: Arc<ExecutionRegistry>) -> Self {
        Self {
            execution_registry,
            workflows: parking_lot::RwLock::new(HashMap::new()),
        }
    }

    pub fn register_workflow(&self, wf: DeclarativeWorkflow) {
        self.workflows.write().insert(wf.id.clone(), wf);
    }

    pub fn parse_declarative_json(&self, json_str: &str) -> Result<DeclarativeWorkflow, WeaveError> {
        serde_json::from_str(json_str).map_err(|e| WeaveError::WorkflowError(e.to_string()))
    }

    pub async fn run_workflow(
        &self,
        workflow_id: &str,
        ctx: &ExecutionContext,
    ) -> Result<Vec<Value>, WeaveError> {
        let wf = {
            let guard = self.workflows.read();
            guard.get(workflow_id).cloned().ok_or_else(|| {
                WeaveError::WorkflowError(format!("Declarative workflow not found: {}", workflow_id))
            })?
        };

        let mut step_outputs: HashMap<String, Value> = HashMap::new();
        let mut results = Vec::new();

        for step in wf.steps {
            let mut resolved_params = step.params.clone();

            // Resolve Dataflow Artifact Inputs
            if let Some(obj) = resolved_params.as_object_mut() {
                for input_binding in &step.inputs {
                    if let Some(ref src_step) = input_binding.source_step {
                        if let Some(prev_out) = step_outputs.get(src_step) {
                            if let Some(val) = prev_out.get(&input_binding.source_key) {
                                obj.insert(input_binding.name.clone(), val.clone());
                            }
                        }
                    }
                }
            }

            let res = self.execution_registry.execute(
                &step.plugin_id,
                &step.capability,
                resolved_params,
                ctx,
            )?;

            step_outputs.insert(step.id.clone(), res.clone());
            results.push(res);
        }

        Ok(results)
    }
}
