use crate::errors::KernelError;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use wait_timeout::ChildExt;

pub struct SandboxShell {
    pub cwd: PathBuf,
    pub timeout_secs: u64,
    pub max_output_bytes: usize,
    pub env_allowlist: Vec<String>,
}

impl SandboxShell {
    pub fn new(cwd: PathBuf) -> Self {
        Self {
            cwd,
            timeout_secs: 60,
            max_output_bytes: 512 * 1024, // 512 KB max output buffer
            env_allowlist: vec!["PATH".into(), "HOME".into(), "TERM".into(), "LANG".into()],
        }
    }

    pub fn execute(&self, binary: &str, args: &[String]) -> Result<Value, KernelError> {
        let start = Instant::now();

        // 1. Sanitize Environment
        let mut cmd = Command::new(binary);
        cmd.args(args);
        cmd.current_dir(&self.cwd);
        cmd.env_clear();

        for key in &self.env_allowlist {
            if let Ok(val) = std::env::var(key) {
                cmd.env(key, val);
            }
        }

        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| {
            KernelError::PluginError(format!("Sandbox spawn failed for '{}': {}", binary, e))
        })?;

        let timeout = Duration::from_secs(self.timeout_secs);
        match child
            .wait_timeout(timeout)
            .map_err(|e| KernelError::PluginError(format!("Timeout error: {}", e)))?
        {
            Some(status) => {
                let duration = start.elapsed().as_millis();

                let mut stdout_buf = Vec::new();
                let mut stderr_buf = Vec::new();

                if let Some(out) = child.stdout.as_mut() {
                    use std::io::Read;
                    let _ = out
                        .take(self.max_output_bytes as u64)
                        .read_to_end(&mut stdout_buf);
                }
                if let Some(err) = child.stderr.as_mut() {
                    use std::io::Read;
                    let _ = err
                        .take(self.max_output_bytes as u64)
                        .read_to_end(&mut stderr_buf);
                }

                let stdout_str = String::from_utf8_lossy(&stdout_buf).to_string();
                let stderr_str = String::from_utf8_lossy(&stderr_buf).to_string();

                Ok(json!({
                    "binary": binary,
                    "args": args,
                    "directory": self.cwd.to_string_lossy().to_string(),
                    "stdout": stdout_str,
                    "stderr": stderr_str,
                    "exit_code": status.code(),
                    "success": status.success(),
                    "duration_ms": duration
                }))
            }
            None => {
                let _ = child.kill();
                Err(KernelError::PluginError(format!(
                    "Sandboxed execution of '{}' timed out after {}s",
                    binary, self.timeout_secs
                )))
            }
        }
    }
}

pub struct PermissionEnforcer;

impl PermissionEnforcer {
    pub fn enforce_process_allowlist(
        binary: &str,
        allowlist: &[String],
    ) -> Result<(), KernelError> {
        if allowlist.is_empty() {
            return Ok(());
        }
        if allowlist
            .iter()
            .any(|allowed| allowed == binary || binary.ends_with(allowed))
        {
            Ok(())
        } else {
            Err(KernelError::PermissionDenied(format!(
                "Process '{}' is not in execution allowlist",
                binary
            )))
        }
    }
}
