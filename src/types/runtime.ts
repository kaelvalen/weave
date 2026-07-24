/**
 * Mirrors of the Rust runtime event / observability payloads.
 *
 * Field names match the serde output exactly (default snake_case;
 * `RuntimeEventKind` uses `rename_all = "snake_case"` on the Rust side).
 * `ts` is a chrono `DateTime<Utc>`, serialized as an RFC 3339 string.
 */

export type RuntimeEventKind =
  | 'plan_started'
  | 'step_started'
  | 'step_succeeded'
  | 'step_failed'
  | 'artifact_produced'
  | 'memory_updated'
  | 'task_status_changed';

export interface RuntimeEvent {
  ts: string;
  kind: RuntimeEventKind;
  goal_id: string | null;
  step_id: string;
  plugin_id: string | null;
  capability: string | null;
  latency_ms: number | null;
  summary: string;
  artifact_ref: string | null;
}

export interface ToolMetrics {
  call_count: number;
  failure_count: number;
  total_duration_ms: number;
  min_duration_ms: number;
  max_duration_ms: number;
}

/** serde output of `Observability::snapshot()` (`ObservabilityMetrics`). */
export interface ObservabilitySnapshot {
  total_tool_calls: number;
  total_planner_runs: number;
  total_tokens_consumed: number;
  memory_reads: number;
  memory_hits: number;
  tool_metrics: Record<string, ToolMetrics>;
}
