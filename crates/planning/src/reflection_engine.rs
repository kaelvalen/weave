use serde::{Deserialize, Serialize};
use serde_json::Value;
use runtime_kernel::execution_context::ExecutionContext;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReflectionOutcome {
    pub is_successful: bool,
    pub critique: String,
    pub suggested_adjustments: Vec<String>,
    pub confidence_score: f32,
}

pub struct ReflectionEngine;

impl ReflectionEngine {
    pub fn new() -> Self {
        Self
    }

    pub async fn evaluate_and_record(
        &self,
        expected_goal: &str,
        tool_id: &str,
        output: &Value,
        ctx: &ExecutionContext,
    ) -> ReflectionOutcome {
        let is_successful = !output.is_null();
        let critique = if is_successful {
            format!("Task execution for capability '{}' produced valid output", tool_id)
        } else {
            format!("Capability '{}' returned null output", tool_id)
        };

        let outcome = ReflectionOutcome {
            is_successful,
            critique: critique.clone(),
            suggested_adjustments: if is_successful { vec![] } else { vec!["Adjust parameters".into()] },
            confidence_score: if is_successful { 0.95 } else { 0.0 },
        };

        // 1. Feedback score into PlannerIndex
        if let Some(ref planner_idx) = ctx.planner_index {
            planner_idx.record_feedback(tool_id, 10, is_successful);
        }

        // 2. Persist execution outcome into MemoryEngine
        if let Some(ref memory) = ctx.memory {
            let key = format!("reflection:{}", tool_id);
            let content = format!("Goal: {} | Critique: {}", expected_goal, critique);
            let _ = memory.store(&key, &content, "execution_reflection").await;
        }

        outcome
    }
}
