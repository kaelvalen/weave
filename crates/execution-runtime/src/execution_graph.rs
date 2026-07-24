use crate::dependency_resolver::DependencyResolver;
use crate::node_state::NodeState;
use crate::ready_queue::ReadyQueue;
use parking_lot::RwLock;
use std::collections::HashMap;

pub struct ExecutionGraph {
    pub nodes: RwLock<HashMap<String, NodeState>>,
    pub resolver: DependencyResolver,
    pub queue: ReadyQueue,
}

impl ExecutionGraph {
    pub fn new() -> Self {
        Self {
            nodes: RwLock::new(HashMap::new()),
            resolver: DependencyResolver::new(),
            queue: ReadyQueue::new(),
        }
    }

    pub fn add_node(&self, node_id: String) {
        self.nodes
            .write()
            .insert(node_id.clone(), NodeState::Pending);
        // Initially, if no dependencies, we could put it in the ready queue.
        // But the planner should explicitly set up edges before starting.
    }

    pub fn set_state(&self, node_id: &str, state: NodeState) {
        if let Some(node) = self.nodes.write().get_mut(node_id) {
            *node = state;
        }
    }
}
