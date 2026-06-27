use serde_json::{json, Value};
use std::process::Command;
use tracing::{info, warn};

use crate::models::plugin::PluginExecutor;
use crate::utils::errors::WeaveError;

pub struct SqlitePlugin;

impl PluginExecutor for SqlitePlugin {
    fn execute(&self, capability: &str, params: Value) -> Result<Value, WeaveError> {
        SqlitePlugin::execute(capability, params)
    }
}

impl SqlitePlugin {
    pub fn execute(capability: &str, params: Value) -> Result<Value, WeaveError> {
        match capability {
            "db.query" => Self::query(params),
            "db.execute" => Self::execute_statement(params),
            "db.tables" => Self::list_tables(params),
            _ => Err(WeaveError::CapabilityNotFound(capability.to_string())),
        }
    }

    fn query(params: Value) -> Result<Value, WeaveError> {
        let db_path = params.get("db_path")
            .and_then(|v| v.as_str())
            .unwrap_or("weave.db");

        // Accept both "query" and "sql" parameter names
        let query = params.get("query")
            .or_else(|| params.get("sql"))
            .and_then(|v| v.as_str())
            .ok_or_else(|| WeaveError::PluginError("Missing 'query' parameter".to_string()))?;

        info!("Executing SQL Query on {}: {}", db_path, query);

        let output = Command::new("sqlite3")
            .arg("-json")
            .arg(db_path)
            .arg(query)
            .output()
            .map_err(|e| WeaveError::PluginError(format!("Failed to execute sqlite3 CLI: {}. Make sure sqlite3 is installed.", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            warn!("Query failed: {}", stderr);
            return Err(WeaveError::PluginError(format!("SQL Error: {}", stderr.trim())));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let result: Value = if stdout.trim().is_empty() {
            json!([])
        } else {
            serde_json::from_str(&stdout).unwrap_or(json!([]))
        };

        let row_count = result.as_array().map(|a| a.len()).unwrap_or(0);

        Ok(json!({
            "success": true,
            "data": result,
            "row_count": row_count,
            "db_path": db_path
        }))
    }

    fn execute_statement(params: Value) -> Result<Value, WeaveError> {
        let db_path = params.get("db_path")
            .and_then(|v| v.as_str())
            .unwrap_or("weave.db");

        // Accept "statement", "query", or "sql"
        let statement = params.get("statement")
            .or_else(|| params.get("query"))
            .or_else(|| params.get("sql"))
            .and_then(|v| v.as_str())
            .ok_or_else(|| WeaveError::PluginError("Missing 'statement' (or 'query') parameter".to_string()))?;

        info!("Executing SQL Statement on {}: {}", db_path, statement);

        let output = Command::new("sqlite3")
            .arg(db_path)
            .arg(statement)
            .output()
            .map_err(|e| WeaveError::PluginError(format!("Failed to execute sqlite3 CLI: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            warn!("Statement failed: {}", stderr);
            return Err(WeaveError::PluginError(format!("SQL Error: {}", stderr.trim())));
        }

        Ok(json!({
            "success": true,
            "message": "Statement executed successfully",
            "db_path": db_path
        }))
    }

    fn list_tables(params: Value) -> Result<Value, WeaveError> {
        let db_path = params.get("db_path")
            .and_then(|v| v.as_str())
            .unwrap_or("weave.db");

        info!("Listing tables in {}", db_path);

        let output = Command::new("sqlite3")
            .arg("-json")
            .arg(db_path)
            .arg("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY name;")
            .output()
            .map_err(|e| WeaveError::PluginError(format!("Failed to execute sqlite3 CLI: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            return Err(WeaveError::PluginError(format!("SQL Error: {}", stderr.trim())));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let tables: Value = if stdout.trim().is_empty() {
            json!([])
        } else {
            serde_json::from_str(&stdout).unwrap_or(json!([]))
        };

        Ok(json!({
            "success": true,
            "tables": tables,
            "count": tables.as_array().map(|a| a.len()).unwrap_or(0),
            "db_path": db_path
        }))
    }
}
