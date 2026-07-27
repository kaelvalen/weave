import { Fragment, type ReactNode } from 'react';
import { useRuntimeStore } from '@/stores/useRuntimeStore';
import { useAppStore } from '@/stores/useAppStore';
import { useChatStore } from '@/stores/useChatStore';
import { useSystemPulse } from '@/hooks/useSystemPulse';
import { effectiveTps, formatTps } from '@/lib/modelStats';

function formatGb(bytes: number): string {
  return (bytes / 1_073_741_824).toFixed(1);
}

/**
 * Live runtime strip. Each segment is a small "label + value" pair;
 * the planner segment is the heartbeat — it lights up in the brand
 * accent and pulses while the runtime is executing.
 */
export function StatusBar() {
  const runningSteps = useRuntimeStore(
    (s) => s.executions.filter((e) => e.status === 'running').length
  );
  const appVersion = useAppStore((s) => s.appVersion);
  const selectedModel = useChatStore((s) => s.selectedModel);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const { sysStats, modelStats } = useSystemPulse();

  const busy = isStreaming || runningSteps > 0;
  const tps = effectiveTps(modelStats);
  const observability = useRuntimeStore((s) => s.observability);

  // Only segments backed by real data get pushed — anything unknown stays hidden.
  const segments: ReactNode[] = [];

  // Planner heartbeat — the ambient "alive" signal. Idle means the runtime
  // is watching the workspace, not that it is off.
  segments.push(
    <span className="flex items-center gap-1.5">
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          busy ? 'bg-brand status-pulse' : 'bg-muted-foreground/50'
        }`}
      />
      <span className="text-muted-foreground">Planner</span>
      {busy ? (
        <span className="text-brand font-medium">
          thinking{runningSteps > 0 ? ` · ${runningSteps}` : ''}
        </span>
      ) : (
        <span className="text-foreground">watching</span>
      )}
    </span>
  );

  if (selectedModel) {
    segments.push(
      <span className="flex items-center gap-1.5">
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            modelStats?.ollama_running ? 'bg-brand' : 'bg-muted-foreground/40'
          }`}
          title={modelStats?.ollama_running ? 'Runtime connected' : 'Runtime not detected'}
        />
        <span className="text-foreground max-w-[160px] truncate">{selectedModel}</span>
        {tps != null && (
          <span className="text-muted-foreground" title="Tokens/sec">
            {formatTps(tps)} tok/s
          </span>
        )}
      </span>
    );
  }

  if (sysStats) {
    segments.push(
      <span title="CPU / RAM usage">
        <span className="text-muted-foreground">CPU</span>{' '}
        <span className="text-foreground">{Math.round(sysStats.cpu_usage)}%</span>
        <span className="text-muted-foreground"> · RAM</span>{' '}
        <span className="text-foreground">
          {formatGb(sysStats.ram_usage)}/{formatGb(sysStats.ram_total)} GB
        </span>
      </span>
    );
  }

  if (observability && observability.memory_reads > 0) {
    const hitRate = Math.round((observability.memory_hits / observability.memory_reads) * 100);
    segments.push(
      <span title={`${observability.memory_hits} hits / ${observability.memory_reads} reads`}>
        <span className="text-muted-foreground">Memory</span>{' '}
        <span className="text-foreground">{hitRate}% hits</span>
      </span>
    );
  }

  if (runningSteps > 0) {
    segments.push(
      <span>
        <span className="text-muted-foreground">Queue</span>{' '}
        <span className="text-foreground">{runningSteps}</span>
      </span>
    );
  }

  return (
    <footer className="h-7 flex items-center justify-between px-4 bg-background font-mono text-[11px] text-muted-foreground select-none flex-shrink-0 z-40">
      <div className="flex items-center gap-4 min-w-0 overflow-hidden">
        {segments.map((node, i) => (
          <Fragment key={i}>{node}</Fragment>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <span>v{appVersion}</span>
      </div>
    </footer>
  );
}
