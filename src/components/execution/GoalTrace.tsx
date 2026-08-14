import { useLayoutEffect, useRef, useState } from 'react';
import {
  useRuntimeStore,
  stepsForGoal,
  planForGoal,
  artifactsForGoal,
  memoryUpdatesForGoal,
  goalStats,
} from '@/stores/useRuntimeStore';
import { StepTimeline } from '@/components/execution/StepTimeline';
import { ChevronDown, Sparkles, Activity, Brain, Package, GitMerge } from 'lucide-react';
import { formatBytes } from '@/lib/utils';
import { usePluginStore } from '@/stores/usePluginStore';

/** Per-message execution trace box, rendered inside ChatMessage.
 *  Trace design contract: compact sparkle header that shimmers while
 *  running, settles to a "Ran N steps · Xs" line when done, and expands
 *  into a fade-up step list. Auto-collapses once the goal settles. */
export function GoalTrace({ goalId, defaultOpen }: { goalId: string; defaultOpen: boolean }) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const [lineHeight, setLineHeight] = useState(0);
  const traceRef = useRef<HTMLDivElement>(null);
  const events = useRuntimeStore((s) => s.events);
  const loadedTraceEvents = useRuntimeStore((s) => s.loadedTraceEvents);
  const state = { events, loadedTraceEvents };

  const stats = goalStats(state, goalId);
  const plan = planForGoal(state, goalId);
  const steps = stepsForGoal(state, goalId);
  const artifacts = artifactsForGoal(state, goalId);
  const memory = memoryUpdatesForGoal(state, goalId);

  const plugins = usePluginStore((s) => s.plugins);

  const getCapabilityLabel = (cap: string) => {
    for (const plugin of plugins) {
      if (plugin.capabilities?.descriptions?.[cap]) {
        return plugin.capabilities.descriptions[cap];
      }
    }
    return cap;
  };

  const working = stats.status === 'running';
  const expanded = manualOpen ?? (defaultOpen || working);

  useLayoutEffect(() => {
    if (traceRef.current) setLineHeight(traceRef.current.offsetHeight);
  }, [steps.length, expanded, goalId]);

  const doneLabel =
    stats.status === 'failed'
      ? stats.stepCount > 0
        ? `Failed · ${stats.stepCount - stats.failedCount} ok · ${stats.failedCount} failed`
        : 'Failed'
      : stats.status === 'completed'
        ? stats.durationMs != null
          ? `Ran ${steps.length} step${steps.length === 1 ? '' : 's'} · ${(stats.durationMs / 1000).toFixed(1)}s`
          : `Ran ${steps.length} step${steps.length === 1 ? '' : 's'}`
        : 'Tool activity';

  return (
    <div className="flex flex-col gap-1">
      {/* header — shared trace header: sparkle, shimmer-while-running, chevron */}
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setManualOpen((current) => !(current ?? (defaultOpen || working)))}
        className="-mx-1.5 flex w-fit items-center gap-2 rounded-md px-1.5 py-1 transition-colors duration-100 hover:bg-muted/50"
      >
        <Sparkles
          size={16}
          strokeWidth={1.5}
          fill="currentColor"
          className={working ? 'text-muted-foreground' : 'text-muted-foreground/60'}
        />
        {working ? (
          <span
            className="bg-clip-text text-[13px] font-medium whitespace-nowrap text-transparent"
            style={{
              backgroundImage:
                'linear-gradient(90deg, hsl(var(--muted-foreground)) 35%, hsl(var(--foreground)) 50%, hsl(var(--muted-foreground)) 65%)',
              backgroundSize: '200% 100%',
              animation: 'shimmer-text 1.4s linear infinite',
            }}
          >
            Running tools
          </span>
        ) : (
          <span
            className="text-[13px] font-medium whitespace-nowrap text-muted-foreground"
            style={{ animation: 'fade-in 350ms ease-out both' }}
          >
            {doneLabel}
          </span>
        )}
        <ChevronDown
          size={14}
          strokeWidth={2.2}
          className="shrink-0 text-muted-foreground transition-transform duration-300"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0)' }}
        />
      </button>

      {/* expandable trace */}
      <div
        className="grid transition-[grid-template-rows,opacity] duration-400"
        style={{
          gridTemplateRows: expanded ? '1fr' : '0fr',
          opacity: expanded ? 1 : 0,
          transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)',
        }}
      >
        <div className="overflow-hidden">
          <div className="relative mt-1 ml-[5px] pl-4">
            <span
              aria-hidden
              className="absolute left-[3px] w-px bg-border"
              style={{
                top: -8,
                height: lineHeight ? lineHeight - 2 : 0,
                transition: 'height 500ms cubic-bezier(0.23,1,0.32,1)',
              }}
            />
            <div ref={traceRef} className="flex flex-col gap-1 py-1">
              {/* PLANNING SECTION */}
              {plan && plan.length > 0 && (
                <div className="py-1.5">
                  <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                    <GitMerge className="w-3 h-3" />
                    Planning
                    {working && (
                      <div className="w-1.5 h-1.5 rounded-full bg-brand status-pulse ml-1" />
                    )}
                  </div>
                  <div className="flex flex-col gap-1 pl-5">
                    {plan.map((p, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 text-xs font-mono text-foreground/80"
                      >
                        <span className="w-4 h-4 flex items-center justify-center rounded-full bg-surface-3 text-[9px]">
                          {i + 1}
                        </span>
                        <span>{getCapabilityLabel(p.capability)}</span>
                        <span className="text-muted-foreground/50 text-[10px]">{p.capability}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* STEPS SECTION — the trace proper */}
              <div className="py-1.5">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                  <Activity className="w-3 h-3" />
                  Steps
                </div>
                {steps.length > 0 ? (
                  <StepTimeline steps={steps} live={working} />
                ) : (
                  <div className="pl-5 text-xs text-muted-foreground font-mono">
                    No execution steps yet.
                  </div>
                )}
              </div>

              {/* ARTIFACTS SECTION */}
              {artifacts.length > 0 && (
                <div className="py-1.5">
                  <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                    <Package className="w-3 h-3" />
                    Artifacts
                  </div>
                  <div className="flex flex-col gap-1 pl-5">
                    {artifacts.map((art, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between text-xs font-mono text-foreground/80 bg-surface-2 p-1.5 rounded"
                      >
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
                <div className="py-1.5">
                  <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                    <Brain className="w-3 h-3" />
                    Memory Updates
                  </div>
                  <div className="flex flex-col gap-1 pl-5">
                    {memory.map((m, i) => (
                      <div
                        key={i}
                        className="flex flex-col text-xs font-mono text-foreground/80 bg-surface-2 p-1.5 rounded"
                      >
                        <span className="font-semibold">{m.capability}</span>
                        <span className="text-muted-foreground">{m.summary}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
