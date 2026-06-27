use serde_json::{json, Value};
use std::process::Command;
use tracing::info;

use crate::models::plugin::PluginExecutor;
use crate::utils::errors::WeaveError;

pub struct GitPlugin;

impl PluginExecutor for GitPlugin {
    fn execute(&self, capability: &str, params: Value) -> Result<Value, WeaveError> {
        GitPlugin::execute(capability, params)
    }
}

impl GitPlugin {
    pub fn execute(capability: &str, params: Value) -> Result<Value, WeaveError> {
        match capability {
            "git.status" => Self::status(params),
            "git.add" => Self::add(params),
            "git.commit" => Self::commit(params),
            "git.log" => Self::log(params),
            "git.diff" => Self::diff(params),
            "git.branch" => Self::branch(params),
            _ => Err(WeaveError::CapabilityNotFound(capability.to_string())),
        }
    }

    fn run_git_command(args: &[&str], cwd: Option<&str>) -> Result<String, WeaveError> {
        let mut cmd = Command::new("git");
        cmd.args(args);
        if let Some(dir) = cwd { cmd.current_dir(dir); }
        let output = cmd.output().map_err(|e| WeaveError::PluginError(format!("Failed to execute git: {}", e)))?;
        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        } else {
            let error = String::from_utf8_lossy(&output.stderr).to_string();
            Err(WeaveError::PluginError(format!("Git error: {}", error.trim())))
        }
    }

    fn status(params: Value) -> Result<Value, WeaveError> {
        let cwd = params.get("directory").and_then(|v| v.as_str());
        let result = Self::run_git_command(&["status", "-s"], cwd)?;
        let branch = Self::run_git_command(&["branch", "--show-current"], cwd).unwrap_or_default();
        info!("Executed git.status in {:?}", cwd.unwrap_or("."));
        Ok(json!({"status": result.trim(), "branch": branch.trim(), "success": true}))
    }

    fn add(params: Value) -> Result<Value, WeaveError> {
        let cwd = params.get("directory").and_then(|v| v.as_str());
        let path = params.get("path").and_then(|v| v.as_str()).unwrap_or(".");
        let result = Self::run_git_command(&["add", path], cwd)?;
        info!("Executed git.add on {} in {:?}", path, cwd.unwrap_or("."));
        Ok(json!({"output": result.trim(), "path": path, "success": true}))
    }

    fn commit(params: Value) -> Result<Value, WeaveError> {
        let cwd = params.get("directory").and_then(|v| v.as_str());
        let message = params.get("message").and_then(|v| v.as_str())
            .ok_or_else(|| WeaveError::PluginError("Missing 'message' parameter".to_string()))?;
        let result = Self::run_git_command(&["commit", "-m", message], cwd)?;
        info!("Executed git.commit in {:?}", cwd.unwrap_or("."));
        Ok(json!({"output": result.trim(), "message": message, "success": true}))
    }

    fn log(params: Value) -> Result<Value, WeaveError> {
        let cwd = params.get("directory").and_then(|v| v.as_str());
        let limit = params.get("limit").and_then(|v| v.as_u64()).unwrap_or(5);
        let limit_str = format!("-{}", limit);
        let result = Self::run_git_command(&["log", "--oneline", &limit_str], cwd)?;
        info!("Executed git.log (limit {}) in {:?}", limit, cwd.unwrap_or("."));
        Ok(json!({"log": result.trim(), "limit": limit, "success": true}))
    }

    fn diff(params: Value) -> Result<Value, WeaveError> {
        let cwd = params.get("directory").and_then(|v| v.as_str());
        let staged = params.get("staged").and_then(|v| v.as_bool()).unwrap_or(false);
        let file = params.get("file").and_then(|v| v.as_str());

        let mut args = vec!["diff"];
        if staged { args.push("--cached"); }
        let file_str;
        if let Some(f) = file { file_str = f.to_string(); args.push(&file_str); }

        let result = Self::run_git_command(&args, cwd)?;
        info!("Executed git.diff in {:?}", cwd.unwrap_or("."));
        Ok(json!({"diff": result, "staged": staged, "success": true}))
    }

    fn branch(params: Value) -> Result<Value, WeaveError> {
        let cwd = params.get("directory").and_then(|v| v.as_str());
        let result = Self::run_git_command(&["branch", "-a"], cwd)?;
        let current = Self::run_git_command(&["branch", "--show-current"], cwd).unwrap_or_default();
        let branches: Vec<&str> = result.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).collect();
        info!("Executed git.branch in {:?}", cwd.unwrap_or("."));
        Ok(json!({"branches": branches, "current": current.trim(), "count": branches.len(), "success": true}))
    }
}
