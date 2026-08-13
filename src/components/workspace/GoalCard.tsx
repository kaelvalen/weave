import { SectionLabel } from './SectionLabel';

/**
 * Goal object framing a user message as an executable GOAL.
 * Presentational wrapper — hover actions and body are injected by the caller
 * so copy/edit behavior stays in ChatMessage.
 *
 * WDL: goals are primary objects. State is communicated by motion
 * (pulse while running, a single check-pop on completion), never by chrome.
 */
import type { GoalStats } from '@/stores/useRuntimeStore';
import { Check, X } from 'lucide-react';

function StatusChip({ status }: { status: GoalStats['status'] }) {
  switch (status) {
    case 'running':
      return (
        <div className="flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-surface-2 text-[10px] uppercase font-mono tracking-wider font-medium text-brand">
          <span className="w-1.5 h-1.5 rounded-full bg-brand status-pulse" />
          Running
        </div>
      );
    case 'completed':
      return (
        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-2 text-[10px] uppercase font-mono tracking-wider font-medium text-brand">
          <Check className="w-3 h-3 check-pop" />
          Done
        </div>
      );
    case 'failed':
      return (
        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-2 text-[10px] uppercase font-mono tracking-wider font-medium text-destructive">
          <X className="w-3 h-3" />
          Failed
        </div>
      );
    default:
      return null;
  }
}

export function GoalCard({
  headerRight,
  stats,
  children,
}: {
  headerRight?: React.ReactNode;
  stats?: GoalStats;
  children: React.ReactNode;
}) {
  const running = stats?.status === 'running';

  return (
    <div className="relative overflow-hidden rounded-xl bg-surface-1 px-4 py-3">
      {/* Goal spine — the primary object carries the accent, nothing else does */}
      <span
        className="absolute left-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-brand/70 via-brand/25 to-transparent"
        aria-hidden
      />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SectionLabel>Goal</SectionLabel>
          {stats && stats.status !== 'unknown' && <StatusChip status={stats.status} />}
        </div>
        <div className="flex items-center gap-2">{headerRight}</div>
      </div>

      <div className="mt-2 text-foreground">{children}</div>

      {/* Live progress — a quiet scan while the planner works */}
      {running && (
        <div className="mt-3 h-0.5 w-full rounded-full bg-surface-3 goal-progress" aria-hidden />
      )}

      {stats && stats.status !== 'unknown' && (
        <div className="mt-3 flex items-center gap-5 overflow-x-auto text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
          {stats.durationMs != null && (
            <div className="flex items-center gap-1.5">
              <span>Duration</span>
              <span className="text-foreground">{stats.durationMs}ms</span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <span>Plan</span>
            <span className="text-foreground">{stats.planCount} steps</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span>Execution</span>
            <span className="text-foreground">
              {stats.stepCount} tools
              {stats.status === 'failed' && stats.stepCount > 0
                ? ` · ${stats.stepCount - stats.failedCount} ok · ${stats.failedCount} failed`
                : ''}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span>Artifacts</span>
            <span className="text-foreground">{stats.artifactCount}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span>Memory</span>
            <span className="text-foreground">{stats.memoryCount}</span>
          </div>
        </div>
      )}
    </div>
  );
}
