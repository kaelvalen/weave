use serde_json::json;
use std::collections::HashMap;
use std::sync::Arc;

use planning::goal_analyzer::GoalAnalysis;
use planning::plan_generator::PlanGeneratorTrait;
use planning::task_graph::{TaskGraph, TaskNode, TaskStatus};
use memory::planner_index::PlannerIndex;

pub struct HTNPlanner {
    planner_index: Arc<PlannerIndex>,
}

impl HTNPlanner {
    pub fn new(planner_index: Arc<PlannerIndex>) -> Self {
        Self { planner_index }
    }

    /// Hierarchical decomposition of compound goal tasks into primitive capability nodes
    fn decompose_compound_task(&self, intent: &str, raw_goal: &str, step_idx: usize) -> Vec<TaskNode> {
        let mut nodes = Vec::new();

        if intent == "workflow" || intent == "repository" {
            nodes.push(TaskNode {
                id: format!("htn-{}-1", step_idx),
                title: "Clone/Fetch Repository Data".into(),
                description: "Primitive step: Fetch repository metadata".into(),
                capability_id: "git.status".into(),
                params: json!({"query": raw_goal}),
                inputs: HashMap::new(),
                output_bindings: HashMap::new(),
                dependencies: vec![],
                status: TaskStatus::Created,
                output: None,
            });

            nodes.push(TaskNode {
                id: format!("htn-{}-2", step_idx),
                title: "Parse & Analyze Source Files".into(),
                description: "Primitive step: Analyze directory contents".into(),
                capability_id: "file.list".into(),
                params: json!({"query": raw_goal}),
                inputs: HashMap::new(),
                output_bindings: HashMap::new(),
                dependencies: vec![format!("htn-{}-1", step_idx)],
                status: TaskStatus::Created,
                output: None,
            });
        } else {
            let ranked = self.planner_index.rank_capabilities(intent);
            let selected_tool = ranked
                .first()
                .map(|t| t.id.clone())
                .unwrap_or_else(|| "file.read".into());

            nodes.push(TaskNode {
                id: format!("htn-{}-1", step_idx),
                title: format!("HTN Step {}: {}", step_idx, intent),
                description: format!("Primitive capability execution: {}", selected_tool),
                capability_id: selected_tool,
                params: json!({"query": raw_goal, "input": raw_goal}),
                inputs: HashMap::new(),
                output_bindings: HashMap::new(),
                dependencies: vec![],
                status: TaskStatus::Created,
                output: None,
            });
        }

        nodes
    }
}

impl PlanGeneratorTrait for HTNPlanner {
    fn generate_plan(&self, analysis: &GoalAnalysis) -> TaskGraph {
        let mut graph = TaskGraph::new(uuid::Uuid::new_v4().to_string(), &analysis.raw_goal);

        let mut step_counter = 1;
        let mut prev_primitive_id: Option<String> = None;

        for sub in &analysis.sub_goals {
            let primitive_nodes = self.decompose_compound_task(&sub.intent, &analysis.raw_goal, step_counter);
            for mut node in primitive_nodes {
                if let Some(ref prev_id) = prev_primitive_id {
                    if node.dependencies.is_empty() {
                        node.dependencies.push(prev_id.clone());
                    }
                }
                prev_primitive_id = Some(node.id.clone());
                graph.add_node(node);
            }
            step_counter += 1;
        }

        graph
    }
}
