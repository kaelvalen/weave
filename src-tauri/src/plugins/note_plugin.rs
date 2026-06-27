use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tracing::{info, warn};

use crate::models::plugin::PluginExecutor;
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

impl PluginExecutor for NotePlugin {
    fn execute(&self, capability: &str, params: Value) -> Result<Value, WeaveError> {
        NotePlugin::execute(capability, params)
    }
}

impl NotePlugin {
    pub fn execute(capability: &str, params: Value) -> Result<Value, WeaveError> {
        match capability {
            "note.create" => Self::create(params),
            "note.list" => Self::list(),
            "note.get" => Self::get(params),
            "note.update" => Self::update(params),
            "note.delete" => Self::delete(params),
            "note.search" => Self::search(params),
            _ => Err(WeaveError::CapabilityNotFound(capability.to_string())),
        }
    }

    fn note_to_json(note: &Note) -> Value {
        json!({
            "id": note.id, "title": note.title, "content": note.content,
            "created_at": note.created_at.timestamp(), "updated_at": note.updated_at.timestamp(),
            "tags": note.tags,
        })
    }

    fn create(params: Value) -> Result<Value, WeaveError> {
        let title = params.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled Note");
        let content = params.get("content").and_then(|v| v.as_str()).unwrap_or("");
        let tags: Vec<String> = params.get("tags").and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
            .unwrap_or_default();

        let notes_dir = AppConfig::notes_dir()?;
        std::fs::create_dir_all(&notes_dir)?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now();
        let note = Note { id: id.clone(), title: title.to_string(), content: content.to_string(), created_at: now, updated_at: now, tags };
        let file_path = notes_dir.join(format!("{}.json", id));
        let note_json = serde_json::to_string_pretty(&note).map_err(|e| WeaveError::Serialization(e.to_string()))?;
        std::fs::write(&file_path, note_json)?;
        info!("Created note: {} ({}) in {:?}", title, id, file_path);
        Ok(json!({"note": Self::note_to_json(&note), "success": true}))
    }

    fn list() -> Result<Value, WeaveError> {
        let notes = Self::load_all_notes()?;
        let note_jsons: Vec<Value> = notes.iter().map(|n| Self::note_to_json(n)).collect();
        info!("Listed {} notes", note_jsons.len());
        Ok(json!({"notes": note_jsons, "count": note_jsons.len(), "success": true}))
    }

    fn get(params: Value) -> Result<Value, WeaveError> {
        let id = params.get("id").and_then(|v| v.as_str())
            .ok_or_else(|| WeaveError::PluginError("Missing 'id' parameter".to_string()))?;
        let notes_dir = AppConfig::notes_dir()?;
        let file_path = notes_dir.join(format!("{}.json", id));
        if !file_path.exists() { return Err(WeaveError::PluginError(format!("Note not found: {}", id))); }
        let content = std::fs::read_to_string(&file_path)?;
        let note: Note = serde_json::from_str(&content).map_err(|e| WeaveError::Serialization(e.to_string()))?;
        Ok(json!({"note": Self::note_to_json(&note), "success": true}))
    }

    fn update(params: Value) -> Result<Value, WeaveError> {
        let id = params.get("id").and_then(|v| v.as_str())
            .ok_or_else(|| WeaveError::PluginError("Missing 'id' parameter".to_string()))?;
        let notes_dir = AppConfig::notes_dir()?;
        let file_path = notes_dir.join(format!("{}.json", id));
        if !file_path.exists() { return Err(WeaveError::PluginError(format!("Note not found: {}", id))); }
        let content = std::fs::read_to_string(&file_path)?;
        let mut note: Note = serde_json::from_str(&content).map_err(|e| WeaveError::Serialization(e.to_string()))?;
        if let Some(t) = params.get("title").and_then(|v| v.as_str()) { note.title = t.to_string(); }
        if let Some(c) = params.get("content").and_then(|v| v.as_str()) { note.content = c.to_string(); }
        if let Some(tags) = params.get("tags").and_then(|v| v.as_array()) {
            note.tags = tags.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect();
        }
        note.updated_at = Utc::now();
        let note_json = serde_json::to_string_pretty(&note).map_err(|e| WeaveError::Serialization(e.to_string()))?;
        std::fs::write(&file_path, note_json)?;
        info!("Updated note: {} ({})", note.title, id);
        Ok(json!({"note": Self::note_to_json(&note), "success": true}))
    }

    fn delete(params: Value) -> Result<Value, WeaveError> {
        let id = params.get("id").and_then(|v| v.as_str())
            .ok_or_else(|| WeaveError::PluginError("Missing 'id' parameter".to_string()))?;
        let notes_dir = AppConfig::notes_dir()?;
        let file_path = notes_dir.join(format!("{}.json", id));
        if !file_path.exists() { return Err(WeaveError::PluginError(format!("Note not found: {}", id))); }
        std::fs::remove_file(&file_path)?;
        info!("Deleted note: {}", id);
        Ok(json!({"deleted_id": id, "success": true}))
    }

    fn search(params: Value) -> Result<Value, WeaveError> {
        let query = params.get("query").and_then(|v| v.as_str())
            .ok_or_else(|| WeaveError::PluginError("Missing 'query' parameter".to_string()))?;
        let query_lower = query.to_lowercase();
        let notes = Self::load_all_notes()?;
        let matches: Vec<Value> = notes.iter()
            .filter(|n| n.title.to_lowercase().contains(&query_lower) || n.content.to_lowercase().contains(&query_lower) || n.tags.iter().any(|t| t.to_lowercase().contains(&query_lower)))
            .map(|n| Self::note_to_json(n))
            .collect();
        info!("Search '{}': {} matches", query, matches.len());
        Ok(json!({"query": query, "results": matches, "count": matches.len(), "success": true}))
    }

    fn load_all_notes() -> Result<Vec<Note>, WeaveError> {
        let notes_dir = AppConfig::notes_dir()?;
        if !notes_dir.exists() { return Ok(Vec::new()); }
        let mut notes = Vec::new();
        for entry in std::fs::read_dir(&notes_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                match std::fs::read_to_string(&path) {
                    Ok(content) => match serde_json::from_str::<Note>(&content) {
                        Ok(note) => notes.push(note),
                        Err(e) => { warn!("Failed to parse note at {:?}: {}", path, e); }
                    },
                    Err(e) => { warn!("Failed to read note at {:?}: {}", path, e); }
                }
            }
        }
        notes.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(notes)
    }
}
