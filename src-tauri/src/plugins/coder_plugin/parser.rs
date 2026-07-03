use regex::Regex;
use serde_json::{json, Value};
use std::fs::File;
use std::io::{BufRead, BufReader};
use crate::utils::errors::WeaveError;
use super::security::{resolve_path, validate_read_access};

pub fn parse_test_results(stdout: &str, framework: &str) -> (Option<u32>, Option<u32>) {
    let stdout_lower = stdout.to_lowercase();
    let mut passed = None;
    let mut failed = None;

    match framework {
        "cargo" => {
            // e.g. "test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out"
            let re = Regex::new(r"(\d+)\s+passed;\s+(\d+)\s+failed").unwrap();
            if let Some(caps) = re.captures(&stdout_lower) {
                passed = caps.get(1).and_then(|m| m.as_str().parse::<u32>().ok());
                failed = caps.get(2).and_then(|m| m.as_str().parse::<u32>().ok());
            }
        }
        "pytest" => {
            // e.g. "=== 14 passed, 2 failed in 0.12s ==="
            // Also handle singular/plural and only passed/failed listed
            let re_passed = Regex::new(r"\b(\d+)\s+passed\b").unwrap();
            let re_failed = Regex::new(r"\b(\d+)\s+failed\b").unwrap();
            
            if let Some(caps) = re_passed.captures(&stdout_lower) {
                passed = caps.get(1).and_then(|m| m.as_str().parse::<u32>().ok());
            }
            if let Some(caps) = re_failed.captures(&stdout_lower) {
                failed = caps.get(1).and_then(|m| m.as_str().parse::<u32>().ok());
            } else if passed.is_some() {
                failed = Some(0); // If passed is found but failed is not, it means 0 failures
            }
        }
        "jest" | "vitest" => {
            // e.g. "Tests:       12 passed, 12 total" or "Tests:       1 failed, 12 passed, 13 total"
            let re_passed = Regex::new(r"(\d+)\s+passed").unwrap();
            let re_failed = Regex::new(r"(\d+)\s+failed").unwrap();

            if let Some(caps) = re_passed.captures(&stdout_lower) {
                passed = caps.get(1).and_then(|m| m.as_str().parse::<u32>().ok());
            }
            if let Some(caps) = re_failed.captures(&stdout_lower) {
                failed = caps.get(1).and_then(|m| m.as_str().parse::<u32>().ok());
            } else if passed.is_some() {
                failed = Some(0);
            }
        }
        "gotest" => {
            // e.g. "--- PASS: TestFoo (0.00s)" or "FAIL"
            // Let's count occurrences of "--- PASS:" and "--- FAIL:"
            let passed_count = stdout.matches("--- PASS:").count() as u32;
            let failed_count = stdout.matches("--- FAIL:").count() as u32;
            if passed_count > 0 || failed_count > 0 {
                passed = Some(passed_count);
                failed = Some(failed_count);
            }
        }
        _ => {
            // Fallback generic regex
            let re = Regex::new(r"(\d+)\s+passed.*?(\d+)\s+failed").unwrap();
            if let Some(caps) = re.captures(&stdout_lower) {
                passed = caps.get(1).and_then(|m| m.as_str().parse::<u32>().ok());
                failed = caps.get(2).and_then(|m| m.as_str().parse::<u32>().ok());
            }
        }
    }

    (passed, failed)
}

pub fn extract_symbols(params: Value) -> Result<Value, WeaveError> {
    let path_str = params.get("path").and_then(|v| v.as_str())
        .ok_or_else(|| WeaveError::PluginError("Missing 'path' parameter".to_string()))?;
    
    let raw_path = resolve_path(path_str)?;
    let path = validate_read_access(&raw_path)?;

    if !path.exists() || !path.is_file() {
        return Err(WeaveError::PluginError(format!("File not found: {}", path.display())));
    }

    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    
    let file = File::open(&path).map_err(|e| WeaveError::Io(e.to_string()))?;
    let reader = BufReader::new(file);

    // Prepare compiled Regexes for speed
    let re_rust_fn = Regex::new(r"^\s*(?:pub\s+)?(?:async\s+)?fn\s+([a-zA-Z_][a-zA-Z0-9_]*)").unwrap();
    let re_rust_struct = Regex::new(r"^\s*(?:pub\s+)?struct\s+([a-zA-Z_][a-zA-Z0-9_]*)").unwrap();
    let re_rust_enum = Regex::new(r"^\s*(?:pub\s+)?enum\s+([a-zA-Z_][a-zA-Z0-9_]*)").unwrap();
    let re_rust_trait = Regex::new(r"^\s*(?:pub\s+)?trait\s+([a-zA-Z_][a-zA-Z0-9_]*)").unwrap();
    let re_rust_impl = Regex::new(r"^\s*impl(?:\s*<.*>)?\s+([a-zA-Z_][a-zA-Z0-9_]*)").unwrap();

    let re_py_fn = Regex::new(r"^\s*def\s+([a-zA-Z_][a-zA-Z0-9_]*)").unwrap();
    let re_py_class = Regex::new(r"^\s*class\s+([a-zA-Z_][a-zA-Z0-9_]*)").unwrap();

    let re_js_fn = Regex::new(r"^\s*(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z_][a-zA-Z0-9_]*)").unwrap();
    let re_js_class = Regex::new(r"^\s*(?:export\s+)?class\s+([a-zA-Z_][a-zA-Z0-9_]*)").unwrap();
    let re_js_interface = Regex::new(r"^\s*(?:export\s+)?interface\s+([a-zA-Z_][a-zA-Z0-9_]*)").unwrap();
    let re_js_type = Regex::new(r"^\s*(?:export\s+)?type\s+([a-zA-Z_][a-zA-Z0-9_]*)").unwrap();

    let re_go_fn = Regex::new(r"^\s*func\s+(?:\([^)]+\)\s+)?([a-zA-Z_][a-zA-Z0-9_]*)").unwrap();
    let re_go_struct = Regex::new(r"^\s*type\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+struct").unwrap();
    let re_go_interface = Regex::new(r"^\s*type\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+interface").unwrap();

    let mut symbols = Vec::new();
    let mut line_num = 1;

    for line_result in reader.lines() {
        let line = line_result.map_err(|e| WeaveError::Io(e.to_string()))?;
        
        match ext.as_str() {
            "rs" => {
                if let Some(caps) = re_rust_fn.captures(&line) {
                    symbols.push(json!({ "name": caps[1].to_string(), "kind": "function", "line": line_num }));
                } else if let Some(caps) = re_rust_struct.captures(&line) {
                    symbols.push(json!({ "name": caps[1].to_string(), "kind": "struct", "line": line_num }));
                } else if let Some(caps) = re_rust_enum.captures(&line) {
                    symbols.push(json!({ "name": caps[1].to_string(), "kind": "enum", "line": line_num }));
                } else if let Some(caps) = re_rust_trait.captures(&line) {
                    symbols.push(json!({ "name": caps[1].to_string(), "kind": "trait", "line": line_num }));
                } else if let Some(caps) = re_rust_impl.captures(&line) {
                    symbols.push(json!({ "name": format!("impl {}", &caps[1]), "kind": "impl", "line": line_num }));
                }
            }
            "py" => {
                if let Some(caps) = re_py_fn.captures(&line) {
                    symbols.push(json!({ "name": caps[1].to_string(), "kind": "function", "line": line_num }));
                } else if let Some(caps) = re_py_class.captures(&line) {
                    symbols.push(json!({ "name": caps[1].to_string(), "kind": "class", "line": line_num }));
                }
            }
            "js" | "jsx" | "ts" | "tsx" => {
                if let Some(caps) = re_js_fn.captures(&line) {
                    symbols.push(json!({ "name": caps[1].to_string(), "kind": "function", "line": line_num }));
                } else if let Some(caps) = re_js_class.captures(&line) {
                    symbols.push(json!({ "name": caps[1].to_string(), "kind": "class", "line": line_num }));
                } else if let Some(caps) = re_js_interface.captures(&line) {
                    symbols.push(json!({ "name": caps[1].to_string(), "kind": "interface", "line": line_num }));
                } else if let Some(caps) = re_js_type.captures(&line) {
                    symbols.push(json!({ "name": caps[1].to_string(), "kind": "type", "line": line_num }));
                }
            }
            "go" => {
                if let Some(caps) = re_go_fn.captures(&line) {
                    symbols.push(json!({ "name": caps[1].to_string(), "kind": "function", "line": line_num }));
                } else if let Some(caps) = re_go_struct.captures(&line) {
                    symbols.push(json!({ "name": caps[1].to_string(), "kind": "struct", "line": line_num }));
                } else if let Some(caps) = re_go_interface.captures(&line) {
                    symbols.push(json!({ "name": caps[1].to_string(), "kind": "interface", "line": line_num }));
                }
            }
            _ => {}
        }
        line_num += 1;
    }

    Ok(json!(symbols))
}
