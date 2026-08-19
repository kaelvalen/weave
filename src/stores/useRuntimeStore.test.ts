import { describe, it, expect, beforeEach } from 'vitest';
import { useRuntimeStore, stepsForGoal, planForGoal } from './useRuntimeStore';
import type { RuntimeEvent } from '@/types/runtime';

function ev(
  partial: Partial<RuntimeEvent> & { step_id: string; kind: RuntimeEvent['kind'] }
): RuntimeEvent {
  return {
    ts: '2026-01-01T00:00:00Z',
    goal_id: null,
    plugin_id: null,
    capability: null,
    latency_ms: null,
    summary: '',
    artifact_ref: null,
    ...partial,
  };
}

/**
 * Runtime-event aggregation: the backend streams runtime events over the
 * event bus; this store folds them into the goal traces the UI displays.
 * Tests the pure folds (stepsForGoal/planForGoal) against real pushEvent
 * traffic rather than the observable surface.
 */
describe('useRuntimeStore (runtime-event aggregation)', () => {
  beforeEach(() => {
    useRuntimeStore.getState().clear();
  });

  it('pushEvent accumulates events (bounded ring buffer)', () => {
    const store = useRuntimeStore.getState();
    store.pushEvent(ev({ kind: 'step_started', step_id: 's1', goal_id: 'g1' }));
    expect(useRuntimeStore.getState().events).toHaveLength(1);
  });

  it('folds step_started + step_succeeded into one succeeded step', () => {
    const store = useRuntimeStore.getState();
    store.pushEvent(
      ev({
        kind: 'step_started',
        step_id: 's1',
        goal_id: 'g1',
        plugin_id: 'com.weave.builtin.file',
        capability: 'file.read',
        summary: 'read src',
      })
    );
    store.pushEvent(
      ev({
        kind: 'step_succeeded',
        step_id: 's1',
        goal_id: 'g1',
        plugin_id: 'com.weave.builtin.file',
        capability: 'file.read',
        latency_ms: 12,
        output: { n: 1 },
      })
    );

    const steps = stepsForGoal(useRuntimeStore.getState(), 'g1');
    expect(steps).toHaveLength(1);
    expect(steps[0].status).toBe('succeeded');
    expect(steps[0].capability).toBe('file.read');
    expect(steps[0].latency_ms).toBe(12);
  });

  it('reports a step with no succeeding event as running', () => {
    const store = useRuntimeStore.getState();
    store.pushEvent(ev({ kind: 'step_started', step_id: 's9', goal_id: 'g2' }));
    const steps = stepsForGoal(useRuntimeStore.getState(), 'g2');
    expect(steps).toHaveLength(1);
    expect(steps[0].status).toBe('running');
  });

  it('planForGoal extracts the latest planned steps from params.steps', () => {
    const store = useRuntimeStore.getState();
    store.pushEvent(
      ev({
        kind: 'plan_started',
        step_id: 'p',
        goal_id: 'g3',
        params: { steps: [{ plugin_id: 'x', capability: 'file.read' }] },
      })
    );
    const plan = planForGoal(useRuntimeStore.getState(), 'g3');
    expect(plan).toEqual([{ plugin_id: 'x', capability: 'file.read' }]);
  });

  it('clear() empties the event buffer', () => {
    const store = useRuntimeStore.getState();
    store.pushEvent(ev({ kind: 'step_started', step_id: 's1', goal_id: 'g1' }));
    useRuntimeStore.getState().clear();
    expect(useRuntimeStore.getState().events).toHaveLength(0);
  });
});
