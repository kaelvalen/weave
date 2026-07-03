use std::fs::File;
use std::io::{BufRead, BufReader};

use serde_json::{json, Value};
use crate::utils::errors::WeaveError;
use super::security::{resolve_path, validate_read_access, validate_write_access};
use super::history::create_backup;

pub fn infer_language(ext: &str) -> &'static str {
    match ext.to_lowercase().as_str() {
        "rs" => "rust",
        "ts" | "tsx" => "typescript",
        "js" | "jsx" => "javascript",
        "py" => "python",
        "go" => "go",
        "toml" => "toml",
        "json" => "json",
        "md" => "markdown",
        "html" => "html",
        "css" => "css",
        "sh" | "bash" => "shell",
        _ => "text",
    }
}

pub fn read_file(params: Value) -> Result<Value, WeaveError> {
    let path_str = params.get("path").and_then(|v| v.as_str())
        .ok_or_else(|| WeaveError::PluginError("Missing 'path' parameter".to_string()))?;
    
    let raw_path = resolve_path(path_str)?;
    let path = validate_read_access(&raw_path)?;
    
    if !path.exists() || !path.is_file() {
        return Err(WeaveError::PluginError(format!("File not found: {}", path.display())));
    }

    let start_line = params.get("start").and_then(|v| v.as_u64()).map(|v| v as usize);
    let end_line = params.get("end").and_then(|v| v.as_u64()).map(|v| v as usize);

    let file = File::open(&path).map_err(|e| WeaveError::Io(e.to_string()))?;
    let size_bytes = file.metadata().map(|m| m.len()).unwrap_or(0);
    let reader = BufReader::new(file);

    let mut lines = Vec::new();
    let mut current_idx = 1;
    let mut total_lines = 0;

    for line_result in reader.lines() {
        let line = line_result.map_err(|e| WeaveError::Io(e.to_string()))?;
        total_lines += 1;

        let inside_range = match (start_line, end_line) {
            (Some(s), Some(e)) => current_idx >= s && current_idx <= e,
            (Some(s), None) => current_idx >= s,
            (None, Some(e)) => current_idx <= e,
            (None, None) => true,
        };

        if inside_range {
            lines.push((current_idx, line));
        }

        current_idx += 1;
    }

    let formatted_content = lines.iter()
        .map(|(num, content)| format!("{:>4}\t{}", num, content))
        .collect::<Vec<String>>()
        .join("\n");

    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    let language = infer_language(ext);

    let range_val = match (start_line, end_line) {
        (Some(s), Some(e)) => json!([s, e]),
        (Some(s), None) => json!([s, total_lines]),
        (None, Some(e)) => json!([1, e]),
        (None, None) => json!([1, total_lines]),
    };

    Ok(json!({
        "path": path.to_string_lossy().to_string(),
        "content": formatted_content,
        "lines": range_val,
        "total_lines": total_lines,
        "size_bytes": size_bytes,
        "language": language,
        "success": true
    }))
}

pub fn write_file(params: Value) -> Result<Value, WeaveError> {
    let path_str = params.get("path").and_then(|v| v.as_str())
        .ok_or_else(|| WeaveError::PluginError("Missing 'path' parameter".to_string()))?;
    let content = params.get("content").and_then(|v| v.as_str())
        .ok_or_else(|| WeaveError::PluginError("Missing 'content' parameter".to_string()))?;
    let create_dirs = params.get("create_dirs").and_then(|v| v.as_bool()).unwrap_or(true);

    let raw_path = resolve_path(path_str)?;
    let path = validate_write_access(&raw_path)?;

    let backed_up = if path.exists() {
        create_backup(&path).is_ok()
    } else {
        false
    };

    if create_dirs {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
    }

    std::fs::write(&path, content)?;

    // Verify write
    let read_back = std::fs::read(&path)?;
    if read_back.len() != content.len() {
        tracing::warn!("Write verification failed for {}", path.display());
    }

    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    let language = infer_language(ext);

    Ok(json!({
        "path": path.to_string_lossy().to_string(),
        "bytes_written": content.len(),
        "backed_up": backed_up,
        "language": language,
        "success": true
    }))
}
