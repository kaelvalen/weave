use serde_json::{json, Value};
use std::fs;

use regex::Regex;
use ignore::WalkBuilder;
use crate::utils::errors::WeaveError;
use super::security::{resolve_path, validate_read_access, validate_write_access};
use super::process::{execute_subprocess, ExecSpec};
use super::project_detector::{detect_check_command, detect_test_command};
use super::filesystem;
use super::patch;
use super::history;
use super::parser;

pub fn route_capability(capability: &str, params: Value) -> Result<Value, WeaveError> {
    match capability {
        "coder.read_file" => filesystem::read_file(params),
        "coder.write_file" => filesystem::write_file(params),
        "coder.apply_diff" => patch::apply_diff(params),
        "coder.apply_patch" => patch::apply_patch(params),
        "coder.patch_preview" => patch::patch_preview(params),
        "coder.revert_file" => history::undo(params), // map legacy revert_file to undo
        "coder.run_check" => run_check(params),
        "coder.run_tests" => run_tests(params),
        "coder.list_dir" => list_dir(params),
        "coder.symbols" => parser::extract_symbols(params),
        "coder.history" => history::history(params),
        "coder.undo" => history::undo(params),
        "coder.redo" => history::redo(params),
        "coder.search" => search(params),
        "coder.find_references" => find_references(params),
        "coder.rename_symbol" => rename_symbol(params),
        "coder.git_status" => git_status(params),
        "coder.git_diff" => git_diff(params),
        "coder.git_commit" => git_commit(params),
        "coder.format" => format_code(params),
        "coder.lint" => lint_code(params),
        "coder.dependencies" => list_dependencies(params),
        _ => Err(WeaveError::CapabilityNotFound(capability.to_string())),
    }
}

fn run_check(params: Value) -> Result<Value, WeaveError> {
    let dir = params.get("directory").and_then(|v| v.as_str()).unwrap_or(".");
    let raw_path = resolve_path(dir)?;
    let path = validate_read_access(&raw_path)?;
    
    let spec = detect_check_command(&path)?;
    execute_subprocess(spec, path, 60, false, None)
}

fn run_tests(params: Value) -> Result<Value, WeaveError> {
    let dir = params.get("directory").and_then(|v| v.as_str()).unwrap_or(".");
    let filter_val = params.get("filter").and_then(|v| v.as_str());
    let raw_path = resolve_path(dir)?;
    let path = validate_read_access(&raw_path)?;
    
    let (spec, framework) = detect_test_command(&path, filter_val)?;
    execute_subprocess(spec, path, 120, true, Some(framework))
}

fn list_dir(params: Value) -> Result<Value, WeaveError> {
    let path_str = params.get("path").and_then(|v| v.as_str()).unwrap_or(".");
    let max_depth = params.get("depth").and_then(|v| v.as_u64()).unwrap_or(2).clamp(1, 5) as usize;
    let show_hidden = params.get("show_hidden").and_then(|v| v.as_bool()).unwrap_or(false);

    let raw_path = resolve_path(path_str)?;
    let path = validate_read_access(&raw_path)?;

    if !path.exists() || !path.is_dir() {
        return Err(WeaveError::PluginError(format!("Directory not found: {}", path.display())));
    }

    let mut tree_str = String::new();
    tree_str.push_str(&format!("{}/\n", path.file_name().unwrap_or_default().to_string_lossy()));

    let walker = WalkBuilder::new(&path)
        .hidden(!show_hidden)
        .git_ignore(true)
        .max_depth(Some(max_depth))
        .build();

    let mut entries = Vec::new();
    for result in walker {
        if let Ok(entry) = result {
            let entry_path = entry.path();
            if entry_path == path {
                continue;
            }
            if let Ok(rel_path) = entry_path.strip_prefix(&path) {
                let name = entry.file_name().to_string_lossy().to_string();
                if name == "node_modules" || name == "target" || name == ".git" || name == "__pycache__" || name == "dist" || name == ".venv" {
                    continue;
                }
                let depth = rel_path.components().count();
                if depth <= max_depth {
                    entries.push((rel_path.to_path_buf(), entry.file_type().map(|t| t.is_dir()).unwrap_or(false)));
                }
            }
        }
    }

    entries.sort_by(|a, b| a.0.cmp(&b.0));

    for (rel_path, is_dir) in entries {
        let depth = rel_path.components().count();
        let indent = "│   ".repeat(depth - 1);
        let name = rel_path.file_name().unwrap_or_default().to_string_lossy();
        let marker = "└── ";
        if is_dir {
            tree_str.push_str(&format!("{}{}{}/\n", indent, marker, name));
        } else {
            tree_str.push_str(&format!("{}{}{}\n", indent, marker, name));
        }
    }

    Ok(json!({
        "path": path.to_string_lossy().to_string(),
        "tree": tree_str,
        "success": true
    }))
}

fn search(params: Value) -> Result<Value, WeaveError> {
    let query = params.get("query").and_then(|v| v.as_str())
        .ok_or_else(|| WeaveError::PluginError("Missing 'query' parameter".to_string()))?;
    let dir_str = params.get("directory").and_then(|v| v.as_str()).unwrap_or(".");

    let raw_path = resolve_path(dir_str)?;
    let path = validate_read_access(&raw_path)?;

    let walker = WalkBuilder::new(&path)
        .hidden(false)
        .git_ignore(true)
        .build();

    let mut matches = Vec::new();
    for result in walker {
        if let Ok(entry) = result {
            let p = entry.path();
            if p.is_file() {
                if let Ok(content) = fs::read_to_string(p) {
                    let mut line_num = 1;
                    for line in content.lines() {
                        if line.contains(query) {
                            matches.push(json!({
                                "path": p.to_string_lossy().to_string(),
                                "line": line_num,
                                "content": line.trim(),
                            }));
                            if matches.len() >= 100 {
                                break;
                            }
                        }
                        line_num += 1;
                    }
                }
            }
        }
        if matches.len() >= 100 {
            break;
        }
    }

    Ok(json!({
        "matches": matches,
        "success": true
    }))
}

fn find_references(params: Value) -> Result<Value, WeaveError> {
    let symbol = params.get("symbol").and_then(|v| v.as_str())
        .ok_or_else(|| WeaveError::PluginError("Missing 'symbol' parameter".to_string()))?;
    let dir_str = params.get("directory").and_then(|v| v.as_str()).unwrap_or(".");

    let raw_path = resolve_path(dir_str)?;
    let path = validate_read_access(&raw_path)?;

    // Word boundary regex
    let re = Regex::new(&format!(r"\b{}\b", regex::escape(symbol)))
        .map_err(|e| WeaveError::PluginError(format!("Invalid symbol regex: {}", e)))?;

    let walker = WalkBuilder::new(&path)
        .hidden(false)
        .git_ignore(true)
        .build();

    let mut matches = Vec::new();
    for result in walker {
        if let Ok(entry) = result {
            let p = entry.path();
            if p.is_file() {
                if let Ok(content) = fs::read_to_string(p) {
                    let mut line_num = 1;
                    for line in content.lines() {
                        if re.is_match(line) {
                            matches.push(json!({
                                "path": p.to_string_lossy().to_string(),
                                "line": line_num,
                                "content": line.trim(),
                            }));
                            if matches.len() >= 100 {
                                break;
                            }
                        }
                        line_num += 1;
                    }
                }
            }
        }
        if matches.len() >= 100 {
            break;
        }
    }

    Ok(json!({
        "references": matches,
        "success": true
    }))
}

fn rename_symbol(params: Value) -> Result<Value, WeaveError> {
    let path_str = params.get("path").and_then(|v| v.as_str())
        .ok_or_else(|| WeaveError::PluginError("Missing 'path' parameter".to_string()))?;
    let old_name = params.get("old_name").and_then(|v| v.as_str())
        .ok_or_else(|| WeaveError::PluginError("Missing 'old_name' parameter".to_string()))?;
    let new_name = params.get("new_name").and_then(|v| v.as_str())
        .ok_or_else(|| WeaveError::PluginError("Missing 'new_name' parameter".to_string()))?;

    let raw_path = resolve_path(path_str)?;
    let path = validate_write_access(&raw_path)?;

    if !path.exists() || !path.is_file() {
        return Err(WeaveError::PluginError(format!("File not found: {}", path.display())));
    }

    let content = fs::read_to_string(&path).map_err(|e| WeaveError::Io(e.to_string()))?;

    let re = Regex::new(&format!(r"\b{}\b", regex::escape(old_name)))
        .map_err(|e| WeaveError::PluginError(format!("Invalid old name regex: {}", e)))?;

    if !re.is_match(&content) {
        return Err(WeaveError::PluginError(format!("Symbol '{}' not found in file", old_name)));
    }

    history::create_backup(&path)?;

    let updated = re.replace_all(&content, new_name).to_string();
    fs::write(&path, &updated).map_err(|e| WeaveError::Io(e.to_string()))?;

    Ok(json!({
        "path": path.to_string_lossy().to_string(),
        "success": true
    }))
}

fn git_status(params: Value) -> Result<Value, WeaveError> {
    let dir = params.get("directory").and_then(|v| v.as_str()).unwrap_or(".");
    let raw_path = resolve_path(dir)?;
    let path = validate_read_access(&raw_path)?;

    let spec = ExecSpec {
        binary: "git".to_string(),
        args: vec!["status".to_string(), "--short".to_string()],
    };
    execute_subprocess(spec, path, 20, false, None)
}

fn git_diff(params: Value) -> Result<Value, WeaveError> {
    let dir = params.get("directory").and_then(|v| v.as_str()).unwrap_or(".");
    let raw_path = resolve_path(dir)?;
    let path = validate_read_access(&raw_path)?;

    let spec = ExecSpec {
        binary: "git".to_string(),
        args: vec!["diff".to_string()],
    };
    execute_subprocess(spec, path, 20, false, None)
}

fn git_commit(params: Value) -> Result<Value, WeaveError> {
    let dir = params.get("directory").and_then(|v| v.as_str()).unwrap_or(".");
    let message = params.get("message").and_then(|v| v.as_str())
        .ok_or_else(|| WeaveError::PluginError("Missing commit 'message' parameter".to_string()))?;

    let raw_path = resolve_path(dir)?;
    let path = validate_write_access(&raw_path)?;

    let spec = ExecSpec {
        binary: "git".to_string(),
        args: vec!["commit".to_string(), "-m".to_string(), message.to_string()],
    };
    execute_subprocess(spec, path, 20, false, None)
}

fn format_code(params: Value) -> Result<Value, WeaveError> {
    let dir = params.get("directory").and_then(|v| v.as_str()).unwrap_or(".");
    let raw_path = resolve_path(dir)?;
    let path = validate_write_access(&raw_path)?;

    let spec = if path.join("Cargo.toml").exists() {
        ExecSpec {
            binary: "cargo".to_string(),
            args: vec!["fmt".to_string()],
        }
    } else if path.join("package.json").exists() {
        ExecSpec {
            binary: "npx".to_string(),
            args: vec!["prettier".to_string(), "--write".to_string(), ".".to_string()],
        }
    } else if path.join("go.mod").exists() {
        ExecSpec {
            binary: "go".to_string(),
            args: vec!["fmt".to_string(), "./...".to_string()],
        }
    } else {
        return Err(WeaveError::PluginError("No supported formatter found for project type".to_string()));
    };

    execute_subprocess(spec, path, 30, false, None)
}

fn lint_code(params: Value) -> Result<Value, WeaveError> {
    let dir = params.get("directory").and_then(|v| v.as_str()).unwrap_or(".");
    let raw_path = resolve_path(dir)?;
    let path = validate_read_access(&raw_path)?;

    let spec = if path.join("Cargo.toml").exists() {
        ExecSpec {
            binary: "cargo".to_string(),
            args: vec!["clippy".to_string(), "--".to_string(), "-D".to_string(), "warnings".to_string()],
        }
    } else if path.join("package.json").exists() {
        ExecSpec {
            binary: "npx".to_string(),
            args: vec!["eslint".to_string(), ".".to_string()],
        }
    } else {
        return Err(WeaveError::PluginError("No supported linter found for project type".to_string()));
    };

    execute_subprocess(spec, path, 60, false, None)
}

fn list_dependencies(params: Value) -> Result<Value, WeaveError> {
    let dir = params.get("directory").and_then(|v| v.as_str()).unwrap_or(".");
    let raw_path = resolve_path(dir)?;
    let path = validate_read_access(&raw_path)?;

    let spec = if path.join("Cargo.toml").exists() {
        ExecSpec {
            binary: "cargo".to_string(),
            args: vec!["tree".to_string()],
        }
    } else if path.join("package.json").exists() {
        ExecSpec {
            binary: "npm".to_string(),
            args: vec!["list".to_string(), "--depth=1".to_string()],
        }
    } else if path.join("go.mod").exists() {
        ExecSpec {
            binary: "go".to_string(),
            args: vec!["list".to_string(), "-m".to_string(), "all".to_string()],
        }
    } else {
        return Err(WeaveError::PluginError("No supported dependency viewer found for project type".to_string()));
    };

    execute_subprocess(spec, path, 30, false, None)
}
