use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};
use tokio::fs;

#[derive(Serialize, Deserialize, Clone)]
pub struct KnowledgeFile {
    pub id: String,
    pub filename: String,
    pub size_bytes: u64,
    pub created_at: i64,
}

pub fn get_knowledge_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?
        .join("knowledge");
    std::fs::create_dir_all(&path).ok();
    Ok(path)
}

fn get_index_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = get_knowledge_dir(app)?;
    Ok(dir.join(".index.json"))
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct IndexedChunk {
    pub filename: String,
    pub chunk: String,
    pub tokens: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct KnowledgeIndex {
    pub chunks: Vec<IndexedChunk>,
    pub built_at: i64,
    pub file_count: usize,
}

/// Tokenize text into lowercase alphanumeric terms for simple keyword indexing.
fn tokenize(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_lowercase())
        .collect()
}

/// Split a long document into overlapping chunks of ~500 chars for retrieval.
fn chunk_text(text: &str) -> Vec<String> {
    const CHUNK_SIZE: usize = 500;
    const OVERLAP: usize = 80;
    let bytes = text.as_bytes();
    let mut chunks = Vec::new();
    let mut start = 0;
    while start < bytes.len() {
        let end = (start + CHUNK_SIZE).min(bytes.len());
        // Snap to a UTF-8 char boundary.
        let mut safe_end = end;
        while safe_end < bytes.len() && !text.is_char_boundary(safe_end) {
            safe_end += 1;
        }
        if let Ok(slice) = std::str::from_utf8(&bytes[start..safe_end]) {
            chunks.push(slice.to_string());
        }
        if end >= bytes.len() {
            break;
        }
        start = end.saturating_sub(OVERLAP);
    }
    chunks
}

#[derive(Serialize, Clone)]
pub struct IndexingProgress {
    pub filename: String,
    pub processed: usize,
    pub total: usize,
    pub done: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn list_knowledge_files(app: AppHandle) -> Result<Vec<KnowledgeFile>, String> {
    let dir = get_knowledge_dir(&app)?;
    let mut files = Vec::new();
    
    if let Ok(mut entries) = fs::read_dir(dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            if let Ok(metadata) = entry.metadata().await {
                if metadata.is_file() {
                    let filename = entry.file_name().to_string_lossy().to_string();
                    // Skip the index file itself.
                    if filename.starts_with('.') {
                        continue;
                    }
                    let size_bytes = metadata.len();
                    
                    let created_at = metadata
                        .created()
                        .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
                        .duration_since(std::time::SystemTime::UNIX_EPOCH)
                        .unwrap_or(std::time::Duration::from_secs(0))
                        .as_millis() as i64;
                    
                    files.push(KnowledgeFile {
                        id: format!("{}-{}", filename, created_at),
                        filename,
                        size_bytes,
                        created_at,
                    });
                }
            }
        }
    }
    
    // Sort by newest first
    files.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(files)
}

#[tauri::command]
pub async fn upload_knowledge_file(app: AppHandle, filename: String, content: Vec<u8>) -> Result<(), String> {
    let dir = get_knowledge_dir(&app)?;
    let file_path = dir.join(&filename);
    
    fs::write(file_path, content).await.map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
pub async fn delete_knowledge_file(app: AppHandle, filename: String) -> Result<(), String> {
    let dir = get_knowledge_dir(&app)?;
    let file_path = dir.join(&filename);
    
    if file_path.exists() {
        fs::remove_file(file_path).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Build (or rebuild) a simple keyword-based index over all knowledge files.
/// Emits `knowledge-index-progress` events so the UI can show live progress.
#[tauri::command]
pub async fn index_knowledge_files(app: AppHandle) -> Result<KnowledgeIndex, String> {
    let dir = get_knowledge_dir(&app)?;
    let emit_progress = |filename: String, processed: usize, total: usize, done: bool, error: Option<String>| {
        let _ = app.emit("knowledge-index-progress", IndexingProgress {
            filename,
            processed,
            total,
            done,
            error,
        });
    };

    // Gather text-like files (skip the index file and anything that looks binary).
    let mut targets: Vec<(String, PathBuf)> = Vec::new();
    if let Ok(mut entries) = fs::read_dir(&dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let lower = name.to_lowercase();
            let is_text = lower.ends_with(".txt")
                || lower.ends_with(".md")
                || lower.ends_with(".markdown")
                || lower.ends_with(".json")
                || lower.ends_with(".csv")
                || lower.ends_with(".rs")
                || lower.ends_with(".ts")
                || lower.ends_with(".tsx")
                || lower.ends_with(".js")
                || lower.ends_with(".py")
                || lower.ends_with(".toml")
                || lower.ends_with(".yaml")
                || lower.ends_with(".yml")
                || lower.ends_with(".html")
                || lower.ends_with(".log")
                || (!lower.contains('.') /* extensionless */);
            if is_text {
                targets.push((name, path));
            }
        }
    }

    let total = targets.len();
    let mut chunks: Vec<IndexedChunk> = Vec::new();
    let mut processed = 0usize;

    for (filename, path) in targets {
        processed += 1;
        emit_progress(filename.clone(), processed, total, false, None);
        let content = match fs::read_to_string(&path).await {
            Ok(c) => c,
            Err(e) => {
                emit_progress(filename, processed, total, false, Some(e.to_string()));
                continue;
            }
        };
        for chunk in chunk_text(&content) {
            let tokens = tokenize(&chunk);
            if tokens.is_empty() {
                continue;
            }
            chunks.push(IndexedChunk { filename: filename.clone(), chunk, tokens });
        }
    }

    let index = KnowledgeIndex {
        file_count: processed,
        chunks,
        built_at: chrono::Utc::now().timestamp_millis(),
    };

    let index_path = get_index_path(&app)?;
    let serialized = serde_json::to_string_pretty(&index).map_err(|e| e.to_string())?;
    fs::write(index_path, serialized).await.map_err(|e| e.to_string())?;

    emit_progress(String::new(), processed, total, true, None);
    Ok(index)
}

#[derive(Serialize)]
pub struct KnowledgeSearchResult {
    pub filename: String,
    pub snippet: String,
    pub score: f64,
}

/// Query the keyword index for chunks matching the given text. Returns ranked snippets.
#[tauri::command]
pub async fn search_knowledge(
    app: AppHandle,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<KnowledgeSearchResult>, String> {
    let index_path = get_index_path(&app)?;
    if !index_path.exists() {
        return Err("Knowledge index has not been built yet. Run indexing first.".to_string());
    }
    let content = fs::read_to_string(&index_path).await.map_err(|e| e.to_string())?;
    let index: KnowledgeIndex = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    let query_tokens = tokenize(&query);
    if query_tokens.is_empty() {
        return Ok(Vec::new());
    }

    // Simple TF-based scoring: count how many query tokens appear in each chunk,
    // weighted by inverse document frequency to emphasize rare terms.
    let df: HashMap<String, usize> = {
        let mut df: HashMap<String, usize> = HashMap::new();
        for c in &index.chunks {
            let mut seen: std::collections::HashSet<&str> = std::collections::HashSet::new();
            for t in &c.tokens {
                if seen.insert(t.as_str()) {
                    *df.entry(t.clone()).or_insert(0) += 1;
                }
            }
        }
        df
    };
    let n_docs = index.chunks.len().max(1) as f64;

    let mut scored: Vec<KnowledgeSearchResult> = index
        .chunks
        .iter()
        .filter_map(|c| {
            let mut term_counts: HashMap<String, usize> = HashMap::new();
            for t in &c.tokens {
                *term_counts.entry(t.clone()).or_insert(0) += 1;
            }
            let mut score = 0.0;
            for qt in &query_tokens {
                if let Some(tf) = term_counts.get(qt) {
                    let df = *df.get(qt).unwrap_or(&1) as f64;
                    let idf = (1.0 + n_docs / (1.0 + df)).ln();
                    score += (*tf as f64) * idf;
                }
            }
            if score <= 0.0 {
                None
            } else {
                let snippet = if c.chunk.len() > 240 {
                    format!("{}…", &c.chunk[..240])
                } else {
                    c.chunk.clone()
                };
                Some(KnowledgeSearchResult {
                    filename: c.filename.clone(),
                    snippet,
                    score,
                })
            }
        })
        .collect();

    scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    let limit = limit.unwrap_or(10).max(1);
    scored.truncate(limit);
    Ok(scored)
}

/// Return current index metadata (without the chunk contents) so the UI can show
/// whether indexing has been performed and how many files were processed.
#[tauri::command]
pub async fn get_knowledge_index_status(app: AppHandle) -> Result<KnowledgeIndex, String> {
    let index_path = get_index_path(&app)?;
    if !index_path.exists() {
        return Ok(KnowledgeIndex::default());
    }
    let content = fs::read_to_string(&index_path).await.map_err(|e| e.to_string())?;
    let mut idx: KnowledgeIndex = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    // Drop chunk bodies to keep the payload small — UI only needs counts.
    idx.chunks.clear();
    Ok(idx)
}
