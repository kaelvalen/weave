use std::path::PathBuf;
use std::sync::Arc;
use plugin_runtime::plugin_manager::PluginManager;
use crate::models::plugin::Plugin;
use crate::utils::errors::WeaveError;

pub struct PluginRuntime {
    manager: Arc<PluginManager>,
}

impl PluginRuntime {
    pub fn new(manager: Arc<PluginManager>) -> Self {
        Self { manager }
    }

    pub fn discover_and_load(&self) -> Result<Vec<Plugin>, WeaveError> {
        self.manager.discover()
    }

    pub fn plugin_dir(&self) -> PathBuf {
        self.manager.plugin_dir()
    }
}
