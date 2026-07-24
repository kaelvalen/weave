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
    pub fn new(
        artifact_type: &str,
        version: ArtifactVersion,
        source_node: &str,
        payload: T,
    ) -> Self {
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RepositoryData {
    pub url: String,
    pub branch: Option<String>,
    pub commit_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SourceTreeData {
    pub root_path: String,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SummaryData {
    pub text: String,
    pub insights: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ArtifactPayload {
    Repository(RepositoryData),
    SourceTree(SourceTreeData),
    Summary(SummaryData),
    Markdown(String),
    Json(serde_json::Value),
}

impl ArtifactPayload {
    pub fn as_json(&self) -> Option<&serde_json::Value> {
        if let Self::Json(val) = self {
            Some(val)
        } else {
            None
        }
    }
}

pub type ExecutionArtifact = Artifact<ArtifactPayload>;
