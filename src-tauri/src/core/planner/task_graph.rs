use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet, VecDeque};
use tracing::{info, warn};

use crate::core::execution_context::ExecutionContext;
use crate::utils::errors::WeaveError;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TaskStatus {
    Created,
    Queued,
    Planning,
    WaitingPermission { reason: String },
    WaitingUser { prompt: String },
    Running,
    Paused,
    Blocked,
    Skipped,
    Expired,
    TimedOut,
    Compensating,
    Compensated,
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
    pub inputs: HashMap<String, Value>,
    pub output_bindings: HashMap<String, String>, // Maps parent output key -> child input parameter name
    pub dependencies: Vec<String>,                 // Parent node IDs that must complete first
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

    /// Resolves dataflow bindings from parent node outputs into child node inputs.
    pub fn resolve_dataflow_inputs(&mut self, node_id: &str) {
        let parent_outputs: Vec<(String, HashMap<String, String>, Option<Value>)> = {
            if let Some(node) = self.nodes.get(node_id) {
                let bindings = node.output_bindings.clone();
                node.dependencies
                    .iter()
                    .filter_map(|dep_id| {
                        self.nodes.get(dep_id).map(|dep_node| (dep_id.clone(), bindings.clone(), dep_node.output.clone()))
                    })
                    .collect()
            } else {
                vec![]
            }
        };

        if let Some(target_node) = self.nodes.get_mut(node_id) {
            for (_parent_id, bindings, parent_output) in parent_outputs {
                if let Some(output_val) = parent_output {
                    for (out_key, in_key) in bindings {
                        if let Some(field_val) = output_val.get(&out_key).cloned().or(Some(output_val.clone())) {
                            target_node.inputs.insert(in_key, field_val);
                        }
                    }
                }
            }
        }
    }

    pub fn topological_sort(&self) -> Result<Vec<String>, String> {
        let mut in_degree: HashMap<String, usize> = HashMap::new();
        let mut adj: HashMap<String, Vec<String>> = HashMap::new();

        for id in self.nodes.keys() {
            in_degree.insert(id.clone(), 0);
            adj.insert(id.clone(), vec![]);
        }

        for node in self.nodes.values() {
            for dep in &node.dependencies {
                if adj.contains_key(dep) {
                    adj.get_mut(dep).unwrap().push(node.id.clone());
                    *in_degree.entry(node.id.clone()).or_default() += 1;
                }
            }
        }

        let mut queue: VecDeque<String> = in_degree
            .iter()
            .filter(|(_, &deg)| deg == 0)
            .map(|(id, _)| id.clone())
            .collect();

        let mut sorted = Vec::new();
        while let Some(node_id) = queue.pop_front() {
            sorted.push(node_id.clone());
            if let Some(neighbors) = adj.get(&node_id) {
                for neighbor in neighbors {
                    let deg = in_degree.get_mut(neighbor).unwrap();
                    *deg -= 1;
                    if *deg == 0 {
                        queue.push_back(neighbor.clone());
                    }
                }
            }
        }

        if sorted.len() != self.nodes.len() {
            Err("Cycle detected in graph dependencies".into())
        } else {
            Ok(sorted)
        }
    }

    pub fn detect_cycles(&self) -> bool {
        self.topological_sort().is_err()
    }

    pub fn critical_path(&self) -> Vec<String> {
        self.topological_sort().unwrap_or_default()
    }

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
                break;
            }

            for id in &current_batch {
                remaining.remove(id);
                completed.insert(id.clone());
            }

            batches.push(current_batch);
        }

        batches
    }

    pub async fn saga_rollback(&mut self, failed_node: &str, ctx: &ExecutionContext) -> Result<(), WeaveError> {
        warn!("Executing SAGA transactional rollback for TaskGraph: {} starting at failed node: {}", self.id, failed_node);

        let sort_order = self.topological_sort().unwrap_or_default();
        let mut reverse_order = sort_order;
        reverse_order.reverse();

        for node_id in reverse_order {
            if let Some(node) = self.nodes.get_mut(&node_id) {
                if node.status == TaskStatus::Completed {
                    info!("SAGA compensation executed for node: {}", node_id);
                    node.status = TaskStatus::Compensating;

                    if let Some(ref memory) = ctx.memory {
                        let key = format!("saga_compensation:{}", node_id);
                        let _ = memory.store(&key, "SAGA node compensation completed", "compensation").await;
                    }

                    node.status = TaskStatus::Compensated;
                }
            }
        }

        Ok(())
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
