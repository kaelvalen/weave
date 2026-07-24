pub struct RetryPolicy {
    pub max_retries: u32,
    pub initial_backoff_ms: u64,
    pub multiplier: f32,
}

impl RetryPolicy {
    pub fn default_policy() -> Self {
        Self {
            max_retries: 3,
            initial_backoff_ms: 1000,
            multiplier: 2.0,
        }
    }
}
