use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilityNode {
    pub id: String,
    pub name: String,
    pub input_types: Vec<String>,
    pub output_types: Vec<String>,
    pub cost_rating: f64,
    pub latency_ms: u64,
    pub failure_rate: f64,
    pub vector_embedding: Vec<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeEdge {
    pub from_capability: String,
    pub to_capability: String,
    pub relation: String, // "produces_input_for", "depends_on", "composite_of"
}

pub struct CapabilityKnowledgeGraph {
    nodes: Arc<RwLock<HashMap<String, CapabilityNode>>>,
    edges: Arc<RwLock<Vec<KnowledgeEdge>>>,
}

impl CapabilityKnowledgeGraph {
    pub fn new() -> Self {
        Self {
            nodes: Arc::new(RwLock::new(HashMap::new())),
            edges: Arc::new(RwLock::new(Vec::new())),
        }
    }

    pub fn add_node(&self, node: CapabilityNode) {
        self.nodes.write().insert(node.id.clone(), node);
    }

    pub fn add_edge(&self, edge: KnowledgeEdge) {
        self.edges.write().push(edge);
    }

    pub fn find_compatible_downstream(&self, output_type: &str) -> Vec<CapabilityNode> {
        let nodes = self.nodes.read();
        nodes
            .values()
            .filter(|n| n.input_types.iter().any(|t| t == output_type || t == "*"))
            .cloned()
            .collect()
    }

    pub fn get_node(&self, id: &str) -> Option<CapabilityNode> {
        self.nodes.read().get(id).cloned()
    }

    pub fn list_nodes(&self) -> Vec<CapabilityNode> {
        self.nodes.read().values().cloned().collect()
    }
}
