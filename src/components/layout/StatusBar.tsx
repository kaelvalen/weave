import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
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
        <span className="flex items-center gap-1.5 text-foreground">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
          <span className="font-semibold">DeepSeek R1</span>
        </span>
        <span className="text-border">•</span>
        <span>320ms</span>
        {sysStats && (
          <>
            <span className="text-border">•</span>
            <span
              title={`RAM ${formatGb(sysStats.ram_usage)} / ${formatGb(sysStats.ram_total)} GB`}
            >
              VRAM 7.3/8GB · RAM {formatGb(sysStats.ram_usage)}GB
            </span>
          </>
        )}
        <span className="text-border">•</span>
        <span>Planner: {runningSteps > 0 ? <span className="text-orange-500">busy</span> : 'idle'}</span>
        <span className="text-border">•</span>
        <span>Queue: {runningSteps > 0 ? 2 : 0}</span>
        <span className="text-border">•</span>
        <span>Workers: 18</span>
        {runningSteps > 0 && (
          <>
            <span className="text-border">•</span>
            <span className="flex items-center gap-1.5 text-orange-500">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
              <span>{runningSteps} running</span>
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span>v1.0.0</span>
      </div>
    </footer>
  );
}
