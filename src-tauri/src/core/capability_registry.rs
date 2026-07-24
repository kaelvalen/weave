use parking_lot::RwLock;
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tracing::info;

use crate::core::execution_context::ExecutionContext;
use crate::core::policy_engine::{PolicyDecision, PolicyEngine};
use crate::core::tool_registry::{RegisteredPlugin, ToolDefinition};
use crate::models::plugin::Plugin;
use crate::utils::errors::WeaveError;

pub struct CapabilityRegistry {
    tools: Arc<RwLock<HashMap<String, ToolDefinition>>>,
    semantic_aliases: Arc<RwLock<HashMap<String, String>>>, // e.g. "ReadDocument" -> "file.read"
    executors: Arc<RwLock<HashMap<String, Arc<dyn RegisteredPlugin>>>>,
    plugins: Arc<RwLock<HashMap<String, Plugin>>>,
    policy_engine: Arc<PolicyEngine>,
    _plugin_dir: PathBuf,
}

impl CapabilityRegistry {
    pub fn new(plugin_dir: PathBuf, policy_engine: Arc<PolicyEngine>) -> Self {
        let registry = Self {
            tools: Arc::new(RwLock::new(HashMap::new())),
            semantic_aliases: Arc::new(RwLock::new(HashMap::new())),
            executors: Arc::new(RwLock::new(HashMap::new())),
            plugins: Arc::new(RwLock::new(HashMap::new())),
            policy_engine,
            _plugin_dir: plugin_dir,
        };

        registry.register_default_aliases();
        registry
    }

    fn register_default_aliases(&self) {
        let mut aliases = self.semantic_aliases.write();
        aliases.insert("ReadDocument".into(), "file.read".into());
        aliases.insert("WriteDocument".into(), "file.write".into());
        aliases.insert("ListDirectory".into(), "file.list".into());
        aliases.insert("SearchFiles".into(), "file.search".into());
        aliases.insert("EvaluateExpression".into(), "calc.eval".into());
        aliases.insert("ExecuteShell".into(), "shell.execute".into());
        aliases.insert("SearchMemory".into(), "memory.search".into());
        aliases.insert("CreateNote".into(), "note.create".into());
        aliases.insert("RunWorkflow".into(), "workflow.run".into());
    }

    pub fn register_plugin<T: RegisteredPlugin + 'static>(&self, plugin: T, plugin_meta: Plugin) {
        let plugin_arc = Arc::new(plugin);
        let mut tools = self.tools.write();
        let mut executors = self.executors.write();
        let mut plugins = self.plugins.write();

        let plugin_id = plugin_arc.id().to_string();
        for def in plugin_arc.definitions() {
            tools.insert(def.id.clone(), def);
        }

        executors.insert(plugin_id.clone(), plugin_arc);
        plugins.insert(plugin_id.clone(), plugin_meta);
        info!("CapabilityRegistry registered plugin: {}", plugin_id);
    }

    pub fn resolve_capability(&self, cap: &str) -> String {
        let aliases = self.semantic_aliases.read();
        aliases.get(cap).cloned().unwrap_or_else(|| cap.to_string())
    }

    pub fn get_tool(&self, tool_id: &str) -> Option<ToolDefinition> {
        let resolved = self.resolve_capability(tool_id);
        self.tools.read().get(&resolved).cloned()
    }

    pub fn list_tools(&self) -> Vec<ToolDefinition> {
        self.tools.read().values().cloned().collect()
    }

    pub fn list_plugins(&self) -> Vec<Plugin> {
        self.plugins.read().values().cloned().collect()
    }

    pub fn execute(
        &self,
        plugin_id: &str,
        capability: &str,
        params: Value,
        ctx: &ExecutionContext,
    ) -> Result<Value, WeaveError> {
        let resolved_cap = self.resolve_capability(capability);

        // Security Policy Check for Shell capability
        if resolved_cap == "shell.execute" {
            if let Some(cmd) = params.get("command").and_then(|v| v.as_str()) {
                match self.policy_engine.check_command_execution(cmd) {
                    PolicyDecision::Allow => {}
                    PolicyDecision::RequiresConfirmation { reason } => {
                        return Err(WeaveError::PluginError(format!(
                            "Policy requires confirmation: {}",
                            reason
                        )));
                    }
                    PolicyDecision::Deny { reason } => {
                        return Err(WeaveError::PluginError(format!(
                            "Policy denied command execution: {}",
                            reason
                        )));
                    }
                }
            }
        }

        let executors = self.executors.read();
        if let Some(exec) = executors.get(plugin_id) {
            exec.execute(&resolved_cap, params, ctx)
        } else {
            Err(WeaveError::PluginError(format!(
                "No registered plugin found for id: {}",
                plugin_id
            )))
        }
    }
}
