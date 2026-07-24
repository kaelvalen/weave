use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use tracing::info;

use crate::models::plugin::PluginExecutor;
use crate::utils::config::AppConfig;
use crate::utils::errors::WeaveError;

pub struct MemoryPlugin;

impl PluginExecutor for MemoryPlugin {
    fn execute(&self, capability: &str, params: Value, ctx: &runtime_kernel::execution_context::ExecutionContext) -> Result<Value, WeaveError> {
        MemoryPlugin::execute(capability, params, ctx)
    }
}

impl MemoryPlugin {
    pub fn execute(capability: &str, params: Value, _ctx: &runtime_kernel::execution_context::ExecutionContext) -> Result<Value, WeaveError> {
        match capability {
            "memory.store" => Self::store(params),
            "memory.recall" => Self::recall(params),
            "memory.delete" => Self::delete(params),
            "memory.list" => Self::list_keys(),
            "memory.get_profile" => Self::get_profile(),
            "memory.update_profile" => Self::update_profile(params),
            _ => Err(WeaveError::CapabilityNotFound(capability.to_string())),
        }
    }

    fn get_memory_file() -> Result<PathBuf, WeaveError> {
        let dir = AppConfig::app_data_dir()?;
        Ok(dir.join("memory.json"))
    }

    pub fn read_memory() -> Result<HashMap<String, Value>, WeaveError> {
        let file_path = Self::get_memory_file()?;
        if !file_path.exists() { return Ok(HashMap::new()); }
        let content = std::fs::read_to_string(&file_path)?;
        let mut memory: HashMap<String, Value> = serde_json::from_str(&content).unwrap_or_default();
        for (key, val) in memory.iter_mut() {
            if !key.starts_with('_') {
                if let Some(obj) = val.as_object() {
                    if obj.contains_key("content") && obj.contains_key("source") && obj.contains_key("confidence") {
                        continue;
                    }
                }
                let content_str = match val {
                    Value::String(ref s) => s.clone(),
                    _ => if let Some(obj) = val.as_object() {
                        obj.get("content").and_then(|v| v.as_str()).map(|s| s.to_string())
                            .unwrap_or_else(|| serde_json::to_string(&val).unwrap_or_default())
                    } else {
                        serde_json::to_string(&val).unwrap_or_default()
                    }
                };
                let now_iso = chrono::Utc::now().to_rfc3339();
                let id_hash = format!("mem_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() % 100000);
                *val = json!({
                    "id": id_hash,
                    "key": key,
                    "content": content_str,
                    "source": "conversation",
                    "confidence": 0.85,
                    "timestamp": now_iso,
                    "tags": ["general"]
                });
            }
        }
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
        let mut memory = Self::read_memory()?;
        let is_update = memory.contains_key(key);
        
        let stored_val = if key.starts_with('_') {
            params.get("value").cloned().unwrap_or(Value::Null)
        } else {
            let existing_obj = memory.get(key).and_then(|v| v.as_object());
            let value_param = params.get("value");
            
            let content_str = if let Some(c) = params.get("content").and_then(|v| v.as_str()) {
                c.to_string()
            } else if let Some(v) = value_param {
                match v {
                    Value::String(ref s) => s.clone(),
                    _ => if let Some(obj) = v.as_object() {
                        obj.get("content").and_then(|c| c.as_str()).map(|s| s.to_string())
                            .unwrap_or_else(|| serde_json::to_string(v).unwrap_or_default())
                    } else {
                        serde_json::to_string(v).unwrap_or_default()
                    }
                }
            } else if let Some(existing) = existing_obj {
                existing.get("content").and_then(|c| c.as_str()).unwrap_or("").to_string()
            } else {
                "".to_string()
            };

            let id = params.get("id").and_then(|v| v.as_str()).map(|s| s.to_string())
                .or_else(|| existing_obj.and_then(|e| e.get("id").and_then(|v| v.as_str()).map(|s| s.to_string())))
                .unwrap_or_else(|| format!("mem_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() % 100000));
                
            let source = params.get("source").and_then(|v| v.as_str())
                .or_else(|| existing_obj.and_then(|e| e.get("source").and_then(|v| v.as_str())))
                .unwrap_or("conversation");
                
            let confidence = params.get("confidence").and_then(|v| v.as_f64())
                .or_else(|| existing_obj.and_then(|e| e.get("confidence").and_then(|v| v.as_f64())))
                .unwrap_or(0.85);
                
            let timestamp = params.get("timestamp").and_then(|v| v.as_str()).map(|s| s.to_string())
                .or_else(|| existing_obj.and_then(|e| e.get("timestamp").and_then(|v| v.as_str()).map(|s| s.to_string())))
                .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
                
            let tags = params.get("tags").cloned()
                .or_else(|| existing_obj.and_then(|e| e.get("tags").cloned()))
                .unwrap_or_else(|| json!(["general"]));

            json!({
                "id": id,
                "key": key,
                "content": content_str,
                "source": source,
                "confidence": confidence,
                "timestamp": timestamp,
                "tags": tags
            })
        };

        memory.insert(key.to_string(), stored_val.clone());
        Self::write_memory(&memory)?;
        info!("Stored memory key: {} ({})", key, if is_update { "updated" } else { "created" });
        Ok(json!({"key": key, "action": if is_update { "updated" } else { "created" }, "value": stored_val, "success": true}))
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

    pub fn default_profile() -> Value {
        json!({
            "name": "Weave User",
            "role": "Software Architect & Developer",
            "bio": "Building autonomous agentic coding workflows.",
            "tech_stack": ["TypeScript", "Rust", "React", "Tauri", "NixOS", "Python"],
            "ai_directives": "Be concise, precise, and helpful. Always verify code changes before completing tasks."
        })
    }

    pub fn get_profile() -> Result<Value, WeaveError> {
        let memory = Self::read_memory()?;
        let profile = memory.get("_user_profile").cloned().unwrap_or_else(Self::default_profile);
        Ok(json!({"profile": profile, "success": true}))
    }

    pub fn update_profile(params: Value) -> Result<Value, WeaveError> {
        let profile = if let Some(p) = params.get("profile") {
            p.clone()
        } else {
            params.clone()
        };
        let mut memory = Self::read_memory()?;
        memory.insert("_user_profile".to_string(), profile.clone());
        Self::write_memory(&memory)?;
        info!("Updated user profile in memory");
        Ok(json!({"profile": profile, "success": true}))
    }
}
