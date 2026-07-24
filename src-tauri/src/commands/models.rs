use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use sysinfo::System;
use tauri::State as TauriState;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::fs;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::AppState;
use crate::utils::errors::WeaveError;

#[derive(Debug, Serialize, Deserialize)]
pub struct LocalModelInfo {
    pub name: String,
    pub size_bytes: u64,
}

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

fn get_models_dir(app: &AppHandle) -> PathBuf {
    let mut path = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("~/.weave"));
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
                        let name = path
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .to_string();
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
pub async fn download_local_model(
    app: AppHandle,
    url: String,
    filename: String,
) -> Result<(), String> {
    let models_dir = get_models_dir(&app);
    if !models_dir.exists() {
        fs::create_dir_all(&models_dir)
            .await
            .map_err(|e| e.to_string())?;
    }

    let mut file_path = models_dir.clone();
    file_path.push(&filename);

    let app_clone = app.clone();
    let filename_clone = filename.clone();

    // Spawn a background task so the command returns immediately and doesn't block the UI
    tokio::spawn(async move {
        let emit_progress =
            |downloaded: u64, total: Option<u64>, done: bool, error: Option<String>| {
                let _ = app_clone.emit(
                    "download-progress",
                    DownloadProgress {
                        filename: filename_clone.clone(),
                        downloaded,
                        total,
                        done,
                        error,
                    },
                );
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
pub struct LocalServerStatus {
    pub running: bool,
    pub url: String,
    pub pid: Option<u32>,
    pub message: String,
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
        if t.is_empty() { None } else { Some(t) }
    });
    let next_model = next_model.and_then(|m| {
        let t = m.trim().to_string();
        if t.is_empty() { None } else { Some(t) }
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

/// Best-effort GGUF header inspection of a downloaded model file.
/// Any parse failure yields an all-None struct rather than an error.
#[tauri::command]
pub async fn local_model_info(
    app: AppHandle,
    filename: String,
) -> Result<LocalModelDetails, String> {
    let mut path = get_models_dir(&app);
    path.push(&filename);
    Ok(parse_gguf_details(&path).unwrap_or_default())
}

// --- GGUF header parsing (best-effort) ---

const GGUF_MAX_METADATA_KV: u64 = 1_000_000;
const GGUF_MAX_STRING_LEN: u64 = 16 * 1024 * 1024;
const GGUF_MAX_ARRAY_LEN: u64 = 100_000_000;

fn parse_gguf_details(path: &std::path::Path) -> Option<LocalModelDetails> {
    let file = std::fs::File::open(path).ok()?;
    parse_gguf_from(file)
}

/// Map a `general.file_type` value to the common GGML type name.
fn ggml_type_name(file_type: u32) -> Option<&'static str> {
    Some(match file_type {
        0 => "F32",
        1 => "F16",
        2 => "Q4_0",
        3 => "Q4_1",
        6 => "Q5_0",
        7 => "Q5_1",
        8 => "Q8_0",
        10 => "Q2_K",
        11 => "Q3_K_S",
        12 => "Q3_K_M",
        13 => "Q3_K_L",
        14 => "Q4_K_S",
        15 => "Q4_K_M",
        16 => "Q5_K_S",
        17 => "Q5_K_M",
        18 => "Q6_K",
        _ => return None,
    })
}

/// Fixed byte size of a GGUF metadata value type; strings (8) and arrays
/// (9) are variable-length and return None.
fn gguf_primitive_size(value_type: u32) -> Option<u64> {
    match value_type {
        0 | 1 | 7 => Some(1),     // u8, i8, bool
        2 | 3 => Some(2),         // u16, i16
        4 | 5 | 6 => Some(4),     // u32, i32, f32
        10 | 11 | 12 => Some(8),  // u64, i64, f64
        _ => None,
    }
}

struct GgufReader<R> {
    inner: R,
}

impl<R: std::io::Read + std::io::Seek> GgufReader<R> {
    fn read_bytes<const N: usize>(&mut self) -> Option<[u8; N]> {
        let mut buf = [0u8; N];
        std::io::Read::read_exact(&mut self.inner, &mut buf).ok()?;
        Some(buf)
    }

    fn read_u32(&mut self) -> Option<u32> {
        Some(u32::from_le_bytes(self.read_bytes::<4>()?))
    }

    fn read_u64(&mut self) -> Option<u64> {
        Some(u64::from_le_bytes(self.read_bytes::<8>()?))
    }

    fn read_string(&mut self) -> Option<String> {
        let len = self.read_u64()?;
        if len > GGUF_MAX_STRING_LEN {
            return None;
        }
        let mut buf = vec![0u8; len as usize];
        std::io::Read::read_exact(&mut self.inner, &mut buf).ok()?;
        Some(String::from_utf8_lossy(&buf).to_string())
    }

    fn skip(&mut self, bytes: u64) -> Option<()> {
        std::io::Seek::seek(&mut self.inner, std::io::SeekFrom::Current(bytes as i64)).ok()?;
        Some(())
    }

    /// Skip a metadata value of the given type tag.
    fn skip_value(&mut self, value_type: u32) -> Option<()> {
        match value_type {
            8 => {
                let len = self.read_u64()?;
                if len > GGUF_MAX_STRING_LEN {
                    return None;
                }
                self.skip(len)
            }
            9 => {
                let elem_type = self.read_u32()?;
                let count = self.read_u64()?;
                if count > GGUF_MAX_ARRAY_LEN {
                    return None;
                }
                match elem_type {
                    8 => {
                        for _ in 0..count {
                            let len = self.read_u64()?;
                            if len > GGUF_MAX_STRING_LEN {
                                return None;
                            }
                            self.skip(len)?;
                        }
                        Some(())
                    }
                    9 => None, // nested arrays are not expected
                    _ => {
                        let size = gguf_primitive_size(elem_type)?;
                        self.skip(size.checked_mul(count)?)
                    }
                }
            }
            _ => {
                let size = gguf_primitive_size(value_type)?;
                self.skip(size)
            }
        }
    }
}

fn parse_gguf_from<R: std::io::Read + std::io::Seek>(reader: R) -> Option<LocalModelDetails> {
    let mut r = GgufReader { inner: reader };

    if r.read_bytes::<4>()? != *b"GGUF" {
        return None;
    }
    let _version = r.read_u32()?;
    let _tensor_count = r.read_u64()?;
    let metadata_kv_count = r.read_u64()?;
    if metadata_kv_count > GGUF_MAX_METADATA_KV {
        return None;
    }

    let mut details = LocalModelDetails::default();

    for _ in 0..metadata_kv_count {
        let key = r.read_string()?;
        let value_type = r.read_u32()?;

        match key.as_str() {
            "general.file_type" if value_type == 4 => {
                let file_type = r.read_u32()?;
                details.quant = ggml_type_name(file_type).map(|s| s.to_string());
            }
            "general.size_label" if value_type == 8 => {
                details.parameter_count = Some(r.read_string()?);
            }
            _ if key.ends_with(".context_length") && value_type == 4 => {
                details.context_length = Some(r.read_u32()?);
            }
            _ => {
                r.skip_value(value_type)?;
            }
        }
    }

    Some(details)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn push_string(buf: &mut Vec<u8>, s: &str) {
        buf.extend_from_slice(&(s.len() as u64).to_le_bytes());
        buf.extend_from_slice(s.as_bytes());
    }

    fn sample_gguf() -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(b"GGUF");
        buf.extend_from_slice(&3u32.to_le_bytes()); // version
        buf.extend_from_slice(&0u64.to_le_bytes()); // tensor_count
        buf.extend_from_slice(&5u64.to_le_bytes()); // metadata_kv_count

        // general.file_type = 15 (Q4_K_M)
        push_string(&mut buf, "general.file_type");
        buf.extend_from_slice(&4u32.to_le_bytes());
        buf.extend_from_slice(&15u32.to_le_bytes());

        // llama.context_length = 8192
        push_string(&mut buf, "llama.context_length");
        buf.extend_from_slice(&4u32.to_le_bytes());
        buf.extend_from_slice(&8192u32.to_le_bytes());

        // general.size_label = "7B"
        push_string(&mut buf, "general.size_label");
        buf.extend_from_slice(&8u32.to_le_bytes());
        push_string(&mut buf, "7B");

        // a string array that must be skipped (type 9 of type 8)
        push_string(&mut buf, "tokenizer.ggml.tokens");
        buf.extend_from_slice(&9u32.to_le_bytes());
        buf.extend_from_slice(&8u32.to_le_bytes()); // elem type: string
        buf.extend_from_slice(&2u64.to_le_bytes()); // count
        push_string(&mut buf, "hello");
        push_string(&mut buf, "world");

        // a primitive array that must be skipped (type 9 of type 6 = f32)
        push_string(&mut buf, "some.floats");
        buf.extend_from_slice(&9u32.to_le_bytes());
        buf.extend_from_slice(&6u32.to_le_bytes());
        buf.extend_from_slice(&3u64.to_le_bytes());
        buf.extend_from_slice(&[0u8; 12]);

        buf
    }

    #[test]
    fn parses_gguf_metadata() {
        let data = sample_gguf();
        let details = parse_gguf_from(std::io::Cursor::new(data)).expect("parse");
        assert_eq!(details.quant.as_deref(), Some("Q4_K_M"));
        assert_eq!(details.context_length, Some(8192));
        assert_eq!(details.parameter_count.as_deref(), Some("7B"));
    }

    #[test]
    fn rejects_bad_magic() {
        let data = b"NOPE........".to_vec();
        assert!(parse_gguf_from(std::io::Cursor::new(data)).is_none());
    }

    #[test]
    fn rejects_truncated_file() {
        let data = b"GGUF".to_vec();
        assert!(parse_gguf_from(std::io::Cursor::new(data)).is_none());
    }

    #[test]
    fn unknown_file_type_yields_none_quant() {
        let mut buf = Vec::new();
        buf.extend_from_slice(b"GGUF");
        buf.extend_from_slice(&3u32.to_le_bytes());
        buf.extend_from_slice(&0u64.to_le_bytes());
        buf.extend_from_slice(&1u64.to_le_bytes());
        push_string(&mut buf, "general.file_type");
        buf.extend_from_slice(&4u32.to_le_bytes());
        buf.extend_from_slice(&99u32.to_le_bytes());

        let details = parse_gguf_from(std::io::Cursor::new(buf)).expect("parse");
        assert_eq!(details.quant, None);
        assert_eq!(details.context_length, None);
        assert_eq!(details.parameter_count, None);
    }
}
