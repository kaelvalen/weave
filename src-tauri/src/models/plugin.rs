use serde::{Deserialize, Serialize};
use std::path::PathBuf;

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
