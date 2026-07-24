pub mod capabilities;
pub mod filesystem;
pub mod history;
pub mod parser;
pub mod patch;
pub mod process;
pub mod project_detector;
pub mod security;

use serde_json::Value;
use crate::models::plugin::PluginExecutor;
use crate::utils::errors::WeaveError;

pub struct CoderPlugin;

impl PluginExecutor for CoderPlugin {
    fn execute(&self, capability: &str, params: Value, _ctx: &runtime_kernel::execution_context::ExecutionContext) -> Result<Value, WeaveError> {
        capabilities::route_capability(capability, params)
    }
}
