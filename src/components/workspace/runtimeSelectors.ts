
import {
  useRuntimeStore,
  stepsForGoal,
  planForGoal,
  artifactsForGoal,
  memoryUpdatesForGoal,
  goalStats,
  type GoalStats,
} from '@/stores/useRuntimeStore';
import type { ExecutionStep, PlannedStep, RuntimeEvent } from '@/types/runtime';

/**
 * Per-goal runtime selectors for the Execution Workspace.
 *
 * `useRuntimeStore` is being extended with `stepsForGoal` / `planForGoal` /
 * `artifactsForGoal` helpers; while they land, these adapters derive the same
 * data from the raw `events` ring buffer, so callers work either way. When the
 * store exposes a helper, we delegate to it.
 */

export interface EventArtifact {
  ref: string;
  ts: string;
  capability: string | null;
}

/** Shape of the helpers the runtime store may expose (duck-typed). */
interface RuntimeStoreHelpers {
  stepsForGoal?: (goalId: string) => ExecutionStep[];
  planForGoal?: (goalId: string) => PlannedStep[] | null;
  artifactsForGoal?: (goalId: string) => EventArtifact[];
}

function storeHelpers(): RuntimeStoreHelpers {
  return useRuntimeStore.getState() as unknown as RuntimeStoreHelpers;
}

const STEP_EVENT_KINDS = new Set(['step_started', 'step_succeeded', 'step_failed']);

/** Fold step_started/step_succeeded/step_failed events for a goal into ExecutionSteps. */
export function deriveStepsForGoal(events: RuntimeEvent[], goalId: string): ExecutionStep[] {
  const steps = new Map<string, ExecutionStep>();

  for (const event of events) {
    if (event.goal_id !== goalId || !STEP_EVENT_KINDS.has(event.kind)) continue;

    let step = steps.get(event.step_id);
    if (!step) {
      step = {
        step_id: event.step_id,
        plugin_id: event.plugin_id,
        capability: event.capability,
        status: 'running',
        latency_ms: null,
        summary: event.summary,
        params: null,
        output: null,
        error: null,
        artifact_ref: null,
        started_ts: event.ts,
      };
      steps.set(event.step_id, step);
    }

    if (event.plugin_id) step.plugin_id = event.plugin_id;
    if (event.capability) step.capability = event.capability;
    if (event.latency_ms != null) step.latency_ms = event.latency_ms;
    if (event.summary) step.summary = event.summary;
    if (event.artifact_ref) step.artifact_ref = event.artifact_ref;

    switch (event.kind) {
      case 'step_started':
        step.status = 'running';
        step.started_ts = event.ts;
        if (event.params != null) step.params = event.params;
        break;
      case 'step_succeeded':
        step.status = 'succeeded';
        if (event.output != null) step.output = event.output;
        break;
      case 'step_failed':
        step.status = 'failed';
        if (event.error != null) step.error = event.error;
        break;
    }
  }

  return [...steps.values()];
}

function parsePlannedSteps(raw: unknown): PlannedStep[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const steps: PlannedStep[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const capability = (item as Record<string, unknown>).capability;
    if (typeof capability !== 'string') return null;
    const pluginId = (item as Record<string, unknown>).plugin_id;
    steps.push({ plugin_id: typeof pluginId === 'string' ? pluginId : null, capability });
  }
  return steps;
}

/** Extract the planned steps from the latest plan_started event for a goal. */
export function derivePlanForGoal(events: RuntimeEvent[], goalId: string): PlannedStep[] | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.kind !== 'plan_started' || event.goal_id !== goalId) continue;
    const params = event.params as Record<string, unknown> | null | undefined;
    const steps = parsePlannedSteps(params?.steps) ?? parsePlannedSteps(params?.plan);
    if (steps) return steps;
  }
  return null;
}

/** artifact_produced events for a goal, oldest first. */
export function deriveArtifactsForGoal(events: RuntimeEvent[], goalId: string): EventArtifact[] {
  const artifacts: EventArtifact[] = [];
  for (const event of events) {
    if (event.kind !== 'artifact_produced' || event.goal_id !== goalId || !event.artifact_ref) {
      continue;
    }
    artifacts.push({ ref: event.artifact_ref, ts: event.ts, capability: event.capability });
  }
  return artifacts;
}

export function useStepsForGoal(goalId: string): ExecutionStep[] {
  const events = useRuntimeStore((s) => s.events);
  const loadedTraceEvents = useRuntimeStore((s) => s.loadedTraceEvents);
  const helper = storeHelpers().stepsForGoal;
  if (typeof helper === 'function') return helper(goalId);
  return stepsForGoal({ events, loadedTraceEvents }, goalId);
}

export function usePlanForGoal(goalId: string): PlannedStep[] | null {
  const events = useRuntimeStore((s) => s.events);
  const loadedTraceEvents = useRuntimeStore((s) => s.loadedTraceEvents);
  const helper = storeHelpers().planForGoal;
  if (typeof helper === 'function') return helper(goalId);
  return planForGoal({ events, loadedTraceEvents }, goalId);
}

export function useArtifactsForGoals(goalIds: string[]): EventArtifact[] {
  const events = useRuntimeStore((s) => s.events);
  const loadedTraceEvents = useRuntimeStore((s) => s.loadedTraceEvents);
  const helper = storeHelpers().artifactsForGoal;
  const out: EventArtifact[] = [];
  for (const goalId of goalIds) {
    if (typeof helper === 'function') {
      out.push(...helper(goalId));
    } else {
      out.push(...artifactsForGoal({ events, loadedTraceEvents }, goalId));
    }
  }
  return out;
}

export function useGoalStats(goalId: string): GoalStats {
  const events = useRuntimeStore((s) => s.events);
  const loadedTraceEvents = useRuntimeStore((s) => s.loadedTraceEvents);
  return goalStats({ events, loadedTraceEvents }, goalId);
}

export function useMemoryUpdatesForGoal(goalId: string) {
  const events = useRuntimeStore((s) => s.events);
  const loadedTraceEvents = useRuntimeStore((s) => s.loadedTraceEvents);
  return memoryUpdatesForGoal({ events, loadedTraceEvents }, goalId);
}
