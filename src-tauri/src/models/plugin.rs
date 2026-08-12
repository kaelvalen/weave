use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

/// Trait that all plugin executors must implement.
/// This provides a unified dispatch interface for both built-in and external plugins.
pub trait PluginExecutor: Send + Sync {
    fn execute(
        &self,
        capability: &str,
        params: serde_json::Value,
        ctx: &runtime_kernel::execution_context::ExecutionContext,
    ) -> Result<serde_json::Value, crate::utils::errors::WeaveError>;
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
    /// JSON Schema document per capability (provider-agnostic object schema,
    /// consumed directly by native tool-calling).
    #[serde(default)]
    pub schemas: HashMap<String, serde_json::Value>,
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
    /// Tools discovered live from an MCP (2026-07-28) server, registered
    /// into the plugin registry the same way builtins are — see
    /// docs/phase8-mcp-spec.md Part 1 Q2.
    Mcp,
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

    /// Register a capability with its schema and description. The schema is
    /// given as an example parameter object (e.g. `{"path":"..."}`) which is
    /// converted into a best-effort JSON Schema at registration time. Plugins
    /// that need precise contracts can pass an explicit schema object instead.
    pub fn capability(mut self, name: &str, schema: &str, desc: &str) -> Self {
        self.plugin.capabilities.provide.push(name.to_string());
        self.plugin
            .capabilities
            .schemas
            .insert(name.to_string(), schema_from_example(schema));
        self.plugin
            .capabilities
            .descriptions
            .insert(name.to_string(), desc.to_string());
        self
    }

    pub fn build(self) -> Plugin {
        self.plugin
    }
}

/// Convert an example parameter object (or an explicit JSON Schema object)
/// into a provider-usable JSON Schema document.
///
/// Inference rules (adversarially reviewed — see schema_from_value):
/// - string/number/boolean/array examples map to their JSON Schema type;
/// - a `null` example value means "optional and nullable" — typed as
///   `["string", "null"]`, NEVER object;
/// - every non-null key in the example is marked `required`; null-valued
///   keys are the only way an example marks a parameter optional;
/// - documents that already look like a schema (`type` present) pass
///   through unchanged.
pub fn schema_from_example(example: &str) -> serde_json::Value {
    let parsed: serde_json::Value =
        serde_json::from_str(example.trim()).unwrap_or(serde_json::Value::Object(Default::default()));
    schema_from_value(&parsed)
}

fn is_schema_type_name(value: &serde_json::Value) -> bool {
    let is_name = |s: &str| {
        matches!(
            s,
            "object" | "string" | "number" | "integer" | "boolean" | "array" | "null"
        )
    };
    match value {
        serde_json::Value::String(s) => is_name(s),
        serde_json::Value::Array(items) => items
            .iter()
            .all(|v| v.as_str().map(is_name).unwrap_or(false)),
        _ => false,
    }
}

fn schema_from_value(value: &serde_json::Value) -> serde_json::Value {
    if let Some(obj) = value.as_object() {
        // Already an explicit JSON Schema document — only when the `type`
        // key names a real schema type. Examples like
        // `{"type":"shapeNode",...}` must NOT pass through as schemas.
        if obj.get("type").map(is_schema_type_name).unwrap_or(false) {
            return value.clone();
        }
        let mut properties = serde_json::Map::new();
        let mut required: Vec<String> = Vec::new();
        for (key, v) in obj {
            properties.insert(key.clone(), schema_from_value(v));
            // Null example values are explicitly optional/nullable; every
            // other key present in the example is part of the contract.
            if !v.is_null() {
                required.push(key.clone());
            }
        }
        required.sort();
        let mut schema = serde_json::json!({
            "type": "object",
            "properties": properties,
        });
        if !required.is_empty() {
            schema["required"] = serde_json::json!(required);
        }
        schema
    } else if value.is_string() {
        serde_json::json!({"type": "string"})
    } else if value.is_number() {
        serde_json::json!({"type": "number"})
    } else if value.is_boolean() {
        serde_json::json!({"type": "boolean"})
    } else if value.is_array() {
        serde_json::json!({"type": "array"})
    } else if value.is_null() {
        // A null example is an explicit "optional/nullable" marker — never
        // guess `object` (that actively misleads the model into sending an
        // object where a scalar is expected).
        serde_json::json!({"type": ["string", "null"]})
    } else {
        serde_json::json!({"type": "object"})
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn infers_types_and_required_from_example() {
        let schema = schema_from_example(r#"{"path":"...","content":"..."}"#);
        assert_eq!(schema["type"], "object");
        assert_eq!(schema["properties"]["path"]["type"], "string");
        assert_eq!(schema["properties"]["content"]["type"], "string");
        assert_eq!(schema["required"], serde_json::json!(["content", "path"]));
    }

    #[test]
    fn null_example_values_are_optional_nullable_strings() {
        // The adversarial case: shell.exec's `cwd` must never be typed object.
        let schema = schema_from_example(r#"{"command":"...","cwd":null,"timeout":30}"#);
        assert_eq!(
            schema["properties"]["cwd"]["type"],
            serde_json::json!(["string", "null"]),
            "cwd: null must not infer object"
        );
        assert_eq!(schema["required"], serde_json::json!(["command", "timeout"]));
    }

    #[test]
    fn null_range_params_are_optional() {
        let schema = schema_from_example(r#"{"path":"...","start":null,"end":null}"#);
        assert_eq!(schema["required"], serde_json::json!(["path"]));
        assert_eq!(
            schema["properties"]["start"]["type"],
            serde_json::json!(["string", "null"])
        );
        assert_eq!(
            schema["properties"]["end"]["type"],
            serde_json::json!(["string", "null"])
        );
    }

    #[test]
    fn explicit_schema_passes_through_unchanged() {
        let schema = schema_from_example(
            r#"{"type":"object","properties":{"a":{"type":"integer"}},"required":["a"]}"#,
        );
        assert_eq!(schema["properties"]["a"]["type"], "integer");
        assert_eq!(schema["required"], serde_json::json!(["a"]));
    }

    #[test]
    fn empty_example_is_an_open_object() {
        let schema = schema_from_example("{}");
        assert_eq!(schema["type"], "object");
        assert!(schema.get("required").is_none());
    }

    #[test]
    fn example_with_non_schema_type_key_is_inferred_not_passed_through() {
        // canvas.add_node's example literally contains a top-level `type`
        // key ("shapeNode") — it must be inferred as an object schema, not
        // passed through raw as a schema document.
        let schema = schema_from_example(r#"{"type":"shapeNode","data":{},"position":null}"#);
        assert_eq!(schema["type"], "object");
        assert_eq!(schema["properties"]["type"]["type"], "string");
        assert_eq!(schema["required"], serde_json::json!(["data", "type"]));
        assert_eq!(schema["properties"]["position"]["type"], serde_json::json!(["string", "null"]));
    }

    #[test]
    fn example_with_real_schema_type_key_passes_through() {
        let schema = schema_from_example(r#"{"type":"object","properties":{}}"#);
        assert_eq!(schema["type"], "object");
        assert!(schema.get("properties").is_some());
    }

    #[test]
    fn builtin_schemas_never_infer_object_from_null() {
        // The exact example strings from create_builtin_plugins().
        let cases = [
            (r#"{"command":"...","cwd":null,"timeout":30}"#, "cwd"),
            (r#"{"path":"...","start":null,"end":null}"#, "start"),
            (r#"{"directory":".","staged":false,"file":null}"#, "file"),
            (r#"{"directory":".","filter":null}"#, "filter"),
        ];
        for (example, key) in cases {
            let schema = schema_from_example(example);
            let t = &schema["properties"][key]["type"];
            assert!(
                t != "object",
                "{} must not infer object (got {:?})",
                key,
                t
            );
            let required = schema["required"].as_array().unwrap();
            assert!(
                !required.iter().any(|r| r == key),
                "null-example key {} must not be required",
                key
            );
        }
    }
}
