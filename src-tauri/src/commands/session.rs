use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tracing::info;

use crate::models::chat::ChatMessage;
use crate::utils::config::AppConfig;
use crate::utils::errors::WeaveError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMeta {
    pub id: String,
    pub title: String,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSession {
    pub id: String,
    pub title: String,
    pub updated_at: u64,
    pub messages: Vec<ChatMessage>,
}

fn get_sessions_dir() -> Result<PathBuf, WeaveError> {
    let dir = AppConfig::app_data_dir()?.join("sessions");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

#[tauri::command]
pub fn chat_list_sessions() -> Result<Vec<SessionMeta>, WeaveError> {
    let dir = get_sessions_dir()?;
    let mut sessions = Vec::new();
    
    if dir.exists() {
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_file() && path.extension().map_or(false, |ext| ext == "json") {
                if let Ok(content) = std::fs::read_to_string(&path) {
                    if let Ok(session) = serde_json::from_str::<ChatSession>(&content) {
                        sessions.push(SessionMeta {
                            id: session.id,
                            title: session.title,
                            updated_at: session.updated_at,
                        });
                    }
                }
            }
        }
    }
    
    sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(sessions)
}

#[tauri::command]
pub fn chat_load_session(id: String) -> Result<ChatSession, WeaveError> {
    let dir = get_sessions_dir()?;
    let path = dir.join(format!("{}.json", id));
    
    if !path.exists() {
        return Err(WeaveError::PluginError(format!("Session {} not found", id)));
    }
    
    let content = std::fs::read_to_string(path)?;
    let session: ChatSession = serde_json::from_str(&content)
        .map_err(|e| WeaveError::Serialization(format!("Failed to parse session: {}", e)))?;
        
    Ok(session)
}

#[tauri::command]
pub fn chat_save_session(id: String, title: String, messages: Vec<ChatMessage>) -> Result<(), WeaveError> {
    let dir = get_sessions_dir()?;
    let path = dir.join(format!("{}.json", id));
    
    let updated_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
        
    let session = ChatSession {
        id,
        title,
        updated_at,
        messages,
    };
    
    let content = serde_json::to_string_pretty(&session)
        .map_err(|e| WeaveError::Serialization(e.to_string()))?;
        
    std::fs::write(path, content)?;
    Ok(())
}

#[tauri::command]
pub fn chat_delete_session(id: String) -> Result<(), WeaveError> {
    let dir = get_sessions_dir()?;
    let path = dir.join(format!("{}.json", id));
    
    if path.exists() {
        std::fs::remove_file(path)?;
    }
    
    info!("Deleted session: {}", id);
    Ok(())
}
