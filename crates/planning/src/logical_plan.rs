pub struct LogicalPlan {
    pub goal: String,
    // High level graph of logical operations, free from execution details.
}

impl LogicalPlan {
    pub fn new(goal: &str) -> Self {
        Self {
            goal: goal.to_string(),
        }
    }
}
