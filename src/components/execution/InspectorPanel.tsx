import { useMemo, useState } from 'react';
import {
  useRuntimeStore,
  foldEventsToSteps,
  stepsForGoal,
} from '@/stores/useRuntimeStore';
import { useAppStore } from '@/stores/useAppStore';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Check, ChevronRight, Loader2, X, Circle } from 'lucide-react';
import type { ExecutionStep, RuntimeEvent } from '@/types/runtime';

const JSON_TRUNCATE_AT = 4096;

function StatusIcon({ status }: { status: ExecutionStep['status'] }) {
  switch (status) {
    case 'running':
      return <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />;
    case 'succeeded':
      return <Check className="w-3.5 h-3.5 text-emerald-500" />;
    case 'failed':
      return <X className="w-3.5 h-3.5 text-destructive" />;
    default:
      return <Circle className="w-3.5 h-3.5 text-muted-foreground/50" />;
  }
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
        {label}
      </span>
      <span className="font-mono text-xs text-foreground break-all">{value ?? '—'}</span>
    </div>
  );
}

/** Collapsible JSON block, truncated to ~4KB with an expand toggle. */
function JsonSection({
  label,
  value,
  defaultOpen = false,
}: {
  label: string;
  value: unknown;
  defaultOpen?: boolean;
}) {
  const [showFull, setShowFull] = useState(false);
  if (value === null || value === undefined) return null;

  const full = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const isLong = full.length > JSON_TRUNCATE_AT;
  const text = isLong && !showFull ? `${full.slice(0, JSON_TRUNCATE_AT)}\n…` : full;

  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground hover:text-foreground transition-colors group">
        <ChevronRight className="w-3 h-3 transition-transform group-data-[state=open]:rotate-90" />
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-1 p-2 rounded border border-border bg-background font-mono text-[11px] text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all">
          {text}
        </pre>
        {isLong && (
          <button
            type="button"
            onClick={() => setShowFull((v) => !v)}
            className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
          >
            {showFull ? 'Show less' : `Show all (${full.length.toLocaleString()} chars)`}
          </button>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** All events for a step: live ring buffer first, then loaded persisted traces. */
function findStepEvents(
  events: RuntimeEvent[],
  loadedTraceEvents: Record<string, RuntimeEvent[]>,
  stepId: string
): RuntimeEvent[] {
  const live = events.filter((e) => e.step_id === stepId);
  if (live.length > 0) return live;
  for (const traceEvents of Object.values(loadedTraceEvents)) {
    const match = traceEvents.filter((e) => e.step_id === stepId);
    if (match.length > 0) return match;
  }
  return [];
}

export function InspectorPanel() {
  const events = useRuntimeStore((s) => s.events);
  const loadedTraceEvents = useRuntimeStore((s) => s.loadedTraceEvents);
  const selectedStepId = useRuntimeStore((s) => s.selectedStepId);
  const selectStep = useRuntimeStore((s) => s.selectStep);
  const setRightPanelOpen = useAppStore((s) => s.setRightPanelOpen);

  const stepEvents = useMemo(
    () => (selectedStepId ? findStepEvents(events, loadedTraceEvents, selectedStepId) : []),
    [events, loadedTraceEvents, selectedStepId]
  );

  const step = useMemo(() => foldEventsToSteps(stepEvents)[0] ?? null, [stepEvents]);
  const goalId = stepEvents.find((e) => e.goal_id != null)?.goal_id ?? null;
  const lastEvent = stepEvents[stepEvents.length - 1] ?? null;

  // Other steps in the same trace (goal_id), for quick navigation.
  const traceSiblings = useMemo(() => {
    if (!goalId || !step) return [];
    return stepsForGoal({ events, loadedTraceEvents }, goalId).filter(
      (s) => s.step_id !== step.step_id
    );
  }, [events, loadedTraceEvents, goalId, step]);

  return (
    <aside className="w-80 flex-shrink-0 flex flex-col h-full border-l border-border bg-card">
      <div className="h-10 px-3 flex items-center justify-between border-b border-border flex-shrink-0 font-mono text-xs">
        <span className="font-semibold text-foreground uppercase tracking-wider">Inspector</span>
        <Button
          variant="ghost"
          size="icon"
          className="w-6 h-6 text-muted-foreground hover:text-foreground"
          onClick={() => setRightPanelOpen(false)}
          title="Close Inspector"
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        {!step ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 select-none">
            <p className="font-mono text-xs text-muted-foreground">No step selected</p>
            <p className="font-mono text-[11px] text-muted-foreground/70">
              Click a step in the timeline to inspect it.
            </p>
          </div>
        ) : (
          <div className="p-3 flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <StatusIcon status={step.status} />
              <span className="font-mono text-xs font-semibold text-foreground uppercase tracking-wider">
                {step.status}
              </span>
            </div>

            <div className="flex flex-col gap-3">
              <Field label="Capability" value={step.capability} />
              <Field label="Plugin" value={step.plugin_id} />
              <Field
                label="Latency"
                value={step.latency_ms != null ? `${step.latency_ms} ms` : null}
              />
              <Field label="Step ID" value={step.step_id} />
              <Field label="Trace ID" value={goalId} />
              <Field label="Summary" value={step.summary} />
              {step.artifact_ref && <Field label="Artifact" value={step.artifact_ref} />}
            </div>

            <div className="flex flex-col gap-2">
              <JsonSection label="Params" value={step.params} />
              <JsonSection label="Output" value={step.output} />
              <JsonSection label="Error" value={step.error} defaultOpen />
            </div>

            <Collapsible>
              <CollapsibleTrigger className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground hover:text-foreground transition-colors group">
                <ChevronRight className="w-3 h-3 transition-transform group-data-[state=open]:rotate-90" />
                Raw event
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="mt-1 p-2 rounded border border-border bg-background font-mono text-[11px] text-muted-foreground overflow-x-auto whitespace-pre">
                  {JSON.stringify(lastEvent, null, 2)}
                </pre>
              </CollapsibleContent>
            </Collapsible>

            {traceSiblings.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="font-mono text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  Trace steps ({traceSiblings.length})
                </span>
                {traceSiblings.map((sibling) => (
                  <button
                    key={sibling.step_id}
                    type="button"
                    onClick={() => selectStep(sibling.step_id)}
                    className="flex items-center gap-2 px-2 py-1.5 rounded font-mono text-xs text-left hover:bg-muted/50 transition-colors"
                  >
                    <StatusIcon status={sibling.status} />
                    <span className="text-foreground truncate">{sibling.capability}</span>
                    <span className="flex-1" />
                    {sibling.latency_ms != null && (
                      <span className="text-muted-foreground text-[11px]">
                        {sibling.latency_ms}ms
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </aside>
  );
}
