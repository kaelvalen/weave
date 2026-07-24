use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogicalNode {
    pub id: String,
    pub description: String,
    pub intent: String,
    pub dependencies: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogicalPlan {
    pub goal: String,
    pub nodes: HashMap<String, LogicalNode>,
}

impl LogicalPlan {
    pub fn new(goal: &str) -> Self {
        Self {
            goal: goal.to_string(),
            nodes: HashMap::new(),
        }
    }

    pub fn add_node(&mut self, node: LogicalNode) {
        self.nodes.insert(node.id.clone(), node);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoredPlan {
    pub score: f32,
    pub confidence: f32,
    pub plan: LogicalPlan,
}
