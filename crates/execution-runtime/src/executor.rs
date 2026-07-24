use std::sync::Arc;
use runtime_kernel::execution_context::ExecutionContext;
use crate::execution_graph::ExecutionGraph;
use crate::worker_pool::WorkerPool;
use crate::retry_policy::RetryPolicy;

pub struct Executor {
    graph: Arc<ExecutionGraph>,
    worker_pool: Arc<WorkerPool>,
    retry_policy: RetryPolicy,
}

impl Executor {
    pub fn new(graph: Arc<ExecutionGraph>, concurrency: usize) -> Self {
        Self {
            graph,
            worker_pool: Arc::new(WorkerPool::new(concurrency)),
            retry_policy: RetryPolicy::default_policy(),
        }
    }

    pub async fn execute_plan(&self, ctx: &ExecutionContext) -> Result<(), String> {
        // Core execution loop pulling from ReadyQueue
        loop {
            if ctx.cancellation_token.is_cancelled() {
                return Err("Execution cancelled".to_string());
            }

            let next_node = self.graph.queue.dequeue();
            match next_node {
                Some(node_id) => {
                    // Acquire permit and spawn task
                    let _permit = self.worker_pool.acquire().await.map_err(|e| e.to_string())?;
                    // Simulate execution for now
                    self.graph.set_state(&node_id, crate::node_state::NodeState::Running);
                    // ... execution logic ...
                    self.graph.set_state(&node_id, crate::node_state::NodeState::Completed);
                }
                None => {
                    // Check if all nodes are completed
                    // If not, wait or detect deadlock
                    break;
                }
            }
        }
        Ok(())
    }
}
