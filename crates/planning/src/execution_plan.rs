use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionPlanNode {
    pub id: String,
    pub capability_id: String,
    pub dependencies: Vec<String>,
    pub inputs: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionPlan {
    pub id: String,
    pub goal: String,
    pub nodes: HashMap<String, ExecutionPlanNode>,
}

impl ExecutionPlan {
    pub fn new(goal: &str) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            goal: goal.to_string(),
            nodes: HashMap::new(),
        }
    }
}
