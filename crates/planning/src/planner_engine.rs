use std::sync::Arc;

use crate::execution_optimizer::TopologicalOptimizer;
use crate::goal_analyzer::HeuristicGoalAnalyzer;
use crate::plan_generator::{PlanGeneratorTrait, SemanticVectorPlanGenerator};
use crate::task_graph::TaskGraph;
use memory::planner_index::PlannerIndex;
use crate::utils::errors::WeaveError;

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
        let mut graph = self.plan_generator.generate_plan(&analysis);
        self.plan_optimizer.optimize(&mut graph).map_err(|e| WeaveError::PlannerError(e))?;
        Ok(graph)
    }
}
