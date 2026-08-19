use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ToolMetrics {
    pub call_count: u64,
    pub failure_count: u64,
    pub total_duration_ms: u64,
    pub min_duration_ms: u64,
    pub max_duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ObservabilityMetrics {
    pub total_tool_calls: u64,
    pub total_planner_runs: u64,
    pub total_tokens_consumed: u64,
    pub memory_reads: u64,
    pub memory_hits: u64,
    pub tool_metrics: HashMap<String, ToolMetrics>,
}

#[derive(Clone)]
pub struct Observability {
    metrics: Arc<RwLock<ObservabilityMetrics>>,
}

impl Observability {
    pub fn new() -> Self {
        Self {
            metrics: Arc::new(RwLock::new(ObservabilityMetrics::default())),
        }
    }

    pub fn record_tool_execution(&self, tool_id: &str, duration_ms: u64, success: bool) {
        let mut m = self.metrics.write();
        m.total_tool_calls += 1;

        let entry = m.tool_metrics.entry(tool_id.to_string()).or_default();
        entry.call_count += 1;
        if !success {
            entry.failure_count += 1;
        }
        entry.total_duration_ms += duration_ms;
        if entry.min_duration_ms == 0 || duration_ms < entry.min_duration_ms {
            entry.min_duration_ms = duration_ms;
        }
        if duration_ms > entry.max_duration_ms {
            entry.max_duration_ms = duration_ms;
        }
    }

    pub fn record_tokens(&self, tokens: u64) {
        let mut m = self.metrics.write();
        m.total_tokens_consumed += tokens;
    }

    pub fn record_memory_access(&self, hit: bool) {
        let mut m = self.metrics.write();
        m.memory_reads += 1;
        if hit {
            m.memory_hits += 1;
        }
    }

    pub fn snapshot(&self) -> ObservabilityMetrics {
        self.metrics.read().clone()
    }
}

impl Default for Observability {
    fn default() -> Self {
        Self::new()
    }
}
