import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { castDraft, current } from 'immer';
import type { ObservabilitySnapshot, RuntimeEvent } from '@/types/runtime';

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

interface RuntimeState {
  /** Ring buffer of the last 500 runtime events, oldest first. */
  events: RuntimeEvent[];
  /** Events grouped into step runs, derived from `events`. */
  executions: ExecutionGroup[];
  observability: ObservabilitySnapshot | null;
  /** Step currently shown in the execution inspector. */
  selectedStepId: string | null;

  pushEvent: (event: RuntimeEvent) => void;
  setObservability: (snapshot: ObservabilitySnapshot) => void;
  selectStep: (stepId: string | null) => void;
  clear: () => void;
}

export const useRuntimeStore = create<RuntimeState>()(
  immer((set) => ({
    events: [],
    executions: [],
    observability: null,
    selectedStepId: null,

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
