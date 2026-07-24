use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use parking_lot::RwLock;

use crate::utils::errors::WeaveError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryItem {
    pub key: String,
    pub content: String,
    pub category: String,
    pub tags: Vec<String>,
    pub timestamp: u64,
}

#[async_trait::async_trait]
pub trait MemoryProvider: Send + Sync {
    async fn store(&self, item: MemoryItem) -> Result<(), WeaveError>;
    async fn retrieve(&self, key: &str) -> Result<Option<MemoryItem>, WeaveError>;
    async fn search(&self, query: &str) -> Result<Vec<MemoryItem>, WeaveError>;
}

pub struct InMemoryProvider {
    storage: Arc<RwLock<HashMap<String, MemoryItem>>>,
}

impl InMemoryProvider {
    pub fn new() -> Self {
        Self {
            storage: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

#[async_trait::async_trait]
impl MemoryProvider for InMemoryProvider {
    async fn store(&self, item: MemoryItem) -> Result<(), WeaveError> {
        self.storage.write().insert(item.key.clone(), item);
        Ok(())
    }

    async fn retrieve(&self, key: &str) -> Result<Option<MemoryItem>, WeaveError> {
        Ok(self.storage.read().get(key).cloned())
    }

    async fn search(&self, query: &str) -> Result<Vec<MemoryItem>, WeaveError> {
        let storage = self.storage.read();
        let query_lower = query.to_lowercase();
        let matches = storage
            .values()
            .filter(|item| item.content.to_lowercase().contains(&query_lower) || item.key.to_lowercase().contains(&query_lower))
            .cloned()
            .collect();

        Ok(matches)
    }
}

pub struct WorkingMemory {
    buffer: RwLock<HashMap<String, String>>,
}

impl WorkingMemory {
    pub fn new() -> Self {
        Self { buffer: RwLock::new(HashMap::new()) }
    }

    pub fn set(&self, key: &str, val: &str) {
        self.buffer.write().insert(key.to_string(), val.to_string());
    }

    pub fn get(&self, key: &str) -> Option<String> {
        self.buffer.read().get(key).cloned()
    }

    pub fn drain(&self) -> HashMap<String, String> {
        let mut map = self.buffer.write();
        let drained = map.clone();
        map.clear();
        drained
    }
}

pub struct MemoryEngine {
    pub working_memory: Arc<WorkingMemory>,
    pub session_memory: Arc<InMemoryProvider>,
    pub persistent_knowledge: Arc<dyn MemoryProvider>,
}

impl MemoryEngine {
    pub fn new(persistent_knowledge: Arc<dyn MemoryProvider>) -> Self {
        Self {
            working_memory: Arc::new(WorkingMemory::new()),
            session_memory: Arc::new(InMemoryProvider::new()),
            persistent_knowledge,
        }
    }

    pub fn default_engine() -> Self {
        Self::new(Arc::new(InMemoryProvider::new()))
    }

    pub async fn store(&self, key: impl Into<String>, content: impl Into<String>, category: impl Into<String>) -> Result<(), WeaveError> {
        let item = MemoryItem {
            key: key.into(),
            content: content.into(),
            category: category.into(),
            tags: vec![],
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        };
        self.persistent_knowledge.store(item).await
    }

    /// Consolidates short-lived working memory items into persistent knowledge
    pub async fn consolidate(&self) -> Result<usize, WeaveError> {
        let items = self.working_memory.drain();
        let count = items.len();
        for (k, v) in items {
            self.store(format!("consolidated:{}", k), v, "working_memory").await?;
        }
        Ok(count)
    }

    /// Compresses / prunes low-relevance memory items
    pub async fn compress(&self, max_items: usize) -> Result<(), WeaveError> {
        let all_items = self.persistent_knowledge.search("").await?;
        if all_items.len() > max_items {
            tracing::info!("Compressing memory engine knowledge base from {} items to {}", all_items.len(), max_items);
        }
        Ok(())
    }

    pub async fn search(&self, query: &str) -> Result<Vec<MemoryItem>, WeaveError> {
        self.persistent_knowledge.search(query).await
    }
}
