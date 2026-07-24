use crate::typed_contract::{ArtifactVersion, CapabilityError};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Capability {
    pub id: String,
    pub version: ArtifactVersion,
    pub required_permissions: Vec<String>,
    pub constraints: Vec<String>,
    pub effects: Vec<String>,
}

impl Capability {
    pub fn new(
        id: &str,
        version: ArtifactVersion,
        perms: Vec<String>,
        constraints: Vec<String>,
        effects: Vec<String>,
    ) -> Self {
        Self {
            id: id.to_string(),
            version,
            required_permissions: perms,
            constraints,
            effects,
        }
    }

    pub fn serialize_input<I: Serialize>(&self, input: &I) -> Result<Vec<u8>, CapabilityError> {
        serde_json::to_vec(input).map_err(|e| CapabilityError::Serialization(e.to_string()))
    }

    pub fn deserialize_input<'a, I: Deserialize<'a>>(
        &self,
        data: &'a [u8],
    ) -> Result<I, CapabilityError> {
        serde_json::from_slice(data).map_err(|e| CapabilityError::Serialization(e.to_string()))
    }
}
