use serde::{Deserialize, Serialize};

use super::plugin::*;
use crate::utils::errors::WeaveError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub plugin: PluginMetadata,
    #[serde(default)]
    pub capabilities: ManifestCapabilities,
    #[serde(default)]
    pub runtime: ManifestRuntime,
    #[serde(default)]
    pub ui: ManifestUi,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginMetadata {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    #[serde(default = "default_license")]
    pub license: String,
    #[serde(default)]
    pub category: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ManifestCapabilities {
    #[serde(default)]
    pub read: Vec<String>,
    #[serde(default)]
    pub write: Vec<String>,
    #[serde(default)]
    pub provide: Vec<String>,
    #[serde(default)]
    pub schemas: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub descriptions: std::collections::HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ManifestRuntime {
    #[serde(rename = "type", default = "default_runtime_type")]
    pub runtime_type: String,
    #[serde(default)]
    pub entry: String,
    #[serde(default = "default_sandbox")]
    pub sandbox: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ManifestUi {
    #[serde(rename = "type", default = "default_ui_type")]
    pub ui_type: String,
    #[serde(default)]
    pub entry: String,
}

fn default_license() -> String {
    "MIT".to_string()
}

fn default_runtime_type() -> String {
    "builtin".to_string()
}

fn default_sandbox() -> String {
    "strict".to_string()
}

fn default_ui_type() -> String {
    "native".to_string()
}

impl Manifest {
    pub fn from_toml(content: &str) -> Result<Self, WeaveError> {
        let manifest: Manifest = toml::from_str(content)
            .map_err(|e| WeaveError::InvalidManifest(format!("TOML parse error: {}", e)))?;
        manifest.validate()?;
        Ok(manifest)
    }

    pub fn validate(&self) -> Result<(), WeaveError> {
        if self.plugin.id.is_empty() {
            return Err(WeaveError::InvalidManifest("Plugin ID is required".to_string()));
        }
        if self.plugin.name.is_empty() {
            return Err(WeaveError::InvalidManifest("Plugin name is required".to_string()));
        }
        if self.plugin.version.is_empty() {
            return Err(WeaveError::InvalidManifest("Plugin version is required".to_string()));
        }
        
        let valid_id = regex::Regex::new(r"^[a-zA-Z0-9._-]+$")
            .map_err(|e| WeaveError::InvalidManifest(e.to_string()))?;
        if !valid_id.is_match(&self.plugin.id) {
            return Err(WeaveError::InvalidManifest(
                format!("Plugin ID '{}' contains invalid characters", self.plugin.id)
            ));
        }

        let valid_types = ["builtin", "wasm", "python", "nodejs"];
        if !valid_types.contains(&self.runtime.runtime_type.as_str()) {
            return Err(WeaveError::InvalidManifest(
                format!("Invalid runtime type: {}", self.runtime.runtime_type)
            ));
        }

        Ok(())
    }

    pub fn to_plugin(&self, path: Option<std::path::PathBuf>, is_builtin: bool) -> Plugin {
        let runtime_type = match self.runtime.runtime_type.as_str() {
            "wasm" => RuntimeType::Wasm,
            "python" => RuntimeType::Python,
            "nodejs" => RuntimeType::Nodejs,
            _ => RuntimeType::Builtin,
        };

        let sandbox = match self.runtime.sandbox.as_str() {
            "relaxed" => SandboxLevel::Relaxed,
            _ => SandboxLevel::Strict,
        };

        let ui_type = match self.ui.ui_type.as_str() {
            "webview" => UiType::Webview,
            "none" => UiType::None,
            _ => UiType::Native,
        };

        let category = match self.plugin.category.as_str() {
            "productivity" => PluginCategory::Productivity,
            "development" => PluginCategory::Development,
            "ai" => PluginCategory::Ai,
            _ => PluginCategory::System,
        };

        Plugin {
            id: self.plugin.id.clone(),
            name: self.plugin.name.clone(),
            version: self.plugin.version.clone(),
            author: self.plugin.author.clone(),
            description: self.plugin.description.clone(),
            capabilities: Capabilities {
                read: self.capabilities.read.clone(),
                write: self.capabilities.write.clone(),
                provide: self.capabilities.provide.clone(),
                schemas: self.capabilities.schemas.clone(),
                descriptions: self.capabilities.descriptions.clone(),
            },
            runtime: RuntimeConfig {
                runtime_type,
                entry: self.runtime.entry.clone(),
                sandbox,
            },
            ui: PluginUiConfig {
                ui_type,
                entry: self.ui.entry.clone(),
            },
            state: PluginState::Discovered,
            path,
            is_builtin,
            category,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_schemas_and_descriptions() {
        let toml = r#"
[plugin]
id = "com.test.plugin"
name = "Test Plugin"
version = "1.0.0"
author = "Test"
description = "A test plugin"

[capabilities]
provide = ["test.echo"]

[capabilities.schemas]
"test.echo" = '{"message":"string"}'

[capabilities.descriptions]
"test.echo" = "Echoes a message back"

[runtime]
type = "python"
entry = "main.py"
"#;

        let manifest = Manifest::from_toml(toml).unwrap();
        let plugin = manifest.to_plugin(None, false);

        assert_eq!(plugin.capabilities.provide, vec!["test.echo"]);
        assert_eq!(
            plugin.capabilities.schemas.get("test.echo"),
            Some(&"{\"message\":\"string\"}".to_string())
        );
        assert_eq!(
            plugin.capabilities.descriptions.get("test.echo"),
            Some(&"Echoes a message back".to_string())
        );
    }
}
