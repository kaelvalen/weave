use std::path::{Path, PathBuf};
use crate::utils::errors::WeaveError;

const BLOCKED_PATHS: &[&str] = &[
    "/etc",
    "/proc",
    "/sys",
    "/dev",
    "/boot",
    "/usr",
    "/bin",
    "/sbin",
    "/root/.ssh",
    ".git",
    ".env",
];

pub fn resolve_path(path: &str) -> Result<PathBuf, WeaveError> {
    if path.starts_with("~/") {
        let home = dirs::home_dir().ok_or_else(|| WeaveError::PluginError("Cannot determine home directory".to_string()))?;
        Ok(home.join(&path[2..]))
    } else if Path::new(path).is_absolute() {
        Ok(PathBuf::from(path))
    } else {
        Ok(std::env::current_dir().map_err(|e| WeaveError::Io(e.to_string()))?.join(path))
    }
}

pub fn canonicalize_secure(path: &Path) -> Result<PathBuf, WeaveError> {
    // Resolve absolute path first
    let abs_path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir().map_err(|e| WeaveError::Io(e.to_string()))?.join(path)
    };

    // If path exists, canonicalize directly
    let resolved = if abs_path.exists() {
        abs_path.canonicalize().map_err(|e| WeaveError::Io(e.to_string()))?
    } else {
        // If it doesn't exist, canonicalize the closest existing parent
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
        let mut parent_canonical = parent.canonicalize().map_err(|e| WeaveError::Io(e.to_string()))?;
        for comp in components.iter().rev() {
            parent_canonical.push(comp);
        }
        parent_canonical
    };

    let path_str = resolved.to_string_lossy();

    // Check blocked directories/files
    for blocked in BLOCKED_PATHS {
        // Check if path starts withblocked path (handling leading slashes)
        if path_str.starts_with(blocked) || path_str.contains(&format!("/{}", blocked)) {
            return Err(WeaveError::PermissionDenied(format!(
                "Access denied: Path violates security boundary: {}",
                resolved.display()
            )));
        }
    }

    Ok(resolved)
}

pub fn validate_read_access(path: &Path) -> Result<PathBuf, WeaveError> {
    let secure_path = canonicalize_secure(path)?;
    let path_str = secure_path.to_string_lossy();

    if path_str.contains("/etc/shadow") || path_str.contains("/etc/passwd") {
        return Err(WeaveError::PermissionDenied(format!("Read access denied: {}", secure_path.display())));
    }

    Ok(secure_path)
}

pub fn validate_write_access(path: &Path) -> Result<PathBuf, WeaveError> {
    let secure_path = canonicalize_secure(path)?;
    let path_str = secure_path.to_string_lossy();

    // Block critical writes
    if path_str.contains(".git/") || path_str.ends_with(".git") {
        return Err(WeaveError::PermissionDenied(format!("Write access to Git internal metadata denied: {}", secure_path.display())));
    }

    Ok(secure_path)
}
