import { useMemo } from 'react';
import { useRuntimeStore, type ExecutionGroup } from '@/stores/useRuntimeStore';
import { useAppStore } from '@/stores/useAppStore';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Check, ChevronRight, Loader2, X, Circle } from 'lucide-react';

function StatusIcon({ status }: { status: ExecutionGroup['status'] }) {
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

export function InspectorPanel() {
  const executions = useRuntimeStore((s) => s.executions);
  const selectedStepId = useRuntimeStore((s) => s.selectedStepId);
  const selectStep = useRuntimeStore((s) => s.selectStep);
  const setRightPanelOpen = useAppStore((s) => s.setRightPanelOpen);

  const step = useMemo(
    () => executions.find((e) => e.step_id === selectedStepId) ?? null,
    [executions, selectedStepId]
  );

  // Other steps in the same trace (goal_id), for quick navigation.
  const traceSiblings = useMemo(() => {
    if (!step?.goal_id) return [];
    return executions.filter((e) => e.goal_id === step.goal_id && e.step_id !== step.step_id);
  }, [executions, step]);

  const lastEvent = step?.events[step.events.length - 1] ?? null;

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
              <Field label="Trace ID" value={step.goal_id} />
              <Field label="Summary" value={lastEvent?.summary} />
              {lastEvent?.artifact_ref && <Field label="Artifact" value={lastEvent.artifact_ref} />}
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
