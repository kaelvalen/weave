use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BlackboardState {
    pub facts: HashMap<String, Value>,
    pub hypotheses: HashMap<String, String>,
    pub context: HashMap<String, Value>,
    pub artifacts: HashMap<String, String>,
}

pub struct Blackboard {
    state: Arc<RwLock<BlackboardState>>,
}

impl Blackboard {
    pub fn new() -> Self {
        Self {
            state: Arc::new(RwLock::new(BlackboardState::default())),
        }
    }

    pub fn set_fact(&self, key: impl Into<String>, val: Value) {
        self.state.write().facts.insert(key.into(), val);
    }

    pub fn get_fact(&self, key: &str) -> Option<Value> {
        self.state.read().facts.get(key).cloned()
    }

    pub fn set_hypothesis(&self, key: impl Into<String>, hyp: impl Into<String>) {
        self.state.write().hypotheses.insert(key.into(), hyp.into());
    }

    pub fn set_artifact(&self, key: impl Into<String>, path: impl Into<String>) {
        self.state.write().artifacts.insert(key.into(), path.into());
    }

    pub fn get_artifact(&self, key: &str) -> Option<String> {
        self.state.read().artifacts.get(key).cloned()
    }

    pub fn snapshot(&self) -> BlackboardState {
        self.state.read().clone()
    }
}
