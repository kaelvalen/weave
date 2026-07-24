use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Structured, frontend-facing event describing runtime activity.
///
/// Published on the EventBus's dedicated runtime topic and bridged to the
/// Tauri frontend as the `runtime-event` payload. Serialized with default
/// snake_case field names; `kind` uses snake_case variant names.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeEvent {
    pub ts: DateTime<Utc>,
    pub kind: RuntimeEventKind,
    pub goal_id: Option<String>,
    pub step_id: String,
    pub plugin_id: Option<String>,
    pub capability: Option<String>,
    pub latency_ms: Option<u64>,
    pub summary: String,
    pub artifact_ref: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeEventKind {
    PlanStarted,
    StepStarted,
    StepSucceeded,
    StepFailed,
    ArtifactProduced,
    MemoryUpdated,
    TaskStatusChanged,
}

impl RuntimeEvent {
    pub fn new(
        kind: RuntimeEventKind,
        step_id: impl Into<String>,
        summary: impl Into<String>,
    ) -> Self {
        Self {
            ts: Utc::now(),
            kind,
            goal_id: None,
            step_id: step_id.into(),
            plugin_id: None,
            capability: None,
            latency_ms: None,
            summary: summary.into(),
            artifact_ref: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_event_serde_round_trip() {
        let mut event = RuntimeEvent::new(
            RuntimeEventKind::StepSucceeded,
            "step-1",
            "Executed fs.read_file",
        );
        event.goal_id = Some("goal-9".to_string());
        event.plugin_id = Some("com.weave.builtin.file".to_string());
        event.capability = Some("file.read".to_string());
        event.latency_ms = Some(42);
        event.artifact_ref = Some("artifact://out".to_string());

        let json = serde_json::to_string(&event).expect("serialize");
        let back: RuntimeEvent = serde_json::from_str(&json).expect("deserialize");

        assert_eq!(back.step_id, "step-1");
        assert_eq!(back.kind, RuntimeEventKind::StepSucceeded);
        assert_eq!(back.goal_id.as_deref(), Some("goal-9"));
        assert_eq!(back.plugin_id.as_deref(), Some("com.weave.builtin.file"));
        assert_eq!(back.capability.as_deref(), Some("file.read"));
        assert_eq!(back.latency_ms, Some(42));
        assert_eq!(back.summary, "Executed fs.read_file");
        assert_eq!(back.artifact_ref.as_deref(), Some("artifact://out"));
        assert_eq!(back.ts, event.ts);
    }

    #[test]
    fn runtime_event_kind_serializes_snake_case() {
        assert_eq!(
            serde_json::to_value(RuntimeEventKind::PlanStarted).unwrap(),
            serde_json::json!("plan_started")
        );
        assert_eq!(
            serde_json::to_value(RuntimeEventKind::TaskStatusChanged).unwrap(),
            serde_json::json!("task_status_changed")
        );
    }

    #[test]
    fn runtime_event_optional_fields_omit_as_null() {
        let event = RuntimeEvent::new(RuntimeEventKind::StepStarted, "s", "started");
        let value = serde_json::to_value(&event).unwrap();
        assert_eq!(value["goal_id"], serde_json::Value::Null);
        assert_eq!(value["plugin_id"], serde_json::Value::Null);
        assert_eq!(value["latency_ms"], serde_json::Value::Null);
        assert_eq!(value["artifact_ref"], serde_json::Value::Null);
        // Field names the frontend relies on.
        assert!(value.get("step_id").is_some());
        assert!(value.get("ts").is_some());
        assert!(value.get("kind").is_some());
    }
}
