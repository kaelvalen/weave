use std::sync::Arc;

use crate::core::planner::execution_optimizer::{PlanOptimizerTrait, TopologicalOptimizer};
use crate::core::planner::goal_analyzer::{GoalAnalyzerTrait, HeuristicGoalAnalyzer};
use crate::core::planner::plan_generator::{PlanGeneratorTrait, SemanticVectorPlanGenerator};
use crate::core::planner::task_graph::TaskGraph;
use crate::core::registries::planner_index::PlannerIndex;
use crate::utils::errors::WeaveError;

pub struct PlannerEngine {
    goal_analyzer: Box<dyn GoalAnalyzerTrait>,
    plan_generator: Box<dyn PlanGeneratorTrait>,
    plan_optimizer: Box<dyn PlanOptimizerTrait>,
}

impl PlannerEngine {
    pub fn new(planner_index: Arc<PlannerIndex>) -> Self {
        Self {
            goal_analyzer: Box::new(HeuristicGoalAnalyzer::new()),
            plan_generator: Box::new(SemanticVectorPlanGenerator::new(planner_index)),
            plan_optimizer: Box::new(TopologicalOptimizer::new()),
        }
    }

    pub fn with_strategies(
        goal_analyzer: Box<dyn GoalAnalyzerTrait>,
        plan_generator: Box<dyn PlanGeneratorTrait>,
        plan_optimizer: Box<dyn PlanOptimizerTrait>,
    ) -> Self {
        Self {
            goal_analyzer,
            plan_generator,
            plan_optimizer,
        }
    }

    pub fn create_plan(&self, goal: &str) -> Result<TaskGraph, WeaveError> {
        let analysis = self.goal_analyzer.analyze(goal);
        let mut graph = self.plan_generator.generate_plan(&analysis);
        self.plan_optimizer.optimize(&mut graph).map_err(|e| WeaveError::PlannerError(e))?;
        Ok(graph)
    }
}
