//! Python Runtime
//!
//! Executes Python plugins via the system Python interpreter.

use serde_json::Value;
use std::process::Command;

use crate::models::plugin::Plugin;
use crate::utils::errors::WeaveError;

/// Python runtime for executing Python plugins
pub struct PythonRuntime;

impl PythonRuntime {
    /// Create a new Python runtime
    pub fn new() -> Result<Self, WeaveError> {
        Ok(Self)
    }

    /// Execute a Python plugin capability
    pub fn execute(
        &self,
        plugin: &Plugin,
        capability: &str,
        params: Value,
    ) -> Result<Value, WeaveError> {
        let path = plugin.path.as_ref().ok_or_else(|| {
            WeaveError::PluginError("Python plugin has no path defined".to_string())
        })?;

        let entry = if plugin.runtime.entry.is_empty() {
            "main.py"
        } else {
            &plugin.runtime.entry
        };

        // If the path is a file (e.g. .wpk), we'd need to extract it first.
        // For directory plugins, we can just run it.
        let entry_path = if path.is_file() && path.extension().map_or(false, |ext| ext == "wpk") {
            // For WPK we need a temp dir to extract to, but for now we assume directory plugin
            // or we could support WPK extraction in the future.
            return Err(WeaveError::PluginError(
                "Python WPK plugins must be extracted first. Use directory plugins for now.".to_string(),
            ));
        } else {
            path.join(entry)
        };

        if !entry_path.exists() {
            return Err(WeaveError::PluginError(format!(
                "Python entry point not found at {:?}",
                entry_path
            )));
        }

        let params_str = serde_json::to_string(&params)
            .map_err(|e| WeaveError::PluginError(format!("Failed to serialize params: {}", e)))?;

        let output = Command::new("python")
            .arg(&entry_path)
            .arg(capability)
            .arg(&params_str)
            .current_dir(path)
            .output()
            .map_err(|e| WeaveError::PluginError(format!("Failed to execute python: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(WeaveError::PluginError(format!(
                "Python script failed ({}): {}",
                output.status, stderr
            )));
        }

        let stdout_str = String::from_utf8(output.stdout)
            .map_err(|e| WeaveError::PluginError(format!("Invalid UTF-8 in python output: {}", e)))?;

        let result: Value = serde_json::from_str(&stdout_str).map_err(|e| {
            WeaveError::PluginError(format!(
                "Failed to parse python output as JSON: {}. Output: {}",
                e, stdout_str
            ))
        })?;

        Ok(result)
    }
}
