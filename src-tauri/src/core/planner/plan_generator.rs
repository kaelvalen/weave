use serde_json::json;
use std::sync::Arc;

use crate::core::planner::goal_analyzer::GoalAnalysis;
use crate::core::planner::task_graph::{TaskGraph, TaskNode, TaskStatus};
use crate::core::registries::planner_index::PlannerIndex;

pub struct PlanGenerator {
    planner_index: Arc<PlannerIndex>,
}

impl PlanGenerator {
    pub fn new(planner_index: Arc<PlannerIndex>) -> Self {
        Self { planner_index }
    }

    pub fn generate_plan(&self, analysis: &GoalAnalysis) -> TaskGraph {
        let mut graph = TaskGraph::new(uuid::Uuid::new_v4().to_string(), &analysis.raw_goal);

        for sub in &analysis.sub_goals {
            let ranked = self.planner_index.rank_capabilities(&sub.intent);
            let tool_id = ranked
                .first()
                .map(|t| t.id.clone())
                .unwrap_or_else(|| "file.read".into());

            graph.add_node(TaskNode {
                id: sub.id.clone(),
                title: sub.description.clone(),
                description: format!("Execute intent '{}' using tool '{}'", sub.intent, tool_id),
                capability_id: tool_id,
                params: json!({"query": analysis.raw_goal, "input": analysis.raw_goal}),
                dependencies: sub.preconditions.clone(),
                status: TaskStatus::Created,
                output: None,
            });
        }

        graph
    }
}
