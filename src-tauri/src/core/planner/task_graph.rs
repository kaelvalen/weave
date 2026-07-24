use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TaskStatus {
    Pending,
    InProgress,
    Completed,
    Failed { error: String },
    Skipped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskNode {
    pub id: String,
    pub title: String,
    pub description: String,
    pub capability_id: String,
    pub params: Value,
    pub dependencies: Vec<String>, // Node IDs that must complete first
    pub status: TaskStatus,
    pub output: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskGraph {
    pub id: String,
    pub goal: String,
    pub nodes: HashMap<String, TaskNode>,
}

impl TaskGraph {
    pub fn new(id: impl Into<String>, goal: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            goal: goal.into(),
            nodes: HashMap::new(),
        }
    }

    pub fn add_node(&mut self, node: TaskNode) {
        self.nodes.insert(node.id.clone(), node);
    }

    pub fn get_executable_nodes(&self) -> Vec<TaskNode> {
        self.nodes
            .values()
            .filter(|n| {
                if n.status != TaskStatus::Pending {
                    return false;
                }

                // All dependencies must be completed
                n.dependencies.iter().all(|dep_id| {
                    self.nodes
                        .get(dep_id)
                        .map(|dep_node| dep_node.status == TaskStatus::Completed)
                        .unwrap_or(false)
                })
            })
            .cloned()
            .collect()
    }

    pub fn update_status(&mut self, node_id: &str, status: TaskStatus, output: Option<Value>) {
        if let Some(node) = self.nodes.get_mut(node_id) {
            node.status = status;
            node.output = output;
        }
    }

    pub fn is_completed(&self) -> bool {
        self.nodes.values().all(|n| n.status == TaskStatus::Completed || n.status == TaskStatus::Skipped)
    }

    pub fn is_failed(&self) -> bool {
        self.nodes.values().any(|n| matches!(n.status, TaskStatus::Failed { .. }))
    }
}
