use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use sysinfo::System;
use tauri::State as TauriState;
use tauri::State;

use crate::utils::errors::WeaveError;
use crate::AppState;

#[derive(Debug, Serialize, Deserialize)]
pub struct SystemStats {
    pub cpu_usage: f32,
    pub ram_usage: u64,
    pub ram_total: u64,
}

#[derive(Default)]
pub struct SysinfoState {
    pub sys: Mutex<System>,
}

#[tauri::command]
pub fn get_system_stats(state: State<'_, SysinfoState>) -> Result<SystemStats, String> {
    let mut sys = state
        .sys
        .lock()
        .map_err(|e| format!("System info lock poisoned: {}", e))?;
    sys.refresh_memory();
    // CPU usage is computed against the previous refresh; with the frontend
    // polling periodically the first call may read 0% and later calls report
    // the average load over the interval between polls.
    sys.refresh_cpu_usage();

    Ok(SystemStats {
        cpu_usage: sys.global_cpu_info().cpu_usage(),
        ram_usage: sys.used_memory(),
        ram_total: sys.total_memory(),
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LocalModelSwitchStatus {
    pub previous_model: Option<String>,
    pub next_model: Option<String>,
    pub unloaded_previous: bool,
    pub preloaded_next: bool,
    pub message: String,
}

fn ollama_generate_url(raw_url: &str) -> String {
    let trimmed = raw_url.trim_end_matches('/');
    if trimmed.ends_with("/api/generate") {
        return trimmed.to_string();
    }
    if trimmed.ends_with("/api/chat") {
        let base = trimmed.trim_end_matches("/api/chat");
        return format!("{}/api/generate", base);
    }
    if trimmed.ends_with("/api") {
        return format!("{}/generate", trimmed);
    }
    format!("{}/api/generate", trimmed)
}

async fn ollama_set_keep_alive(
    generate_url: &str,
    model: &str,
    keep_alive: serde_json::Value,
    tolerate_not_loaded: bool,
) -> Result<(), WeaveError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| WeaveError::AiApiError(format!("Failed to build HTTP client: {}", e)))?;

    let payload = serde_json::json!({
        "model": model,
        "prompt": "",
        "stream": false,
        "keep_alive": keep_alive,
    });

    let response = client
        .post(generate_url)
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| {
            WeaveError::LocalLlmNotAvailable(format!("Failed contacting Ollama: {}", e))
        })?;

    if response.status().is_success() {
        return Ok(());
    }

    let error_text = response.text().await.unwrap_or_default();
    let lowered = error_text.to_lowercase();
    if tolerate_not_loaded
        && (lowered.contains("not loaded")
            || lowered.contains("not found")
            || lowered.contains("no such model"))
    {
        return Ok(());
    }

    Err(WeaveError::LocalLlmNotAvailable(format!(
        "Ollama model lifecycle request failed: {}",
        error_text
    )))
}

#[tauri::command]
pub async fn local_model_switch(
    previous_model: Option<String>,
    next_model: Option<String>,
    app_state: TauriState<'_, AppState>,
) -> Result<LocalModelSwitchStatus, WeaveError> {
    let previous_model = previous_model.and_then(|m| {
        let t = m.trim().to_string();
        if t.is_empty() {
            None
        } else {
            Some(t)
        }
    });
    let next_model = next_model.and_then(|m| {
        let t = m.trim().to_string();
        if t.is_empty() {
            None
        } else {
            Some(t)
        }
    });

    if previous_model == next_model {
        return Ok(LocalModelSwitchStatus {
            previous_model,
            next_model,
            unloaded_previous: false,
            preloaded_next: false,
            message: "Model is already active.".to_string(),
        });
    }

    let config = app_state.config.read().clone();
    let base_url = config
        .ai
        .local
        .api_url
        .clone()
        .unwrap_or_else(|| crate::utils::config::OLLAMA_DEFAULT_URL.to_string());

    if !probe_url(&base_url).await {
        return Err(WeaveError::LocalLlmNotAvailable(
            "Local model server is not reachable. Start Ollama first.".to_string(),
        ));
    }

    let generate_url = ollama_generate_url(&base_url);
    let mut unloaded_previous = false;
    let mut preloaded_next = false;

    if let Some(prev) = previous_model.as_ref() {
        ollama_set_keep_alive(&generate_url, prev, serde_json::json!(0), true).await?;
        unloaded_previous = true;
    }

    if let Some(next) = next_model.as_ref() {
        ollama_set_keep_alive(&generate_url, next, serde_json::json!("15m"), false).await?;
        preloaded_next = true;
    }

    let message = match (&previous_model, &next_model) {
        (Some(prev), Some(next)) => {
            format!("Switched local model from '{}' to '{}'.", prev, next)
        }
        (Some(prev), None) => format!("Unloaded local model '{}'.", prev),
        (None, Some(next)) => format!("Activated local model '{}'.", next),
        (None, None) => "No local model transition requested.".to_string(),
    };

    Ok(LocalModelSwitchStatus {
        previous_model,
        next_model,
        unloaded_previous,
        preloaded_next,
        message,
    })
}

async fn probe_url(url: &str) -> bool {
    // Quick liveness probe — Ollama returns 200 on GET / for recent versions,
    // but any successful HTTP response counts. Use a short timeout to avoid blocking the UI.
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(800))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    let probe_url = if url.ends_with('/') {
        format!("{}api/tags", url)
    } else {
        format!("{}/api/tags", url)
    };
    client
        .get(&probe_url)
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct LocalModelDetails {
    pub quant: Option<String>,
    pub context_length: Option<u32>,
    pub parameter_count: Option<String>,
}
