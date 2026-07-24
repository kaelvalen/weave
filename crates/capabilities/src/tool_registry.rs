use crate::utils::errors::WeaveError;
use parking_lot::RwLock;
use runtime_kernel::execution_context::ExecutionContext;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum MemoryAccessLevel {
    None,
    ReadOnly,
    ReadWrite,
}

impl Default for MemoryAccessLevel {
    fn default() -> Self {
        Self::None
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SideEffectLevel {
    None,
    Low,
    Medium,
    High,
    Destructive,
}

impl Default for SideEffectLevel {
    fn default() -> Self {
        Self::None
    }
}

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

    // Advanced Planner & Execution Metadataları
    pub confidence: f64,
    pub idempotent: bool,
    pub deterministic: bool,
    pub priority: i32,
    pub parallel_safe: bool,
    pub requires_confirmation: bool,
    pub estimated_latency_ms: u64,
    pub streaming: bool,
    pub memory_access: MemoryAccessLevel,
    pub side_effect_level: SideEffectLevel,
    pub rollback_support: bool,
    pub planner_tags: Vec<String>,
}

impl ToolDefinition {
    pub fn new(
        id: impl Into<String>,
        name: impl Into<String>,
        description: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            description: description.into(),
            input_schema: serde_json::json!({}),
            output_schema: serde_json::json!({}),
            side_effects: false,
            permissions: PermissionSpec::default(),
            estimated_cost_usd: 0.0,
            timeout_secs: 30,
            confidence: 1.0,
            idempotent: false,
            deterministic: true,
            priority: 0,
            parallel_safe: true,
            requires_confirmation: false,
            estimated_latency_ms: 100,
            streaming: false,
            memory_access: MemoryAccessLevel::None,
            side_effect_level: SideEffectLevel::None,
            rollback_support: false,
            planner_tags: vec![],
        }
    }
}

pub trait RegisteredPlugin: Send + Sync {
    fn id(&self) -> &'static str;
    fn definitions(&self) -> Vec<ToolDefinition>;
    fn execute(
        &self,
        capability: &str,
        params: Value,
        ctx: &ExecutionContext,
    ) -> Result<Value, WeaveError>;
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

    pub fn execute(
        &self,
        plugin_id: &str,
        capability: &str,
        params: Value,
        ctx: &ExecutionContext,
    ) -> Result<Value, WeaveError> {
        let executors = self.executors.read();
        if let Some(exec) = executors.get(plugin_id) {
            exec.execute(capability, params, ctx)
        } else {
            Err(WeaveError::PluginError(format!(
                "No registered plugin found for id: {}",
                plugin_id
            )))
        }
    }
}
