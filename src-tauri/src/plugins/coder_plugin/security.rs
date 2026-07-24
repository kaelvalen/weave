use crate::utils::errors::WeaveError;
use std::path::{Path, PathBuf};

const BLOCKED_PREFIXES: &[&str] = &[
    "/etc", "/proc", "/sys", "/dev", "/boot", "/root", "/var/log", "/var/run",
];

pub fn resolve_path(path: &str) -> Result<PathBuf, WeaveError> {
    let path = path.trim();
    if path.starts_with("~/") {
        let home = dirs::home_dir().ok_or_else(|| {
            WeaveError::PluginError("Cannot determine home directory".to_string())
        })?;
        Ok(home.join(&path[2..]))
    } else if Path::new(path).is_absolute() {
        Ok(PathBuf::from(path))
    } else {
        Ok(std::env::current_dir()
            .map_err(|e| WeaveError::Io(e.to_string()))?
            .join(path))
    }
}

pub fn canonicalize_secure(path: &Path) -> Result<PathBuf, WeaveError> {
    // 1. Resolve absolute path
    let abs_path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|e| WeaveError::Io(e.to_string()))?
            .join(path)
    };

    // 2. Canonicalize path (or parent if file doesn't exist yet)
    let resolved = if abs_path.exists() {
        abs_path
            .canonicalize()
            .map_err(|e| WeaveError::Io(e.to_string()))?
    } else {
        let mut parent = abs_path.as_path();
        let mut components = Vec::new();
        while !parent.exists() {
            if let Some(name) = parent.file_name() {
                components.push(name);
            }
            if let Some(p) = parent.parent() {
                parent = p;
            } else {
                break;
            }
        }
        let mut parent_canonical = parent
            .canonicalize()
            .map_err(|e| WeaveError::Io(e.to_string()))?;
        for comp in components.iter().rev() {
            parent_canonical.push(comp);
        }
        parent_canonical
    };

    let path_str = resolved.to_string_lossy();

    // 3. Deny access to sensitive system paths
    for prefix in BLOCKED_PREFIXES {
        if path_str == *prefix || path_str.starts_with(&format!("{}/", prefix)) {
            return Err(WeaveError::PermissionDenied(format!(
                "Access denied: Path violates security boundary: {}",
                resolved.display()
            )));
        }
    }

    // 4. Deny access to sensitive SSH key folders
    if path_str.contains("/.ssh/") || path_str.ends_with("/.ssh") {
        return Err(WeaveError::PermissionDenied(format!(
            "Access denied: SSH key folder is protected: {}",
            resolved.display()
        )));
    }

    Ok(resolved)
}

pub fn validate_read_access(path: &Path) -> Result<PathBuf, WeaveError> {
    let secure_path = canonicalize_secure(path)?;
    let path_str = secure_path.to_string_lossy();

    if path_str.contains("/etc/shadow") || path_str.contains("/etc/passwd") {
        return Err(WeaveError::PermissionDenied(format!(
            "Read access denied: {}",
            secure_path.display()
        )));
    }

    Ok(secure_path)
}

pub fn validate_write_access(path: &Path) -> Result<PathBuf, WeaveError> {
    let secure_path = canonicalize_secure(path)?;
    let path_str = secure_path.to_string_lossy();

    // Block write to internal git objects
    if path_str.contains("/.git/objects/") || path_str.contains("/.git/refs/") {
        return Err(WeaveError::PermissionDenied(format!(
            "Write access to Git internal objects denied: {}",
            secure_path.display()
        )));
    }

    Ok(secure_path)
}
