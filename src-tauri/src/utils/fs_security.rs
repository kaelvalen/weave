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
        return abs
            .canonicalize()
            .map_err(|e| WeaveError::Io(e.to_string()));
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

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "weave_fs_security_{}_{}",
            tag,
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn canonicalize_dotdot_traversal_is_denied() {
        let root = temp_root("traversal");
        // Build a literal path like /tmp/weave_fs_sec_X/../secret — must
        // canonicalize to the parent, which is outside `root`.
        let traversal = root.join("..").join("null_does_not_matter");
        let canonical = canonicalize_checked(&traversal).unwrap();
        assert!(!is_within_any(&canonical, std::slice::from_ref(&root)));
        // Symmetry: a real child is allowed.
        std::fs::create_dir_all(root.join("child")).unwrap();
        let child_canon = canonicalize_checked(&root.join("child")).unwrap();
        assert!(is_within_any(&child_canon, std::slice::from_ref(&root)));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn symlink_escape_is_resolved_and_denied() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let root = temp_root("symlink");
            let outside = temp_root("symlink_outside");
            std::fs::write(outside.join("secret.txt"), "x").unwrap();
            let link = root.join("escape");
            // Symlink INSIDE root → OUTSIDE root. Literal prefix checks would
            // pass; canonicalization must resolve it and deny it.
            symlink(&outside, &link).unwrap();
            let canonical = canonicalize_checked(&link.join("secret.txt")).unwrap();
            assert!(!is_within_any(&canonical, std::slice::from_ref(&root)));
            let _ = std::fs::remove_dir_all(&root);
            let _ = std::fs::remove_dir_all(&outside);
        }
    }

    #[test]
    fn canonicalize_tolerates_missing_leaf_for_writes() {
        let root = temp_root("write");
        std::fs::create_dir_all(root.join("sub")).unwrap();
        let target = root.join("sub").join("new").join("file.txt");
        let canonical = canonicalize_checked(&target).unwrap();
        assert!(canonical.starts_with(root.join("sub")));
        assert!(canonical.ends_with("file.txt"));
        assert!(is_within_any(&canonical, std::slice::from_ref(&root)));
        let _ = std::fs::remove_dir_all(&root);
    }
}
