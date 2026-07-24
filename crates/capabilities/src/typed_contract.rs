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

/// Trait for validating capability inputs and outputs.
pub trait Validation {
    fn validate(&self) -> Result<(), CapabilityError>;
}

/// Trait for migrating old data formats to new ones.
pub trait Migration<OldType> {
    fn migrate_from(old: OldType) -> Result<Self, CapabilityError>
    where
        Self: Sized;
}

/// A Capability represents an abstract operation that can be executed.
/// Tools are specific implementations of a Capability.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Capability<I, O> 
where 
    I: Validation + Serialize + for<'de> Deserialize<'de>,
    O: Validation + Serialize + for<'de> Deserialize<'de>,
{
    pub id: String,
    pub version: ArtifactVersion,
    pub required_permissions: Vec<String>,
    _phantom: std::marker::PhantomData<(I, O)>,
}

impl<I, O> Capability<I, O>
where
    I: Validation + Serialize + for<'de> Deserialize<'de>,
    O: Validation + Serialize + for<'de> Deserialize<'de>,
{
    pub fn new(id: &str, version: ArtifactVersion, perms: Vec<String>) -> Self {
        Self {
            id: id.to_string(),
            version,
            required_permissions: perms,
            _phantom: std::marker::PhantomData,
        }
    }

    pub fn serialize_input(&self, input: &I) -> Result<Vec<u8>, CapabilityError> {
        input.validate()?;
        serde_json::to_vec(input).map_err(|e| CapabilityError::Serialization(e.to_string()))
    }

    pub fn deserialize_input(&self, data: &[u8]) -> Result<I, CapabilityError> {
        let input: I = serde_json::from_slice(data).map_err(|e| CapabilityError::Serialization(e.to_string()))?;
        input.validate()?;
        Ok(input)
    }

    pub fn serialize_output(&self, output: &O) -> Result<Vec<u8>, CapabilityError> {
        output.validate()?;
        serde_json::to_vec(output).map_err(|e| CapabilityError::Serialization(e.to_string()))
    }

    pub fn deserialize_output(&self, data: &[u8]) -> Result<O, CapabilityError> {
        let output: O = serde_json::from_slice(data).map_err(|e| CapabilityError::Serialization(e.to_string()))?;
        output.validate()?;
        Ok(output)
    }
}
