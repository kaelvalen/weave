use chrono::Utc;
use serde_json::{json, Value};
use tracing::info;
use std::env;

use crate::models::plugin::PluginExecutor;
use crate::utils::errors::WeaveError;

pub struct SysPlugin;

impl PluginExecutor for SysPlugin {
    fn execute(&self, capability: &str, params: Value) -> Result<Value, WeaveError> {
        SysPlugin::execute(capability, params)
    }
}

impl SysPlugin {
    pub fn execute(capability: &str, _params: Value) -> Result<Value, WeaveError> {
        match capability {
            "sys.info" => Self::info(),
            "sys.time" => Self::time(),
            "sys.uptime" => Self::uptime(),
            "sys.hostname" => Self::hostname(),
            "sys.disk" => Self::disk(),
            _ => Err(WeaveError::CapabilityNotFound(capability.to_string())),
        }
    }

    fn info() -> Result<Value, WeaveError> {
        let os = env::consts::OS;
        let arch = env::consts::ARCH;
        let family = env::consts::FAMILY;
        let hostname = Self::get_hostname();
        let username = env::var("USER").or_else(|_| env::var("USERNAME")).unwrap_or_default();

        info!("System info requested");

        Ok(json!({
            "os": os,
            "architecture": arch,
            "family": family,
            "hostname": hostname,
            "username": username,
            "success": true
        }))
    }

    fn time() -> Result<Value, WeaveError> {
        let now = Utc::now();
        let local_offset = chrono::Local::now().format("%:z").to_string();

        info!("System time requested");

        Ok(json!({
            "timestamp": now.timestamp(),
            "timestamp_ms": now.timestamp_millis(),
            "iso_8601": now.to_rfc3339(),
            "local_offset": local_offset,
            "formatted": now.format("%Y-%m-%d %H:%M:%S UTC").to_string(),
            "success": true
        }))
    }

    fn uptime() -> Result<Value, WeaveError> {
        info!("System uptime requested");
        let output = std::process::Command::new("uptime").arg("-p").output();
        let uptime_str = match output {
            Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().to_string(),
            _ => "unknown".to_string(),
        };
        Ok(json!({"uptime": uptime_str, "success": true}))
    }

    fn hostname() -> Result<Value, WeaveError> {
        info!("Hostname requested");
        Ok(json!({"hostname": Self::get_hostname(), "success": true}))
    }

    fn disk() -> Result<Value, WeaveError> {
        info!("Disk info requested");
        let output = std::process::Command::new("df").arg("-h").arg("--output=source,size,used,avail,pcent,target").output();
        match output {
            Ok(o) if o.status.success() => {
                let stdout = String::from_utf8_lossy(&o.stdout).to_string();
                let lines: Vec<&str> = stdout.lines().collect();
                let mut disks = Vec::new();
                for line in lines.iter().skip(1) {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 6 && !parts[0].starts_with("tmpfs") && !parts[0].starts_with("devtmpfs") {
                        disks.push(json!({"filesystem": parts[0], "size": parts[1], "used": parts[2], "available": parts[3], "use_percent": parts[4], "mount": parts[5]}));
                    }
                }
                Ok(json!({"disks": disks, "count": disks.len(), "success": true}))
            }
            _ => Ok(json!({"disks": [], "error": "df command not available", "success": false}))
        }
    }

    fn get_hostname() -> String {
        std::process::Command::new("hostname").output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_else(|| "unknown".to_string())
    }
}
