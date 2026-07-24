import { StepTimeline } from '@/components/execution/StepTimeline';
import type { ExecutionStep, PlannedStep } from '@/types/runtime';
import { SectionLabel } from './SectionLabel';

/**
 * Live EXECUTION block for a goal: the PLAN (capability chips reported via
 * `runtime_note_plan`) followed by the real-time step timeline fed by runtime
 * events. Renders nothing when the goal has neither a plan nor steps (e.g.
 * plain-text replies and historical sessions), where callers fall back to the
 * metadata-driven activity accordion.
 */
export function ExecutionSection({
  plan,
  steps,
  live,
}: {
  plan: PlannedStep[] | null;
  steps: ExecutionStep[];
  live?: boolean;
}) {
  if (steps.length === 0 && !plan) return null;

  const isLive = live || steps.some((s) => s.status === 'running');

  return (
    <div className="my-2 rounded-md border border-border bg-surface-1 px-3 py-2">
      {plan && (
        <div className={steps.length > 0 ? 'mb-2' : ''}>
          <SectionLabel>Plan</SectionLabel>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {plan.map((step, i) => (
              <span
                key={`${step.capability}-${i}`}
                title={step.plugin_id ?? step.capability}
                className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
              >
                {step.capability}
              </span>
            ))}
          </div>
        </div>
      )}
      <StepTimeline steps={steps} live={isLive} />
    </div>
  );
}
