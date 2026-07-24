use serde_json::json;
use std::collections::HashMap;
use std::sync::Arc;

use crate::goal_analyzer::GoalAnalysis;
use crate::logical_plan::{LogicalNode, LogicalPlan, ScoredPlan};
use knowledge::planner_index::PlannerIndex;

pub trait PlanGeneratorTrait: Send + Sync {
    fn generate_plan(&self, analysis: &GoalAnalysis) -> Vec<ScoredPlan>;
}

pub struct SemanticVectorPlanGenerator {
    planner_index: Arc<PlannerIndex>,
}

impl SemanticVectorPlanGenerator {
    pub fn new(planner_index: Arc<PlannerIndex>) -> Self {
        Self { planner_index }
    }
}

impl PlanGeneratorTrait for SemanticVectorPlanGenerator {
    fn generate_plan(&self, analysis: &GoalAnalysis) -> Vec<ScoredPlan> {
        let mut plan = LogicalPlan::new(&analysis.raw_goal);

        for sub in &analysis.sub_goals {
            plan.add_node(LogicalNode {
                id: sub.id.clone(),
                description: sub.description.clone(),
                intent: sub.intent.clone(),
                dependencies: sub.preconditions.clone(),
            });
        }

        // For now, return a single scored plan.
        // A more advanced planner would generate multiple variants and score them.
        vec![ScoredPlan {
            score: 0.95,
            confidence: 0.9,
            plan,
        }]
    }
}
