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

    pub fn validate_manifest(&self, manifest: &Manifest) -> Result<(), WeaveError> {
        if manifest.plugin.id.is_empty() || manifest.plugin.name.is_empty() {
            return Err(WeaveError::InvalidManifest(
                "Manifest contains empty plugin ID or name".into(),
            ));
        }
        Ok(())
    }

    pub fn health_check(&self, plugin: &Plugin) -> bool {
        plugin.path.as_ref().map(|p| p.exists()).unwrap_or(true)
    }

    pub fn discover_dir(&self, plugin_dir: &PathBuf) -> Result<Vec<Plugin>, WeaveError> {
        info!(
            "DynamicPluginLoader running pipeline on directory: {:?}",
            plugin_dir
        );
        let mut discovered = Vec::new();

        if !plugin_dir.exists() {
            return Ok(discovered);
        }

        for entry in std::fs::read_dir(plugin_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() && path.join("manifest.toml").exists() {
                let manifest_path = path.join("manifest.toml");
                if let Ok(manifest) = self.load_manifest(&manifest_path) {
                    if self.validate_manifest(&manifest).is_ok() {
                        let plugin = manifest.to_plugin(Some(path.clone()), false);
                        if self.health_check(&plugin) {
                            info!(
                                "Validated & published plugin: {} ({})",
                                plugin.name, plugin.id
                            );
                            discovered.push(plugin);
                        }
                    }
                }
            }
        }

        Ok(discovered)
    }
}
