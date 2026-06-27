use serde_json::{json, Value};
use std::process::Command;
use tracing::{info, warn};

use crate::models::plugin::PluginExecutor;
use crate::utils::errors::WeaveError;

/// Commands that are too dangerous to execute.
const BLOCKED_COMMANDS: &[&str] = &[
    "rm -rf /", "rm -rf /*", "mkfs", "dd if=", ":(){ :|:& };:",
    "chmod -R 777 /", "chown -R", "> /dev/sda",
    "mv / ", "wget -O- | sh", "curl | sh",
];

/// Default timeout in seconds for shell commands.
const DEFAULT_TIMEOUT_SECS: u64 = 30;

pub struct ShellPlugin;

impl PluginExecutor for ShellPlugin {
    fn execute(&self, capability: &str, params: Value) -> Result<Value, WeaveError> {
        ShellPlugin::execute(capability, params)
    }
}

impl ShellPlugin {
    pub fn execute(capability: &str, params: Value) -> Result<Value, WeaveError> {
        match capability {
            "shell.exec" => Self::exec(params),
            _ => Err(WeaveError::CapabilityNotFound(capability.to_string())),
        }
    }

    fn exec(params: Value) -> Result<Value, WeaveError> {
        let command_str = params.get("command")
            .and_then(|v| v.as_str())
            .ok_or_else(|| WeaveError::PluginError("Missing 'command' parameter".to_string()))?;

        // Security: block dangerous commands
        let cmd_lower = command_str.to_lowercase();
        for blocked in BLOCKED_COMMANDS {
            if cmd_lower.contains(blocked) {
                return Err(WeaveError::PermissionDenied(
                    format!("Command blocked for safety: contains '{}'", blocked)
                ));
            }
        }

        let timeout_secs = params.get("timeout")
            .and_then(|v| v.as_u64())
            .unwrap_or(DEFAULT_TIMEOUT_SECS);

        let cwd = params.get("cwd").and_then(|v| v.as_str());

        info!("Executing shell command: {} (timeout: {}s, cwd: {:?})", command_str, timeout_secs, cwd);

        let mut cmd = Command::new("sh");
        cmd.arg("-c").arg(command_str);

        if let Some(dir) = cwd {
            let path = std::path::Path::new(dir);
            if path.exists() && path.is_dir() {
                cmd.current_dir(dir);
            } else {
                return Err(WeaveError::PluginError(format!("Working directory not found: {}", dir)));
            }
        }

        // Execute with timeout using a thread
        let timeout_duration = std::time::Duration::from_secs(timeout_secs);
        let handle = std::thread::spawn(move || cmd.output());

        match handle.join() {
            Ok(result) => {
                let output = result.map_err(|e| WeaveError::Io(e.to_string()))?;
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                if !output.status.success() {
                    warn!("Command failed with status: {:?}", output.status.code());
                }
                Ok(json!({
                    "command": command_str,
                    "stdout": stdout,
                    "stderr": stderr,
                    "exit_code": output.status.code(),
                    "success": output.status.success(),
                    "timeout_secs": timeout_secs
                }))
            }
            Err(_) => {
                Err(WeaveError::TimeoutError(
                    format!("Command timed out after {} seconds: {}", timeout_duration.as_secs(), command_str)
                ))
            }
        }
    }
}
