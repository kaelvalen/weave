use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use crate::core::tool_registry::{SideEffectLevel, ToolDefinition};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ToolScore {
    pub usage_count: u64,
    pub failure_count: u64,
    pub failure_rate: f64,
    pub average_latency_ms: u64,
    pub average_cost_usd: f64,
    pub popularity: u32,
    pub last_used_timestamp: u64,
}

pub struct PlannerIndex {
    tools_by_tag: Arc<RwLock<HashMap<String, Vec<ToolDefinition>>>>,
    all_tools: Arc<RwLock<HashMap<String, ToolDefinition>>>,
    tool_scores: Arc<RwLock<HashMap<String, ToolScore>>>,
    composite_mappings: Arc<RwLock<HashMap<String, Vec<String>>>>,
}

impl PlannerIndex {
    pub fn new() -> Self {
        let index = Self {
            tools_by_tag: Arc::new(RwLock::new(HashMap::new())),
            all_tools: Arc::new(RwLock::new(HashMap::new())),
            tool_scores: Arc::new(RwLock::new(HashMap::new())),
            composite_mappings: Arc::new(RwLock::new(HashMap::new())),
        };

        index.register_default_composites();
        index
    }

    fn register_default_composites(&self) {
        let mut comp = self.composite_mappings.write();
        comp.insert(
            "ReadRepository".into(),
            vec!["git.status".into(), "file.list".into(), "file.read".into()],
        );
        comp.insert(
            "PerformFullAudit".into(),
            vec!["sys.info".into(), "file.list".into(), "note.list".into()],
        );
    }

    pub fn index_tool(&self, def: ToolDefinition) {
        let mut tools = self.all_tools.write();
        let mut by_tag = self.tools_by_tag.write();
        let mut scores = self.tool_scores.write();

        scores.entry(def.id.clone()).or_default();
        tools.insert(def.id.clone(), def.clone());

        for tag in &def.planner_tags {
            by_tag.entry(tag.clone()).or_default().push(def.clone());
        }
    }

    pub fn get_composite_sub_capabilities(&self, composite_id: &str) -> Vec<String> {
        let comp = self.composite_mappings.read();
        comp.get(composite_id).cloned().unwrap_or_default()
    }

    pub fn record_feedback(&self, tool_id: &str, duration_ms: u64, success: bool) {
        let mut scores = self.tool_scores.write();
        let score = scores.entry(tool_id.to_string()).or_default();

        score.usage_count += 1;
        score.popularity += 1;
        if !success {
            score.failure_count += 1;
        }

        score.failure_rate = (score.failure_count as f64) / (score.usage_count as f64);
        score.average_latency_ms = (score.average_latency_ms * (score.usage_count - 1) + duration_ms) / score.usage_count;
        score.last_used_timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
    }

    pub fn rank_capabilities(&self, intent: &str) -> Vec<ToolDefinition> {
        let intent_lower = intent.to_lowercase();
        let tools = self.all_tools.read();
        let scores = self.tool_scores.read();

        let mut ranked: Vec<(f64, ToolDefinition)> = tools
            .values()
            .map(|t| {
                let mut score = 0.0;
                let id_lower = t.id.to_lowercase();
                let name_lower = t.name.to_lowercase();
                let desc_lower = t.description.to_lowercase();

                if id_lower.contains(&intent_lower) || name_lower.contains(&intent_lower) {
                    score += 10.0;
                }
                if desc_lower.contains(&intent_lower) {
                    score += 5.0;
                }
                for tag in &t.planner_tags {
                    if intent_lower.contains(&tag.to_lowercase()) {
                        score += 8.0;
                    }
                }

                if let Some(s) = scores.get(&t.id) {
                    score -= s.failure_rate * 5.0;
                }

                (score, t.clone())
            })
            .filter(|(s, _)| *s > 0.0)
            .collect();

        ranked.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        ranked.into_iter().map(|(_, t)| t).collect()
    }

    pub fn find_by_tag(&self, tag: &str) -> Vec<ToolDefinition> {
        self.tools_by_tag.read().get(tag).cloned().unwrap_or_default()
    }

    pub fn find_parallel_safe(&self) -> Vec<ToolDefinition> {
        self.all_tools
            .read()
            .values()
            .filter(|t| t.parallel_safe)
            .cloned()
            .collect()
    }

    pub fn find_non_destructive(&self) -> Vec<ToolDefinition> {
        self.all_tools
            .read()
            .values()
            .filter(|t| t.side_effect_level != SideEffectLevel::Destructive && t.side_effect_level != SideEffectLevel::High)
            .cloned()
            .collect()
    }

    pub fn list_all(&self) -> Vec<ToolDefinition> {
        self.all_tools.read().values().cloned().collect()
    }

    pub fn get_score(&self, tool_id: &str) -> Option<ToolScore> {
        self.tool_scores.read().get(tool_id).cloned()
    }
}
