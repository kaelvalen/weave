use std::sync::Arc;
use serde_json::json;

use crate::core::execution_context::ExecutionContext;
use crate::core::planner::reflection_engine::ReflectionEngine;
use crate::core::planner::task_graph::{TaskGraph, TaskNode, TaskStatus};
use crate::core::registries::execution_registry::ExecutionRegistry;
use crate::core::registries::planner_index::PlannerIndex;
use crate::utils::errors::WeaveError;

pub struct PlannerEngine {
    planner_index: Arc<PlannerIndex>,
    execution_registry: Arc<ExecutionRegistry>,
    reflection_engine: ReflectionEngine,
}

impl PlannerEngine {
    pub fn new(
        planner_index: Arc<PlannerIndex>,
        execution_registry: Arc<ExecutionRegistry>,
    ) -> Self {
        Self {
            planner_index,
            execution_registry,
            reflection_engine: ReflectionEngine::new(),
        }
    }

    pub fn create_plan(&self, goal: &str) -> TaskGraph {
        let mut graph = TaskGraph::new(uuid::Uuid::new_v4().to_string(), goal);

        let tools = self.planner_index.list_all();
        let first_tool = tools.first();

        let cap_id = first_tool
            .map(|t| t.id.as_str())
            .unwrap_or("file.read");

        graph.add_node(TaskNode {
            id: "node-1".into(),
            title: "Execute Initial Capability".into(),
            description: format!("Perform capability execution for goal: {}", goal),
            capability_id: cap_id.into(),
            params: json!({"query": goal}),
            dependencies: vec![],
            status: TaskStatus::Pending,
            output: None,
        });

        graph
    }

    pub async fn execute_plan(
        &self,
        graph: &mut TaskGraph,
        plugin_id: &str,
        ctx: &ExecutionContext,
    ) -> Result<serde_json::Value, WeaveError> {
        while !graph.is_completed() && !graph.is_failed() {
            let executable_nodes = graph.get_executable_nodes();
            if executable_nodes.is_empty() {
                break;
            }

            for node in executable_nodes {
                graph.update_status(&node.id, TaskStatus::InProgress, None);

                match self.execution_registry.execute(plugin_id, &node.capability_id, node.params.clone(), ctx) {
                    Ok(output) => {
                        let reflection = self.reflection_engine.evaluate(&graph.goal, &output);
                        if reflection.is_successful {
                            graph.update_status(&node.id, TaskStatus::Completed, Some(output));
                        } else {
                            graph.update_status(
                                &node.id,
                                TaskStatus::Failed { error: reflection.critique },
                                Some(output),
                            );
                        }
                    }
                    Err(e) => {
                        graph.update_status(
                            &node.id,
                            TaskStatus::Failed { error: e.to_string() },
                            None,
                        );
                    }
                }
            }
        }

        Ok(json!({
            "plan_id": graph.id,
            "completed": graph.is_completed(),
            "nodes": graph.nodes
        }))
    }
}
