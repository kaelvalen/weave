use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

use crate::planner_index::PlannerIndex;
use capabilities::tool_registry::ToolDefinition;
use memory::vector_index::CapabilityVectorIndex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilityNode {
    pub id: String,
    pub name: String,
    pub description: String,
    pub plugin_id: String,
    pub input_types: Vec<String>,
    pub output_types: Vec<String>,
    pub required_permissions: Vec<String>,
    pub cost_rating: f64,
    pub latency_ms: u64,
    pub failure_rate: f64,
    pub vector_embedding: Vec<f32>,
}

impl CapabilityNode {
    pub fn to_tool_definition(&self) -> ToolDefinition {
        let mut def = ToolDefinition::new(&self.id, &self.name, &self.description);
        def.planner_tags = self.input_types.clone();
        def.parallel_safe = true;
        def.estimated_cost_usd = self.cost_rating;
        def.estimated_latency_ms = self.latency_ms;
        def
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeEdge {
    pub from_capability: String,
    pub to_capability: String,
    pub relation: String, // "produces_artifact_for", "requires_permission", "implemented_by_plugin", "depends_on"
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

    pub fn project_planner_index(&self) -> PlannerIndex {
        let index = PlannerIndex::new();
        for node in self.nodes.read().values() {
            index.index_tool(node.to_tool_definition());
        }
        index
    }

    pub fn project_vector_index(&self) -> CapabilityVectorIndex {
        let v_index = CapabilityVectorIndex::new();
        for node in self.nodes.read().values() {
            v_index.index_capability(&node.id, &node.description, node.vector_embedding.clone());
        }
        v_index
    }

    pub fn traverse_implements(&self, capability_id: &str) -> Option<String> {
        self.nodes
            .read()
            .get(capability_id)
            .map(|n| n.plugin_id.clone())
    }

    pub fn traverse_produces_artifacts(&self, capability_id: &str) -> Vec<String> {
        self.nodes
            .read()
            .get(capability_id)
            .map(|n| n.output_types.clone())
            .unwrap_or_default()
    }

    pub fn traverse_requires_permissions(&self, capability_id: &str) -> Vec<String> {
        self.nodes
            .read()
            .get(capability_id)
            .map(|n| n.required_permissions.clone())
            .unwrap_or_default()
    }

    pub fn traverse_dependencies(&self, capability_id: &str) -> Vec<String> {
        self.edges
            .read()
            .iter()
            .filter(|e| e.to_capability == capability_id && e.relation == "depends_on")
            .map(|e| e.from_capability.clone())
            .collect()
    }

    pub fn cosine_similarity(v1: &[f32], v2: &[f32]) -> f32 {
        if v1.len() != v2.len() || v1.is_empty() {
            return 0.0;
        }

        let dot_product: f32 = v1.iter().zip(v2.iter()).map(|(a, b)| a * b).sum();
        let norm_v1: f32 = v1.iter().map(|a| a * a).sum::<f32>().sqrt();
        let norm_v2: f32 = v2.iter().map(|b| b * b).sum::<f32>().sqrt();

        if norm_v1 == 0.0 || norm_v2 == 0.0 {
            0.0
        } else {
            dot_product / (norm_v1 * norm_v2)
        }
    }

    pub fn search_by_vector(
        &self,
        query_embedding: &[f32],
        top_k: usize,
    ) -> Vec<(CapabilityNode, f32)> {
        let nodes = self.nodes.read();
        let mut matches: Vec<(CapabilityNode, f32)> = nodes
            .values()
            .map(|n| {
                let sim = Self::cosine_similarity(&n.vector_embedding, query_embedding);
                (n.clone(), sim)
            })
            .collect();

        matches.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        matches.truncate(top_k);
        matches
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

    pub fn as_tool_definitions(&self) -> Vec<ToolDefinition> {
        self.nodes
            .read()
            .values()
            .map(|n| n.to_tool_definition())
            .collect()
    }
}
