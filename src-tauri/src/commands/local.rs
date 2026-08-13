//! Local inference server management (Ollama) — the sustainable local-model
//! surface: reachability/start/stop, model listing, and model pulling.
//!
//! Weave does not bundle an inference runtime; it manages a system Ollama
//! (spawning `ollama serve` when present) and talks to it over HTTP. GGUF
//! self-hosting via llama-server was removed (no runtime left to run it).

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::process::Command;

use crate::utils::errors::WeaveError;
use crate::AppState;

/// Normalize a configured local API URL to the Ollama base URL, tolerating
/// the common suffix forms users paste into Settings.
pub(crate) fn ollama_base_url(raw_url: &str) -> String {
    let trimmed = raw_url.trim_end_matches('/');
    if trimmed.ends_with("/api/chat") {
        return trimmed.trim_end_matches("/api/chat").to_string();
    }
    if trimmed.ends_with("/api/generate") {
        return trimmed.trim_end_matches("/api/generate").to_string();
    }
    if trimmed.ends_with("/api") {
        return trimmed.trim_end_matches("/api").to_string();
    }
    trimmed.to_string()
}

fn configured_base_url(app_state: &AppState) -> String {
    ollama_base_url(
        &app_state
            .config
            .read()
            .ai
            .local
            .api_url
            .clone()
            .unwrap_or_else(|| crate::utils::config::OLLAMA_DEFAULT_URL.to_string()),
    )
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalServerStatus {
    pub running: bool,
    pub url: String,
    pub pid: Option<u32>,
    pub message: String,
}

/// Probe the configured local endpoint for reachability and report whether
/// a Weave-managed `ollama serve` child is alive.
#[tauri::command]
pub async fn local_server_status(
    app_state: State<'_, AppState>,
) -> Result<LocalServerStatus, WeaveError> {
    let url = configured_base_url(&app_state);
    let mut pid: Option<u32> = None;
    {
        let guard = app_state.local_server.lock().await;
        if let Some(child) = guard.as_ref() {
            pid = child.id();
        }
    }
    let reachable = probe_url(&url).await;
    Ok(LocalServerStatus {
        running: reachable || pid.is_some(),
        url: url.clone(),
        pid,
        message: if reachable {
            "Server is reachable.".to_string()
        } else if pid.is_some() {
            "Managed server is starting...".to_string()
        } else {
            "Server is stopped. Start it to use local models.".to_string()
        },
    })
}

/// Start the local inference server: spawns `ollama serve` when the
/// endpoint is not already reachable.
#[tauri::command]
pub async fn local_server_start(
    app_state: State<'_, AppState>,
) -> Result<LocalServerStatus, WeaveError> {
    let url = configured_base_url(&app_state);

    {
        let mut guard = app_state.local_server.lock().await;
        if let Some(child) = guard.as_mut() {
            let still_alive = matches!(child.try_wait(), Ok(None));
            if still_alive {
                return Ok(LocalServerStatus {
                    running: true,
                    url: url.clone(),
                    pid: child.id(),
                    message: "Server is already running.".to_string(),
                });
            }
            *guard = None;
        }
    }

    if probe_url(&url).await {
        return Ok(LocalServerStatus {
            running: true,
            url: url.clone(),
            pid: None,
            message: "An existing local server is already reachable.".to_string(),
        });
    }

    let child = Command::new("ollama")
        .arg("serve")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| {
            WeaveError::LocalLlmNotAvailable(format!(
                "Failed to start `ollama serve` (is Ollama installed and on PATH?): {}",
                e
            ))
        })?;

    let pid = child.id();
    *app_state.local_server.lock().await = Some(child);

    Ok(LocalServerStatus {
        running: true,
        url: url.clone(),
        pid,
        message: "Started `ollama serve`. It may take a few seconds to be reachable.".to_string(),
    })
}

/// Stop the managed local server, if any. Does not affect externally
/// launched servers.
#[tauri::command]
pub async fn local_server_stop(
    app_state: State<'_, AppState>,
) -> Result<LocalServerStatus, WeaveError> {
    let url = configured_base_url(&app_state);

    let mut guard = app_state.local_server.lock().await;
    let mut stopped_pid: Option<u32> = None;
    if let Some(child) = guard.as_mut() {
        stopped_pid = child.id();
        let _ = child.kill().await;
    }
    *guard = None;

    Ok(LocalServerStatus {
        running: probe_url(&url).await,
        url,
        pid: stopped_pid,
        message: if stopped_pid.is_some() {
            "Stopped managed server.".to_string()
        } else {
            "No managed server was running.".to_string()
        },
    })
}

async fn probe_url(url: &str) -> bool {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(800))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    client
        .get(format!("{}/api/tags", url))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

/// A model installed in the local inference server (`/api/tags`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalModel {
    pub name: String,
    pub size_bytes: u64,
    #[serde(default)]
    pub modified_at: Option<String>,
    #[serde(default)]
    pub family: Option<String>,
    #[serde(default)]
    pub parameter_size: Option<String>,
    #[serde(default)]
    pub quantization: Option<String>,
}

/// List models installed in the local server. Empty when the server is not
/// reachable (the UI surfaces the status separately) rather than failing.
#[tauri::command]
pub async fn local_list_models(
    app_state: State<'_, AppState>,
) -> Result<Vec<LocalModel>, WeaveError> {
    let url = configured_base_url(&app_state);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| WeaveError::Http(e.to_string()))?;

    let response = client
        .get(format!("{}/api/tags", url))
        .send()
        .await
        .map_err(|e| {
            WeaveError::LocalLlmNotAvailable(format!(
                "Cannot reach the local inference server at {}: {}",
                url, e
            ))
        })?;
    if !response.status().is_success() {
        return Err(WeaveError::LocalLlmNotAvailable(format!(
            "Local inference server at {} returned {}",
            url,
            response.status()
        )));
    }

    let json: serde_json::Value = response.json().await.map_err(|e| {
        WeaveError::Http(format!("Invalid /api/tags response from {}: {}", url, e))
    })?;

    Ok(parse_tags(&json))
}

/// Parse Ollama's `/api/tags` payload into `LocalModel`s.
pub fn parse_tags(json: &serde_json::Value) -> Vec<LocalModel> {
    json["models"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|m| {
                    let name = m["name"].as_str()?;
                    Some(LocalModel {
                        name: name.to_string(),
                        size_bytes: m["size"].as_u64().unwrap_or(0),
                        modified_at: m["modified_at"].as_str().map(String::from),
                        family: m["details"]["family"].as_str().map(String::from),
                        parameter_size: m["details"]["parameter_size"].as_str().map(String::from),
                        quantization: m["details"]["quantization_level"].as_str().map(String::from),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Parse one NDJSON line of Ollama's `/api/pull` stream. Returns `None` for
/// unrecognized lines (the stream is best-effort).
pub fn parse_pull_line(line: &str) -> Option<PullProgress> {
    let parsed: serde_json::Value = serde_json::from_str(line).ok()?;
    let status = parsed["status"].as_str()?.to_string();
    if status == "error" {
        return Some(PullProgress {
            name: String::new(),
            status: "error".to_string(),
            percent: None,
            error: Some(parsed["error"].as_str().unwrap_or("unknown error").to_string()),
            done: true,
        });
    }
    let percent = parsed["total"]
        .as_u64()
        .zip(parsed["completed"].as_u64())
        .map(|(total, completed)| {
            if total > 0 {
                completed as f64 / total as f64 * 100.0
            } else {
                0.0
            }
        });
    let done = status == "success";
    Some(PullProgress {
        name: String::new(),
        status,
        percent,
        error: None,
        done,
    })
}

/// Pull progress for `local_pull_model`, streamed as `local-pull-progress`.
#[derive(Debug, Clone, Serialize)]
pub struct PullProgress {
    pub name: String,
    pub status: String,
    pub percent: Option<f64>,
    pub error: Option<String>,
    pub done: bool,
}

/// Pull (install) a model via Ollama's `/api/pull`, streaming NDJSON
/// progress events (`local-pull-progress`) to the frontend. Returns once
/// the pull finishes or fails.
#[tauri::command]
pub async fn local_pull_model(
    name: String,
    app: AppHandle,
    app_state: State<'_, AppState>,
) -> Result<(), WeaveError> {
    let url = configured_base_url(&app_state);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| WeaveError::Http(e.to_string()))?;

    let emit = |progress: &PullProgress| {
        let _ = app.emit("local-pull-progress", progress);
    };

    let response = client
        .post(format!("{}/api/pull", url))
        .json(&serde_json::json!({ "name": name }))
        .send()
        .await
        .map_err(|e| {
            WeaveError::LocalLlmNotAvailable(format!(
                "Cannot reach the local inference server at {}: {}",
                url, e
            ))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(WeaveError::LocalLlmNotAvailable(format!(
            "Pull failed with HTTP {}: {}",
            status, text
        )));
    }

    let mut stream = response.bytes_stream();
    use futures::StreamExt;
    let mut buffer = String::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| WeaveError::Http(e.to_string()))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        // Ollama streams one NDJSON object per line.
        while let Some(newline) = buffer.find('\n') {
            let line = buffer[..newline].trim().to_string();
            buffer.drain(..=newline);
            if line.is_empty() {
                continue;
            }
            let Some(progress) = parse_pull_line(&line) else {
                continue;
            };
            if progress.status == "error" {
                let message = progress.error.clone().unwrap_or_default();
                emit(&progress);
                return Err(WeaveError::LocalLlmNotAvailable(format!(
                    "Model pull failed: {}",
                    message
                )));
            }
            let done = progress.done;
            emit(&progress);
            if done {
                return Ok(());
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_url_normalizes_common_suffixes() {
        assert_eq!(ollama_base_url("http://localhost:11434"), "http://localhost:11434");
        assert_eq!(ollama_base_url("http://localhost:11434/"), "http://localhost:11434");
        assert_eq!(ollama_base_url("http://localhost:11434/api/chat"), "http://localhost:11434");
        assert_eq!(ollama_base_url("http://localhost:11434/api/generate"), "http://localhost:11434");
        assert_eq!(ollama_base_url("http://localhost:11434/api"), "http://localhost:11434");
    }

    #[test]
    fn tags_parse_preserves_model_details() {
        let json = serde_json::json!({
            "models": [
                {
                    "name": "qwen3.5:9b",
                    "size": 1234567890,
                    "modified_at": "2026-08-13T10:00:00Z",
                    "details": {
                        "family": "qwen3.5",
                        "parameter_size": "9.0B",
                        "quantization_level": "Q4_K_M"
                    }
                },
                {"name": "llama3.1:8b", "size": 99}
            ]
        });
        let models = parse_tags(&json);
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].name, "qwen3.5:9b");
        assert_eq!(models[0].size_bytes, 1234567890);
        assert_eq!(models[0].family.as_deref(), Some("qwen3.5"));
        assert_eq!(models[0].quantization.as_deref(), Some("Q4_K_M"));
        assert_eq!(models[1].family, None);
    }

    #[test]
    fn tags_parse_tolerates_garbage() {
        assert!(parse_tags(&serde_json::json!({})).is_empty());
        assert!(parse_tags(&serde_json::json!({"models": "nope"})).is_empty());
        assert!(parse_tags(&serde_json::json!([1, 2])).is_empty());
    }

    #[test]
    fn pull_line_parses_progress_and_success() {
        let progress = parse_pull_line(r#"{"status":"downloading","digest":"abc","total":100,"completed":25}"#).unwrap();
        assert_eq!(progress.status, "downloading");
        assert_eq!(progress.percent, Some(25.0));
        assert!(!progress.done);

        let done = parse_pull_line(r#"{"status":"success"}"#).unwrap();
        assert!(done.done);
    }

    #[test]
    fn pull_line_surfaces_errors() {
        let err = parse_pull_line(r#"{"status":"error","error":"model not found"}"#).unwrap();
        assert_eq!(err.status, "error");
        assert_eq!(err.error.as_deref(), Some("model not found"));
        assert!(err.done);
    }

    #[test]
    fn pull_line_ignores_garbage() {
        assert!(parse_pull_line("not json").is_none());
        assert!(parse_pull_line("").is_none());
    }
}
