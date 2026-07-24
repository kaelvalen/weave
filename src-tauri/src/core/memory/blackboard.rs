use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FactEntity {
    pub id: String,
    pub statement: String,
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObservationEntity {
    pub id: String,
    pub source: String,
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HypothesisEntity {
    pub id: String,
    pub proposal: String,
    pub rationale: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecisionEntity {
    pub id: String,
    pub selected_action: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtifactEntity {
    pub id: String,
    pub uri: String,
    pub content_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BlackboardState {
    pub facts: HashMap<String, FactEntity>,
    pub observations: HashMap<String, ObservationEntity>,
    pub hypotheses: HashMap<String, HypothesisEntity>,
    pub decisions: HashMap<String, DecisionEntity>,
    pub artifacts: HashMap<String, ArtifactEntity>,
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

    pub fn add_fact(&self, id: impl Into<String>, statement: impl Into<String>, confidence: f32) {
        let id_str = id.into();
        let fact = FactEntity {
            id: id_str.clone(),
            statement: statement.into(),
            confidence,
        };
        self.state.write().facts.insert(id_str, fact);
    }

    pub fn add_observation(&self, id: impl Into<String>, source: impl Into<String>, payload: Value) {
        let id_str = id.into();
        let obs = ObservationEntity {
            id: id_str.clone(),
            source: source.into(),
            payload,
        };
        self.state.write().observations.insert(id_str, obs);
    }

    pub fn add_hypothesis(&self, id: impl Into<String>, proposal: impl Into<String>, rationale: impl Into<String>) {
        let id_str = id.into();
        let hyp = HypothesisEntity {
            id: id_str.clone(),
            proposal: proposal.into(),
            rationale: rationale.into(),
        };
        self.state.write().hypotheses.insert(id_str, hyp);
    }

    pub fn add_decision(&self, id: impl Into<String>, action: impl Into<String>, status: impl Into<String>) {
        let id_str = id.into();
        let dec = DecisionEntity {
            id: id_str.clone(),
            selected_action: action.into(),
            status: status.into(),
        };
        self.state.write().decisions.insert(id_str, dec);
    }

    pub fn add_artifact(&self, id: impl Into<String>, uri: impl Into<String>, content_type: impl Into<String>) {
        let id_str = id.into();
        let art = ArtifactEntity {
            id: id_str.clone(),
            uri: uri.into(),
            content_type: content_type.into(),
        };
        self.state.write().artifacts.insert(id_str, art);
    }

    pub fn snapshot(&self) -> BlackboardState {
        self.state.read().clone()
    }
}
