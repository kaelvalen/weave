use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tokio::fs;

#[derive(Serialize, Deserialize, Clone)]
pub struct KnowledgeFile {
    pub id: String,
    pub filename: String,
    pub size_bytes: u64,
    pub created_at: i64,
}

pub fn get_knowledge_dir(app: &AppHandle) -> PathBuf {
    let path = app.path().app_data_dir().unwrap().join("knowledge");
    std::fs::create_dir_all(&path).ok();
    path
}

#[tauri::command]
pub async fn list_knowledge_files(app: AppHandle) -> Result<Vec<KnowledgeFile>, String> {
    let dir = get_knowledge_dir(&app);
    let mut files = Vec::new();
    
    if let Ok(mut entries) = fs::read_dir(dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            if let Ok(metadata) = entry.metadata().await {
                if metadata.is_file() {
                    let filename = entry.file_name().to_string_lossy().to_string();
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
    let dir = get_knowledge_dir(&app);
    let file_path = dir.join(&filename);
    
    fs::write(file_path, content).await.map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
pub async fn delete_knowledge_file(app: AppHandle, filename: String) -> Result<(), String> {
    let dir = get_knowledge_dir(&app);
    let file_path = dir.join(&filename);
    
    if file_path.exists() {
        fs::remove_file(file_path).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}
