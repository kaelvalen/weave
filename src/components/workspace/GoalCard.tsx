import { SectionLabel } from './SectionLabel';

/**
 * Flat surface card framing a user message as an executable GOAL.
 * Presentational wrapper — hover actions and body are injected by the caller
 * so copy/edit behavior stays in ChatMessage.
 */
import type { GoalStats } from '@/stores/useRuntimeStore';
import { Loader2, Check, X } from 'lucide-react';

function StatusIcon({ status }: { status: GoalStats['status'] }) {
  switch (status) {
    case 'running':
      return <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />;
    case 'completed':
      return <Check className="w-3.5 h-3.5 text-emerald-500" />;
    case 'failed':
      return <X className="w-3.5 h-3.5 text-destructive" />;
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
  return (
    <div className="rounded-md border border-border bg-surface-1 px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SectionLabel>Goal</SectionLabel>
          {stats && stats.status !== 'unknown' && (
            <div className="flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-muted/50 text-[10px] uppercase font-mono tracking-wider font-bold text-muted-foreground border border-border/50">
              <StatusIcon status={stats.status} />
              {stats.status}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">{headerRight}</div>
      </div>
      <div className="mt-2 text-foreground">{children}</div>
      {stats && stats.status !== 'unknown' && (
        <div className="mt-4 pt-3 border-t border-border/50 flex items-center gap-6 overflow-x-auto text-[10px] font-mono text-muted-foreground uppercase tracking-wider font-bold">
          {stats.durationMs != null && (
            <div className="flex flex-col gap-1">
              <span>Duration</span>
              <span className="text-foreground">{stats.durationMs}ms</span>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <span>Planner</span>
            <span className="text-foreground">{stats.planCount} steps</span>
          </div>
          <div className="flex flex-col gap-1">
            <span>Execution</span>
            <span className="text-foreground">{stats.stepCount} tools</span>
          </div>
          <div className="flex flex-col gap-1">
            <span>Artifacts</span>
            <span className="text-foreground">{stats.artifactCount} items</span>
          </div>
          <div className="flex flex-col gap-1">
            <span>Memory</span>
            <span className="text-foreground">{stats.memoryCount} updates</span>
          </div>
        </div>
      )}
    </div>
  );
}
