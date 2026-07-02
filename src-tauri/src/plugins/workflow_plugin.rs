use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tracing::{info, warn};

use crate::models::plugin::PluginExecutor;
use crate::utils::config::AppConfig;
use crate::utils::errors::WeaveError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowDefinition {
    pub id: String,
    pub name: String,
    pub description: String,
    pub nodes: Vec<Value>,
    pub edges: Vec<Value>,
    #[serde(with = "chrono::serde::ts_seconds")]
    pub created_at: DateTime<Utc>,
    #[serde(with = "chrono::serde::ts_seconds")]
    pub updated_at: DateTime<Utc>,
}

pub struct WorkflowPlugin;

impl PluginExecutor for WorkflowPlugin {
    fn execute(&self, capability: &str, params: Value) -> Result<Value, WeaveError> {
        WorkflowPlugin::execute(capability, params)
    }
}

impl WorkflowPlugin {
    pub fn execute(capability: &str, params: Value) -> Result<Value, WeaveError> {
        match capability {
            "workflow.create" => Self::create(params),
            "workflow.list" => Self::list(),
            "workflow.get" => Self::get(params),
            "workflow.delete" => Self::delete(params),
            _ => Err(WeaveError::CapabilityNotFound(capability.to_string())),
        }
    }

    fn workflow_to_json(wf: &WorkflowDefinition) -> Value {
        json!({
            "id": wf.id,
            "name": wf.name,
            "description": wf.description,
            "nodes": wf.nodes,
            "edges": wf.edges,
            "created_at": wf.created_at.timestamp(),
            "updated_at": wf.updated_at.timestamp(),
        })
    }

    fn create(params: Value) -> Result<Value, WeaveError> {
        let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("Automated AI Workflow");
        let description = params.get("description").and_then(|v| v.as_str()).unwrap_or("");
        let nodes = params.get("nodes").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        let edges = params.get("edges").and_then(|v| v.as_array()).cloned().unwrap_or_default();

        let workflows_dir = AppConfig::workflows_dir()?;
        std::fs::create_dir_all(&workflows_dir)?;
        
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now();
        let wf = WorkflowDefinition {
            id: id.clone(),
            name: name.to_string(),
            description: description.to_string(),
            nodes,
            edges,
            created_at: now,
            updated_at: now,
        };

        let file_path = workflows_dir.join(format!("{}.json", id));
        let wf_json = serde_json::to_string_pretty(&wf).map_err(|e| WeaveError::Serialization(e.to_string()))?;
        std::fs::write(&file_path, wf_json)?;
        
        info!("Created workflow template: {} ({}) in {:?}", name, id, file_path);
        Ok(json!({"workflow": Self::workflow_to_json(&wf), "success": true}))
    }

    fn list() -> Result<Value, WeaveError> {
        let workflows = Self::load_all_workflows()?;
        let wf_jsons: Vec<Value> = workflows.iter().map(|w| Self::workflow_to_json(w)).collect();
        info!("Listed {} workflow templates", wf_jsons.len());
        Ok(json!({"workflows": wf_jsons, "count": wf_jsons.len(), "success": true}))
    }

    fn get(params: Value) -> Result<Value, WeaveError> {
        let id = params.get("id").and_then(|v| v.as_str())
            .ok_or_else(|| WeaveError::PluginError("Missing 'id' parameter".to_string()))?;
        let workflows_dir = AppConfig::workflows_dir()?;
        let file_path = workflows_dir.join(format!("{}.json", id));
        if !file_path.exists() {
            return Err(WeaveError::PluginError(format!("Workflow not found: {}", id)));
        }
        let content = std::fs::read_to_string(&file_path)?;
        let wf: WorkflowDefinition = serde_json::from_str(&content).map_err(|e| WeaveError::Serialization(e.to_string()))?;
        Ok(json!({"workflow": Self::workflow_to_json(&wf), "success": true}))
    }

    fn delete(params: Value) -> Result<Value, WeaveError> {
        let id = params.get("id").and_then(|v| v.as_str())
            .ok_or_else(|| WeaveError::PluginError("Missing 'id' parameter".to_string()))?;
        let workflows_dir = AppConfig::workflows_dir()?;
        let file_path = workflows_dir.join(format!("{}.json", id));
        if !file_path.exists() {
            return Err(WeaveError::PluginError(format!("Workflow not found: {}", id)));
        }
        std::fs::remove_file(&file_path)?;
        info!("Deleted workflow template: {}", id);
        Ok(json!({"deleted_id": id, "success": true}))
    }

    fn load_all_workflows() -> Result<Vec<WorkflowDefinition>, WeaveError> {
        let workflows_dir = AppConfig::workflows_dir()?;
        if !workflows_dir.exists() {
            return Ok(Vec::new());
        }
        let mut workflows = Vec::new();
        for entry in std::fs::read_dir(&workflows_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                match std::fs::read_to_string(&path) {
                    Ok(content) => match serde_json::from_str::<WorkflowDefinition>(&content) {
                        Ok(wf) => workflows.push(wf),
                        Err(e) => { warn!("Failed to parse workflow at {:?}: {}", path, e); }
                    },
                    Err(e) => { warn!("Failed to read workflow at {:?}: {}", path, e); }
                }
            }
        }
        workflows.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(workflows)
    }
}
