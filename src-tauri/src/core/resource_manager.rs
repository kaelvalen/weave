use memory_stats::memory_stats;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceBudget {
    pub max_cpu_percent: f32,
    pub max_gpu_vram_mb: usize,
    pub max_ram_mb: usize,
    pub max_token_budget: usize,
    pub max_latency_budget_ms: u64,
}

impl Default for ResourceBudget {
    fn default() -> Self {
        Self {
            max_cpu_percent: 80.0,
            max_gpu_vram_mb: 8192,
            max_ram_mb: 4096,
            max_token_budget: 100_000,
            max_latency_budget_ms: 30_000,
        }
    }
}

pub struct ResourceManager {
    active_tasks: Arc<AtomicUsize>,
    max_concurrency: usize,
    budget: ResourceBudget,
}

impl ResourceManager {
    pub fn new(max_concurrency: usize, budget: ResourceBudget) -> Self {
        Self {
            active_tasks: Arc::new(AtomicUsize::new(0)),
            max_concurrency,
            budget,
        }
    }

    pub fn default_manager() -> Self {
        Self::new(10, ResourceBudget::default())
    }

    pub fn acquire_slot(&self) -> bool {
        let current = self.active_tasks.load(Ordering::Relaxed);
        if current >= self.max_concurrency {
            return false;
        }

        self.active_tasks.fetch_add(1, Ordering::SeqCst);
        true
    }

    pub fn release_slot(&self) {
        self.active_tasks.fetch_sub(1, Ordering::SeqCst);
    }

    pub fn active_tasks(&self) -> usize {
        self.active_tasks.load(Ordering::Relaxed)
    }

    pub fn current_physical_memory_mb(&self) -> Option<usize> {
        memory_stats().map(|usage| usage.physical_mem / (1024 * 1024))
    }

    pub fn is_within_ram_budget(&self) -> bool {
        if let Some(mem_mb) = self.current_physical_memory_mb() {
            mem_mb <= self.budget.max_ram_mb
        } else {
            true
        }
    }

    pub fn get_budget(&self) -> ResourceBudget {
        self.budget.clone()
    }
}
