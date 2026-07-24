import { useEffect, useMemo, useState } from 'react';
import {
  useRuntimeStore,
  foldEventsToSteps,
  stepsForGoal,
  type ExecutionGroup,
} from '@/stores/useRuntimeStore';
import { useAppStore } from '@/stores/useAppStore';
import { useChatStore } from '@/stores/useChatStore';
import { usePluginStore } from '@/stores/usePluginStore';
import { refreshObservability } from '@/hooks/useRuntimeEvents';
import { InspectorPanel } from '@/components/execution/InspectorPanel';
import { StepTimeline } from '@/components/execution/StepTimeline';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Check, ChevronRight, Loader2, X, Circle, Activity } from 'lucide-react';
import type { ExecutionStep } from '@/types/runtime';

type TraceStatus = 'running' | 'succeeded' | 'failed' | 'unknown';

/** One row in the merged trace list — a live trace/step group or a persisted trace. */
interface TraceItem {
  /** goal_id for traces, step_id for standalone live steps. */
  key: string;
  goalId: string | null;
  title: string;
  status: TraceStatus;
  stepCount: number;
  totalLatencyMs: number;
  /** ts used for sorting and the time-ago label. */
  ts: string;
  /** True when the live ring buffer holds events for this trace (live wins over persistence). */
  isLive: boolean;
  /** Live events for standalone (goal-less) steps; null for goal traces. */
  standaloneEvents: ExecutionGroup['events'] | null;
}

function groupByTrace(executions: ExecutionGroup[]): { id: string; group: ExecutionGroup[] }[] {
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
  return [...map.entries()].map(([id, group]) => ({ id, group }));
}

function liveTraceItems(executions: ExecutionGroup[], traceLabels: Map<string, string>): TraceItem[] {
  return groupByTrace(executions)
    .map(({ id, group }) => {
      const status: TraceStatus = group.some((s) => s.status === 'running')
        ? 'running'
        : group.some((s) => s.status === 'failed')
          ? 'failed'
          : group.every((s) => s.status === 'succeeded')
            ? 'succeeded'
            : 'unknown';
      const lastTs =
        group
          .map((s) => s.events[s.events.length - 1]?.ts ?? '')
          .sort()
          .pop() ?? '';
      const isTrace = group[0]?.goal_id != null;
      return {
        key: id,
        goalId: isTrace ? id : null,
        title: isTrace ? (traceLabels.get(id) ?? 'Assistant message') : 'Standalone step',
        status,
        stepCount: group.length,
        totalLatencyMs: group.reduce((acc, s) => acc + (s.latency_ms ?? 0), 0),
        ts: lastTs,
        isLive: true,
        standaloneEvents: isTrace ? null : group.flatMap((g) => g.events),
      };
    })
    .sort((a, b) => b.ts.localeCompare(a.ts));
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

function StatusIcon({ status }: { status: TraceStatus }) {
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

/** Steps of one trace item, folded from live events or loaded persisted events. */
function TraceSteps({ item }: { item: TraceItem }) {
  const events = useRuntimeStore((s) => s.events);
  const loadedTraceEvents = useRuntimeStore((s) => s.loadedTraceEvents);

  const steps: ExecutionStep[] = useMemo(() => {
    if (item.goalId) {
      return stepsForGoal({ events, loadedTraceEvents }, item.goalId);
    }
    return item.standaloneEvents ? foldEventsToSteps(item.standaloneEvents) : [];
  }, [item.goalId, item.standaloneEvents, events, loadedTraceEvents]);

  if (steps.length === 0) {
    const loading =
      item.goalId != null && !item.isLive && loadedTraceEvents[item.goalId] === undefined;
    return (
      <div className="px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
        {loading ? 'Loading…' : 'No step events recorded'}
      </div>
    );
  }

  return <StepTimeline steps={steps} live={item.status === 'running'} />;
}

function TraceCard({ item, defaultOpen }: { item: TraceItem; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const loadTraceEvents = useRuntimeStore((s) => s.loadTraceEvents);
  const hasPersistedEvents = useRuntimeStore((s) =>
    item.goalId ? s.loadedTraceEvents[item.goalId] !== undefined : true
  );

  // Persisted-only traces load their events lazily on first expand.
  useEffect(() => {
    if (open && item.goalId && !item.isLive && !hasPersistedEvents) {
      loadTraceEvents(item.goalId);
    }
  }, [open, item.goalId, item.isLive, hasPersistedEvents, loadTraceEvents]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="border border-border rounded-md bg-card">
        <CollapsibleTrigger className="w-full flex items-center gap-2 px-2 py-1.5 font-mono text-xs hover:bg-muted/50 rounded-t-md transition-colors group">
          <ChevronRight className="w-3 h-3 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
          <StatusIcon status={item.status} />
          <span className="text-foreground font-semibold truncate max-w-72" title={item.title}>
            {item.title}
          </span>
          {item.isLive && item.goalId && (
            <span className="rounded border border-emerald-500/40 px-1 font-mono text-[9px] uppercase tracking-wider text-emerald-500">
              live
            </span>
          )}
          <span className="text-muted-foreground text-[11px]">
            · {item.stepCount} {item.stepCount === 1 ? 'step' : 'steps'} · {item.totalLatencyMs}ms
          </span>
          <span className="flex-1" />
          <span className="text-muted-foreground/70 text-[11px]">{timeAgo(item.ts)}</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-border p-2">
            <TraceSteps item={item} />
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function EmptyState() {
  const observability = useRuntimeStore((s) => s.observability);
  const plugins = usePluginStore((s) => s.plugins);
  const capabilityCount = useMemo(
    () => plugins.reduce((acc, p) => acc + (p.capabilities?.provide?.length ?? 0), 0),
    [plugins]
  );

  return (
    <div className="p-6 sm:p-10 max-w-4xl mx-auto w-full flex flex-col gap-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground mb-1">
          Execution Runtime
        </h1>
        <p className="text-sm text-muted-foreground">
          No executions yet — run a goal in Conversation.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="bg-surface-1 rounded-xl p-4 border border-border flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground font-mono">
            Tool Calls
          </span>
          <span className="text-lg font-semibold text-foreground">
            {observability ? observability.total_tool_calls : '—'}
          </span>
        </div>
        {capabilityCount > 0 && (
          <div className="bg-surface-1 rounded-xl p-4 border border-border flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground font-mono">
              Capabilities Available
            </span>
            <span className="text-lg font-semibold text-foreground">{capabilityCount}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function ExecutionView() {
  const executions = useRuntimeStore((s) => s.executions);
  const observability = useRuntimeStore((s) => s.observability);
  const persistedTraces = useRuntimeStore((s) => s.traces);
  const tracesLoaded = useRuntimeStore((s) => s.tracesLoaded);
  const loadTraces = useRuntimeStore((s) => s.loadTraces);
  const selectedStepId = useRuntimeStore((s) => s.selectedStepId);
  const isRightPanelOpen = useAppStore((s) => s.isRightPanelOpen);
  const setRightPanelOpen = useAppStore((s) => s.setRightPanelOpen);

  useEffect(() => {
    loadTraces();
    refreshObservability();
    const interval = setInterval(refreshObservability, 5000);
    return () => clearInterval(interval);
  }, [loadTraces]);

  // StepTimeline dispatches step selection itself (shared with chat); surface
  // it in the inspector here.
  useEffect(() => {
    if (selectedStepId) setRightPanelOpen(true);
  }, [selectedStepId, setRightPanelOpen]);

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

  // Live traces pin on top; persisted traces fill in history from before app
  // start. Dedupe by goal_id — the live buffer wins for traces it still holds.
  const items = useMemo(() => {
    const live = liveTraceItems(executions, traceLabels);
    const liveGoalIds = new Set(live.map((t) => t.goalId).filter((id) => id != null));
    const persisted: TraceItem[] = persistedTraces
      .filter((t) => !liveGoalIds.has(t.goal_id))
      .map((t) => ({
        key: t.goal_id,
        goalId: t.goal_id,
        title: t.title || 'Untitled goal',
        status: t.status,
        stepCount: t.step_count,
        totalLatencyMs: t.total_latency_ms,
        ts: t.ended_at ?? t.started_at,
        isLive: false,
        standaloneEvents: null,
      }));
    return [...live, ...persisted];
  }, [executions, persistedTraces, traceLabels]);

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
            <span>{observability ? observability.total_tool_calls : '—'} tool calls</span>
            <span className="text-border">•</span>
            <span className={stats && stats.failures > 0 ? 'text-destructive' : ''}>
              {stats?.failures ?? '—'} failures
            </span>
            <span className="text-border">•</span>
            <span className="truncate max-w-40">
              top: {stats?.topTool ? `${stats.topTool[0]} (${stats.topTool[1].call_count})` : '—'}
            </span>
            {tracesLoaded && persistedTraces.length > 0 && (
              <>
                <span className="text-border">•</span>
                <span>{persistedTraces.length} traces</span>
              </>
            )}
          </div>
        </div>

        <ScrollArea className="flex-1">
          {items.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="p-2 flex flex-col gap-1">
              {items.map((item, idx) => (
                <TraceCard
                  key={item.key}
                  item={item}
                  defaultOpen={idx === 0 || item.status === 'running'}
                />
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
