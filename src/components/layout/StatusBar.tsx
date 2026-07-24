import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '@/stores/useAppStore';
import { usePluginStore } from '@/stores/usePluginStore';
import { useRuntimeStore } from '@/stores/useRuntimeStore';
import { refreshObservability } from '@/hooks/useRuntimeEvents';

/** Mirrors `SystemStats` in src-tauri/src/commands/models.rs (RAM in bytes). */
interface SystemStats {
  cpu_usage: number;
  ram_usage: number;
  ram_total: number;
}

function formatGb(bytes: number): string {
  return (bytes / 1_073_741_824).toFixed(1);
}

export function StatusBar() {
  const { appVersion } = useAppStore();
  const { loadedPlugins } = usePluginStore();
  const observability = useRuntimeStore((s) => s.observability);
  const runningSteps = useRuntimeStore(
    (s) => s.executions.filter((e) => e.status === 'running').length
  );
  const [sysStats, setSysStats] = useState<SystemStats | null>(null);

  // Slow global poll so the stats strip stays fresh on any view.
  useEffect(() => {
    const tick = () => {
      refreshObservability();
      // On failure keep the previous values; this strip is best-effort.
      invoke<SystemStats>('get_system_stats')
        .then(setSysStats)
        .catch(() => {});
    };
    tick();
    const interval = setInterval(tick, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <footer className="h-6 flex items-center justify-between px-3 bg-background border-t border-border font-mono text-[11px] text-muted-foreground select-none flex-shrink-0 z-40">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-foreground/60" />
          <span>Online</span>
        </span>
        <span className="text-border">•</span>
        <span>{loadedPlugins.length} active plugins</span>
        <span className="text-border">•</span>
        <span>{observability?.total_tool_calls ?? 0} tool calls</span>
        {sysStats && (
          <>
            <span className="text-border">•</span>
            <span
              title={`RAM ${formatGb(sysStats.ram_usage)} / ${formatGb(sysStats.ram_total)} GB`}
            >
              CPU {Math.round(sysStats.cpu_usage)}% · RAM {formatGb(sysStats.ram_usage)} GB
            </span>
          </>
        )}
        {runningSteps > 0 && (
          <>
            <span className="text-border">•</span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-foreground animate-pulse" />
              <span>{runningSteps} running</span>
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span>v{appVersion}</span>
      </div>
    </footer>
  );
}
