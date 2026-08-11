use crate::execution_context::ExecutionContext;
use crate::subsystem::KernelSubsystem;
use std::sync::Arc;

pub struct Kernel {
    subsystems: Vec<Arc<dyn KernelSubsystem>>,
}

impl Kernel {
    pub fn new() -> Self {
        Self {
            subsystems: Vec::new(),
        }
    }

    pub fn with_subsystem(mut self, subsystem: Arc<dyn KernelSubsystem>) -> Self {
        self.subsystems.push(subsystem);
        self
    }

    pub async fn boot(&self) -> Result<(), String> {
        for sub in &self.subsystems {
            sub.init().await.map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn spawn_agent(&self) {
        // Spawn agent lifecycle
    }

    pub async fn submit_goal(&self, _goal: &str, _ctx: &ExecutionContext) -> Result<(), String> {
        // Here we just delegate to the execution-runtime without knowing its internals.
        // Wait, if Kernel doesn't hold Executor, how does it submit?
        // It could fire an event via EventBus.
        Ok(())
    }

    pub async fn shutdown(&self) {
        // Shutdown logic
    }
}
