import { useEffect, useMemo } from 'react';
import { useRuntimeStore, type ExecutionGroup } from '@/stores/useRuntimeStore';
import { useAppStore } from '@/stores/useAppStore';
import { useChatStore } from '@/stores/useChatStore';
import { refreshObservability } from '@/hooks/useRuntimeEvents';
import { InspectorPanel } from '@/components/execution/InspectorPanel';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Check, ChevronRight, Loader2, X, Circle, Activity } from 'lucide-react';

interface TraceGroup {
  id: string;
  isTrace: boolean;
  steps: ExecutionGroup[];
  status: ExecutionGroup['status'];
  totalLatencyMs: number;
  stepCount: number;
  lastTs: string;
}

function groupByTrace(executions: ExecutionGroup[]): TraceGroup[] {
  const map = new Map<string, ExecutionGroup[]>();
  for (const exec of executions) {
    const key = exec.goal_id ?? exec.step_id;
    const list = map.get(key);
    if (list) {
      list.push(exec);
    } else {
      map.set(key, [exec]);
    }
  }

  return [...map.entries()]
    .map(([id, steps]) => {
      const status: ExecutionGroup['status'] = steps.some((s) => s.status === 'running')
        ? 'running'
        : steps.some((s) => s.status === 'failed')
          ? 'failed'
          : steps.every((s) => s.status === 'succeeded')
            ? 'succeeded'
            : 'unknown';
      const lastTs =
        steps
          .map((s) => s.events[s.events.length - 1]?.ts ?? '')
          .sort()
          .pop() ?? '';
      return {
        id,
        isTrace: steps[0]?.goal_id != null,
        steps,
        status,
        totalLatencyMs: steps.reduce((acc, s) => acc + (s.latency_ms ?? 0), 0),
        stepCount: steps.length,
        lastTs,
      };
    })
    .sort((a, b) => b.lastTs.localeCompare(a.lastTs));
}

function timeAgo(ts: string): string {
  const then = new Date(ts).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

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

/** Short single-line snippet of a chat message, for trace group titles. */
function messageSnippet(content: string, maxLen = 48): string {
  const collapsed = content.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLen) return collapsed;
  return `${collapsed.slice(0, maxLen)}…`;
}

function StepRow({
  step,
  selected,
  onSelect,
}: {
  step: ExecutionGroup;
  selected: boolean;
  onSelect: () => void;
}) {
  const lastEvent = step.events[step.events.length - 1];
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded font-mono text-xs text-left transition-colors ${
        selected ? 'bg-accent' : 'hover:bg-muted/50'
      }`}
    >
      <StatusIcon status={step.status} />
      <span className="text-foreground font-semibold truncate">{step.capability ?? 'unknown'}</span>
      <span className="text-muted-foreground truncate hidden sm:inline">
        {step.plugin_id ?? ''}
      </span>
      <span className="flex-1" />
      {step.latency_ms != null && (
        <span className="text-muted-foreground text-[11px]">{step.latency_ms}ms</span>
      )}
      {lastEvent && (
        <span className="text-muted-foreground/70 text-[11px]">{timeAgo(lastEvent.ts)}</span>
      )}
    </button>
  );
}

export function ExecutionView() {
  const executions = useRuntimeStore((s) => s.executions);
  const observability = useRuntimeStore((s) => s.observability);
  const selectedStepId = useRuntimeStore((s) => s.selectedStepId);
  const selectStep = useRuntimeStore((s) => s.selectStep);
  const isRightPanelOpen = useAppStore((s) => s.isRightPanelOpen);
  const setRightPanelOpen = useAppStore((s) => s.setRightPanelOpen);

  useEffect(() => {
    refreshObservability();
    const interval = setInterval(refreshObservability, 5000);
    return () => clearInterval(interval);
  }, []);

  const traces = useMemo(() => groupByTrace(executions), [executions]);

  // Trace groups are keyed by chat message id (goal_id); resolve them against
  // the loaded chat thread for a meaningful title. Traces from older sessions
  // fall back to the generic label — no cross-session loading.
  const messages = useChatStore((s) => s.messages);
  const traceLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of messages) {
      if (m.content.trim()) map.set(m.id, messageSnippet(m.content));
    }
    return map;
  }, [messages]);

  const stats = useMemo(() => {
    if (!observability) return null;
    const failures = Object.values(observability.tool_metrics).reduce(
      (acc, m) => acc + m.failure_count,
      0
    );
    const topTool = Object.entries(observability.tool_metrics).sort(
      (a, b) => b[1].call_count - a[1].call_count
    )[0];
    return { failures, topTool };
  }, [observability]);

  const handleSelectStep = (stepId: string) => {
    selectStep(stepId);
    setRightPanelOpen(true);
  };

  return (
    <div className="flex h-full w-full bg-background overflow-hidden">
      {/* ── Timeline column ── */}
      <div className="flex-1 flex flex-col min-w-0 h-full">
        <div className="h-10 px-3 flex items-center justify-between border-b border-border flex-shrink-0 font-mono text-xs">
          <span className="font-semibold text-foreground uppercase tracking-wider flex items-center gap-2">
            <Activity className="w-3.5 h-3.5" />
            Execution
          </span>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span>{observability?.total_tool_calls ?? 0} tool calls</span>
            <span className="text-border">•</span>
            <span className={stats && stats.failures > 0 ? 'text-destructive' : ''}>
              {stats?.failures ?? 0} failures
            </span>
            <span className="text-border">•</span>
            <span className="truncate max-w-40">
              top: {stats?.topTool ? `${stats.topTool[0]} (${stats.topTool[1].call_count})` : '—'}
            </span>
          </div>
        </div>

        <ScrollArea className="flex-1">
          {traces.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-2 py-16 select-none">
              <Activity className="w-6 h-6 text-muted-foreground/50" />
              <p className="font-mono text-xs text-muted-foreground">Runtime idle</p>
              <p className="font-mono text-[11px] text-muted-foreground/70">
                No executions yet — send a chat message that uses a tool.
              </p>
            </div>
          ) : (
            <div className="p-2 flex flex-col gap-1">
              {traces.map((trace, idx) => (
                <Collapsible key={trace.id} defaultOpen={idx === 0 || trace.status === 'running'}>
                  <div className="border border-border rounded-md bg-card">
                    <CollapsibleTrigger className="w-full flex items-center gap-2 px-2 py-1.5 font-mono text-xs hover:bg-muted/50 rounded-t-md transition-colors group">
                      <ChevronRight className="w-3 h-3 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
                      <StatusIcon status={trace.status} />
                      <span
                        className="text-foreground font-semibold truncate max-w-72"
                        title={trace.isTrace ? (traceLabels.get(trace.id) ?? undefined) : undefined}
                      >
                        {trace.isTrace
                          ? (traceLabels.get(trace.id) ?? 'Assistant message')
                          : 'Standalone step'}
                      </span>
                      <span className="text-muted-foreground text-[11px]">
                        · {trace.stepCount} {trace.stepCount === 1 ? 'step' : 'steps'} ·{' '}
                        {trace.totalLatencyMs}ms
                      </span>
                      <span className="flex-1" />
                      <span className="text-muted-foreground/70 text-[11px]">
                        {timeAgo(trace.lastTs)}
                      </span>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="border-t border-border p-1 flex flex-col gap-0.5">
                        {trace.steps.map((step) => (
                          <StepRow
                            key={step.step_id}
                            step={step}
                            selected={selectedStepId === step.step_id}
                            onSelect={() => handleSelectStep(step.step_id)}
                          />
                        ))}
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* ── Inspector column ── */}
      {isRightPanelOpen && <InspectorPanel />}
    </div>
  );
}
