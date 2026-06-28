use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Instant;
use tracing::warn;
use wait_timeout::ChildExt;
use std::time::Duration;

use crate::models::plugin::PluginExecutor;
use crate::utils::errors::WeaveError;

const BLOCKED_READ_PATHS: &[&str] = &["/etc/shadow", "/etc/passwd", ".env", ".ssh/"];
const BLOCKED_WRITE_PATHS: &[&str] = &["/etc/", "/boot/", "/usr/", "/bin/", "/sbin/", "/proc/", "/sys/", "/dev/", ".git/"];

pub struct CoderPlugin;

impl PluginExecutor for CoderPlugin {
    fn execute(&self, capability: &str, params: Value) -> Result<Value, WeaveError> {
        CoderPlugin::execute(capability, params)
    }
}

impl CoderPlugin {
    pub fn execute(capability: &str, params: Value) -> Result<Value, WeaveError> {
        match capability {
            "coder.read_file" => Self::read_file(params),
            "coder.write_file" => Self::write_file(params),
            "coder.apply_diff" => Self::apply_diff(params),
            "coder.revert_file" => Self::revert_file(params),
            "coder.run_check" => Self::run_check(params),
            "coder.run_tests" => Self::run_tests(params),
            "coder.list_dir" => Self::list_dir(params),
            _ => Err(WeaveError::CapabilityNotFound(capability.to_string())),
        }
    }

    fn resolve_path(path: &str) -> Result<PathBuf, WeaveError> {
        if path.starts_with("~/") {
            let home = dirs::home_dir().ok_or_else(|| WeaveError::PluginError("Cannot determine home directory".to_string()))?;
            Ok(home.join(&path[2..]))
        } else if Path::new(path).is_absolute() {
            Ok(PathBuf::from(path))
        } else {
            Ok(std::env::current_dir().map_err(|e| WeaveError::Io(e.to_string()))?.join(path))
        }
    }

    fn validate_read_access(path: &Path) -> Result<(), WeaveError> {
        let path_str = path.to_string_lossy();
        for blocked in BLOCKED_READ_PATHS {
            if path_str.contains(blocked) {
                return Err(WeaveError::PermissionDenied(format!("Read access denied: {}", path.display())));
            }
        }
        Ok(())
    }

    fn validate_write_access(path: &Path) -> Result<(), WeaveError> {
        let path_str = path.to_string_lossy();
        for blocked in BLOCKED_WRITE_PATHS {
            if path_str.contains(blocked) {
                return Err(WeaveError::PermissionDenied(format!("Write denied for path: {}", path.display())));
            }
        }
        Ok(())
    }

    fn infer_language(ext: &str) -> &'static str {
        match ext.to_lowercase().as_str() {
            "rs" => "rust",
            "ts" | "tsx" => "typescript",
            "js" | "jsx" => "javascript",
            "py" => "python",
            "go" => "go",
            "toml" => "toml",
            "json" => "json",
            "md" => "markdown",
            "html" => "html",
            "css" => "css",
            "sh" | "bash" => "shell",
            _ => "text",
        }
    }

    fn read_file(params: Value) -> Result<Value, WeaveError> {
        let path_str = params.get("path").and_then(|v| v.as_str())
            .ok_or_else(|| WeaveError::PluginError("Missing 'path' parameter".to_string()))?;
        
        let path = Self::resolve_path(path_str)?;
        Self::validate_read_access(&path)?;
        
        if !path.exists() || !path.is_file() {
            return Err(WeaveError::PluginError(format!("File not found: {}", path.display())));
        }

        let content = std::fs::read_to_string(&path)?;
        let lines: Vec<&str> = content.lines().collect();
        let total_lines = lines.len();
        
        let formatted_content = lines.iter().enumerate()
            .map(|(i, line)| format!("{:>4}\t{}", i + 1, line))
            .collect::<Vec<String>>()
            .join("\n");
            
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        let language = Self::infer_language(ext);
        
        Ok(json!({
            "path": path.to_string_lossy().to_string(),
            "content": formatted_content,
            "total_lines": total_lines,
            "size_bytes": content.len(),
            "language": language,
            "success": true
        }))
    }

    fn write_file(params: Value) -> Result<Value, WeaveError> {
        let path_str = params.get("path").and_then(|v| v.as_str())
            .ok_or_else(|| WeaveError::PluginError("Missing 'path' parameter".to_string()))?;
        let content = params.get("content").and_then(|v| v.as_str())
            .ok_or_else(|| WeaveError::PluginError("Missing 'content' parameter".to_string()))?;
        let create_dirs = params.get("create_dirs").and_then(|v| v.as_bool()).unwrap_or(true);

        let path = Self::resolve_path(path_str)?;
        Self::validate_write_access(&path)?;

        let mut backed_up = false;
        if path.exists() {
            let backup_path = path.with_extension("weave.bak");
            if std::fs::copy(&path, &backup_path).is_ok() {
                backed_up = true;
            }
        }

        if create_dirs {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }
        }

        std::fs::write(&path, content)?;
        
        // Verify write
        let read_back = std::fs::read(&path)?;
        if read_back.len() != content.len() {
            warn!("Write verification failed for {}", path.display());
        }

        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        let language = Self::infer_language(ext);

        Ok(json!({
            "path": path.to_string_lossy().to_string(),
            "bytes_written": content.len(),
            "backed_up": backed_up,
            "language": language,
            "success": true
        }))
    }

    fn apply_diff(params: Value) -> Result<Value, WeaveError> {
        let path_str = params.get("path").and_then(|v| v.as_str())
            .ok_or_else(|| WeaveError::PluginError("Missing 'path' parameter".to_string()))?;
        let old_str = params.get("old_str").and_then(|v| v.as_str())
            .ok_or_else(|| WeaveError::PluginError("Missing 'old_str' parameter".to_string()))?;
        let new_str = params.get("new_str").and_then(|v| v.as_str())
            .ok_or_else(|| WeaveError::PluginError("Missing 'new_str' parameter".to_string()))?;

        let path = Self::resolve_path(path_str)?;
        Self::validate_write_access(&path)?;

        if !path.exists() || !path.is_file() {
            return Err(WeaveError::PluginError(format!("File not found: {}", path.display())));
        }

        let content = std::fs::read_to_string(&path)?;
        let count = content.matches(old_str).count();

        if count == 0 {
            return Err(WeaveError::PluginError("old_str not found in file".to_string()));
        } else if count > 1 {
            return Err(WeaveError::PluginError(format!("old_str is ambiguous — found {} occurrences, must be unique", count)));
        }

        let mut backed_up = false;
        let backup_path = path.with_extension("weave.bak");
        if std::fs::copy(&path, &backup_path).is_ok() {
            backed_up = true;
        }

        let new_content = content.replace(old_str, new_str);
        std::fs::write(&path, &new_content)?;

        let old_lines = old_str.lines().count();
        let new_lines = new_str.lines().count();
        let lines_changed = std::cmp::max(old_lines, new_lines);

        Ok(json!({
            "path": path.to_string_lossy().to_string(),
            "lines_changed": lines_changed,
            "backed_up": backed_up,
            "success": true
        }))
    }

    fn revert_file(params: Value) -> Result<Value, WeaveError> {
        let path_str = params.get("path").and_then(|v| v.as_str())
            .ok_or_else(|| WeaveError::PluginError("Missing 'path' parameter".to_string()))?;

        let path = Self::resolve_path(path_str)?;
        Self::validate_write_access(&path)?;

        let backup_path = path.with_extension("weave.bak");
        
        if backup_path.exists() {
            std::fs::copy(&backup_path, &path)?;
            Ok(json!({ "success": true, "path": path_str }))
        } else {
            Err(WeaveError::PluginError("Backup file not found".to_string()))
        }
    }

    fn run_check(params: Value) -> Result<Value, WeaveError> {
        let dir = params.get("directory").and_then(|v| v.as_str()).unwrap_or(".");
        let path = Self::resolve_path(dir)?;
        
        let (check_type, cmd, args) = Self::detect_check_command(&path)?;
        Self::execute_subprocess(check_type, cmd, args, path, 60, false, None)
    }

    fn run_tests(params: Value) -> Result<Value, WeaveError> {
        let dir = params.get("directory").and_then(|v| v.as_str()).unwrap_or(".");
        let filter_val = params.get("filter").and_then(|v| v.as_str());
        let path = Self::resolve_path(dir)?;
        
        let (check_type, cmd, args) = Self::detect_test_command(&path, filter_val)?;
        Self::execute_subprocess(&check_type, cmd, args, path, 120, true, filter_val)
    }

    fn detect_check_command(path: &PathBuf) -> Result<(&'static str, &'static str, String), WeaveError> {
        if path.join("Cargo.toml").exists() {
            Ok(("rust", "sh", "-c 'cargo check 2>&1'".to_string()))
        } else if path.join("package.json").exists() {
            let pkg = std::fs::read_to_string(path.join("n package.json")).unwrap_or_default();
            if pkg.contains("\"type-check\"") || std::fs::read_to_string(path.join("package.json")).unwrap_or_default().contains("\"type-check\"") {
                Ok(("typescript", "sh", "-c 'npm run type-check 2>&1'".to_string()))
            } else if pkg.contains("\"build\"") || std::fs::read_to_string(path.join("package.json")).unwrap_or_default().contains("\"build\"") {
                Ok(("typescript", "sh", "-c 'npm run build 2>&1'".to_string()))
            } else {
                Ok(("typescript", "sh", "-c 'npx tsc --noEmit 2>&1'".to_string()))
            }
        } else if path.join("pyproject.toml").exists() || path.join("requirements.txt").exists() {
            Ok(("python", "sh", "-c 'python -m py_compile $(find . -name \"*.py\" | head -20) 2>&1'".to_string()))
        } else if path.join("go.mod").exists() {
            Ok(("go", "sh", "-c 'go build ./... 2>&1'".to_string()))
        } else {
            Err(WeaveError::PluginError("Cannot detect project type. No Cargo.toml, package.json, pyproject.toml, or go.mod found.".to_string()))
        }
    }

    fn detect_test_command(path: &PathBuf, filter: Option<&str>) -> Result<(String, &'static str, String), WeaveError> {
        let f = filter.unwrap_or("");
        if path.join("Cargo.toml").exists() {
            let filter_arg = if f.is_empty() { "".to_string() } else { format!(" {}", f) };
            Ok(("rust".to_string(), "sh", format!("-c 'cargo test{} 2>&1'", filter_arg)))
        } else if path.join("package.json").exists() {
            let filter_arg = if f.is_empty() { "".to_string() } else { format!(" -- {}", f) };
            Ok(("javascript".to_string(), "sh", format!("-c 'npm test{} 2>&1'", filter_arg)))
        } else if path.join("pyproject.toml").exists() || path.join("requirements.txt").exists() {
            let filter_arg = if f.is_empty() { "".to_string() } else { format!(" -k {}", f) };
            Ok(("python".to_string(), "sh", format!("-c 'python -m pytest{} -v 2>&1'", filter_arg)))
        } else if path.join("go.mod").exists() {
            let filter_arg = if f.is_empty() { "".to_string() } else { format!(" -run {}", f) };
            Ok(("go".to_string(), "sh", format!("-c 'go test ./...{} 2>&1'", filter_arg)))
        } else {
            Err(WeaveError::PluginError("Cannot detect project type for tests.".to_string()))
        }
    }

    fn execute_subprocess(check_type: &str, cmd: &str, args: String, cwd: PathBuf, timeout_secs: u64, is_test: bool, _filter: Option<&str>) -> Result<Value, WeaveError> {
        let start = Instant::now();
        
        let args_vec: Vec<&str> = if args.starts_with("-c '") && args.ends_with("'") {
            vec!["-c", &args[4..args.len()-1]]
        } else {
            args.split_whitespace().collect()
        };

        let mut child = Command::new(cmd)
            .args(&args_vec)
            .current_dir(&cwd)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| WeaveError::PluginError(format!("Failed to spawn process: {}", e)))?;

        let timeout = Duration::from_secs(timeout_secs);
        match child.wait_timeout(timeout).unwrap() {
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

                let command_str = format!("{} {}", cmd, args);
                
                let mut result_json = json!({
                    "directory": cwd.to_string_lossy().to_string(),
                    "check_type": check_type,
                    "command": command_str,
                    "stdout": stdout_str,
                    "stderr": stderr_str,
                    "exit_code": status.code(),
                    "success": status.success(),
                    "duration_ms": duration
                });
                
                if is_test {
                    // Very basic parsing for tests_passed / tests_failed
                    let mut passed = None;
                    let mut failed = None;
                    let out_lower = stdout_str.to_lowercase();
                    
                    if check_type == "rust" {
                        if let Some(idx) = out_lower.find("test result: ") {
                            let end = &out_lower[idx..];
                            if let Some(p_idx) = end.find(" passed") {
                                let start_p = end[..p_idx].rfind(' ').unwrap_or(0);
                                passed = end[start_p..p_idx].trim().parse::<u32>().ok();
                            }
                            if let Some(f_idx) = end.find(" failed") {
                                let start_f = end[..f_idx].rfind(' ').unwrap_or(0);
                                failed = end[start_f..f_idx].trim().parse::<u32>().ok();
                            }
                        }
                    }
                    
                    result_json.as_object_mut().unwrap().insert("tests_passed".to_string(), passed.map_or(Value::Null, |v| json!(v)));
                    result_json.as_object_mut().unwrap().insert("tests_failed".to_string(), failed.map_or(Value::Null, |v| json!(v)));
                }

                Ok(result_json)
            }
            None => {
                let _ = child.kill();
                Err(WeaveError::PluginError(format!("Command timed out after {}s", timeout_secs)))
            }
        }
    }

    fn list_dir(params: Value) -> Result<Value, WeaveError> {
        let path_str = params.get("path").and_then(|v| v.as_str()).unwrap_or(".");
        let depth = params.get("depth").and_then(|v| v.as_u64()).unwrap_or(2).clamp(1, 5) as usize;
        let show_hidden = params.get("show_hidden").and_then(|v| v.as_bool()).unwrap_or(false);
        
        let path = Self::resolve_path(path_str)?;
        Self::validate_read_access(&path)?;
        
        if !path.exists() || !path.is_dir() {
            return Err(WeaveError::PluginError(format!("Directory not found: {}", path.display())));
        }
        
        let mut tree_str = String::new();
        tree_str.push_str(&format!("{}/\n", path.file_name().unwrap_or_default().to_string_lossy()));
        
        Self::build_tree(&path, "", depth, 0, show_hidden, &mut tree_str)?;
        
        Ok(json!({
            "path": path.to_string_lossy().to_string(),
            "tree": tree_str,
            "success": true
        }))
    }

    fn build_tree(dir: &Path, prefix: &str, max_depth: usize, current_depth: usize, show_hidden: bool, output: &mut String) -> Result<(), WeaveError> {
        if current_depth >= max_depth {
            return Ok(());
        }

        let mut entries = vec![];
        if let Ok(rd) = std::fs::read_dir(dir) {
            for entry in rd.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                
                // Excludes
                if name == "node_modules" || name == "target" || name == ".git" || name == "__pycache__" || name == "dist" || name == ".venv" {
                    continue;
                }
                
                if !show_hidden && name.starts_with('.') {
                    continue;
                }
                
                entries.push(entry);
            }
        }
        
        entries.sort_by_key(|a| a.file_name());
        let count = entries.len();
        
        for (i, entry) in entries.iter().enumerate() {
            let is_last = i == count - 1;
            let marker = if is_last { "└── " } else { "├── " };
            let name = entry.file_name().to_string_lossy().to_string();
            
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            if is_dir {
                output.push_str(&format!("{}{}{}/\n", prefix, marker, name));
                let next_prefix = if is_last { format!("{}    ", prefix) } else { format!("{}│   ", prefix) };
                Self::build_tree(&entry.path(), &next_prefix, max_depth, current_depth + 1, show_hidden, output)?;
            } else {
                output.push_str(&format!("{}{}{}\n", prefix, marker, name));
            }
        }
        
        Ok(())
    }
}
