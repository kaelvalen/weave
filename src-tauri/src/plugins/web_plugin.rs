use serde_json::{json, Value};
use tracing::info;

use crate::models::plugin::PluginExecutor;
use crate::utils::errors::WeaveError;

pub struct WebPlugin;

impl PluginExecutor for WebPlugin {
    fn execute(&self, capability: &str, params: Value) -> Result<Value, WeaveError> {
        WebPlugin::execute(capability, params)
    }
}

impl WebPlugin {
    pub fn execute(capability: &str, params: Value) -> Result<Value, WeaveError> {
        match capability {
            "web.fetch" => Self::fetch(params),
            _ => Err(WeaveError::CapabilityNotFound(capability.to_string())),
        }
    }

    fn fetch(params: Value) -> Result<Value, WeaveError> {
        let url = params.get("url")
            .and_then(|v| v.as_str())
            .ok_or_else(|| WeaveError::PluginError("Missing 'url' parameter".to_string()))?
            .to_string();

        info!("Fetching URL: {}", url);

        // Use reqwest in a blocking thread instead of spawning curl subprocess
        let result: Result<Value, WeaveError> = std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .map_err(|e| WeaveError::PluginError(e.to_string()))?;

            rt.block_on(async {
                let client = reqwest::Client::builder()
                    .timeout(std::time::Duration::from_secs(30))
                    .redirect(reqwest::redirect::Policy::limited(10))
                    .build()
                    .map_err(|e| WeaveError::PluginError(e.to_string()))?;

                let response = client.get(&url).send().await
                    .map_err(|e| WeaveError::PluginError(format!("Failed to fetch URL: {}", e)))?;

                let status = response.status().as_u16();
                let content_type = response.headers()
                    .get("content-type")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("unknown")
                    .to_string();

                let body = response.text().await.unwrap_or_default();
                let size = body.len();

                // Basic HTML tag stripping for readability
                let clean_text = if content_type.contains("text/html") {
                    Self::strip_html_tags(&body)
                } else {
                    body.clone()
                };

                Ok(json!({
                    "url": url,
                    "status": status,
                    "content_type": content_type,
                    "content": clean_text,
                    "raw_size": size,
                    "success": status >= 200 && status < 400,
                }))
            })
        }).join().map_err(|_| WeaveError::PluginError("Web fetch thread panicked".to_string()))?;

        result
    }

    fn strip_html_tags(html: &str) -> String {
        let mut result = String::with_capacity(html.len());
        let mut in_tag = false;
        let mut in_script = false;
        let mut in_style = false;

        let lower = html.to_lowercase();
        let chars: Vec<char> = html.chars().collect();
        let lower_chars: Vec<char> = lower.chars().collect();

        let mut i = 0;
        while i < chars.len() {
            if !in_tag && i + 7 < lower_chars.len() {
                let slice: String = lower_chars[i..i+7].iter().collect();
                if slice == "<script" { in_script = true; }
                if slice == "<style " || (i + 6 < lower_chars.len() && lower_chars[i..i+6].iter().collect::<String>() == "<style") { in_style = true; }
            }
            if i + 9 < lower_chars.len() {
                let slice: String = lower_chars[i..i+9].iter().collect();
                if slice == "</script>" { in_script = false; i += 9; continue; }
            }
            if i + 8 < lower_chars.len() {
                let slice: String = lower_chars[i..i+8].iter().collect();
                if slice == "</style>" { in_style = false; i += 8; continue; }
            }

            if in_script || in_style { i += 1; continue; }

            if chars[i] == '<' { in_tag = true; i += 1; continue; }
            if chars[i] == '>' { in_tag = false; i += 1; continue; }
            if !in_tag { result.push(chars[i]); }
            i += 1;
        }

        // Collapse excessive whitespace
        let mut collapsed = String::new();
        let mut prev_was_space = false;
        for ch in result.chars() {
            if ch.is_whitespace() {
                if !prev_was_space { collapsed.push(' '); }
                prev_was_space = true;
            } else {
                collapsed.push(ch);
                prev_was_space = false;
            }
        }
        collapsed.trim().to_string()
    }
}
