use async_trait::async_trait;
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

#[async_trait]
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

#[async_trait]
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

pub struct MemoryEngine {
    provider: Arc<dyn MemoryProvider>,
}

impl MemoryEngine {
    pub fn new(provider: Arc<dyn MemoryProvider>) -> Self {
        Self { provider }
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
        self.provider.store(item).await
    }

    pub async fn search(&self, query: &str) -> Result<Vec<MemoryItem>, WeaveError> {
        self.provider.search(query).await
    }
}
