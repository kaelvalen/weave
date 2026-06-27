use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::collections::HashMap;

/// Trait that all plugin executors must implement.
/// This provides a unified dispatch interface for both built-in and external plugins.
pub trait PluginExecutor: Send + Sync {
    fn execute(&self, capability: &str, params: serde_json::Value) -> Result<serde_json::Value, crate::utils::errors::WeaveError>;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Plugin {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    pub capabilities: Capabilities,
    pub runtime: RuntimeConfig,
    pub ui: PluginUiConfig,
    pub state: PluginState,
    pub path: Option<PathBuf>,
    pub is_builtin: bool,
    #[serde(default)]
    pub category: PluginCategory,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Capabilities {
    #[serde(default)]
    pub read: Vec<String>,
    #[serde(default)]
    pub write: Vec<String>,
    #[serde(default)]
    pub provide: Vec<String>,
    #[serde(default)]
    pub schemas: HashMap<String, String>,
    /// Human-readable descriptions for each capability.
    #[serde(default)]
    pub descriptions: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeConfig {
    #[serde(rename = "type")]
    pub runtime_type: RuntimeType,
    pub entry: String,
    pub sandbox: SandboxLevel,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum RuntimeType {
    Builtin,
    Wasm,
    Python,
    Nodejs,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SandboxLevel {
    Strict,
    Relaxed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PluginState {
    Discovered,
    Loaded,
    Active,
    Error(String),
    Unloaded,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum PluginCategory {
    #[default]
    System,
    Productivity,
    Development,
    Ai,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginUiConfig {
    #[serde(rename = "type")]
    pub ui_type: UiType,
    #[serde(default)]
    pub entry: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum UiType {
    Native,
    Webview,
    None,
}

impl Default for Capabilities {
    fn default() -> Self {
        Self {
            read: Vec::new(),
            write: Vec::new(),
            provide: Vec::new(),
            schemas: HashMap::new(),
            descriptions: HashMap::new(),
        }
    }
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self {
            runtime_type: RuntimeType::Builtin,
            entry: String::new(),
            sandbox: SandboxLevel::Strict,
        }
    }
}

impl Default for PluginUiConfig {
    fn default() -> Self {
        Self {
            ui_type: UiType::Native,
            entry: String::new(),
        }
    }
}

impl Plugin {
    pub fn has_capability(&self, capability: &str) -> bool {
        self.capabilities.provide.iter().any(|c| c == capability)
    }

    pub fn transition_to(&mut self, new_state: PluginState) {
        self.state = new_state;
    }

    pub fn is_active(&self) -> bool {
        matches!(self.state, PluginState::Active)
    }

    pub fn is_loaded(&self) -> bool {
        matches!(self.state, PluginState::Loaded | PluginState::Active)
    }
}

/// Builder for constructing built-in Plugin definitions concisely.
pub struct PluginBuilder {
    plugin: Plugin,
}

impl PluginBuilder {
    pub fn builtin(id: &str, name: &str) -> Self {
        Self {
            plugin: Plugin {
                id: id.to_string(),
                name: name.to_string(),
                version: "0.2.0".to_string(),
                author: "Weave Team".to_string(),
                description: String::new(),
                capabilities: Capabilities::default(),
                runtime: RuntimeConfig::default(),
                ui: PluginUiConfig::default(),
                state: PluginState::Active,
                path: None,
                is_builtin: true,
                category: PluginCategory::System,
            },
        }
    }

    pub fn description(mut self, desc: &str) -> Self {
        self.plugin.description = desc.to_string();
        self
    }

    pub fn category(mut self, cat: PluginCategory) -> Self {
        self.plugin.category = cat;
        self
    }

    pub fn read_access(mut self, patterns: &[&str]) -> Self {
        self.plugin.capabilities.read = patterns.iter().map(|s| s.to_string()).collect();
        self
    }

    pub fn write_access(mut self, patterns: &[&str]) -> Self {
        self.plugin.capabilities.write = patterns.iter().map(|s| s.to_string()).collect();
        self
    }

    /// Register a capability with its schema and description.
    pub fn capability(mut self, name: &str, schema: &str, desc: &str) -> Self {
        self.plugin.capabilities.provide.push(name.to_string());
        self.plugin.capabilities.schemas.insert(name.to_string(), schema.to_string());
        self.plugin.capabilities.descriptions.insert(name.to_string(), desc.to_string());
        self
    }

    pub fn build(self) -> Plugin {
        self.plugin
    }
}
