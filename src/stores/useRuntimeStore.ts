import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { castDraft, current } from 'immer';
import { invoke } from '@tauri-apps/api/core';
import type {
  ExecutionStep,
  ObservabilitySnapshot,
  PlannedStep,
  RuntimeEvent,
  TraceSummary,
} from '@/types/runtime';

/** Events grouped into a single step run, keyed by `step_id`. */
export interface ExecutionGroup {
  step_id: string;
  goal_id: string | null;
  plugin_id: string | null;
  capability: string | null;
  status: 'running' | 'succeeded' | 'failed' | 'unknown';
  started_at: string | null;
  latency_ms: number | null;
  events: RuntimeEvent[];
}

const MAX_EVENTS = 500;
const TRACE_LIST_LIMIT = 200;

function deriveExecutions(events: RuntimeEvent[]): ExecutionGroup[] {
  const groups = new Map<string, ExecutionGroup>();

  for (const event of events) {
    let group = groups.get(event.step_id);
    if (!group) {
      group = {
        step_id: event.step_id,
        goal_id: event.goal_id,
        plugin_id: event.plugin_id,
        capability: event.capability,
        status: 'unknown',
        started_at: null,
        latency_ms: null,
        events: [],
      };
      groups.set(event.step_id, group);
    }

    group.events.push(event);
    if (event.goal_id) group.goal_id = event.goal_id;
    if (event.plugin_id) group.plugin_id = event.plugin_id;
    if (event.capability) group.capability = event.capability;
    if (event.latency_ms != null) group.latency_ms = event.latency_ms;

    switch (event.kind) {
      case 'step_started':
        group.status = 'running';
        group.started_at = event.ts;
        break;
      case 'step_succeeded':
        group.status = 'succeeded';
        break;
      case 'step_failed':
        group.status = 'failed';
        break;
    }
  }

  return [...groups.values()];
}

/**
 * Fold a chronological event list into execution steps, keyed by `step_id`.
 * `step_started` creates a running step; `step_succeeded` / `step_failed`
 * finalize it with latency/output/error; `artifact_produced` attaches the
 * artifact ref. Steps without a visible `step_started` (ring-buffer
 * truncation) are still created from whatever events exist.
 */
export function foldEventsToSteps(events: RuntimeEvent[]): ExecutionStep[] {
  const steps = new Map<string, ExecutionStep>();

  for (const event of events) {
    switch (event.kind) {
      case 'step_started': {
        steps.set(event.step_id, {
          step_id: event.step_id,
          plugin_id: event.plugin_id,
          capability: event.capability,
          status: 'running',
          latency_ms: null,
          summary: event.summary,
          params: event.params ?? null,
          output: null,
          error: null,
          artifact_ref: event.artifact_ref,
          started_ts: event.ts,
        });
        break;
      }
      case 'step_succeeded':
      case 'step_failed': {
        let step = steps.get(event.step_id);
        if (!step) {
          step = {
            step_id: event.step_id,
            plugin_id: event.plugin_id,
            capability: event.capability,
            status: 'running',
            latency_ms: null,
            summary: event.summary,
            params: event.params ?? null,
            output: null,
            error: null,
            artifact_ref: null,
            started_ts: event.ts,
          };
          steps.set(event.step_id, step);
        }
        step.status = event.kind === 'step_succeeded' ? 'succeeded' : 'failed';
        if (event.latency_ms != null) step.latency_ms = event.latency_ms;
        if (event.summary) step.summary = event.summary;
        if (event.plugin_id) step.plugin_id = event.plugin_id;
        if (event.capability) step.capability = event.capability;
        if (event.output != null) step.output = event.output;
        if (event.error != null) step.error = event.error;
        if (event.artifact_ref) step.artifact_ref = event.artifact_ref;
        break;
      }
      case 'artifact_produced': {
        const step = steps.get(event.step_id);
        if (step && event.artifact_ref) step.artifact_ref = event.artifact_ref;
        break;
      }
    }
  }

  return [...steps.values()].sort((a, b) => a.started_ts.localeCompare(b.started_ts));
}

/**
 * Minimal state slice the goal helpers read from — the full runtime store
 * state satisfies it, so `stepsForGoal(useRuntimeStore.getState(), id)` works.
 */
export interface RuntimeEventSource {
  events: RuntimeEvent[];
  loadedTraceEvents: Record<string, RuntimeEvent[]>;
}

/**
 * Events for a goal, merging the live ring buffer with persisted trace loads.
 * If the live buffer holds any event for the goal it wins outright;
 * otherwise fall back to events loaded via `loadTraceEvents`.
 */
function eventsForGoal(state: RuntimeEventSource, goalId: string): RuntimeEvent[] {
  const live = state.events.filter((e) => e.goal_id === goalId);
  if (live.length > 0) return live;
  return state.loadedTraceEvents[goalId] ?? [];
}

/** Steps of one goal/trace, chronological by `started_ts`. */
export function stepsForGoal(state: RuntimeEventSource, goalId: string): ExecutionStep[] {
  return foldEventsToSteps(eventsForGoal(state, goalId));
}

/** Planned steps for a goal, from its latest `plan_started` event (`params.steps`). */
export function planForGoal(state: RuntimeEventSource, goalId: string): PlannedStep[] | null {
  const events = eventsForGoal(state, goalId);
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.kind !== 'plan_started') continue;
    const raw = event.params?.steps;
    if (!Array.isArray(raw)) return null;
    const planned: PlannedStep[] = [];
    for (const item of raw) {
      if (item && typeof item === 'object') {
        const { plugin_id, capability } = item as Record<string, unknown>;
        if (typeof capability === 'string') {
          planned.push({
            plugin_id: typeof plugin_id === 'string' ? plugin_id : null,
            capability,
          });
        }
      }
    }
    return planned;
  }
  return null;
}

/** Artifacts produced within a goal, chronological. */
export function artifactsForGoal(
  state: RuntimeEventSource,
  goalId: string
): { ref: string; ts: string; capability: string | null }[] {
  return eventsForGoal(state, goalId)
    .filter((e) => e.kind === 'artifact_produced' && e.artifact_ref != null)
    .map((e) => ({ ref: e.artifact_ref as string, ts: e.ts, capability: e.capability }));
}

interface RuntimeState {
  /** Ring buffer of the last 500 runtime events, oldest first. */
  events: RuntimeEvent[];
  /** Events grouped into step runs, derived from `events`. */
  executions: ExecutionGroup[];
  observability: ObservabilitySnapshot | null;
  /** Step currently shown in the execution inspector. */
  selectedStepId: string | null;
  /** Persisted trace summaries (newest first), from `trace_list`. */
  traces: TraceSummary[];
  /** True once `loadTraces` has settled (even on error). */
  tracesLoaded: boolean;
  /** Persisted per-trace events loaded on demand via `trace_get`, keyed by goal_id. */
  loadedTraceEvents: Record<string, RuntimeEvent[]>;

  pushEvent: (event: RuntimeEvent) => void;
  setObservability: (snapshot: ObservabilitySnapshot) => void;
  selectStep: (stepId: string | null) => void;
  loadTraces: () => Promise<void>;
  loadTraceEvents: (goalId: string) => Promise<void>;
  clear: () => void;
}

/** In-flight `trace_get` calls, to dedupe concurrent expand/load triggers. */
const inflightTraceLoads = new Set<string>();

export const useRuntimeStore = create<RuntimeState>()(
  immer((set, get) => ({
    events: [],
    executions: [],
    observability: null,
    selectedStepId: null,
    traces: [],
    tracesLoaded: false,
    loadedTraceEvents: {},

    pushEvent: (event) => {
      set((state) => {
        state.events.push(castDraft(event));
        if (state.events.length > MAX_EVENTS) {
          state.events.splice(0, state.events.length - MAX_EVENTS);
        }
        state.executions = castDraft(deriveExecutions(current(state).events));
      });
    },

    setObservability: (snapshot) => {
      set((state) => {
        state.observability = castDraft(snapshot);
      });
    },

    selectStep: (stepId) => {
      set((state) => {
        state.selectedStepId = stepId;
      });
    },

    loadTraces: async () => {
      try {
        const traces = await invoke<TraceSummary[]>('trace_list', { limit: TRACE_LIST_LIMIT });
        set((state) => {
          state.traces = castDraft(traces);
          state.tracesLoaded = true;
        });
      } catch (err) {
        console.warn('Failed to load persisted traces:', err);
        set((state) => {
          state.traces = [];
          state.tracesLoaded = true;
        });
      }
    },

    loadTraceEvents: async (goalId) => {
      if (get().loadedTraceEvents[goalId] || inflightTraceLoads.has(goalId)) return;
      inflightTraceLoads.add(goalId);
      try {
        const events = await invoke<RuntimeEvent[]>('trace_get', { goalId });
        set((state) => {
          state.loadedTraceEvents[goalId] = castDraft(events);
        });
      } catch (err) {
        console.warn(`Failed to load events for trace ${goalId}:`, err);
      } finally {
        inflightTraceLoads.delete(goalId);
      }
    },

    clear: () => {
      set((state) => {
        state.events = [];
        state.executions = [];
        state.observability = null;
        state.selectedStepId = null;
      });
    },
  }))
);
