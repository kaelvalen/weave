use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtifactVersion {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Artifact<T> {
    pub id: String,
    pub artifact_type: String,
    pub version: ArtifactVersion,
    pub source_node: String,
    pub payload: T,
    pub metadata: std::collections::HashMap<String, String>,
}

impl<T> Artifact<T> {
    pub fn new(artifact_type: &str, version: ArtifactVersion, source_node: &str, payload: T) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            artifact_type: artifact_type.to_string(),
            version,
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
