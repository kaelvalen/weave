use crate::models::plugin::Plugin;
use crate::plugin_manager::PluginManager;
use crate::utils::errors::WeaveError;
use std::path::PathBuf;
use std::sync::Arc;

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
