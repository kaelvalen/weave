use serde::{Deserialize, Serialize};
use crate::typed_contract::{ArtifactVersion, Validation, CapabilityError};

pub trait Constraint {
    fn is_satisfied(&self) -> bool;
}

pub trait Effect {
    fn describe(&self) -> String;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Capability<I, O, C, E>
where
    I: Validation + Serialize + for<'de> Deserialize<'de>,
    O: Validation + Serialize + for<'de> Deserialize<'de>,
    C: Constraint + Serialize + for<'de> Deserialize<'de>,
    E: Effect + Serialize + for<'de> Deserialize<'de>,
{
    pub id: String,
    pub version: ArtifactVersion,
    pub required_permissions: Vec<String>,
    pub constraints: Vec<C>,
    pub effects: Vec<E>,
    _phantom: std::marker::PhantomData<(I, O)>,
}

impl<I, O, C, E> Capability<I, O, C, E>
where
    I: Validation + Serialize + for<'de> Deserialize<'de>,
    O: Validation + Serialize + for<'de> Deserialize<'de>,
    C: Constraint + Serialize + for<'de> Deserialize<'de>,
    E: Effect + Serialize + for<'de> Deserialize<'de>,
{
    pub fn new(id: &str, version: ArtifactVersion, perms: Vec<String>, constraints: Vec<C>, effects: Vec<E>) -> Self {
        Self {
            id: id.to_string(),
            version,
            required_permissions: perms,
            constraints,
            effects,
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
}
