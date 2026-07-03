use std::fs;
use serde_json::{json, Value};
use crate::utils::errors::WeaveError;
use super::security::{resolve_path, validate_write_access};
use super::history::create_backup;

pub fn apply_patch(params: Value) -> Result<Value, WeaveError> {
    let path_str = params.get("path").and_then(|v| v.as_str())
        .ok_or_else(|| WeaveError::PluginError("Missing 'path' parameter".to_string()))?;
    let patch_text = params.get("patch").and_then(|v| v.as_str())
        .ok_or_else(|| WeaveError::PluginError("Missing 'patch' parameter".to_string()))?;

    let raw_path = resolve_path(path_str)?;
    let path = validate_write_access(&raw_path)?;

    if !path.exists() || !path.is_file() {
        return Err(WeaveError::PluginError(format!("File not found: {}", path.display())));
    }

    let content = fs::read_to_string(&path).map_err(|e| WeaveError::Io(e.to_string()))?;

    let patch = diffy::Patch::from_str(patch_text)
        .map_err(|e| WeaveError::PluginError(format!("Failed to parse patch: {}", e)))?;

    let updated = diffy::apply(&content, &patch)
        .map_err(|e| WeaveError::PluginError(format!("Failed to apply patch: {}", e)))?;

    create_backup(&path)?;
    fs::write(&path, &updated).map_err(|e| WeaveError::Io(e.to_string()))?;

    Ok(json!({
        "path": path.to_string_lossy().to_string(),
        "success": true
    }))
}

pub fn apply_diff(params: Value) -> Result<Value, WeaveError> {
    let path_str = params.get("path").and_then(|v| v.as_str())
        .ok_or_else(|| WeaveError::PluginError("Missing 'path' parameter".to_string()))?;
    let old_str = params.get("old_str").and_then(|v| v.as_str())
        .ok_or_else(|| WeaveError::PluginError("Missing 'old_str' parameter".to_string()))?;
    let new_str = params.get("new_str").and_then(|v| v.as_str())
        .ok_or_else(|| WeaveError::PluginError("Missing 'new_str' parameter".to_string()))?;

    let raw_path = resolve_path(path_str)?;
    let path = validate_write_access(&raw_path)?;

    if !path.exists() || !path.is_file() {
        return Err(WeaveError::PluginError(format!("File not found: {}", path.display())));
    }

    let content = fs::read_to_string(&path).map_err(|e| WeaveError::Io(e.to_string()))?;
    let count = content.matches(old_str).count();

    if count == 0 {
        return Err(WeaveError::PluginError("old_str not found in file".to_string()));
    } else if count > 1 {
        return Err(WeaveError::PluginError(format!("old_str is ambiguous — found {} occurrences, must be unique", count)));
    }

    create_backup(&path)?;

    let new_content = content.replace(old_str, new_str);
    fs::write(&path, &new_content).map_err(|e| WeaveError::Io(e.to_string()))?;

    let old_lines = old_str.lines().count();
    let new_lines = new_str.lines().count();
    let lines_changed = std::cmp::max(old_lines, new_lines);

    Ok(json!({
        "path": path.to_string_lossy().to_string(),
        "lines_changed": lines_changed,
        "success": true
    }))
}

pub fn patch_preview(params: Value) -> Result<Value, WeaveError> {
    let path_str = params.get("path").and_then(|v| v.as_str())
        .ok_or_else(|| WeaveError::PluginError("Missing 'path' parameter".to_string()))?;
    let patch_text = params.get("patch").and_then(|v| v.as_str())
        .ok_or_else(|| WeaveError::PluginError("Missing 'patch' parameter".to_string()))?;

    let raw_path = resolve_path(path_str)?;
    let path = validate_write_access(&raw_path)?;

    if !path.exists() || !path.is_file() {
        return Err(WeaveError::PluginError(format!("File not found: {}", path.display())));
    }

    let content = fs::read_to_string(&path).map_err(|e| WeaveError::Io(e.to_string()))?;

    let patch = diffy::Patch::from_str(patch_text)
        .map_err(|e| WeaveError::PluginError(format!("Failed to parse patch: {}", e)))?;

    let updated = diffy::apply(&content, &patch)
        .map_err(|e| WeaveError::PluginError(format!("Failed to apply patch: {}", e)))?;

    let diff = diffy::create_patch(&content, &updated);
    
    Ok(json!({
        "path": path.to_string_lossy().to_string(),
        "preview": diff.to_string(),
        "success": true
    }))
}
