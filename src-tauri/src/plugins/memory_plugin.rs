use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use tracing::info;

use crate::models::plugin::PluginExecutor;
use crate::utils::config::AppConfig;
use crate::utils::errors::WeaveError;

pub struct MemoryPlugin;

impl PluginExecutor for MemoryPlugin {
    fn execute(&self, capability: &str, params: Value) -> Result<Value, WeaveError> {
        MemoryPlugin::execute(capability, params)
    }
}

impl MemoryPlugin {
    pub fn execute(capability: &str, params: Value) -> Result<Value, WeaveError> {
        match capability {
            "memory.store" => Self::store(params),
            "memory.recall" => Self::recall(params),
            "memory.delete" => Self::delete(params),
            "memory.list" => Self::list_keys(),
            _ => Err(WeaveError::CapabilityNotFound(capability.to_string())),
        }
    }

    fn get_memory_file() -> Result<PathBuf, WeaveError> {
        let dir = AppConfig::app_data_dir()?;
        Ok(dir.join("memory.json"))
    }

    fn read_memory() -> Result<HashMap<String, Value>, WeaveError> {
        let file_path = Self::get_memory_file()?;
        if !file_path.exists() { return Ok(HashMap::new()); }
        let content = std::fs::read_to_string(&file_path)?;
        let memory: HashMap<String, Value> = serde_json::from_str(&content).unwrap_or_default();
        Ok(memory)
    }

    fn write_memory(memory: &HashMap<String, Value>) -> Result<(), WeaveError> {
        let file_path = Self::get_memory_file()?;
        let content = serde_json::to_string_pretty(memory)
            .map_err(|e| WeaveError::PluginError(e.to_string()))?;
        std::fs::write(file_path, content)?;
        Ok(())
    }

    fn store(params: Value) -> Result<Value, WeaveError> {
        let key = params.get("key").and_then(|v| v.as_str())
            .ok_or_else(|| WeaveError::PluginError("Missing 'key' parameter".to_string()))?;
        let value = params.get("value")
            .ok_or_else(|| WeaveError::PluginError("Missing 'value' parameter".to_string()))?;
        let mut memory = Self::read_memory()?;
        let is_update = memory.contains_key(key);
        memory.insert(key.to_string(), value.clone());
        Self::write_memory(&memory)?;
        info!("Stored memory key: {} ({})", key, if is_update { "updated" } else { "created" });
        Ok(json!({"key": key, "action": if is_update { "updated" } else { "created" }, "success": true}))
    }

    fn recall(params: Value) -> Result<Value, WeaveError> {
        let key = params.get("key").and_then(|v| v.as_str());
        let memory = Self::read_memory()?;
        if let Some(k) = key {
            info!("Recalled memory key: {}", k);
            let val = memory.get(k).cloned().unwrap_or(Value::Null);
            let found = val != Value::Null;
            Ok(json!({"key": k, "value": val, "found": found, "success": true}))
        } else {
            info!("Recalled all memory keys");
            Ok(json!({"memory": memory, "count": memory.len(), "success": true}))
        }
    }

    fn delete(params: Value) -> Result<Value, WeaveError> {
        let key = params.get("key").and_then(|v| v.as_str())
            .ok_or_else(|| WeaveError::PluginError("Missing 'key' parameter".to_string()))?;
        let mut memory = Self::read_memory()?;
        let existed = memory.remove(key).is_some();
        if existed {
            Self::write_memory(&memory)?;
            info!("Deleted memory key: {}", key);
        }
        Ok(json!({"key": key, "deleted": existed, "success": true}))
    }

    fn list_keys() -> Result<Value, WeaveError> {
        let memory = Self::read_memory()?;
        let keys: Vec<&String> = memory.keys().collect();
        info!("Listed {} memory keys", keys.len());
        Ok(json!({"keys": keys, "count": keys.len(), "success": true}))
    }
}
