import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useRuntimeStore } from '@/stores/useRuntimeStore';
import { useAppStore } from '@/stores/useAppStore';
import { useChatStore } from '@/stores/useChatStore';
import { refreshObservability } from '@/hooks/useRuntimeEvents';
import type { ModelStats } from '@/types/runtime';
import { effectiveTps, formatTps, formatTokensCompact } from '@/lib/modelStats';

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
  const appVersion = useAppStore((s) => s.appVersion);
  const selectedModel = useChatStore((s) => s.selectedModel);
  const selectedProvider = useChatStore((s) => s.selectedProvider);
  const [sysStats, setSysStats] = useState<SystemStats | null>(null);
  const [modelStats, setModelStats] = useState<ModelStats | null>(null);

  // Slow global poll so the stats strip stays fresh on any view.
  useEffect(() => {
    const tick = () => {
      refreshObservability();
      // On failure keep the previous values; this strip is best-effort.
      invoke<SystemStats>('get_system_stats')
        .then(setSysStats)
        .catch(() => {});
      invoke<ModelStats>('runtime_get_model_stats')
        .then(setModelStats)
        .catch(() => {});
    };
    tick();
    const interval = setInterval(tick, 15000);
    return () => clearInterval(interval);
  }, []);

  const tps = effectiveTps(modelStats);

  // Only segments backed by real data get pushed — anything unknown stays hidden.
  const segments: ReactNode[] = [];

  if (selectedModel) {
    segments.push(
      <span className="flex items-center gap-1.5 text-foreground">
        <span className="font-semibold">{selectedModel}</span>
        {selectedProvider && <span className="text-muted-foreground">· {selectedProvider}</span>}
      </span>
    );
  }

  if (modelStats) {
    segments.push(
      <span
        className="flex items-center gap-1.5"
        title={modelStats.ollama_running ? 'Ollama is running' : 'Ollama is not running'}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            modelStats.ollama_running ? 'bg-green-500' : 'bg-red-500'
          }`}
        />
        <span>Ollama</span>
      </span>
    );
    segments.push(
      <span title="Tokens generated since app start">
        {formatTokensCompact(modelStats.total_tokens)} tok
      </span>
    );
    if (tps != null) {
      segments.push(
        <span
          title={
            modelStats.avg_tps != null
              ? 'Average tokens/sec since app start'
              : 'Tokens/sec of the last response'
          }
        >
          {formatTps(tps)} tps
        </span>
      );
    }
  }

  if (sysStats) {
    segments.push(
      <span title={`RAM ${formatGb(sysStats.ram_usage)} / ${formatGb(sysStats.ram_total)} GB`}>
        CPU {Math.round(sysStats.cpu_usage)}% · RAM {formatGb(sysStats.ram_usage)}GB
      </span>
    );
  }

  segments.push(
    <span>
      Planner: {runningSteps > 0 ? <span className="text-orange-500">busy</span> : 'idle'}
    </span>
  );

  if (runningSteps > 0) {
    segments.push(
      <span className="flex items-center gap-1.5 text-orange-500">
        <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
        <span>{runningSteps} running</span>
      </span>
    );
  }

  return (
    <footer className="h-6 flex items-center justify-between px-3 bg-background border-t border-border font-mono text-[11px] text-muted-foreground select-none flex-shrink-0 z-40">
      <div className="flex items-center gap-3">
        {segments.map((node, i) => (
          <Fragment key={i}>
            {i > 0 && <span className="text-border">•</span>}
            {node}
          </Fragment>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <span>v{appVersion}</span>
      </div>
    </footer>
  );
}
