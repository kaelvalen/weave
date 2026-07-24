use crate::logical_plan::LogicalPlan;
use runtime_kernel::task_graph::{TaskGraph, TaskNode, TaskStatus};
use serde_json::json;
use std::collections::HashMap;

pub struct PhysicalPlanner {}

impl PhysicalPlanner {
    pub fn new() -> Self {
        Self {}
    }

    /// Compiles a logical plan into an executable TaskGraph by binding capabilities
    pub fn compile(&self, logical_plan: LogicalPlan) -> TaskGraph {
        let mut graph = TaskGraph::new(uuid::Uuid::new_v4().to_string(), &logical_plan.goal);

        for (id, node) in logical_plan.nodes {
            // For now, we statically map intent to capability id.
            // In the future, this queries the capability registry to find the best local/cloud executor.
            let capability_id = if node.intent.contains("repo") {
                "git.clone".to_string()
            } else if node.intent.contains("code") {
                "code.analyze".to_string()
            } else {
                "shell.exec".to_string()
            };

            graph.add_node(TaskNode {
                id,
                title: node.description.clone(),
                description: format!("Executing {} via {}", node.intent, capability_id),
                capability_id,
                params: json!({"intent": node.intent}),
                inputs: HashMap::new(),
                output_bindings: HashMap::new(),
                dependencies: node.dependencies,
                status: TaskStatus::Created,
                output: None,
            });
        }

        graph
    }
}
