use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TaskStatus {
    Created,
    Queued,
    Planning,
    WaitingPermission { reason: String },
    WaitingUser { prompt: String },
    Running,
    Retrying { attempt: u32 },
    RollingBack,
    Cancelled,
    Completed,
    Failed { error: String },
}

impl Default for TaskStatus {
    fn default() -> Self {
        Self::Created
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskNode {
    pub id: String,
    pub title: String,
    pub description: String,
    pub capability_id: String,
    pub params: Value,
    pub dependencies: Vec<String>, // Parent node IDs that must complete first
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
                if n.status != TaskStatus::Created && n.status != TaskStatus::Queued {
                    return false;
                }

                // All dependencies must be Completed
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

    /// Computes parallel execution batches in topological order.
    pub fn get_parallel_batches(&self) -> Vec<Vec<String>> {
        let mut batches = Vec::new();
        let mut completed: HashSet<String> = self
            .nodes
            .values()
            .filter(|n| n.status == TaskStatus::Completed)
            .map(|n| n.id.clone())
            .collect();

        let mut remaining: HashSet<String> = self
            .nodes
            .values()
            .filter(|n| n.status != TaskStatus::Completed)
            .map(|n| n.id.clone())
            .collect();

        while !remaining.is_empty() {
            let mut current_batch = Vec::new();
            for node_id in &remaining {
                if let Some(node) = self.nodes.get(node_id) {
                    let ready = node.dependencies.iter().all(|dep| completed.contains(dep));
                    if ready {
                        current_batch.push(node_id.clone());
                    }
                }
            }

            if current_batch.is_empty() {
                break; // Circular dependency or blocked nodes
            }

            for id in &current_batch {
                remaining.remove(id);
                completed.insert(id.clone());
            }

            batches.push(current_batch);
        }

        batches
    }

    pub fn update_status(&mut self, node_id: &str, status: TaskStatus, output: Option<Value>) {
        if let Some(node) = self.nodes.get_mut(node_id) {
            node.status = status;
            if let Some(out) = output {
                node.output = Some(out);
            }
        }
    }

    pub fn is_completed(&self) -> bool {
        self.nodes.values().all(|n| n.status == TaskStatus::Completed)
    }

    pub fn is_failed(&self) -> bool {
        self.nodes.values().any(|n| matches!(n.status, TaskStatus::Failed { .. }))
    }
}
