use parking_lot::RwLock;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tracing::{debug, error, info, warn};

use crate::models::manifest::Manifest;
use crate::models::plugin::*;
use crate::plugins::calc_plugin::CalcPlugin;
use crate::plugins::file_plugin::FilePlugin;
use crate::plugins::note_plugin::NotePlugin;
use crate::utils::errors::WeaveError;

pub struct PluginManager {
    plugins: Arc<RwLock<HashMap<String, Plugin>>>,
    builtin: Vec<Plugin>,
    plugin_dir: PathBuf,
}

impl PluginManager {
    pub fn new(plugin_dir: PathBuf) -> Self {
        let builtin = Self::create_builtin_plugins();
        let mut plugins = HashMap::new();
        
        for plugin in &builtin {
            let mut p = plugin.clone();
            p.state = PluginState::Active;
            plugins.insert(p.id.clone(), p);
            info!("Registered built-in plugin: {} ({})", p.name, p.id);
        }

        let manager = Self {
            plugins: Arc::new(RwLock::new(plugins)),
            builtin,
            plugin_dir,
        };
        
        manager
    }

    pub fn create_builtin_plugins() -> Vec<Plugin> {
        vec![
            Plugin {
                id: "com.weave.builtin.file".to_string(),
                name: "File Manager".to_string(),
                version: "0.1.0".to_string(),
                author: "Weave Team".to_string(),
                description: "File system operations with sandboxed access".to_string(),
                capabilities: Capabilities {
                    read: vec!["file://*".to_string()],
                    write: vec!["file://*".to_string()],
                    provide: vec![
                        "file.read".to_string(),
                        "file.write".to_string(),
                        "file.list".to_string(),
                        "file.search".to_string(),
                    ],
                },
                runtime: RuntimeConfig {
                    runtime_type: RuntimeType::Builtin,
                    entry: String::new(),
                    sandbox: SandboxLevel::Strict,
                },
                ui: PluginUiConfig {
                    ui_type: UiType::Native,
                    entry: String::new(),
                },
                state: PluginState::Active,
                path: None,
                is_builtin: true,
                category: PluginCategory::System,
            },
            Plugin {
                id: "com.weave.builtin.calc".to_string(),
                name: "Calculator".to_string(),
                version: "0.1.0".to_string(),
                author: "Weave Team".to_string(),
                description: "Mathematical expression evaluator and unit converter".to_string(),
                capabilities: Capabilities {
                    read: Vec::new(),
                    write: Vec::new(),
                    provide: vec![
                        "calc.eval".to_string(),
                        "calc.convert".to_string(),
                    ],
                },
                runtime: RuntimeConfig {
                    runtime_type: RuntimeType::Builtin,
                    entry: String::new(),
                    sandbox: SandboxLevel::Strict,
                },
                ui: PluginUiConfig {
                    ui_type: UiType::Native,
                    entry: String::new(),
                },
                state: PluginState::Active,
                path: None,
                is_builtin: true,
                category: PluginCategory::Productivity,
            },
            Plugin {
                id: "com.weave.builtin.note".to_string(),
                name: "Notes".to_string(),
                version: "0.1.0".to_string(),
                author: "Weave Team".to_string(),
                description: "Note taking and management".to_string(),
                capabilities: Capabilities {
                    read: Vec::new(),
                    write: Vec::new(),
                    provide: vec![
                        "note.create".to_string(),
                        "note.list".to_string(),
                        "note.get".to_string(),
                        "note.update".to_string(),
                        "note.delete".to_string(),
                    ],
                },
                runtime: RuntimeConfig {
                    runtime_type: RuntimeType::Builtin,
                    entry: String::new(),
                    sandbox: SandboxLevel::Strict,
                },
                ui: PluginUiConfig {
                    ui_type: UiType::Native,
                    entry: String::new(),
                },
                state: PluginState::Active,
                path: None,
                is_builtin: true,
                category: PluginCategory::Productivity,
            },
        ]
    }

    pub fn discover(&self) -> Result<Vec<Plugin>, WeaveError> {
        let mut all_plugins = self.builtin.clone();
        
        if !self.plugin_dir.exists() {
            std::fs::create_dir_all(&self.plugin_dir)?;
            return Ok(all_plugins);
        }

        let entries = std::fs::read_dir(&self.plugin_dir)?;
        
        for entry in entries {
            let entry = entry?;
            let path = entry.path();
            
            if path.extension().and_then(|s| s.to_str()) == Some("wpk") {
                match self.load_wpk_plugin(&path) {
                    Ok(plugin) => {
                        if !all_plugins.iter().any(|p| p.id == plugin.id) {
                            all_plugins.push(plugin);
                        }
                    }
                    Err(e) => {
                        warn!("Failed to load .wpk plugin at {:?}: {}", path, e);
                    }
                }
            } else if path.is_dir() {
                let manifest_path = path.join("manifest.toml");
                if manifest_path.exists() {
                    match self.load_directory_plugin(&path) {
                        Ok(plugin) => {
                            if !all_plugins.iter().any(|p| p.id == plugin.id) {
                                all_plugins.push(plugin);
                            }
                        }
                        Err(e) => {
                            warn!("Failed to load plugin at {:?}: {}", path, e);
                        }
                    }
                }
            }
        }

        let mut plugins = self.plugins.write();
        for plugin in &all_plugins {
            if !plugins.contains_key(&plugin.id) {
                plugins.insert(plugin.id.clone(), plugin.clone());
            }
        }

        info!("Discovered {} plugins total", all_plugins.len());
        Ok(all_plugins)
    }

    fn load_wpk_plugin(&self, path: &PathBuf) -> Result<Plugin, WeaveError> {
        let file = std::fs::File::open(path)?;
        let mut archive = zip::ZipArchive::new(file)?;
        
        let mut manifest_content = String::new();
        {
            let mut manifest_file = archive.by_name("manifest.toml")
                .map_err(|_| WeaveError::InvalidManifest("manifest.toml not found in .wpk".to_string()))?;
            use std::io::Read;
            manifest_file.read_to_string(&mut manifest_content)?;
        }
        
        let manifest = Manifest::from_toml(&manifest_content)?;
        let mut plugin = manifest.to_plugin(Some(path.clone()), false);
        plugin.state = PluginState::Discovered;
        
        Ok(plugin)
    }

    fn load_directory_plugin(&self, path: &PathBuf) -> Result<Plugin, WeaveError> {
        let manifest_path = path.join("manifest.toml");
        let content = std::fs::read_to_string(&manifest_path)?;
        let manifest = Manifest::from_toml(&content)?;
        let mut plugin = manifest.to_plugin(Some(path.clone()), false);
        plugin.state = PluginState::Discovered;
        
        Ok(plugin)
    }

    pub fn load(&self, plugin_id: &str) -> Result<Plugin, WeaveError> {
        let mut plugins = self.plugins.write();
        
        let plugin = plugins.get_mut(plugin_id)
            .ok_or_else(|| WeaveError::PluginNotFound(plugin_id.to_string()))?;
        
        if plugin.is_loaded() {
            return Err(WeaveError::PluginAlreadyLoaded(plugin_id.to_string()));
        }

        plugin.state = PluginState::Loaded;
        info!("Loaded plugin: {} ({})", plugin.name, plugin.id);
        
        Ok(plugin.clone())
    }

    pub fn activate(&self, plugin_id: &str) -> Result<Plugin, WeaveError> {
        let mut plugins = self.plugins.write();
        
        let plugin = plugins.get_mut(plugin_id)
            .ok_or_else(|| WeaveError::PluginNotFound(plugin_id.to_string()))?;
        
        plugin.state = PluginState::Active;
        info!("Activated plugin: {} ({})", plugin.name, plugin.id);
        
        Ok(plugin.clone())
    }

    pub fn unload(&self, plugin_id: &str) -> Result<(), WeaveError> {
        let mut plugins = self.plugins.write();
        
        let plugin = plugins.get_mut(plugin_id)
            .ok_or_else(|| WeaveError::PluginNotFound(plugin_id.to_string()))?;
        
        if plugin.is_builtin {
            return Err(WeaveError::PluginError(
                "Cannot unload built-in plugins".to_string()
            ));
        }

        plugin.state = PluginState::Unloaded;
        info!("Unloaded plugin: {} ({})", plugin.name, plugin.id);
        
        Ok(())
    }

    pub fn get_all(&self) -> Vec<Plugin> {
        self.plugins.read().values().cloned().collect()
    }

    pub fn get_loaded(&self) -> Vec<Plugin> {
        self.plugins.read().values()
            .filter(|p| p.is_loaded() || p.is_active())
            .cloned()
            .collect()
    }

    pub fn get_plugin(&self, plugin_id: &str) -> Option<Plugin> {
        self.plugins.read().get(plugin_id).cloned()
    }

    pub fn execute_capability(
        &self,
        plugin_id: &str,
        capability: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, WeaveError> {
        let plugin = self.get_plugin(plugin_id)
            .ok_or_else(|| WeaveError::PluginNotFound(plugin_id.to_string()))?;
        
        if !plugin.has_capability(capability) {
            return Err(WeaveError::CapabilityNotFound(
                format!("{} does not provide '{}'", plugin_id, capability)
            ));
        }

        info!("Executing capability: {}::{} with params: {:?}", plugin_id, capability, params);

        match plugin_id {
            "com.weave.builtin.file" => FilePlugin::execute(capability, params),
            "com.weave.builtin.calc" => CalcPlugin::execute(capability, params),
            "com.weave.builtin.note" => NotePlugin::execute(capability, params),
            _ => Err(WeaveError::PluginError(
                format!("Execution not implemented for plugin: {}", plugin_id)
            )),
        }
    }

    pub fn find_plugins_for_capability(&self, capability: &str) -> Vec<Plugin> {
        self.plugins.read().values()
            .filter(|p| p.has_capability(capability))
            .cloned()
            .collect()
    }
}
