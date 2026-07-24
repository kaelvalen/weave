use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum KernelError {
    #[error("Plugin error: {0}")]
    PluginError(String),
    #[error("Permission denied: {0}")]
    PermissionDenied(String),
    #[error("Event error: {0}")]
    EventError(String),
    #[error("Subsystem error: {0}")]
    SubsystemError(String),
    #[error("Internal error: {0}")]
    InternalError(String),
}

/// Shared error type used across the Weave workspace crates.
///
/// Mirrors the variant set historically defined in the app's
/// `utils::errors` module so moved modules keep their signatures.
#[derive(Debug, Error, Clone, Serialize, Deserialize)]
pub enum WeaveError {
    #[error("Plugin error: {0}")]
    PluginError(String),
    #[error("AI API error: {0}")]
    AiApiError(String),
    #[error("AI error: {0}")]
    AiError(String),
    #[error("Planner error: {0}")]
    PlannerError(String),
    #[error("Execution error: {0}")]
    ExecutionError(String),
    #[error("Invalid manifest: {0}")]
    InvalidManifest(String),
    #[error("Capability not found: {0}")]
    CapabilityNotFound(String),
    #[error("Sandbox violation: {0}")]
    SandboxViolation(String),
    #[error("IO error: {0}")]
    Io(String),
    #[error("Serialization error: {0}")]
    Serialization(String),
    #[error("TOML parse error: {0}")]
    TomlParse(String),
    #[error("HTTP error: {0}")]
    Http(String),
    #[error("Plugin not found: {0}")]
    PluginNotFound(String),
    #[error("Plugin already loaded: {0}")]
    PluginAlreadyLoaded(String),
    #[error("Config error: {0}")]
    ConfigError(String),
    #[error("Workflow error: {0}")]
    WorkflowError(String),
    #[error("Intent error: {0}")]
    IntentError(String),
    #[error("WASM error: {0}")]
    WasmError(String),
    #[error("API key not configured for {0}")]
    ApiKeyNotConfigured(String),
    #[error("Stream error: {0}")]
    StreamError(String),
    #[error("Local LLM not available: {0}")]
    LocalLlmNotAvailable(String),
    #[error("Timeout error: {0}")]
    TimeoutError(String),
    #[error("Parse error: {0}")]
    ParseError(String),
    #[error("Permission denied: {0}")]
    PermissionDenied(String),
}

impl From<std::io::Error> for WeaveError {
    fn from(err: std::io::Error) -> Self {
        WeaveError::Io(err.to_string())
    }
}

impl From<serde_json::Error> for WeaveError {
    fn from(err: serde_json::Error) -> Self {
        WeaveError::Serialization(err.to_string())
    }
}

impl From<std::time::SystemTimeError> for WeaveError {
    fn from(err: std::time::SystemTimeError) -> Self {
        WeaveError::Io(err.to_string())
    }
}
