use std::collections::HashMap;
use parking_lot::RwLock;
use crate::node_state::NodeState;

pub struct DependencyResolver {
    dependencies: RwLock<HashMap<String, Vec<String>>>,
}

impl DependencyResolver {
    pub fn new() -> Self {
        Self {
            dependencies: RwLock::new(HashMap::new()),
        }
    }

    pub fn add_dependency(&self, node_id: String, depends_on: String) {
        let mut deps = self.dependencies.write();
        deps.entry(node_id).or_default().push(depends_on);
    }

    pub fn check_ready(&self, node_id: &str, node_states: &HashMap<String, NodeState>) -> bool {
        let deps = self.dependencies.read();
        if let Some(node_deps) = deps.get(node_id) {
            for dep in node_deps {
                if node_states.get(dep) != Some(&NodeState::Completed) {
                    return false;
                }
            }
        }
        true
    }
}
