use crate::tool_registry::ToolDefinition;
use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::Arc;

pub struct CapabilityRegistry {
    tools: Arc<RwLock<HashMap<String, ToolDefinition>>>,
    semantic_aliases: Arc<RwLock<HashMap<String, String>>>,
}

impl CapabilityRegistry {
    pub fn new() -> Self {
        let registry = Self {
            tools: Arc::new(RwLock::new(HashMap::new())),
            semantic_aliases: Arc::new(RwLock::new(HashMap::new())),
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

    pub fn register_tool(&self, def: ToolDefinition) {
        self.tools.write().insert(def.id.clone(), def);
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
}
