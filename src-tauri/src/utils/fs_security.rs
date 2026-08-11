use std::path::{Path, PathBuf};

use crate::utils::config::AppConfig;
use crate::utils::errors::WeaveError;

/// Canonicalize a user- or model-supplied path.
///
/// Handles `~` expansion and relative paths (resolved against the current
/// working directory), then resolves symlinks and `..` components. For paths
/// that do not exist yet (e.g. a file about to be written) the closest
/// existing ancestor is canonicalized and the remaining components are
/// appended.
///
/// All path checks in the file/coder/git/db plugins MUST operate on the
/// result of this function. Validating raw strings allows bypasses such as
/// `/tmp/../etc/passwd` which fails literal prefix checks but resolves
/// outside the workspace.
pub fn canonicalize_path(path: &str) -> Result<PathBuf, WeaveError> {
    let path = path.trim();

    let expanded = if path == "~" {
        home_dir()?
    } else if let Some(rest) = path.strip_prefix("~/") {
        home_dir()?.join(rest)
    } else if let Some(rest) = path.strip_prefix("~\\") {
        home_dir()?.join(rest)
    } else if Path::new(path).is_absolute() {
        PathBuf::from(path)
    } else {
        std::env::current_dir()
            .map_err(|e| WeaveError::Io(e.to_string()))?
            .join(path)
    };

    canonicalize_checked(&expanded)
}

/// Canonicalize an already-absolute path, tolerating non-existent leaf
/// components (writes to new files).
pub fn canonicalize_checked(path: &Path) -> Result<PathBuf, WeaveError> {
    let abs = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|e| WeaveError::Io(e.to_string()))?
            .join(path)
    };

    if abs.exists() {
        return abs.canonicalize().map_err(|e| WeaveError::Io(e.to_string()));
    }

    // Walk up to the deepest existing ancestor and canonicalize that.
    let mut missing: Vec<PathBuf> = Vec::new();
    let mut ancestor = abs.as_path();
    while !ancestor.exists() {
        if let Some(name) = ancestor.file_name() {
            missing.push(PathBuf::from(name));
        }
        match ancestor.parent() {
            Some(parent) => ancestor = parent,
            None => {
                return Err(WeaveError::Io(format!(
                    "Cannot resolve path: {}",
                    abs.display()
                )))
            }
        }
    }
    let mut resolved = ancestor
        .canonicalize()
        .map_err(|e| WeaveError::Io(e.to_string()))?;
    for component in missing.iter().rev() {
        resolved.push(component);
    }
    Ok(resolved)
}

fn home_dir() -> Result<PathBuf, WeaveError> {
    dirs::home_dir()
        .ok_or_else(|| WeaveError::PluginError("Cannot determine home directory".to_string()))
}

/// The roots within which AI-driven plugins are allowed to operate:
/// the workspace (current working directory, which the File Manager sets
/// when the user opens a folder) plus the app's own data directory
/// (`~/.weave` — notes, memory, artifacts, workflows).
pub fn allowed_roots() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        if let Ok(canonical) = cwd.canonicalize() {
            roots.push(canonical);
        } else {
            roots.push(cwd);
        }
    }
    if let Ok(data_dir) = AppConfig::app_data_dir() {
        roots.push(data_dir);
    }
    roots
}

/// True when `path` is `root` itself or lives under one of the allowed roots.
pub fn is_within_any(path: &Path, roots: &[PathBuf]) -> bool {
    roots
        .iter()
        .any(|root| path == root || path.starts_with(root))
}

/// Reject any path that escapes the workspace / app-data roots. Run this on
/// canonicalized paths only.
pub fn ensure_within_roots(path: &Path) -> Result<(), WeaveError> {
    let roots = allowed_roots();
    if is_within_any(path, &roots) {
        Ok(())
    } else {
        Err(WeaveError::PermissionDenied(format!(
            "Access denied: path is outside the workspace root: {}",
            path.display()
        )))
    }
}
