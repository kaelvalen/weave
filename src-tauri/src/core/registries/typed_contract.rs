use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum DataType {
    String,
    Integer,
    Float,
    Boolean,
    Json,
    Binary,
    Custom(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypedCapabilityContract {
    pub capability_id: String,
    pub input_schema: DataType,
    pub output_schema: DataType,
}

impl TypedCapabilityContract {
    pub fn new(capability_id: impl Into<String>, input: DataType, output: DataType) -> Self {
        Self {
            capability_id: capability_id.into(),
            input_schema: input,
            output_schema: output,
        }
    }

    pub fn validate_connection(src: &DataType, target: &DataType) -> Result<(), String> {
        if src == target || *target == DataType::Json || *src == DataType::Json {
            Ok(())
        } else {
            Err(format!("Dataflow type mismatch: cannot bind output type {:?} to input type {:?}", src, target))
        }
    }
}
