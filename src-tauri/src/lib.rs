use parking_lot::RwLock;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use tokio::process::Child;
use tracing::info;

pub mod commands;
pub mod core;
pub mod models;
pub mod plugins;
pub mod runtime;
pub mod utils;

use core::ai_bridge::AiBridge;
use core::capability_registry::CapabilityRegistry;
use core::event_bus::EventBus;
use core::execution_context::ExecutionContext;
use core::memory::memory_engine::MemoryEngine;
use core::planner::planner_engine::PlannerEngine;
use core::plugin_manager::PluginManager;
use core::policy_engine::PolicyEngine;
use core::tool_registry::PluginRegistry;
use core::workflow::workflow_engine::WorkflowEngine;
use models::chat::ChatMessage;
use utils::config::AppConfig;
use utils::errors::WeaveError;

pub struct AppState {
    pub plugin_manager: Arc<PluginManager>,
    pub ai_bridge: Arc<AiBridge>,
    pub event_bus: Arc<EventBus>,
    pub tool_registry: Arc<PluginRegistry>,
    pub capability_registry: Arc<CapabilityRegistry>,
    pub policy_engine: Arc<PolicyEngine>,
    pub planner_engine: Arc<PlannerEngine>,
    pub workflow_engine: Arc<WorkflowEngine>,
    pub memory_engine: Arc<MemoryEngine>,
    pub config: Arc<RwLock<AppConfig>>,
    pub chat_history: Arc<RwLock<Vec<ChatMessage>>>,
    pub abort_generation: Arc<AtomicBool>,
    pub canvas_tx: tokio::sync::broadcast::Sender<serde_json::Value>,
    pub local_server: Arc<tokio::sync::Mutex<Option<Child>>>,
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

        let (canvas_tx, _) = tokio::sync::broadcast::channel(100);

        let plugin_manager = Arc::new(PluginManager::new(plugin_dir.clone(), canvas_tx.clone()));
        let ai_bridge = Arc::new(AiBridge::new(ai_config_arc));
        let event_bus = Arc::new(EventBus::new(1000));
        let tool_registry = Arc::new(PluginRegistry::new());

        let policy_engine = Arc::new(PolicyEngine::default_engine());
        let capability_registry = Arc::new(CapabilityRegistry::new(plugin_dir.clone(), policy_engine.clone()));
        let planner_engine = Arc::new(PlannerEngine::new(capability_registry.clone()));
        let workflow_engine = Arc::new(WorkflowEngine::new(capability_registry.clone()));
        let memory_engine = Arc::new(MemoryEngine::default_engine());

        let _ = plugin_manager.discover();

        info!("Weave application state initialized successfully");

        Ok(Self {
            plugin_manager,
            ai_bridge,
            event_bus,
            tool_registry,
            capability_registry,
            policy_engine,
            planner_engine,
            workflow_engine,
            memory_engine,
            config: config_arc,
            chat_history: Arc::new(RwLock::new(Vec::new())),
            abort_generation: Arc::new(AtomicBool::new(false)),
            canvas_tx,
            local_server: Arc::new(tokio::sync::Mutex::new(None)),
        })
    }

    pub fn create_execution_context(&self, session_id: &str) -> ExecutionContext {
        let workspace = std::env::current_dir().unwrap_or_default();

        ExecutionContext::new(
            session_id.to_string(),
            workspace,
            self.config.clone(),
            self.event_bus.clone(),
        )
    }
}
