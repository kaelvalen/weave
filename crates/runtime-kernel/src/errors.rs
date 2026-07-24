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
