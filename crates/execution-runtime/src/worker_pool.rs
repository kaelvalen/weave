use std::sync::Arc;
use tokio::sync::Semaphore;

pub struct WorkerPool {
    semaphore: Arc<Semaphore>,
}

impl WorkerPool {
    pub fn new(concurrency_limit: usize) -> Self {
        Self {
            semaphore: Arc::new(Semaphore::new(concurrency_limit)),
        }
    }

    pub async fn acquire(
        &self,
    ) -> Result<tokio::sync::SemaphorePermit<'_>, tokio::sync::AcquireError> {
        self.semaphore.acquire().await
    }
}
