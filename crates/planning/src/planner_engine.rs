use std::sync::Arc;

use crate::execution_optimizer::TopologicalOptimizer;
use crate::goal_analyzer::HeuristicGoalAnalyzer;
use crate::physical_planner::PhysicalPlanner;
use crate::plan_generator::{PlanGeneratorTrait, SemanticVectorPlanGenerator};
use crate::utils::errors::WeaveError;
use knowledge::planner_index::PlannerIndex;
use runtime_kernel::task_graph::TaskGraph;

pub struct PlannerEngine {
    goal_analyzer: HeuristicGoalAnalyzer,
    plan_generator: Box<dyn PlanGeneratorTrait>,
    plan_optimizer: TopologicalOptimizer,
}

impl PlannerEngine {
    pub fn new(planner_index: Arc<PlannerIndex>) -> Self {
        Self {
            goal_analyzer: HeuristicGoalAnalyzer::new(),
            plan_generator: Box::new(SemanticVectorPlanGenerator::new(planner_index)),
            plan_optimizer: TopologicalOptimizer::new(),
        }
    }

    pub fn with_strategies(
        goal_analyzer: HeuristicGoalAnalyzer,
        plan_generator: Box<dyn PlanGeneratorTrait>,
        plan_optimizer: TopologicalOptimizer,
    ) -> Self {
        Self {
            goal_analyzer,
            plan_generator,
            plan_optimizer,
        }
    }

    pub fn create_plan(&self, goal: &str) -> Result<TaskGraph, WeaveError> {
        let analysis = self.goal_analyzer.analyze(goal);
        let scored_plans = self.plan_generator.generate_plan(&analysis);
        let best = scored_plans
            .into_iter()
            .next()
            .ok_or_else(|| WeaveError::PlannerError("No plan generated".to_string()))?;
        let physical_planner = PhysicalPlanner::new();
        let mut graph = physical_planner.compile(best.plan);
        self.plan_optimizer
            .optimize(&mut graph)
            .map_err(|e| WeaveError::PlannerError(e))?;
        Ok(graph)
    }
}
