use std::sync::Arc;

use crate::core::planner::execution_optimizer::ExecutionOptimizer;
use crate::core::planner::goal_analyzer::GoalAnalyzer;
use crate::core::planner::plan_generator::PlanGenerator;
use crate::core::planner::task_graph::TaskGraph;
use crate::core::registries::planner_index::PlannerIndex;
use crate::utils::errors::WeaveError;

pub struct PlannerEngine {
    goal_analyzer: GoalAnalyzer,
    plan_generator: PlanGenerator,
    execution_optimizer: ExecutionOptimizer,
}

impl PlannerEngine {
    pub fn new(planner_index: Arc<PlannerIndex>) -> Self {
        Self {
            goal_analyzer: GoalAnalyzer::new(),
            plan_generator: PlanGenerator::new(planner_index),
            execution_optimizer: ExecutionOptimizer::new(),
        }
    }

    /// Pure strategy plan generation: Goal -> GoalAnalyzer -> PlanGenerator -> ExecutionOptimizer -> TaskGraph
    pub fn create_plan(&self, goal: &str) -> Result<TaskGraph, WeaveError> {
        let analysis = self.goal_analyzer.analyze(goal);
        let mut graph = self.plan_generator.generate_plan(&analysis);
        self.execution_optimizer.optimize(&mut graph).map_err(|e| WeaveError::PlannerError(e))?;
        Ok(graph)
    }
}
