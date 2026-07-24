use planning::task_graph::TaskGraph;

pub trait PlanOptimizerTrait: Send + Sync {
    fn optimize(&self, graph: &mut TaskGraph) -> Result<(), String>;
}

pub struct TopologicalOptimizer;

impl TopologicalOptimizer {
    pub fn new() -> Self {
        Self
    }
}

impl PlanOptimizerTrait for TopologicalOptimizer {
    fn optimize(&self, graph: &mut TaskGraph) -> Result<(), String> {
        if graph.detect_cycles() {
            return Err("Cycle detected in generated TaskGraph".into());
        }

        let _sort_order = graph.topological_sort()?;
        let _critical_path = graph.critical_path();

        Ok(())
    }
}
