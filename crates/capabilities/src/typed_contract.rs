use serde::{Deserialize, Serialize};
use std::fmt::Debug;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CapabilityError {
    #[error("Validation failed: {0}")]
    Validation(String),
    #[error("Incompatible version. Expected {0}, got {1}")]
    Compatibility(String, String),
    #[error("Migration failed: {0}")]
    Migration(String),
    #[error("Serialization error: {0}")]
    Serialization(String),
}

/// Represents the version of a capability's contract.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArtifactVersion {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
}

impl ArtifactVersion {
    pub fn is_compatible_with(&self, other: &ArtifactVersion) -> bool {
        self.major == other.major && self.minor <= other.minor
    }
}
