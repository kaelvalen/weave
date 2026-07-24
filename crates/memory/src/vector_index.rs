use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VectorCapabilityEntry {
    pub id: String,
    pub description: String,
    pub embedding: Vec<f32>,
}

pub struct CapabilityVectorIndex {
    entries: Arc<RwLock<HashMap<String, VectorCapabilityEntry>>>,
}

impl CapabilityVectorIndex {
    pub fn new() -> Self {
        Self {
            entries: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn index_capability(&self, id: &str, description: &str, embedding: Vec<f32>) {
        let entry = VectorCapabilityEntry {
            id: id.to_string(),
            description: description.to_string(),
            embedding,
        };
        self.entries.write().insert(id.to_string(), entry);
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

    pub fn search_similar(&self, query_embedding: &[f32], top_k: usize) -> Vec<(String, f32)> {
        let entries = self.entries.read();
        let mut matches: Vec<(String, f32)> = entries
            .values()
            .map(|e| {
                let sim = Self::cosine_similarity(&e.embedding, query_embedding);
                (e.id.clone(), sim)
            })
            .collect();

        matches.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        matches.truncate(top_k);
        matches
    }
}
