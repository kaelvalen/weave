import { useMemo, useState } from 'react';
import {
  useRuntimeStore,
  stepsForGoal,
  planForGoal,
  artifactsForGoal,
  memoryUpdatesForGoal,
  goalStats,
} from '@/stores/useRuntimeStore';
import { StepTimeline } from '@/components/execution/StepTimeline';
import { InspectorPanel } from '@/components/execution/InspectorPanel';
import { useAppStore } from '@/stores/useAppStore';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Check, ChevronRight, Loader2, X, Circle, Activity, Brain, Package, GitMerge } from 'lucide-react';
import { formatBytes } from '@/lib/utils';
import { usePluginStore } from '@/stores/usePluginStore';

function StatusIcon({ status }: { status: 'running' | 'completed' | 'failed' | 'unknown' }) {
  switch (status) {
    case 'running':
      return <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />;
    case 'completed':
      return <Check className="w-3.5 h-3.5 text-emerald-500" />;
    case 'failed':
      return <X className="w-3.5 h-3.5 text-destructive" />;
    default:
      return <Circle className="w-3.5 h-3.5 text-muted-foreground/50" />;
  }
}

export function GoalTrace({ goalId, defaultOpen }: { goalId: string; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const events = useRuntimeStore((s) => s.events);
  const loadedTraceEvents = useRuntimeStore((s) => s.loadedTraceEvents);
  const state = { events, loadedTraceEvents };

  const stats = goalStats(state, goalId);
  const plan = planForGoal(state, goalId);
  const steps = stepsForGoal(state, goalId);
  const artifacts = artifactsForGoal(state, goalId);
  const memory = memoryUpdatesForGoal(state, goalId);
  
  const plugins = usePluginStore(s => s.plugins);
  
  const getCapabilityLabel = (cap: string) => {
    for (const plugin of plugins) {
      if (plugin.capabilities?.descriptions?.[cap]) {
        return plugin.capabilities.descriptions[cap];
      }
    }
    return cap;
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mb-2 last:mb-0">
      <div className="border border-border rounded-md bg-card">
        <CollapsibleTrigger className="w-full flex items-center gap-2 px-2 py-1.5 font-mono text-xs hover:bg-muted/50 rounded-t-md transition-colors group">
          <ChevronRight className="w-3 h-3 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
          <StatusIcon status={stats.status} />
          <span className="text-foreground font-semibold truncate">Trace: {goalId.slice(0, 8)}</span>
          {stats.status === 'running' && (
            <span className="rounded border border-emerald-500/40 px-1 font-mono text-[9px] uppercase tracking-wider text-emerald-500">
              live
            </span>
          )}
          <span className="text-muted-foreground text-[11px]">
            · {stats.durationMs ? `${stats.durationMs}ms` : 'running'}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-border flex flex-col">
            {/* PLANNING SECTION */}
            {plan && plan.length > 0 && (
              <div className="p-2 border-b border-border/50 bg-muted/10">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                  <GitMerge className="w-3 h-3" />
                  Planning
                  {stats.status === 'running' && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse ml-1" />}
                </div>
                <div className="flex flex-col gap-1 pl-5">
                  {plan.map((p, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs font-mono text-foreground/80">
                      <span className="w-4 h-4 flex items-center justify-center rounded-full bg-border text-[9px]">{i + 1}</span>
                      <span>{getCapabilityLabel(p.capability)}</span>
                      <span className="text-muted-foreground/50 text-[10px]">{p.capability}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* STEPS SECTION */}
            <div className="p-2 border-b border-border/50">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                <Activity className="w-3 h-3" />
                Steps
              </div>
              {steps.length > 0 ? (
                <StepTimeline steps={steps} live={stats.status === 'running'} />
              ) : (
                <div className="pl-5 text-xs text-muted-foreground font-mono">No execution steps yet.</div>
              )}
            </div>

            {/* ARTIFACTS SECTION */}
            {artifacts.length > 0 && (
              <div className="p-2 border-b border-border/50 bg-muted/10">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                  <Package className="w-3 h-3" />
                  Artifacts
                </div>
                <div className="flex flex-col gap-1 pl-5">
                  {artifacts.map((art, i) => (
                    <div key={i} className="flex items-center justify-between text-xs font-mono text-foreground/80 bg-background border border-border/50 p-1.5 rounded">
                      <span className="truncate">{art.ref}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {art.size_bytes != null ? formatBytes(art.size_bytes) : 'unknown size'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* MEMORY SECTION */}
            {memory.length > 0 && (
              <div className="p-2 bg-muted/10">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                  <Brain className="w-3 h-3" />
                  Memory Updates
                </div>
                <div className="flex flex-col gap-1 pl-5">
                  {memory.map((m, i) => (
                    <div key={i} className="flex flex-col text-xs font-mono text-foreground/80 bg-background border border-border/50 p-1.5 rounded">
                      <span className="font-semibold">{m.capability}</span>
                      <span className="text-muted-foreground">{m.summary}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export interface ExecutionPanelProps {
  goalIds?: string[];
  className?: string;
}

export function ExecutionPanel({ goalIds, className = '' }: ExecutionPanelProps) {
  const isRightPanelOpen = useAppStore((s) => s.isRightPanelOpen);
  
  // For 'All Traces' tab (no goalIds provided)
  const persistedTraces = useRuntimeStore((s) => s.traces);
  const executions = useRuntimeStore((s) => s.executions);
  
  const allIds = useMemo(() => {
    if (goalIds) return goalIds;
    
    // Aggregate live + persisted
    const ids = new Set<string>();
    executions.forEach(e => { if (e.goal_id) ids.add(e.goal_id) });
    persistedTraces.forEach(t => ids.add(t.goal_id));
    return Array.from(ids);
  }, [goalIds, executions, persistedTraces]);

  return (
    <div className={`flex h-full w-full bg-background overflow-hidden ${className}`}>
      <div className="flex-1 flex flex-col min-w-0 h-full">
        <ScrollArea className="flex-1">
          {allIds.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground font-mono animate-in fade-in">
              No executions found.
            </div>
          ) : (
            <div className="p-2">
              {allIds.map((id, idx) => (
                <GoalTrace key={id} goalId={id} defaultOpen={idx === 0} />
              ))}
            </div>
          )}
        </ScrollArea>
      </div>
      {isRightPanelOpen && <InspectorPanel />}
    </div>
  );
}
