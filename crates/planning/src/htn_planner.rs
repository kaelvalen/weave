use serde_json::json;
use std::collections::HashMap;
use std::sync::Arc;

use planning::goal_analyzer::GoalAnalysis;
use planning::plan_generator::PlanGeneratorTrait;
use planning::logical_plan::{LogicalPlan, LogicalNode, ScoredPlan};
use knowledge::planner_index::PlannerIndex;

pub struct HTNPlanner {
    planner_index: Arc<PlannerIndex>,
}

impl HTNPlanner {
    pub fn new(planner_index: Arc<PlannerIndex>) -> Self {
        Self { planner_index }
    }

    /// Hierarchical decomposition of compound goal tasks into primitive capability nodes
    fn decompose_compound_task(&self, intent: &str, raw_goal: &str, step_idx: usize) -> Vec<LogicalNode> {
        let mut nodes = Vec::new();
        // Base case: recursive HTN
        if intent.contains("analyze") {
            nodes.push(LogicalNode {
                id: format!("step_{}_1", step_idx),
                description: "Clone repository locally".into(),
                intent: "repo.clone".into(),
                dependencies: vec![],
            });
            nodes.push(LogicalNode {
                id: format!("step_{}_2", step_idx),
                description: "Analyze code structure".into(),
                intent: "code.analyze".into(),
                dependencies: vec![format!("step_{}_1", step_idx)],
            });
        } else if intent.contains("test") {
            nodes.push(LogicalNode {
                id: format!("step_{}_1", step_idx),
                description: "Run unit tests".into(),
                intent: "test.run".into(),
                dependencies: vec![],
            });
            nodes.push(LogicalNode {
                id: format!("step_{}_2", step_idx),
                description: "Generate test report".into(),
                intent: "report.generate".into(),
                dependencies: vec![format!("step_{}_1", step_idx)],
            });
        } else {
            // Default generic fallback step
            nodes.push(LogicalNode {
                id: format!("step_{}_1", step_idx),
                description: format!("Execute intent '{}'", intent),
                intent: intent.to_string(),
                dependencies: vec![],
            });
        }
        nodes
    }
}

impl PlanGeneratorTrait for HTNPlanner {
    fn generate_plan(&self, analysis: &GoalAnalysis) -> Vec<ScoredPlan> {
        let mut plan = LogicalPlan::new(&analysis.raw_goal);

        for (idx, sub) in analysis.sub_goals.iter().enumerate() {
            let decomposed_nodes = self.decompose_compound_task(&sub.intent, &analysis.raw_goal, idx);
            for node in decomposed_nodes {
                plan.add_node(node);
            }
        }

        vec![ScoredPlan {
            score: 0.9,
            confidence: 0.85,
            plan,
        }]
    }
}
