use super::history::create_backup;
use super::security::{resolve_path, validate_write_access};
use crate::utils::errors::WeaveError;
use serde_json::{json, Value};
use std::fs;

pub fn apply_patch(params: Value) -> Result<Value, WeaveError> {
    let path_str = params
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| WeaveError::PluginError("Missing 'path' parameter".to_string()))?;
    let patch_text = params
        .get("patch")
        .and_then(|v| v.as_str())
        .ok_or_else(|| WeaveError::PluginError("Missing 'patch' parameter".to_string()))?;

    let raw_path = resolve_path(path_str)?;
    let path = validate_write_access(&raw_path)?;

    if !path.exists() || !path.is_file() {
        return Err(WeaveError::PluginError(format!(
            "File not found: {}",
            path.display()
        )));
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
    let path_str = params
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| WeaveError::PluginError("Missing 'path' parameter".to_string()))?;
    let old_str = params
        .get("old_str")
        .and_then(|v| v.as_str())
        .ok_or_else(|| WeaveError::PluginError("Missing 'old_str' parameter".to_string()))?;
    let new_str = params
        .get("new_str")
        .and_then(|v| v.as_str())
        .ok_or_else(|| WeaveError::PluginError("Missing 'new_str' parameter".to_string()))?;

    let raw_path = resolve_path(path_str)?;
    let path = validate_write_access(&raw_path)?;

    if !path.exists() || !path.is_file() {
        return Err(WeaveError::PluginError(format!(
            "File not found: {}",
            path.display()
        )));
    }

    let content = fs::read_to_string(&path).map_err(|e| WeaveError::Io(e.to_string()))?;

    // Fast path: exact byte-for-byte match.
    let count = content.matches(old_str).count();

    if count == 1 {
        create_backup(&path)?;
        let new_content = content.replace(old_str, new_str);
        fs::write(&path, &new_content).map_err(|e| WeaveError::Io(e.to_string()))?;
        let old_lines = old_str.lines().count();
        let new_lines = new_str.lines().count();
        return Ok(json!({
            "path": path.to_string_lossy().to_string(),
            "lines_changed": std::cmp::max(old_lines, new_lines),
            "success": true,
            "match_type": "exact"
        }));
    } else if count > 1 {
        return Err(WeaveError::PluginError(format!(
            "old_str is ambiguous — found {} occurrences, must be unique. Use a longer/unique snippet.",
            count
        )));
    }

    // Fallback: whitespace-tolerant match. Normalize trailing whitespace per line
    // and line endings so minor formatting differences don't cause a failure.
    // This makes apply_diff robust against trailing-space edits by formatters.
    let normalize = |s: &str| -> String {
        s.lines()
            .map(|line| line.trim_end())
            .collect::<Vec<_>>()
            .join("\n")
    };

    let norm_old = normalize(old_str);
    let norm_content = normalize(&content);
    let norm_count = norm_content.matches(&norm_old).count();

    if norm_count == 1 {
        // Find the exact byte range in the original content that corresponds to the
        // normalized match, so we preserve the file's original formatting elsewhere.
        let norm_start = norm_content.find(&norm_old).unwrap_or(0);
        let norm_end = norm_start + norm_old.len();

        // Map normalized indices back to original content character offsets.
        let mut orig_start = 0;
        let mut orig_end = 0;
        let mut norm_pos = 0;
        let orig_chars: Vec<char> = content.chars().collect();
        let norm_chars: Vec<char> = norm_content.chars().collect();

        for (i, (_orig_c, norm_c)) in orig_chars.iter().zip(norm_chars.iter()).enumerate() {
            if norm_pos == norm_start {
                orig_start = i;
            }
            if norm_pos == norm_end {
                orig_end = i;
                break;
            }
            norm_pos += norm_c.len_utf8();
        }
        if orig_end == 0 {
            orig_end = content.len();
        }

        let original_slice = &content[orig_start..orig_end];
        create_backup(&path)?;
        let new_content = content.replace(original_slice, new_str);
        fs::write(&path, &new_content).map_err(|e| WeaveError::Io(e.to_string()))?;

        let old_lines = old_str.lines().count();
        let new_lines = new_str.lines().count();
        return Ok(json!({
            "path": path.to_string_lossy().to_string(),
            "lines_changed": std::cmp::max(old_lines, new_lines),
            "success": true,
            "match_type": "whitespace_tolerant"
        }));
    } else if norm_count > 1 {
        return Err(WeaveError::PluginError(format!(
            "old_str is ambiguous — found {} occurrences (even after normalizing whitespace), must be unique.",
            norm_count
        )));
    }

    // Both exact and tolerant match failed — help the AI recover with context.
    let content_lines: Vec<&str> = content.lines().collect();
    let old_first_line = old_str.lines().next().unwrap_or("").trim();
    let old_last_line = old_str.lines().last().unwrap_or("").trim();

    // Try to find the first and last lines of old_str in the file to report how close we got.
    let first_match = content_lines
        .iter()
        .position(|l| l.trim() == old_first_line);
    let last_match = content_lines
        .iter()
        .rposition(|l| l.trim() == old_last_line);

    let hint = match (first_match, last_match) {
        (Some(f), Some(l)) if f <= l => {
            let extracted = content_lines[f..=l.min(content_lines.len() - 1)].join("\n");
            let norm_extracted = normalize(&extracted);
            let norm_old = normalize(old_str);
            // Find first differing line for a concise hint.
            let diff_line = norm_extracted
                .lines()
                .zip(norm_old.lines())
                .position(|(a, b)| a != b);
            match diff_line {
                Some(d) => format!(
                    " First/last lines matched at lines {}-{}, but line {} of old_str differs from the file. Re-read the file and use the exact text.",
                    f + 1, l + 1, d + 1
                ),
                None => format!(
                    " First/last lines matched at lines {}-{} but the block in between differs. Re-read the file and use the exact text.",
                    f + 1, l + 1
                ),
            }
        }
        _ => {
            if old_str.len() > 500 {
                " Tip: old_str is very long (>500 chars). Use a shorter, unique snippet of the file instead of the entire content.".to_string()
            } else {
                " Tip: re-read the file with coder.read_file and copy the exact text, including indentation.".to_string()
            }
        }
    };

    Err(WeaveError::PluginError(format!(
        "old_str not found in file (neither exact nor whitespace-normalized match).{}",
        hint
    )))
}

pub fn patch_preview(params: Value) -> Result<Value, WeaveError> {
    let path_str = params
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| WeaveError::PluginError("Missing 'path' parameter".to_string()))?;
    let patch_text = params
        .get("patch")
        .and_then(|v| v.as_str())
        .ok_or_else(|| WeaveError::PluginError("Missing 'patch' parameter".to_string()))?;

    let raw_path = resolve_path(path_str)?;
    let path = validate_write_access(&raw_path)?;

    if !path.exists() || !path.is_file() {
        return Err(WeaveError::PluginError(format!(
            "File not found: {}",
            path.display()
        )));
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
