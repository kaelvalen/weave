use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use parking_lot::RwLock;
use crate::utils::errors::WeaveError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionSpec {
    pub read_paths: Vec<String>,
    pub write_paths: Vec<String>,
    pub network_domains: Vec<String>,
    pub process_allowlist: Vec<String>,
}

impl Default for PermissionSpec {
    fn default() -> Self {
        Self {
            read_paths: vec!["file://*".to_string()],
            write_paths: vec!["file://*".to_string()],
            network_domains: vec![],
            process_allowlist: vec![],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub id: String,
    pub name: String,
    pub description: String,
    pub input_schema: Value,
    pub output_schema: Value,
    pub side_effects: bool,
    pub permissions: PermissionSpec,
    pub estimated_cost_usd: f64,
    pub timeout_secs: u64,
}

pub trait RegisteredPlugin: Send + Sync {
    fn id(&self) -> &'static str;
    fn definitions(&self) -> Vec<ToolDefinition>;
    fn execute(&self, capability: &str, params: Value) -> Result<Value, WeaveError>;
}

#[derive(Default, Clone)]
pub struct PluginRegistry {
    tools: Arc<RwLock<HashMap<String, ToolDefinition>>>,
    executors: Arc<RwLock<HashMap<String, Arc<dyn RegisteredPlugin>>>>,
}

impl PluginRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register<T: RegisteredPlugin + 'static>(&self, plugin: T) {
        let plugin_arc = Arc::new(plugin);
        let mut tools = self.tools.write();
        let mut executors = self.executors.write();

        for def in plugin_arc.definitions() {
            tools.insert(def.id.clone(), def);
            executors.insert(plugin_arc.id().to_string(), plugin_arc.clone());
        }
    }

    pub fn get_tool(&self, tool_id: &str) -> Option<ToolDefinition> {
        self.tools.read().get(tool_id).cloned()
    }

    pub fn list_tools(&self) -> Vec<ToolDefinition> {
        self.tools.read().values().cloned().collect()
    }

    pub fn execute(&self, plugin_id: &str, capability: &str, params: Value) -> Result<Value, WeaveError> {
        let executors = self.executors.read();
        if let Some(exec) = executors.get(plugin_id) {
            exec.execute(capability, params)
        } else {
            Err(WeaveError::PluginError(format!("No registered plugin found for id: {}", plugin_id)))
        }
    }
}
