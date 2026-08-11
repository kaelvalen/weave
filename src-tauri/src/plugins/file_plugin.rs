use serde_json::{json, Value};
use std::path::Path;
use tracing::{info, warn};

use crate::models::plugin::PluginExecutor;
use crate::utils::errors::WeaveError;
use crate::utils::fs_security;

const BLOCKED_READ_PATHS: &[&str] = &[
    "/etc/shadow",
    "/etc/gshadow",
    "/etc/sudoers",
    "/etc/passwd",
    ".ssh",
    ".gnupg",
    ".aws",
    ".config",
];
const BLOCKED_WRITE_PATHS: &[&str] = &[
    "/etc/", "/boot/", "/usr/", "/bin/", "/sbin/", "/proc/", "/sys/", "/dev/",
];
const BLOCKED_WRITE_FILES: &[&str] = &[
    ".ssh/id_rsa",
    ".ssh/id_ed25519",
    ".ssh/authorized_keys",
    ".gnupg/",
    ".bash_history",
];

pub struct FilePlugin;

impl PluginExecutor for FilePlugin {
    fn execute(
        &self,
        capability: &str,
        params: Value,
        ctx: &runtime_kernel::execution_context::ExecutionContext,
    ) -> Result<Value, WeaveError> {
        FilePlugin::execute(capability, params, ctx)
    }
}

impl FilePlugin {
    pub fn execute(
        capability: &str,
        params: Value,
        _ctx: &runtime_kernel::execution_context::ExecutionContext,
    ) -> Result<Value, WeaveError> {
        match capability {
            "file.read" => Self::read(params),
            "file.write" => Self::write(params),
            "file.list" => Self::list(params),
            "file.search" => Self::search(params),
            "file.delete" => Self::delete(params),
            "file.mkdir" => Self::mkdir(params),
            _ => Err(WeaveError::CapabilityNotFound(capability.to_string())),
        }
    }

    fn read(params: Value) -> Result<Value, WeaveError> {
        let path = params
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| WeaveError::PluginError("Missing 'path' parameter".to_string()))?;
        let resolved_path = Self::resolve_path(path)?;
        Self::validate_read_access(&resolved_path)?;
        if !resolved_path.exists() {
            return Err(WeaveError::PluginError(format!(
                "File not found: {}",
                resolved_path.display()
            )));
        }
        if !resolved_path.is_file() {
            return Err(WeaveError::PluginError(format!(
                "Path is not a file: {}",
                resolved_path.display()
            )));
        }
        let content = std::fs::read_to_string(&resolved_path)?;
        info!(
            "Read file: {} ({} bytes)",
            resolved_path.display(),
            content.len()
        );
        Ok(
            json!({"path": resolved_path.to_string_lossy().to_string(), "content": content, "size": content.len(), "success": true}),
        )
    }

    fn write(params: Value) -> Result<Value, WeaveError> {
        let path = params
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| WeaveError::PluginError("Missing 'path' parameter".to_string()))?;
        let content = params
            .get("content")
            .and_then(|v| v.as_str())
            .ok_or_else(|| WeaveError::PluginError("Missing 'content' parameter".to_string()))?;
        let resolved_path = Self::resolve_path(path)?;
        Self::validate_write_access(&resolved_path)?;
        if let Some(parent) = resolved_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&resolved_path, content)?;
        info!(
            "Wrote file: {} ({} bytes)",
            resolved_path.display(),
            content.len()
        );
        Ok(
            json!({"path": resolved_path.to_string_lossy().to_string(), "bytes_written": content.len(), "success": true}),
        )
    }

    fn list(params: Value) -> Result<Value, WeaveError> {
        let directory = params
            .get("directory")
            .and_then(|v| v.as_str())
            .unwrap_or(".");
        let resolved_path = Self::resolve_path(directory)?;
        Self::validate_read_access(&resolved_path)?;
        if !resolved_path.exists() {
            return Err(WeaveError::PluginError(format!(
                "Directory not found: {}",
                resolved_path.display()
            )));
        }
        if !resolved_path.is_dir() {
            return Err(WeaveError::PluginError(format!(
                "Path is not a directory: {}",
                resolved_path.display()
            )));
        }
        let mut entries = Vec::new();
        for entry_result in std::fs::read_dir(&resolved_path)? {
            let entry = entry_result?;
            let metadata = entry.metadata()?;
            let file_name = entry.file_name().to_string_lossy().to_string();
            let file_type = if metadata.is_dir() {
                "directory"
            } else if metadata.is_file() {
                "file"
            } else if metadata.is_symlink() {
                "symlink"
            } else {
                "unknown"
            };
            entries.push(json!({"name": file_name, "path": entry.path().to_string_lossy().to_string(), "type": file_type, "size": metadata.len(),
                "modified": metadata.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs())}));
        }
        entries.sort_by(|a, b| {
            let a_is_dir = a.get("type").and_then(|v| v.as_str()) == Some("directory");
            let b_is_dir = b.get("type").and_then(|v| v.as_str()) == Some("directory");
            let a_name = a.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let b_name = b.get("name").and_then(|v| v.as_str()).unwrap_or("");
            if a_is_dir && !b_is_dir {
                std::cmp::Ordering::Less
            } else if !a_is_dir && b_is_dir {
                std::cmp::Ordering::Greater
            } else {
                a_name.cmp(b_name)
            }
        });
        info!(
            "Listed directory: {} ({} entries)",
            resolved_path.display(),
            entries.len()
        );
        Ok(
            json!({"directory": resolved_path.to_string_lossy().to_string(), "entries": entries, "count": entries.len(), "success": true}),
        )
    }

    fn search(params: Value) -> Result<Value, WeaveError> {
        let pattern = params
            .get("pattern")
            .and_then(|v| v.as_str())
            .ok_or_else(|| WeaveError::PluginError("Missing 'pattern' parameter".to_string()))?;
        let directory = params
            .get("directory")
            .and_then(|v| v.as_str())
            .unwrap_or(".");
        let resolved_path = Self::resolve_path(directory)?;
        Self::validate_read_access(&resolved_path)?;
        if !resolved_path.exists() || !resolved_path.is_dir() {
            return Err(WeaveError::PluginError(format!(
                "Directory not found: {}",
                resolved_path.display()
            )));
        }
        let mut matches = Vec::new();
        Self::search_recursive(&resolved_path, pattern, &mut matches)?;
        info!(
            "Search '{}' in {}: {} matches",
            pattern,
            resolved_path.display(),
            matches.len()
        );
        Ok(
            json!({"pattern": pattern, "directory": resolved_path.to_string_lossy().to_string(), "matches": matches, "count": matches.len(), "success": true}),
        )
    }

    fn search_recursive(
        dir: &Path,
        pattern: &str,
        results: &mut Vec<Value>,
    ) -> Result<(), WeaveError> {
        let pattern_lower = pattern.to_lowercase();
        let roots = fs_security::allowed_roots();
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            // Do not descend into symlinked directories that point outside
            // the workspace, and never surface paths outside the workspace.
            if let Ok(canonical) = path.canonicalize() {
                if !fs_security::is_within_any(&canonical, &roots) {
                    continue;
                }
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.to_lowercase().contains(&pattern_lower) {
                let metadata = entry.metadata()?;
                results.push(json!({"name": name, "path": path.to_string_lossy().to_string(), "type": if metadata.is_dir() { "directory" } else { "file" }, "size": metadata.len()}));
            }
            if path.is_dir() {
                if let Err(e) = Self::search_recursive(&path, pattern, results) {
                    warn!("Error searching {:?}: {}", path, e);
                }
            }
        }
        Ok(())
    }

    fn delete(params: Value) -> Result<Value, WeaveError> {
        let path = params
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| WeaveError::PluginError("Missing 'path' parameter".to_string()))?;
        let resolved_path = Self::resolve_path(path)?;
        Self::validate_write_access(&resolved_path)?;
        if !resolved_path.exists() {
            return Err(WeaveError::PluginError(format!(
                "Path not found: {}",
                resolved_path.display()
            )));
        }
        if resolved_path.is_dir() {
            std::fs::remove_dir_all(&resolved_path)?;
        } else {
            std::fs::remove_file(&resolved_path)?;
        }
        info!("Deleted path: {}", resolved_path.display());
        Ok(json!({"path": resolved_path.to_string_lossy().to_string(), "success": true}))
    }

    fn mkdir(params: Value) -> Result<Value, WeaveError> {
        let path = params
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| WeaveError::PluginError("Missing 'path' parameter".to_string()))?;
        let resolved_path = Self::resolve_path(path)?;
        Self::validate_write_access(&resolved_path)?;
        std::fs::create_dir_all(&resolved_path)?;
        info!("Created directory: {}", resolved_path.display());
        Ok(json!({"path": resolved_path.to_string_lossy().to_string(), "success": true}))
    }

    fn resolve_path(path: &str) -> Result<std::path::PathBuf, WeaveError> {
        fs_security::canonicalize_path(path)
    }

    /// Read validation: canonicalized path, deny list, then workspace
    /// confinement. All checks run on the canonical path so `..`/symlink
    /// tricks cannot bypass them.
    fn validate_read_access(path: &Path) -> Result<(), WeaveError> {
        let path_str = path.to_string_lossy();
        for blocked in BLOCKED_READ_PATHS {
            let blocked_is_absolute = blocked.starts_with('/');
            let denied = if blocked_is_absolute {
                path_str == *blocked || path_str.starts_with(&format!("{}/", blocked))
            } else {
                path.components().any(|c| c.as_os_str() == Path::new(blocked).as_os_str())
            };
            if denied {
                return Err(WeaveError::PermissionDenied(format!(
                    "Read access denied: {}",
                    path.display()
                )));
            }
        }
        fs_security::ensure_within_roots(path)
    }

    fn validate_write_access(path: &Path) -> Result<(), WeaveError> {
        let path_str = path.to_string_lossy();
        for blocked in BLOCKED_WRITE_PATHS {
            if path_str.starts_with(blocked) {
                return Err(WeaveError::PermissionDenied(format!(
                    "Write denied for system path: {}",
                    path.display()
                )));
            }
        }
        for blocked in BLOCKED_WRITE_FILES {
            if path_str.contains(blocked) {
                return Err(WeaveError::PermissionDenied(format!(
                    "Write denied for sensitive file: {}",
                    path.display()
                )));
            }
        }
        fs_security::ensure_within_roots(path)
    }
}
