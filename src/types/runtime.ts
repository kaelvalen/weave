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
  /** Tool input as passed to `plugin_execute` (long strings truncated backend-side). */
  params?: Record<string, unknown> | null;
  /** Tool result payload (truncated backend-side). */
  output?: unknown | null;
  /** Structured error message for failed steps. */
  error?: string | null;
}

/** One step of an execution, derived client-side from step_started/step_succeeded/step_failed events. */
export interface ExecutionStep {
  step_id: string;
  plugin_id: string | null;
  capability: string | null;
  status: 'running' | 'succeeded' | 'failed';
  latency_ms: number | null;
  summary: string;
  params?: Record<string, unknown> | null;
  output?: unknown | null;
  error?: string | null;
  artifact_ref: string | null;
  /** ts of the step_started event (RFC 3339). */
  started_ts: string;
}

/** A single planned capability call, as reported by `runtime_note_plan`. */
export interface PlannedStep {
  plugin_id: string | null;
  capability: string;
}

/** serde output of the `trace_list` command. */
export interface TraceSummary {
  goal_id: string;
  title: string;
  started_at: string;
  ended_at: string | null;
  step_count: number;
  failure_count: number;
  total_latency_ms: number;
  status: 'running' | 'succeeded' | 'failed';
}

/** serde output of the `runtime_get_model_stats` command. */
export interface ModelStats {
  active_model: string | null;
  ollama_running: boolean;
  total_tokens: number;
  last_tps: number | null;
  avg_tps: number | null;
  loaded_models: { name: string; vram_bytes: number | null }[];
}

/** serde output of the `local_model_info` command (best-effort GGUF header parse). */
export interface LocalModelDetails {
  quant: string | null;
  context_length: number | null;
  parameter_count: string | null;
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
