use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::utils::config::OLLAMA_DEFAULT_URL;
use crate::utils::errors::WeaveError;
use crate::AppState;
use runtime_kernel::observability::ObservabilityMetrics;
use runtime_kernel::runtime_event::{RuntimeEvent, RuntimeEventKind};

/// On-demand snapshot of runtime observability metrics for the frontend.
#[tauri::command]
pub fn runtime_get_observability(
    app_state: State<'_, AppState>,
) -> Result<ObservabilityMetrics, WeaveError> {
    Ok(app_state.observability.snapshot())
}

/// Aggregated view of one execution trace (all events sharing a `goal_id`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraceSummary {
    pub goal_id: String,
    pub title: String,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub step_count: u32,
    pub failure_count: u32,
    pub total_latency_ms: u64,
    pub status: String,
}

/// A model currently loaded in the local inference server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadedModel {
    pub name: String,
    pub vram_bytes: Option<u64>,
}

/// Snapshot of model usage telemetry and local server state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelStats {
    pub active_model: Option<String>,
    pub ollama_running: bool,
    pub total_tokens: u64,
    pub last_tps: Option<f64>,
    pub avg_tps: Option<f64>,
    pub loaded_models: Vec<LoadedModel>,
}

fn traces_file_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join("traces").join("events.jsonl"))
}

/// Read all persisted runtime events; a missing or unreadable trace file,
/// and individual malformed lines, are tolerated silently.
fn read_persisted_events(app: &AppHandle) -> Vec<RuntimeEvent> {
    let Some(path) = traces_file_path(app) else {
        return Vec::new();
    };
    let Ok(content) = std::fs::read_to_string(&path) else {
        return Vec::new();
    };
    content
        .lines()
        .filter_map(|line| serde_json::from_str::<RuntimeEvent>(line).ok())
        .collect()
}

/// Group persisted events into per-trace summaries, newest trace first.
/// `events` must be in chronological (append) order.
fn summarize_traces(events: &[RuntimeEvent], limit: usize) -> Vec<TraceSummary> {
    let mut groups: HashMap<String, Vec<&RuntimeEvent>> = HashMap::new();
    for event in events {
        if let Some(goal_id) = event.goal_id.as_ref() {
            groups.entry(goal_id.clone()).or_default().push(event);
        }
    }

    let mut summaries: Vec<TraceSummary> = groups
        .into_iter()
        .map(|(goal_id, trace_events)| {
            let title = trace_events
                .iter()
                .find(|e| e.kind == RuntimeEventKind::PlanStarted)
                .map(|e| e.summary.clone())
                .or_else(|| {
                    trace_events
                        .iter()
                        .find(|e| e.kind == RuntimeEventKind::StepStarted)
                        .map(|e| e.summary.clone())
                })
                .unwrap_or_default();

            let started_at = trace_events.first().map(|e| e.ts).unwrap_or_else(Utc::now);
            let last_ts = trace_events.last().map(|e| e.ts);

            let mut started_step_ids: HashSet<&str> = HashSet::new();
            let mut finished_step_ids: HashSet<&str> = HashSet::new();
            let mut step_count = 0u32;
            let mut failure_count = 0u32;
            let mut total_latency_ms = 0u64;

            for event in &trace_events {
                match event.kind {
                    RuntimeEventKind::StepStarted => {
                        step_count += 1;
                        started_step_ids.insert(event.step_id.as_str());
                    }
                    RuntimeEventKind::StepSucceeded => {
                        finished_step_ids.insert(event.step_id.as_str());
                    }
                    RuntimeEventKind::StepFailed => {
                        finished_step_ids.insert(event.step_id.as_str());
                        failure_count += 1;
                    }
                    _ => {}
                }
                if let Some(latency) = event.latency_ms {
                    total_latency_ms += latency;
                }
            }

            let running = started_step_ids
                .iter()
                .any(|id| !finished_step_ids.contains(id));
            let status = if running {
                "running"
            } else if failure_count > 0 {
                "failed"
            } else {
                "succeeded"
            }
            .to_string();

            TraceSummary {
                goal_id,
                title,
                started_at,
                ended_at: if running { None } else { last_ts },
                step_count,
                failure_count,
                total_latency_ms,
                status,
            }
        })
        .collect();

    summaries.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    summaries.truncate(limit);
    summaries
}

/// List recent execution traces, newest first.
#[tauri::command]
pub fn trace_list(app: AppHandle, limit: Option<usize>) -> Result<Vec<TraceSummary>, WeaveError> {
    let events = read_persisted_events(&app);
    Ok(summarize_traces(&events, limit.unwrap_or(50)))
}

/// All persisted events for one trace, in chronological order.
#[tauri::command]
pub fn trace_get(app: AppHandle, goal_id: String) -> Result<Vec<RuntimeEvent>, WeaveError> {
    let events = read_persisted_events(&app);
    Ok(events
        .into_iter()
        .filter(|e| e.goal_id.as_deref() == Some(goal_id.as_str()))
        .collect())
}

fn ollama_base_url(raw_url: &str) -> String {
    let trimmed = raw_url.trim_end_matches('/');
    if trimmed.ends_with("/api/chat") {
        return trimmed.trim_end_matches("/api/chat").to_string();
    }
    if trimmed.ends_with("/api/generate") {
        return trimmed.trim_end_matches("/api/generate").to_string();
    }
    if trimmed.ends_with("/api") {
        return trimmed.trim_end_matches("/api").to_string();
    }
    trimmed.to_string()
}

#[tauri::command]
pub async fn runtime_get_model_stats(
    app_state: State<'_, AppState>,
) -> Result<ModelStats, WeaveError> {
    let config = app_state.config.read().clone();
    let base_url = ollama_base_url(
        &config
            .ai
            .local
            .api_url
            .clone()
            .unwrap_or_else(|| OLLAMA_DEFAULT_URL.to_string()),
    );

    let (active_model, last_tps, avg_tps) = {
        let telemetry = app_state.model_telemetry.lock();
        (
            telemetry.last_model.clone(),
            telemetry.last_tps,
            telemetry.avg_tps,
        )
    };
    let total_tokens = app_state.observability.snapshot().total_tokens_consumed;

    let mut ollama_running = false;
    let mut loaded_models = Vec::new();

    // Short-timeout probe; failure = down.
    if let Ok(client) = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(800))
        .build()
    {
        if let Ok(response) = client.get(format!("{}/api/ps", base_url)).send().await {
            if response.status().is_success() {
                ollama_running = true;
                if let Ok(json) = response.json::<serde_json::Value>().await {
                    if let Some(models) = json["models"].as_array() {
                        for model in models {
                            if let Some(name) = model["name"].as_str() {
                                loaded_models.push(LoadedModel {
                                    name: name.to_string(),
                                    vram_bytes: model["size_vram"].as_u64(),
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(ModelStats {
        active_model,
        ollama_running,
        total_tokens,
        last_tps,
        avg_tps,
        loaded_models,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_event(
        kind: RuntimeEventKind,
        goal_id: Option<&str>,
        step_id: &str,
        summary: &str,
        ts_offset_secs: i64,
    ) -> RuntimeEvent {
        let mut event = RuntimeEvent::new(kind, step_id, summary);
        event.goal_id = goal_id.map(|g| g.to_string());
        event.ts = Utc::now() + chrono::Duration::seconds(ts_offset_secs);
        event
    }

    #[test]
    fn summarize_groups_by_goal_and_skips_null_goals() {
        let events = vec![
            make_event(RuntimeEventKind::PlanStarted, Some("g1"), "p1", "Plan A", 0),
            make_event(
                RuntimeEventKind::StepStarted,
                Some("g1"),
                "s1",
                "step one",
                1,
            ),
            make_event(
                RuntimeEventKind::StepSucceeded,
                Some("g1"),
                "s1",
                "step one done",
                2,
            ),
            make_event(RuntimeEventKind::StepStarted, None, "sx", "orphan", 3),
        ];

        let summaries = summarize_traces(&events, 50);
        assert_eq!(summaries.len(), 1);
        let s = &summaries[0];
        assert_eq!(s.goal_id, "g1");
        assert_eq!(s.title, "Plan A");
        assert_eq!(s.step_count, 1);
        assert_eq!(s.failure_count, 0);
        assert_eq!(s.status, "succeeded");
        assert!(s.ended_at.is_some());
    }

    #[test]
    fn summarize_detects_running_and_failed_traces() {
        let mut failed_step = make_event(
            RuntimeEventKind::StepFailed,
            Some("g1"),
            "s2",
            "step two failed",
            4,
        );
        failed_step.latency_ms = Some(7);
        let mut ok_step = make_event(
            RuntimeEventKind::StepSucceeded,
            Some("g1"),
            "s1",
            "step one done",
            2,
        );
        ok_step.latency_ms = Some(11);

        let events = vec![
            make_event(
                RuntimeEventKind::StepStarted,
                Some("g1"),
                "s1",
                "Executing a::b",
                0,
            ),
            ok_step,
            make_event(
                RuntimeEventKind::StepStarted,
                Some("g1"),
                "s2",
                "Executing c::d",
                3,
            ),
            failed_step,
            // A trace with an unfinished step.
            make_event(
                RuntimeEventKind::StepStarted,
                Some("g2"),
                "s9",
                "Executing e::f",
                5,
            ),
        ];

        let summaries = summarize_traces(&events, 50);
        assert_eq!(summaries.len(), 2);
        // Newest trace (g2) first.
        assert_eq!(summaries[0].goal_id, "g2");
        assert_eq!(summaries[0].status, "running");
        assert_eq!(summaries[0].ended_at, None);
        // Title falls back to the first step_started summary.
        assert_eq!(summaries[0].title, "Executing e::f");

        let g1 = &summaries[1];
        assert_eq!(g1.status, "failed");
        assert_eq!(g1.step_count, 2);
        assert_eq!(g1.failure_count, 1);
        assert_eq!(g1.total_latency_ms, 18);
        assert!(g1.ended_at.is_some());
    }

    #[test]
    fn summarize_applies_limit() {
        let events: Vec<RuntimeEvent> = (0..5)
            .map(|i| {
                make_event(
                    RuntimeEventKind::StepStarted,
                    Some(&format!("g{}", i)),
                    &format!("s{}", i),
                    "step",
                    i,
                )
            })
            .collect();
        let summaries = summarize_traces(&events, 2);
        assert_eq!(summaries.len(), 2);
        // Newest first.
        assert_eq!(summaries[0].goal_id, "g4");
        assert_eq!(summaries[1].goal_id, "g3");
    }

    #[test]
    fn ollama_base_url_strips_endpoint_suffixes() {
        assert_eq!(
            ollama_base_url("http://localhost:11434/api/chat"),
            "http://localhost:11434"
        );
        assert_eq!(
            ollama_base_url("http://localhost:11434/"),
            "http://localhost:11434"
        );
        assert_eq!(
            ollama_base_url("http://localhost:11434"),
            "http://localhost:11434"
        );
    }
}
