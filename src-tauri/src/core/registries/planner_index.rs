use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::Arc;
use crate::core::tool_registry::{SideEffectLevel, ToolDefinition};

pub struct PlannerIndex {
    tools_by_tag: Arc<RwLock<HashMap<String, Vec<ToolDefinition>>>>,
    all_tools: Arc<RwLock<HashMap<String, ToolDefinition>>>,
}

impl PlannerIndex {
    pub fn new() -> Self {
        Self {
            tools_by_tag: Arc::new(RwLock::new(HashMap::new())),
            all_tools: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn index_tool(&self, def: ToolDefinition) {
        let mut tools = self.all_tools.write();
        let mut by_tag = self.tools_by_tag.write();

        tools.insert(def.id.clone(), def.clone());

        for tag in &def.planner_tags {
            by_tag.entry(tag.clone()).or_default().push(def.clone());
        }
    }

    pub fn find_by_tag(&self, tag: &str) -> Vec<ToolDefinition> {
        self.tools_by_tag.read().get(tag).cloned().unwrap_or_default()
    }

    pub fn find_parallel_safe(&self) -> Vec<ToolDefinition> {
        self.all_tools
            .read()
            .values()
            .filter(|t| t.parallel_safe)
            .cloned()
            .collect()
    }

    pub fn find_non_destructive(&self) -> Vec<ToolDefinition> {
        self.all_tools
            .read()
            .values()
            .filter(|t| t.side_effect_level != SideEffectLevel::Destructive && t.side_effect_level != SideEffectLevel::High)
            .cloned()
            .collect()
    }

    pub fn list_all(&self) -> Vec<ToolDefinition> {
        self.all_tools.read().values().cloned().collect()
    }
}
