use std::sync::Arc;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tracing::{debug, error, info, warn};

use crate::core::plugin_manager::PluginManager;
use crate::utils::errors::WeaveError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowStep {
    pub id: String,
    pub plugin_id: String,
    pub capability: String,
    pub params: serde_json::Value,
    #[serde(default)]
    pub input_from: Option<String>,
    #[serde(default = "default_timeout")]
    pub timeout_ms: u64,
    #[serde(default)]
    pub continue_on_error: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepResult {
    pub step_id: String,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub execution_time_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowResult {
    pub workflow_id: String,
    pub steps: Vec<StepResult>,
    pub overall_success: bool,
    pub total_execution_time_ms: u64,
}

fn default_timeout() -> u64 {
    30000
}

pub struct WorkflowEngine {
    plugin_manager: Arc<PluginManager>,
}

impl WorkflowEngine {
    pub fn new(plugin_manager: Arc<PluginManager>) -> Self {
        Self { plugin_manager }
    }

    pub async fn execute_chain(
        &self,
        steps: Vec<WorkflowStep>,
    ) -> Result<WorkflowResult, WeaveError> {
        let workflow_id = uuid::Uuid::new_v4().to_string();
        info!("Starting workflow {} with {} steps", workflow_id, steps.len());
        
        let mut step_results = Vec::new();
        let mut overall_success = true;
        let start_time = std::time::Instant::now();
        let mut previous_outputs: std::collections::HashMap<String, serde_json::Value> = std::collections::HashMap::new();

        for step in &steps {
            let step_start = std::time::Instant::now();
            
            let mut params = step.params.clone();
            
            if let Some(ref input_from) = step.input_from {
                if let Some(prev_output) = previous_outputs.get(input_from) {
                    if let serde_json::Value::Object(ref mut map) = params {
                        map.insert("__input".to_string(), prev_output.clone());
                    }
                }
            }

            let result = tokio::time::timeout(
                tokio::time::Duration::from_millis(step.timeout_ms),
                self.plugin_manager.execute_capability(&step.plugin_id, &step.capability, params.clone()),
            ).await;

            let execution_time = step_start.elapsed().as_millis() as u64;

            let step_result = match result {
                Ok(Ok(output)) => {
                    previous_outputs.insert(step.id.clone(), output.clone());
                    StepResult {
                        step_id: step.id.clone(),
                        success: true,
                        output: Some(output),
                        error: None,
                        execution_time_ms: execution_time,
                    }
                }
                Ok(Err(e)) => {
                    let error_msg = e.to_string();
                    warn!("Step {} failed: {}", step.id, error_msg);
                    
                    if !step.continue_on_error {
                        overall_success = false;
                    }
                    
                    StepResult {
                        step_id: step.id.clone(),
                        success: false,
                        output: None,
                        error: Some(error_msg),
                        execution_time_ms: execution_time,
                    }
                }
                Err(_) => {
                    let error_msg = format!("Step {} timed out after {}ms", step.id, step.timeout_ms);
                    warn!("{}", error_msg);
                    
                    if !step.continue_on_error {
                        overall_success = false;
                    }
                    
                    StepResult {
                        step_id: step.id.clone(),
                        success: false,
                        output: None,
                        error: Some(error_msg),
                        execution_time_ms: execution_time,
                    }
                }
            };

            step_results.push(step_result);

            if !overall_success {
                break;
            }
        }

        let total_time = start_time.elapsed().as_millis() as u64;
        
        info!(
            "Workflow {} completed in {}ms (success: {})",
            workflow_id, total_time, overall_success
        );

        Ok(WorkflowResult {
            workflow_id,
            steps: step_results,
            overall_success,
            total_execution_time_ms: total_time,
        })
    }

    pub async fn execute_single_step(
        &self,
        plugin_id: String,
        capability: String,
        params: serde_json::Value,
    ) -> Result<StepResult, WeaveError> {
        let step_id = uuid::Uuid::new_v4().to_string();
        let start_time = std::time::Instant::now();

        let result = self.plugin_manager
            .execute_capability(&plugin_id, &capability, params)
            .await;

        let execution_time = start_time.elapsed().as_millis() as u64;

        match result {
            Ok(output) => Ok(StepResult {
                step_id,
                success: true,
                output: Some(output),
                error: None,
                execution_time_ms: execution_time,
            }),
            Err(e) => Ok(StepResult {
                step_id,
                success: false,
                output: None,
                error: Some(e.to_string()),
                execution_time_ms: execution_time,
            }),
        }
    }
}
