use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Emitter, State};
use tokio::fs;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use futures::StreamExt;
use sysinfo::System;
use std::sync::Mutex;
use tauri::State as TauriState;

use crate::AppState;
use crate::utils::errors::WeaveError;

#[derive(Debug, Serialize, Deserialize)]
pub struct LocalModelInfo {
    pub name: String,
    pub size_bytes: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SystemStats {
    pub ram_usage: u64,
    pub ram_total: u64,
}

#[derive(Default)]
pub struct SysinfoState {
    pub sys: Mutex<System>,
}

fn get_models_dir(app: &AppHandle) -> PathBuf {
    let mut path = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("~/.weave"));
    path.push("models");
    path
}

#[tauri::command]
pub async fn list_local_models(app: AppHandle) -> Result<Vec<LocalModelInfo>, String> {
    let models_dir = get_models_dir(&app);
    if !models_dir.exists() {
        let _ = fs::create_dir_all(&models_dir).await;
        return Ok(Vec::new());
    }

    let mut models = Vec::new();
    let mut entries = fs::read_dir(models_dir).await.map_err(|e| e.to_string())?;

    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        if path.is_file() {
            if let Some(ext) = path.extension() {
                if ext == "gguf" {
                    if let Ok(metadata) = entry.metadata().await {
                        let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                        models.push(LocalModelInfo {
                            name,
                            size_bytes: metadata.len(),
                        });
                    }
                }
            }
        }
    }

    Ok(models)
}

#[tauri::command]
pub async fn delete_local_model(app: AppHandle, filename: String) -> Result<(), String> {
    let mut path = get_models_dir(&app);
    path.push(&filename);
    if path.exists() {
        fs::remove_file(path).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Clone, Serialize)]
struct DownloadProgress {
    filename: String,
    downloaded: u64,
    total: Option<u64>,
    done: bool,
    error: Option<String>,
}

#[tauri::command]
pub async fn download_local_model(app: AppHandle, url: String, filename: String) -> Result<(), String> {
    let models_dir = get_models_dir(&app);
    if !models_dir.exists() {
        fs::create_dir_all(&models_dir).await.map_err(|e| e.to_string())?;
    }

    let mut file_path = models_dir.clone();
    file_path.push(&filename);

    let app_clone = app.clone();
    let filename_clone = filename.clone();
    
    // Spawn a background task so the command returns immediately and doesn't block the UI
    tokio::spawn(async move {
        let emit_progress = |downloaded: u64, total: Option<u64>, done: bool, error: Option<String>| {
            let _ = app_clone.emit("download-progress", DownloadProgress {
                filename: filename_clone.clone(),
                downloaded,
                total,
                done,
                error,
            });
        };

        let response = match reqwest::get(&url).await {
            Ok(r) => r,
            Err(e) => {
                emit_progress(0, None, true, Some(e.to_string()));
                return;
            }
        };

        if !response.status().is_success() {
            emit_progress(0, None, true, Some(format!("HTTP {}", response.status())));
            return;
        }

        let total_size = response.content_length();
        let mut file = match fs::File::create(&file_path).await {
            Ok(f) => f,
            Err(e) => {
                emit_progress(0, total_size, true, Some(e.to_string()));
                return;
            }
        };

        let mut downloaded = 0;
        let mut stream = response.bytes_stream();

        let mut last_emit = std::time::Instant::now();

        while let Some(chunk_result) = stream.next().await {
            match chunk_result {
                Ok(chunk) => {
                    if let Err(e) = file.write_all(&chunk).await {
                        emit_progress(downloaded, total_size, true, Some(e.to_string()));
                        let _ = fs::remove_file(&file_path).await; // clean up
                        return;
                    }
                    downloaded += chunk.len() as u64;
                    
                    // Throttle emits to avoid UI freeze
                    if last_emit.elapsed().as_millis() > 200 {
                        emit_progress(downloaded, total_size, false, None);
                        last_emit = std::time::Instant::now();
                    }
                }
                Err(e) => {
                    emit_progress(downloaded, total_size, true, Some(e.to_string()));
                    let _ = fs::remove_file(&file_path).await; // clean up
                    return;
                }
            }
        }

        // Final emit
        emit_progress(downloaded, total_size, true, None);
    });

    Ok(())
}

#[tauri::command]
pub fn get_system_stats(state: State<'_, SysinfoState>) -> Result<SystemStats, String> {
    let mut sys = state.sys.lock().map_err(|e| format!("System info lock poisoned: {}", e))?;
    sys.refresh_memory();
    
    Ok(SystemStats {
        ram_usage: sys.used_memory(),
        ram_total: sys.total_memory(),
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LocalServerStatus {
    pub running: bool,
    pub url: String,
    pub pid: Option<u32>,
    pub message: String,
}

/// Probe the configured local LLM endpoint (default Ollama at http://localhost:11434)
/// to see if it is responding, and report whether our managed child is alive.
#[tauri::command]
pub async fn local_server_status(
    app_state: TauriState<'_, AppState>,
) -> Result<LocalServerStatus, WeaveError> {
    let config = app_state.config.read().clone();
    let url = config
        .ai
        .local
        .api_url
        .clone()
        .unwrap_or_else(|| crate::utils::config::OLLAMA_DEFAULT_URL.to_string());

    let mut pid: Option<u32> = None;
    let mut managed_running = false;
    {
        let guard = app_state.local_server.lock().await;
        if let Some(child) = guard.as_ref() {
            pid = child.id();
            // We can't call wait() on a &Child; treat presence of the handle as "running"
            // and rely on the URL probe below to confirm actual reachability.
            managed_running = pid.is_some();
        }
    }

    // Probe the URL regardless of managed state — user may run Ollama separately.
    let reachable = probe_url(&url).await;
    let running = managed_running || reachable;
    let message = if running {
        "Server is reachable.".to_string()
    } else if pid.is_some() {
        "Managed server is starting...".to_string()
    } else {
        "Server is stopped. Start it to run local models.".to_string()
    };

    Ok(LocalServerStatus {
        running,
        url,
        pid,
        message,
    })
}

/// Start the local LLM server (spawns `ollama serve` if the `ollama` binary is on PATH).
#[tauri::command]
pub async fn local_server_start(
    app_state: TauriState<'_, AppState>,
) -> Result<LocalServerStatus, WeaveError> {
    let config = app_state.config.read().clone();
    let url = config
        .ai
        .local
        .api_url
        .clone()
        .unwrap_or_else(|| crate::utils::config::OLLAMA_DEFAULT_URL.to_string());

    // If something is already running, just report it.
    {
        let mut guard = app_state.local_server.lock().await;
        if let Some(child) = guard.as_mut() {
            // Best-effort liveness check
            let still_alive = match child.try_wait() {
                Ok(None) => true,
                _ => false,
            };
            if still_alive {
                return Ok(LocalServerStatus {
                    running: true,
                    url: url.clone(),
                    pid: child.id(),
                    message: "Server is already running.".to_string(),
                });
            } else {
                *guard = None;
            }
        }
    }

    // If the endpoint is already reachable, no need to spawn.
    if probe_url(&url).await {
        return Ok(LocalServerStatus {
            running: true,
            url: url.clone(),
            pid: None,
            message: "An existing local server is already reachable.".to_string(),
        });
    }

    // Spawn `ollama serve`. Failure → helpful error so the UI can guide the user.
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

/// Stop the managed local server, if any. Does not affect externally-launched servers.
#[tauri::command]
pub async fn local_server_stop(
    app_state: TauriState<'_, AppState>,
) -> Result<LocalServerStatus, WeaveError> {
    let config = app_state.config.read().clone();
    let url = config
        .ai
        .local
        .api_url
        .clone()
        .unwrap_or_else(|| crate::utils::config::OLLAMA_DEFAULT_URL.to_string());

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
    client.get(&probe_url).send().await.map(|r| r.status().is_success()).unwrap_or(false)
}
