use parking_lot::RwLock;
use std::sync::Arc;
use tracing::info;

pub mod commands;
pub mod core;
pub mod models;
pub mod plugins;
pub mod runtime;
pub mod utils;

use core::ai_bridge::AiBridge;
use core::intent_engine::IntentEngine;
use core::plugin_manager::PluginManager;
use core::workflow_engine::WorkflowEngine;
use models::chat::ChatMessage;
use utils::config::AppConfig;
use utils::errors::WeaveError;

pub struct AppState {
    pub plugin_manager: Arc<PluginManager>,
    pub ai_bridge: Arc<AiBridge>,
    pub workflow_engine: Arc<WorkflowEngine>,
    pub intent_engine: Arc<IntentEngine>,
    pub config: Arc<RwLock<AppConfig>>,
    pub chat_history: Arc<RwLock<Vec<ChatMessage>>>,
}

impl AppState {
    pub fn new() -> Result<Self, WeaveError> {
        info!("Initializing Weave application state...");

        let config = match AppConfig::load() {
            Ok(cfg) => cfg,
            Err(e) => {
                tracing::warn!("Failed to load config: {}, using defaults", e);
                AppConfig::default()
            }
        };

        let plugin_dir = AppConfig::plugin_dir()?;
        std::fs::create_dir_all(&plugin_dir)?;
        info!("Plugin directory: {:?}", plugin_dir);

        let notes_dir = AppConfig::notes_dir()?;
        std::fs::create_dir_all(&notes_dir)?;
        info!("Notes directory: {:?}", notes_dir);

        let config_arc = Arc::new(RwLock::new(config.clone()));
        let ai_config_arc = Arc::new(RwLock::new(config.ai.clone()));

        let plugin_manager = Arc::new(PluginManager::new(plugin_dir.clone()));
        let ai_bridge = Arc::new(AiBridge::new(ai_config_arc));
        let workflow_engine = Arc::new(WorkflowEngine::new(plugin_manager.clone()));
        let intent_engine = Arc::new(IntentEngine::new());

        let _ = plugin_manager.discover();

        info!("Weave application state initialized successfully");

        Ok(Self {
            plugin_manager,
            ai_bridge,
            workflow_engine,
            intent_engine,
            config: config_arc,
            chat_history: Arc::new(RwLock::new(Vec::new())),
        })
    }
}

// Tauri commands defined in main.rs via generate_handler!
