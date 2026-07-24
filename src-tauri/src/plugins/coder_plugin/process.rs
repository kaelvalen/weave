use crate::utils::errors::WeaveError;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use wait_timeout::ChildExt;

#[derive(Debug, Clone)]
pub struct ExecSpec {
    pub binary: String,
    pub args: Vec<String>,
}

pub fn execute_subprocess(
    spec: ExecSpec,
    cwd: PathBuf,
    timeout_secs: u64,
    is_test: bool,
    test_framework: Option<&str>,
) -> Result<Value, WeaveError> {
    let start = Instant::now();

    let mut child = Command::new(&spec.binary)
        .args(&spec.args)
        .current_dir(&cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            WeaveError::PluginError(format!("Failed to spawn process {}: {}", spec.binary, e))
        })?;

    let timeout = Duration::from_secs(timeout_secs);
    match child
        .wait_timeout(timeout)
        .map_err(|e| WeaveError::PluginError(format!("Timeout error: {}", e)))?
    {
        Some(status) => {
            let duration = start.elapsed().as_millis();

            let mut stdout_str = String::new();
            let mut stderr_str = String::new();

            if let Some(mut out) = child.stdout.take() {
                use std::io::Read;
                out.read_to_string(&mut stdout_str).unwrap_or_default();
            }
            if let Some(mut err) = child.stderr.take() {
                use std::io::Read;
                err.read_to_string(&mut stderr_str).unwrap_or_default();
            }

            let command_str = format!("{} {}", spec.binary, spec.args.join(" "));

            let mut result_json = json!({
                "directory": cwd.to_string_lossy().to_string(),
                "command": command_str,
                "stdout": stdout_str,
                "stderr": stderr_str,
                "exit_code": status.code(),
                "success": status.success(),
                "duration_ms": duration
            });

            if is_test {
                // Parse test results using framework-specific parser
                let (passed, failed) =
                    super::parser::parse_test_results(&stdout_str, test_framework.unwrap_or(""));
                if let Some(obj) = result_json.as_object_mut() {
                    obj.insert(
                        "tests_passed".to_string(),
                        passed.map_or(Value::Null, |v| json!(v)),
                    );
                    obj.insert(
                        "tests_failed".to_string(),
                        failed.map_or(Value::Null, |v| json!(v)),
                    );
                }
            }

            Ok(result_json)
        }
        None => {
            let _ = child.kill();
            Err(WeaveError::PluginError(format!(
                "Command '{}' timed out after {}s",
                spec.binary, timeout_secs
            )))
        }
    }
}
