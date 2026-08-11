use parking_lot::RwLock;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlackboardFact {
    pub key: String,
    pub value: serde_json::Value,
    pub confidence: f32,
    pub source: String,
}

pub struct BlackboardState {
    facts: RwLock<Vec<BlackboardFact>>,
}

impl BlackboardState {
    pub fn new() -> Self {
        Self {
            facts: RwLock::new(Vec::new()),
        }
    }

    /// Read the current state immutably.
    pub fn observe(&self) -> Vec<BlackboardFact> {
        self.facts.read().clone()
    }

    /// Pure function: propose new facts based on observations.
    pub fn infer<F>(&self, logic: F) -> Vec<BlackboardFact>
    where
        F: FnOnce(&[BlackboardFact]) -> Vec<BlackboardFact>,
    {
        let observations = self.facts.read();
        logic(&observations)
    }

    /// Mutate the blackboard by committing inferred facts.
    pub fn commit(&self, new_facts: Vec<BlackboardFact>) {
        let mut facts = self.facts.write();
        for fact in new_facts {
            facts.push(fact);
        }
    }
}
