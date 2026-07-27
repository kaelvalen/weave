import { useState } from 'react';
import { Check, ChevronRight, Loader2, X } from 'lucide-react';
import { useRuntimeStore } from '@/stores/useRuntimeStore';
import type { ExecutionStep } from '../../types/runtime';

/**
 * Vertical execution step timeline — the canonical per-goal step list.
 *
 * Consumed by the Execution Workspace (chat) and the Execution view.
 * Visual contract: `step-node-enter` / `step-node-running` CSS classes
 * (defined in styles.css), flat surface styling, no shadows.
 *
 * Clicking a step header toggles its inline details and also marks the step
 * as selected in the runtime store, so the Execution view's Inspector panel
 * follows the selection.
 */

interface StepTimelineProps {
  steps: ExecutionStep[];
  /** True while the owning goal is still executing (running steps pulse). */
  live?: boolean;
}

function StatusIcon({ status, live }: { status: ExecutionStep['status']; live?: boolean }) {
  if (status === 'running') {
    return (
      <Loader2
        size={12}
        className={`animate-spin text-brand ${live ? 'step-node-running' : ''}`}
      />
    );
  }
  if (status === 'failed') {
    return <X size={12} className="text-destructive" />;
  }
  return <Check size={12} className="text-brand check-pop" />;
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="mt-1">
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <pre className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-2 p-2 font-mono text-[11px]">
        {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

export function StepTimeline({ steps, live }: StepTimelineProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const selectedStepId = useRuntimeStore((s) => s.selectedStepId);
  const selectStep = useRuntimeStore((s) => s.selectStep);

  if (steps.length === 0) return null;

  return (
    <div className="flex flex-col">
      {steps.map((step, i) => {
        const isOpen = !!expanded[step.step_id];
        const hasDetails =
          step.params != null || step.output != null || step.error != null || step.artifact_ref != null;
        const isSelected = selectedStepId === step.step_id;
        return (
          <div key={step.step_id} className="step-node-enter relative flex gap-2 py-1.5">
            {i < steps.length - 1 && (
              <div className="absolute left-[5px] top-6 bottom-0 w-px bg-border" aria-hidden />
            )}
            <div className="mt-0.5 flex h-3 w-3 shrink-0 items-center justify-center">
              <StatusIcon status={step.status} live={live} />
            </div>
            <div className="min-w-0 flex-1">
              <button
                type="button"
                title={step.summary || (step.capability ?? undefined)}
                className={`flex w-full items-center gap-2 rounded px-1 -mx-1 text-left transition-colors ${
                  isSelected ? 'bg-accent' : 'hover:bg-muted/50'
                }`}
                onClick={() => {
                  selectStep(step.step_id);
                  if (hasDetails) {
                    setExpanded((prev) => ({ ...prev, [step.step_id]: !prev[step.step_id] }));
                  }
                }}
              >
                {hasDetails && (
                  <ChevronRight
                    size={10}
                    className={`shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-90' : ''}`}
                  />
                )}
                <span className="truncate font-mono text-xs">{step.capability ?? step.summary}</span>
                {step.plugin_id && (
                  <span className="truncate font-mono text-[10px] text-muted-foreground">
                    {step.plugin_id}
                  </span>
                )}
                {step.latency_ms != null && (
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                    {step.latency_ms}ms
                  </span>
                )}
              </button>
              {isOpen && (
                <div className="mt-1">
                  {step.summary && (
                    <div className="font-mono text-[11px] text-muted-foreground">{step.summary}</div>
                  )}
                  <JsonBlock label="params" value={step.params} />
                  <JsonBlock label="output" value={step.output} />
                  <JsonBlock label="error" value={step.error} />
                  {step.artifact_ref && (
                    <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                      artifact: {step.artifact_ref}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
