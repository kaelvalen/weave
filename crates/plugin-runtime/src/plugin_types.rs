use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum PluginKind {
    Capability, // Exposes callable tools
    Provider,   // AI model provider (OpenAI, Ollama, LlamaCpp, etc.)
    Workflow,   // Custom workflow definition/orchestration
    Storage,    // Data persistence & memory provider
    UI,         // Canvas / visual UI view extensions
    Planner,    // Custom planning strategies
}

impl Default for PluginKind {
    fn default() -> Self {
        Self::Capability
    }
}
