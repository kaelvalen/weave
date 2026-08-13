use parking_lot::RwLock;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tracing::info;

pub mod agent;
pub mod ai_bridge;
pub mod commands;
pub mod github_plugin;
pub mod mcp_client;
pub mod models;
pub mod plugin_manager;
pub mod plugins;
pub mod runtime;
pub mod utils;

use agent::{AgentLoop, ApprovalRegistry};
use ai_bridge::{AiBridge, ModelTelemetry};
use models::chat::ChatMessage;
use plugin_manager::PluginManager;
use runtime_kernel::event_bus::EventBus;
use runtime_kernel::event_store::EventSourcingStore;
use runtime_kernel::execution_context::ExecutionContext;
use runtime_kernel::observability::Observability;
use runtime_kernel::runtime_event::RuntimeEvent;
use utils::config::AppConfig;
use utils::errors::WeaveError;

pub struct AppState {
    pub plugin_manager: Arc<PluginManager>,
    pub ai_bridge: Arc<AiBridge>,
    pub agent_loop: Arc<AgentLoop>,
    pub approvals: Arc<ApprovalRegistry>,
    pub event_bus: Arc<EventBus>,
    pub event_store: Arc<EventSourcingStore>,
    pub observability: Arc<Observability>,
    pub config: Arc<RwLock<AppConfig>>,
    pub chat_history: Arc<RwLock<Vec<ChatMessage>>>,
    pub abort_generation: Arc<AtomicBool>,
    /// Auto-Approve mode: when true the agent loop skips the approval gate
    /// (set by `chat_set_approval_mode`; frontend "Auto-Approve" toggle).
    pub approval_auto: Arc<AtomicBool>,
    pub canvas_tx: tokio::sync::broadcast::Sender<serde_json::Value>,
    pub model_telemetry: Arc<parking_lot::Mutex<ModelTelemetry>>,
}

impl AppState {
    pub fn new() -> Result<Self, WeaveError> {
        info!("Initializing Weave AI Execution Kernel Platform state...");

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

        let event_bus = Arc::new(EventBus::new(1000));
        let event_store = Arc::new(EventSourcingStore::new());
        let observability = Arc::new(Observability::new());
        let model_telemetry = Arc::new(parking_lot::Mutex::new(ModelTelemetry::default()));

        let plugin_manager = Arc::new(PluginManager::new(plugin_dir.clone(), canvas_tx.clone()));
        let ai_bridge = Arc::new(AiBridge::new(
            ai_config_arc,
            observability.clone(),
            model_telemetry.clone(),
        ));
        let approvals = Arc::new(ApprovalRegistry::new());
        let chat_history: Arc<RwLock<Vec<ChatMessage>>> = Arc::new(RwLock::new(Vec::new()));
        let abort_generation = Arc::new(AtomicBool::new(false));
        let approval_auto = Arc::new(AtomicBool::new(false));
        let agent_loop = Arc::new(AgentLoop {
            ai_bridge: ai_bridge.clone(),
            plugin_manager: plugin_manager.clone(),
            approvals: approvals.clone(),
            config: config_arc.clone(),
            chat_history: chat_history.clone(),
            abort: abort_generation.clone(),
            approval_auto: approval_auto.clone(),
            event_bus: event_bus.clone(),
            observability: observability.clone(),
            event_store: event_store.clone(),
        });

        let _ = plugin_manager.discover();
        plugin_manager.restore_mcp_servers(&config.mcp_servers);

        info!("Weave AI Execution Kernel Platform state initialized successfully");

        Ok(Self {
            plugin_manager,
            ai_bridge,
            agent_loop,
            approvals,
            event_bus,
            event_store,
            observability,
            config: config_arc,
            chat_history,
            abort_generation,
            approval_auto,
            canvas_tx,
            model_telemetry,
        })
    }

    pub fn create_execution_context(&self, session_id: &str) -> ExecutionContext {
        let workspace = std::env::current_dir().unwrap_or_default();
        let config_json = Arc::new(RwLock::new(
            serde_json::to_value(&*self.config.read()).unwrap_or_default(),
        ));

        ExecutionContext::new(
            session_id.to_string(),
            workspace,
            config_json,
            self.event_bus.clone(),
        )
        .with_subsystems(self.observability.clone(), self.event_store.clone())
    }

    /// Bridge structured runtime events from the kernel event bus to the
    /// frontend as Tauri `runtime-event` emissions. Also persists each event
    /// as a JSON line under `<app_data_dir>/traces/events.jsonl` so traces can
    /// be queried later. Spawns a background task; call once during app setup.
    pub fn spawn_runtime_event_bridge(&self, app_handle: tauri::AppHandle) {
        use tauri::Emitter;
        use tauri::Manager;

        let traces_dir = app_handle
            .path()
            .app_data_dir()
            .ok()
            .map(|dir| dir.join("traces"));

        let mut rx = self.event_bus.subscribe_runtime();
        tauri::async_runtime::spawn(async move {
            loop {
                match rx.recv().await {
                    Ok(event) => {
                        if let Some(ref dir) = traces_dir {
                            persist_runtime_event(dir, &event);
                        }
                        if let Err(e) = app_handle.emit("runtime-event", &event) {
                            tracing::warn!("Failed to emit runtime-event to frontend: {}", e);
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                        tracing::warn!("Runtime event bridge lagged, skipped {} events", skipped);
                        continue;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        });
    }
}

/// Rotate the trace log once it grows past this size.
const MAX_TRACE_FILE_BYTES: u64 = 8 * 1024 * 1024;
/// Number of lines kept when the trace log is rotated.
const TRACE_ROTATION_KEEP_LINES: usize = 10_000;

/// Best-effort trace persistence — never panics, never propagates errors.
fn persist_runtime_event(traces_dir: &std::path::Path, event: &RuntimeEvent) {
    if let Err(e) = persist_runtime_event_inner(traces_dir, event) {
        tracing::warn!("Failed to persist runtime event trace: {}", e);
    }
}

fn persist_runtime_event_inner(
    traces_dir: &std::path::Path,
    event: &RuntimeEvent,
) -> std::io::Result<()> {
    use std::io::Write;

    std::fs::create_dir_all(traces_dir)?;
    let path = traces_dir.join("events.jsonl");

    let line = serde_json::to_string(event)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;

    {
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)?;
        writeln!(file, "{}", line)?;
    }

    // Rotate when the file grows too large: keep only the most recent lines.
    if std::fs::metadata(&path)?.len() > MAX_TRACE_FILE_BYTES {
        let content = std::fs::read_to_string(&path)?;
        let lines: Vec<&str> = content.lines().collect();
        let start = lines.len().saturating_sub(TRACE_ROTATION_KEEP_LINES);
        let mut kept = lines[start..].join("\n");
        kept.push('\n');
        std::fs::write(&path, kept)?;
    }

    Ok(())
}
