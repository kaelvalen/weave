use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceSnapshot {
    pub active_tasks: usize,
    pub ram_used_mb: u64,
}

pub struct ResourceManager {
    active_tasks: Arc<AtomicUsize>,
    max_concurrency: usize,
}

impl ResourceManager {
    pub fn new(max_concurrency: usize) -> Self {
        Self {
            active_tasks: Arc::new(AtomicUsize::new(0)),
            max_concurrency,
        }
    }

    pub fn default_manager() -> Self {
        Self::new(10)
    }

    pub fn acquire_task_slot(&self) -> bool {
        let current = self.active_tasks.load(Ordering::Relaxed);
        if current >= self.max_concurrency {
            false
        } else {
            self.active_tasks.fetch_add(1, Ordering::Relaxed);
            true
        }
    }

    pub fn release_task_slot(&self) {
        self.active_tasks.fetch_sub(1, Ordering::Relaxed);
    }

    pub fn get_snapshot(&self) -> ResourceSnapshot {
        let mem = memory_stats::memory_stats();
        let ram_mb = mem.map(|m| (m.physical_mem / (1024 * 1024)) as u64).unwrap_or(0);

        ResourceSnapshot {
            active_tasks: self.active_tasks.load(Ordering::Relaxed),
            ram_used_mb: ram_mb,
        }
    }
}
