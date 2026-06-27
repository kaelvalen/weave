use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tracing::{debug, error, info, warn};

use crate::utils::config::AppConfig;
use crate::utils::errors::WeaveError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub content: String,
    #[serde(with = "chrono::serde::ts_seconds")]
    pub created_at: DateTime<Utc>,
    #[serde(with = "chrono::serde::ts_seconds")]
    pub updated_at: DateTime<Utc>,
    #[serde(default)]
    pub tags: Vec<String>,
}

pub struct NotePlugin;

impl NotePlugin {
    pub fn execute(capability: &str, params: Value) -> Result<Value, WeaveError> {
        match capability {
            "note.create" => Self::create(params),
            "note.list" => Self::list(),
            "note.get" => Self::get(params),
            "note.update" => Self::update(params),
            "note.delete" => Self::delete(params),
            _ => Err(WeaveError::CapabilityNotFound(capability.to_string())),
        }
    }

    fn create(params: Value) -> Result<Value, WeaveError> {
        let title = params.get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("Untitled Note");
        
        let content = params.get("content")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        
        let notes_dir = AppConfig::notes_dir()?;
        std::fs::create_dir_all(&notes_dir)?;
        
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now();
        
        let note = Note {
            id: id.clone(),
            title: title.to_string(),
            content: content.to_string(),
            created_at: now,
            updated_at: now,
            tags: Vec::new(),
        };
        
        let file_path = notes_dir.join(format!("{}.json", id));
        let note_json = serde_json::to_string_pretty(&note)
            .map_err(|e| WeaveError::Serialization(e.to_string()))?;
        std::fs::write(&file_path, note_json)?;
        
        info!("Created note: {} ({}) in {:?}", title, id, file_path);
        
        Ok(json!({
            "note": {
                "id": note.id,
                "title": note.title,
                "content": note.content,
                "created_at": note.created_at.timestamp(),
                "updated_at": note.updated_at.timestamp(),
                "tags": note.tags,
            },
            "success": true
        }))
    }

    fn list() -> Result<Value, WeaveError> {
        let notes_dir = AppConfig::notes_dir()?;
        
        if !notes_dir.exists() {
            return Ok(json!({
                "notes": [],
                "count": 0,
                "success": true
            }));
        }
        
        let mut notes = Vec::new();
        let entries = std::fs::read_dir(&notes_dir)?;
        
        for entry in entries {
            let entry = entry?;
            let path = entry.path();
            
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                match std::fs::read_to_string(&path) {
                    Ok(content) => {
                        match serde_json::from_str::<Note>(&content) {
                            Ok(note) => {
                                notes.push(json!({
                                    "id": note.id,
                                    "title": note.title,
                                    "content": note.content.chars().take(200).collect::<String>(),
                                    "created_at": note.created_at.timestamp(),
                                    "updated_at": note.updated_at.timestamp(),
                                    "tags": note.tags,
                                }));
                            }
                            Err(e) => {
                                warn!("Failed to parse note at {:?}: {}", path, e);
                            }
                        }
                    }
                    Err(e) => {
                        warn!("Failed to read note at {:?}: {}", path, e);
                    }
                }
            }
        }
        
        notes.sort_by(|a, b| {
            let a_updated = a.get("updated_at").and_then(|v| v.as_i64()).unwrap_or(0);
            let b_updated = b.get("updated_at").and_then(|v| v.as_i64()).unwrap_or(0);
            b_updated.cmp(&a_updated)
        });
        
        info!("Listed {} notes", notes.len());
        
        Ok(json!({
            "notes": notes,
            "count": notes.len(),
            "success": true
        }))
    }

    fn get(params: Value) -> Result<Value, WeaveError> {
        let id = params.get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| WeaveError::PluginError("Missing 'id' parameter".to_string()))?;
        
        let notes_dir = AppConfig::notes_dir()?;
        let file_path = notes_dir.join(format!("{}.json", id));
        
        if !file_path.exists() {
            return Err(WeaveError::PluginError(format!("Note not found: {}", id)));
        }
        
        let content = std::fs::read_to_string(&file_path)?;
        let note: Note = serde_json::from_str(&content)
            .map_err(|e| WeaveError::Serialization(e.to_string()))?;
        
        Ok(json!({
            "note": {
                "id": note.id,
                "title": note.title,
                "content": note.content,
                "created_at": note.created_at.timestamp(),
                "updated_at": note.updated_at.timestamp(),
                "tags": note.tags,
            },
            "success": true
        }))
    }

    fn update(params: Value) -> Result<Value, WeaveError> {
        let id = params.get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| WeaveError::PluginError("Missing 'id' parameter".to_string()))?;
        
        let notes_dir = AppConfig::notes_dir()?;
        let file_path = notes_dir.join(format!("{}.json", id));
        
        if !file_path.exists() {
            return Err(WeaveError::PluginError(format!("Note not found: {}", id)));
        }
        
        let content = std::fs::read_to_string(&file_path)?;
        let mut note: Note = serde_json::from_str(&content)
            .map_err(|e| WeaveError::Serialization(e.to_string()))?;
        
        if let Some(new_title) = params.get("title").and_then(|v| v.as_str()) {
            note.title = new_title.to_string();
        }
        
        if let Some(new_content) = params.get("content").and_then(|v| v.as_str()) {
            note.content = new_content.to_string();
        }
        
        note.updated_at = Utc::now();
        
        let note_json = serde_json::to_string_pretty(&note)
            .map_err(|e| WeaveError::Serialization(e.to_string()))?;
        std::fs::write(&file_path, note_json)?;
        
        info!("Updated note: {} ({})", note.title, id);
        
        Ok(json!({
            "note": {
                "id": note.id,
                "title": note.title,
                "content": note.content,
                "created_at": note.created_at.timestamp(),
                "updated_at": note.updated_at.timestamp(),
                "tags": note.tags,
            },
            "success": true
        }))
    }

    fn delete(params: Value) -> Result<Value, WeaveError> {
        let id = params.get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| WeaveError::PluginError("Missing 'id' parameter".to_string()))?;
        
        let notes_dir = AppConfig::notes_dir()?;
        let file_path = notes_dir.join(format!("{}.json", id));
        
        if !file_path.exists() {
            return Err(WeaveError::PluginError(format!("Note not found: {}", id)));
        }
        
        std::fs::remove_file(&file_path)?;
        
        info!("Deleted note: {}", id);
        
        Ok(json!({
            "deleted_id": id,
            "success": true
        }))
    }
}
