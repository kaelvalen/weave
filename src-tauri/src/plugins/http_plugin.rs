use serde_json::{json, Value};
use std::collections::HashMap;
use tracing::info;

use crate::models::plugin::PluginExecutor;
use crate::utils::errors::WeaveError;

pub struct HttpPlugin;

impl PluginExecutor for HttpPlugin {
    fn execute(&self, capability: &str, params: Value) -> Result<Value, WeaveError> {
        HttpPlugin::execute(capability, params)
    }
}

impl HttpPlugin {
    pub fn execute(capability: &str, params: Value) -> Result<Value, WeaveError> {
        match capability {
            "http.request" => Self::request(params),
            _ => Err(WeaveError::CapabilityNotFound(capability.to_string())),
        }
    }

    fn request(params: Value) -> Result<Value, WeaveError> {
        info!("Executing http.request");

        // Use a dedicated thread with a single-threaded tokio runtime
        // instead of creating a full multi-threaded Runtime each time
        let result: Result<Value, WeaveError> = std::thread::spawn(move || {
            let url = params.get("url")
                .and_then(|v| v.as_str())
                .ok_or_else(|| WeaveError::PluginError("Missing 'url' parameter".to_string()))?
                .to_string();

            let method = params.get("method")
                .and_then(|v| v.as_str())
                .unwrap_or("GET")
                .to_uppercase();

            let timeout_secs = params.get("timeout")
                .and_then(|v| v.as_u64())
                .unwrap_or(30);

            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .map_err(|e| WeaveError::PluginError(e.to_string()))?;

            rt.block_on(async {
                let client = reqwest::Client::builder()
                    .timeout(std::time::Duration::from_secs(timeout_secs))
                    .build()
                    .map_err(|e| WeaveError::PluginError(e.to_string()))?;

                let mut req_builder = match method.as_str() {
                    "GET" => client.get(&url),
                    "POST" => client.post(&url),
                    "PUT" => client.put(&url),
                    "DELETE" => client.delete(&url),
                    "PATCH" => client.patch(&url),
                    "HEAD" => client.head(&url),
                    _ => return Err(WeaveError::PluginError(format!("Unsupported HTTP method: {}", method))),
                };

                if let Some(headers) = params.get("headers").and_then(|v| v.as_object()) {
                    for (k, v) in headers {
                        if let Some(v_str) = v.as_str() {
                            req_builder = req_builder.header(k, v_str);
                        }
                    }
                }

                if let Some(b) = params.get("body") {
                    if let Some(b_str) = b.as_str() {
                        req_builder = req_builder.body(b_str.to_string());
                    } else {
                        req_builder = req_builder.json(b);
                    }
                }

                let response = req_builder.send().await.map_err(|e| WeaveError::PluginError(e.to_string()))?;
                let status = response.status().as_u16();

                let mut resp_headers = HashMap::new();
                for (k, v) in response.headers() {
                    resp_headers.insert(k.to_string(), String::from_utf8_lossy(v.as_bytes()).to_string());
                }

                let text = response.text().await.unwrap_or_default();

                // Truncate very large response bodies
                let body = if text.len() > 100_000 {
                    format!("{}... [truncated, total {} bytes]", &text[..100_000], text.len())
                } else {
                    text
                };

                Ok(json!({
                    "status": status,
                    "headers": resp_headers,
                    "body": body,
                    "method": method,
                    "url": url,
                    "success": status >= 200 && status < 300
                }))
            })
        }).join().map_err(|_| WeaveError::PluginError("HTTP request thread panicked".to_string()))?;

        result
    }
}
