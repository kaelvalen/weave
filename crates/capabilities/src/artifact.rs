use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Artifact {
    pub id: String,
    pub artifact_type: String,
    pub source_node: String,
    pub payload: serde_json::Value,
    pub metadata: std::collections::HashMap<String, String>,
}

impl Artifact {
    pub fn new(artifact_type: &str, source_node: &str, payload: serde_json::Value) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            artifact_type: artifact_type.to_string(),
            source_node: source_node.to_string(),
            payload,
            metadata: std::collections::HashMap::new(),
        }
    }

    pub fn with_metadata(mut self, key: &str, value: &str) -> Self {
        self.metadata.insert(key.to_string(), value.to_string());
        self
    }
}
