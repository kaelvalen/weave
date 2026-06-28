use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Emitter};
use tokio::fs;
use tokio::io::AsyncWriteExt;
use futures::StreamExt;
use sysinfo::System;
use std::sync::Mutex;
use tauri::State;

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
    let mut sys = state.sys.lock().unwrap();
    sys.refresh_memory();
    
    Ok(SystemStats {
        ram_usage: sys.used_memory(),
        ram_total: sys.total_memory(),
    })
}
