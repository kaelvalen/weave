use super::security::{resolve_path, validate_read_access, validate_write_access};
use crate::utils::errors::WeaveError;
use chrono::Local;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

fn get_history_dir() -> Result<PathBuf, WeaveError> {
    let current = std::env::current_dir().map_err(|e| WeaveError::Io(e.to_string()))?;
    let history_dir = current.join(".weave").join("history");
    if !history_dir.exists() {
        fs::create_dir_all(&history_dir).map_err(|e| WeaveError::Io(e.to_string()))?;
    }
    Ok(history_dir)
}

fn get_flat_prefix(path: &Path) -> String {
    let abs_str = path.to_string_lossy().to_string();
    let cleaned: String = abs_str
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '_' })
        .collect();
    cleaned
}

pub fn create_backup(path: &Path) -> Result<PathBuf, WeaveError> {
    let history_dir = get_history_dir()?;
    let prefix = get_flat_prefix(path);
    let timestamp = Local::now().format("%Y%m%d-%H%M%S").to_string();
    let backup_name = format!("{}.{}.bak", prefix, timestamp);
    let backup_path = history_dir.join(backup_name);

    fs::copy(path, &backup_path).map_err(|e| WeaveError::Io(e.to_string()))?;
    Ok(backup_path)
}

pub fn history(params: Value) -> Result<Value, WeaveError> {
    let path_str = params
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| WeaveError::PluginError("Missing 'path' parameter".to_string()))?;
    let raw_path = resolve_path(path_str)?;
    let path = validate_read_access(&raw_path)?;

    let history_dir = get_history_dir()?;
    let prefix = get_flat_prefix(&path);

    let mut entries = Vec::new();
    if let Ok(rd) = fs::read_dir(history_dir) {
        for entry in rd.flatten() {
            let filename = entry.file_name().to_string_lossy().to_string();
            if filename.starts_with(&prefix) && filename.ends_with(".bak") {
                let parts: Vec<&str> = filename.split('.').collect();
                if parts.len() >= 2 {
                    let timestamp = parts[parts.len() - 2].to_string();
                    let metadata = entry.metadata().ok();
                    let size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
                    let mod_time = metadata
                        .as_ref()
                        .and_then(|m| m.modified().ok())
                        .map(|t| chrono::DateTime::<Local>::from(t).to_rfc3339())
                        .unwrap_or_default();

                    entries.push(json!({
                        "filename": filename,
                        "timestamp": timestamp,
                        "size_bytes": size,
                        "modified": mod_time,
                    }));
                }
            }
        }
    }

    // Sort newest first
    entries.sort_by(|a, b| b["timestamp"].as_str().cmp(&a["timestamp"].as_str()));

    Ok(json!({
        "path": path.to_string_lossy().to_string(),
        "history": entries,
        "success": true
    }))
}

pub fn undo(params: Value) -> Result<Value, WeaveError> {
    let path_str = params
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| WeaveError::PluginError("Missing 'path' parameter".to_string()))?;
    let raw_path = resolve_path(path_str)?;
    let path = validate_write_access(&raw_path)?;

    let history_dir = get_history_dir()?;
    let prefix = get_flat_prefix(&path);

    let mut backups = Vec::new();
    if let Ok(rd) = fs::read_dir(&history_dir) {
        for entry in rd.flatten() {
            let filename = entry.file_name().to_string_lossy().to_string();
            if filename.starts_with(&prefix) && filename.ends_with(".bak") {
                backups.push(entry.path());
            }
        }
    }

    if backups.is_empty() {
        return Err(WeaveError::PluginError(
            "No backup found for this file".to_string(),
        ));
    }

    // Sort backups by modification time, newest first
    backups.sort_by(|a, b| {
        let ma = a.metadata().and_then(|m| m.modified()).ok();
        let mb = b.metadata().and_then(|m| m.modified()).ok();
        mb.cmp(&ma)
    });

    let current_content = if path.exists() {
        fs::read_to_string(&path).ok()
    } else {
        None
    };

    // Find the first backup whose content differs from current content, or just the newest one
    let mut backup_to_restore = &backups[0];
    for backup in &backups {
        if let Ok(backup_content) = fs::read_to_string(backup) {
            if Some(&backup_content) != current_content.as_ref() {
                backup_to_restore = backup;
                break;
            }
        }
    }

    // Save current state as a redo/backup before restoring
    if path.exists() {
        create_backup(&path)?;
    }

    fs::copy(backup_to_restore, &path).map_err(|e| WeaveError::Io(e.to_string()))?;

    Ok(json!({
        "path": path.to_string_lossy().to_string(),
        "restored_from": backup_to_restore.file_name().unwrap_or_default().to_string_lossy().to_string(),
        "success": true
    }))
}

pub fn redo(params: Value) -> Result<Value, WeaveError> {
    // Redo is just undoing the undo, i.e., restoring the version that was created just before the undo.
    // In our timestamped model, all states are saved in chronological order. Redo is functionally
    // restoring the next version in the backup history list.
    // Let's implement it by finding the backup that was modified *after* the current state's modification time.
    let path_str = params
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| WeaveError::PluginError("Missing 'path' parameter".to_string()))?;
    let raw_path = resolve_path(path_str)?;
    let path = validate_write_access(&raw_path)?;

    let history_dir = get_history_dir()?;
    let prefix = get_flat_prefix(&path);

    let mut backups = Vec::new();
    if let Ok(rd) = fs::read_dir(&history_dir) {
        for entry in rd.flatten() {
            let filename = entry.file_name().to_string_lossy().to_string();
            if filename.starts_with(&prefix) && filename.ends_with(".bak") {
                backups.push(entry.path());
            }
        }
    }

    if backups.len() < 2 {
        return Err(WeaveError::PluginError(
            "No redo state available (requires at least 2 history versions)".to_string(),
        ));
    }

    // Sort backups by modification time, oldest first
    backups.sort_by(|a, b| {
        let ma = a.metadata().and_then(|m| m.modified()).ok();
        let mb = b.metadata().and_then(|m| m.modified()).ok();
        ma.cmp(&mb)
    });

    let current_content = if path.exists() {
        fs::read_to_string(&path).ok()
    } else {
        None
    };

    // Find the backup whose content matches current_content
    let mut current_backup_idx = None;
    for (idx, backup) in backups.iter().enumerate() {
        if let Ok(backup_content) = fs::read_to_string(backup) {
            if Some(&backup_content) == current_content.as_ref() {
                current_backup_idx = Some(idx);
                break;
            }
        }
    }

    let backup_to_restore = match current_backup_idx {
        Some(idx) if idx + 1 < backups.len() => &backups[idx + 1],
        _ => {
            // Revert to the last backup in the list
            &backups[backups.len() - 1]
        }
    };

    fs::copy(backup_to_restore, &path).map_err(|e| WeaveError::Io(e.to_string()))?;

    Ok(json!({
        "path": path.to_string_lossy().to_string(),
        "restored_from": backup_to_restore.file_name().unwrap_or_default().to_string_lossy().to_string(),
        "success": true
    }))
}
