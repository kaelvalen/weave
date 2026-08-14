use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use parking_lot::Mutex;

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

/// The un-escaped roots: workspace (current working directory, which the
/// File Manager sets when the user opens a folder) plus the app's own data
/// directory. Escapes (user-approved paths outside these) are layered on
/// top by `allowed_roots()`.
pub fn base_roots() -> Vec<PathBuf> {
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

/// The roots within which AI-driven plugins are allowed to operate: the
/// base workspace roots plus every path the user explicitly approved as an
/// escape (see `approve_escape`).
pub fn allowed_roots() -> Vec<PathBuf> {
    let mut roots = base_roots();
    roots.extend(approved_escapes());
    roots
}

/// True when the canonicalized path sits outside the base workspace — i.e.
/// a call touching it is an escape that requires explicit user approval.
pub fn is_escape(path: &Path) -> bool {
    !is_within_any(path, &base_roots())
}

/// Escaped paths the user explicitly approved (session-scoped). Approval is
/// granted per call by the agent loop when the user approves a tool call
/// whose parameters reach outside the workspace — subsequent operations on
/// the same canonical path then pass the confinement check, without ever
/// widening the approval gate itself.
static APPROVED_ESCAPES: OnceLock<Mutex<Vec<PathBuf>>> = OnceLock::new();

fn approved() -> &'static Mutex<Vec<PathBuf>> {
    APPROVED_ESCAPES.get_or_init(|| Mutex::new(Vec::new()))
}

/// Record a user-approved escape. Canonicalized and deduplicated; unknown
/// failures are ignored (the caller's path checks still run on the raw
/// input through `canonicalize_path`).
pub fn approve_escape(path: &Path) {
    if let Ok(canonical) = path.canonicalize() {
        let mut list = approved().lock();
        if !list.iter().any(|p| p == &canonical) {
            list.push(canonical);
        }
    }
}

/// All currently approved escape paths (canonical).
pub fn approved_escapes() -> Vec<PathBuf> {
    approved().lock().clone()
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

#[cfg(test)]
mod tests {
    use super::*;

    /// A path guaranteed to be outside every base root (never under the
    /// CWD, never under the app data dir).
    fn outside_path() -> PathBuf {
        let id = uuid::Uuid::new_v4().to_string();
        let dir = std::env::temp_dir().join(format!("weave_escape_test_{}", id));
        std::fs::create_dir_all(&dir).unwrap();
        dir.canonicalize().unwrap()
    }

    #[test]
    fn unapproved_outside_path_is_an_escape() {
        let path = outside_path();
        assert!(
            is_escape(&path),
            "{} must be an escape before approval",
            path.display()
        );
        assert!(
            ensure_within_roots(&path).is_err(),
            "unapproved escape must be rejected by confinement"
        );
        let _ = std::fs::remove_dir_all(&path);
    }

    #[test]
    fn approved_outside_path_becomes_operable() {
        let path = outside_path();
        approve_escape(&path);
        assert!(
            allowed_roots().iter().any(|root| root == &path),
            "approved escape must join allowed roots"
        );
        assert!(
            ensure_within_roots(&path).is_ok(),
            "approved escape must pass confinement"
        );
        let _ = std::fs::remove_dir_all(&path);
    }

    #[test]
    fn workspace_path_is_not_an_escape() {
        let cwd = std::env::current_dir().unwrap().canonicalize().unwrap();
        assert!(!is_escape(&cwd));
        assert!(ensure_within_roots(&cwd).is_ok());
    }
}
