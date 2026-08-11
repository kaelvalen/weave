use crate::utils::config::AppConfig;
use crate::utils::errors::WeaveError;
use crate::utils::fs_security;
use std::path::{Path, PathBuf};

const BLOCKED_PREFIXES: &[&str] = &[
    "/etc", "/proc", "/sys", "/dev", "/boot", "/root", "/var/log", "/var/run",
];

pub fn resolve_path(path: &str) -> Result<PathBuf, WeaveError> {
    let path = path.trim();
    // App-managed artifacts live under ~/.weave/artifacts, which is one of
    // the allowed roots, so resolution can fall through to the shared
    // canonicalizer after expanding the prefix.
    if path.starts_with("artifacts/") || path.starts_with("artifacts\\") {
        let app_dir = AppConfig::app_data_dir()?;
        return fs_security::canonicalize_checked(&app_dir.join(path));
    }
    fs_security::canonicalize_path(path)
}

pub fn canonicalize_secure(path: &Path) -> Result<PathBuf, WeaveError> {
    let resolved = fs_security::canonicalize_checked(path)?;
    let path_str = resolved.to_string_lossy();

    // 1. Deny access to sensitive system paths
    for prefix in BLOCKED_PREFIXES {
        if path_str == *prefix || path_str.starts_with(&format!("{}/", prefix)) {
            return Err(WeaveError::PermissionDenied(format!(
                "Access denied: Path violates security boundary: {}",
                resolved.display()
            )));
        }
    }

    // 2. Deny access to sensitive SSH key folders
    if resolved
        .components()
        .any(|c| c.as_os_str() == ".ssh")
    {
        return Err(WeaveError::PermissionDenied(format!(
            "Access denied: SSH key folder is protected: {}",
            resolved.display()
        )));
    }

    // 3. Confine to the workspace / app-data roots (canonical paths only)
    fs_security::ensure_within_roots(&resolved)?;

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
