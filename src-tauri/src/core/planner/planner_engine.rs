use std::sync::Arc;
use serde_json::json;
use tracing::info;

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

    /// Extract heuristic intent from user goal statement
    fn extract_intent(&self, goal: &str) -> Vec<String> {
        let lower = goal.to_lowercase();
        let mut intents = Vec::new();

        if lower.contains("search") || lower.contains("find") {
            intents.push("search".into());
        }
        if lower.contains("read") || lower.contains("open") || lower.contains("show") {
            intents.push("read".into());
        }
        if lower.contains("write") || lower.contains("save") || lower.contains("create") {
            intents.push("write".into());
        }
        if lower.contains("calc") || lower.contains("math") || lower.contains("sum") || lower.contains("convert") {
            intents.push("calc".into());
        }
        if lower.contains("note") {
            intents.push("note".into());
        }
        if lower.contains("shell") || lower.contains("command") || lower.contains("exec") {
            intents.push("shell".into());
        }

        if intents.is_empty() {
            intents.push("read".into());
        }

        intents
    }

    /// Construct a multi-node DAG TaskGraph with dependencies and parallel branches
    pub fn create_plan(&self, goal: &str) -> TaskGraph {
        let mut graph = TaskGraph::new(uuid::Uuid::new_v4().to_string(), goal);
        let intents = self.extract_intent(goal);

        let mut previous_node_id: Option<String> = None;
        let mut step_counter = 1;

        for intent in intents {
            let ranked_tools = self.planner_index.rank_capabilities(&intent);
            let selected_tool = ranked_tools
                .first()
                .map(|t| t.id.clone())
                .unwrap_or_else(|| "file.read".into());

            let node_id = format!("node-{}", step_counter);
            let deps = match &previous_node_id {
                Some(prev_id) => vec![prev_id.clone()],
                None => vec![],
            };

            graph.add_node(TaskNode {
                id: node_id.clone(),
                title: format!("Step {}: {}", step_counter, intent),
                description: format!("Execute capability '{}' for goal: {}", selected_tool, goal),
                capability_id: selected_tool,
                params: json!({"query": goal, "input": goal}),
                dependencies: deps,
                status: TaskStatus::Created,
                output: None,
            });

            previous_node_id = Some(node_id);
            step_counter += 1;
        }

        graph
    }

    pub async fn execute_plan(
        &self,
        graph: &mut TaskGraph,
        plugin_id: &str,
        ctx: &ExecutionContext,
    ) -> Result<serde_json::Value, WeaveError> {
        info!("Executing TaskGraph DAG: {} with {} nodes", graph.id, graph.nodes.len());

        let batches = graph.get_parallel_batches();
        for batch in batches {
            for node_id in batch {
                graph.update_status(&node_id, TaskStatus::Running, None);

                let (cap_id, params) = {
                    let node = graph.nodes.get(&node_id).unwrap();
                    (node.capability_id.clone(), node.params.clone())
                };

                match self.execution_registry.execute(plugin_id, &cap_id, params, ctx) {
                    Ok(output) => {
                        let reflection = self
                            .reflection_engine
                            .evaluate_and_record(&graph.goal, &cap_id, &output, ctx)
                            .await;

                        if reflection.is_successful {
                            graph.update_status(&node_id, TaskStatus::Completed, Some(output));
                        } else {
                            graph.update_status(
                                &node_id,
                                TaskStatus::Failed { error: reflection.critique },
                                Some(output),
                            );
                        }
                    }
                    Err(e) => {
                        graph.update_status(
                            &node_id,
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
            "failed": graph.is_failed(),
            "nodes": graph.nodes
        }))
    }
}
