use std::path::{Path, PathBuf};
use tracing::info;

use crate::models::manifest::Manifest;
use crate::models::plugin::Plugin;
use crate::utils::errors::WeaveError;

pub struct DynamicPluginLoader;

impl DynamicPluginLoader {
    pub fn new() -> Self {
        Self
    }

    pub fn load_manifest(&self, path: &Path) -> Result<Manifest, WeaveError> {
        let content = std::fs::read_to_string(path)?;
        Manifest::from_toml(&content)
    }

    pub fn discover_dir(&self, plugin_dir: &PathBuf) -> Result<Vec<Plugin>, WeaveError> {
        info!("DynamicPluginLoader discovering directory: {:?}", plugin_dir);
        let mut discovered = Vec::new();

        if !plugin_dir.exists() {
            return Ok(discovered);
        }

        for entry in std::fs::read_dir(plugin_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() && path.join("manifest.toml").exists() {
                if let Ok(manifest) = self.load_manifest(&path.join("manifest.toml")) {
                    info!("Discovered plugin via manifest: {}", manifest.plugin.name);
                    discovered.push(manifest.to_plugin(Some(path.clone()), false));
                }
            }
        }

        Ok(discovered)
    }
}
