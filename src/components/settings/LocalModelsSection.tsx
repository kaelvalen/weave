import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, Play, Square, Download, Circle } from 'lucide-react';

interface LocalServerStatus {
  running: boolean;
  url: string;
  pid: number | null;
  message: string;
}

interface LocalModel {
  name: string;
  size_bytes: number;
  family: string | null;
  parameter_size: string | null;
  quantization: string | null;
}

interface PullProgress {
  name: string;
  status: string;
  percent: number | null;
  error: string | null;
  done: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '?';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}

/**
 * Live local-model management: server status + start/stop, installed models
 * and pull (Ollama). Fires refreshConfig() via the parent on pull success so
 * the chat model list picks up the new model.
 */
export function LocalModelsSection({ onModelsChanged }: { onModelsChanged: () => void }) {
  const [status, setStatus] = useState<LocalServerStatus | null>(null);
  const [models, setModels] = useState<LocalModel[]>([]);
  const [busy, setBusy] = useState(false);
  const [pullName, setPullName] = useState('');
  const [pulling, setPulling] = useState<null | { name: string; percent: number | null }>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await invoke<LocalServerStatus>('local_server_status'));
    } catch {
      setStatus(null);
    }
  }, []);

  const refreshModels = useCallback(async () => {
    try {
      setModels(await invoke<LocalModel[]>('local_list_models'));
    } catch {
      setModels([]);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    void refreshModels();
    const timer = setInterval(() => void refreshStatus(), 5000);
    return () => clearInterval(timer);
  }, [refreshStatus, refreshModels]);

  useEffect(() => {
    const unlisten = listen<PullProgress>('local-pull-progress', (event) => {
      const p = event.payload;
      if (p.error) {
        setPulling(null);
        toast.error(`Model pull failed: ${p.error}`);
        return;
      }
      if (p.done) {
        setPulling(null);
        toast.success(`Model "${p.name}" pulled`);
        void refreshModels();
        onModelsChanged();
        return;
      }
      setPulling({ name: p.name, percent: p.percent });
    });
    unlisten.then((f) => (unlistenRef.current = f));
    return () => unlistenRef.current?.();
  }, [refreshModels, onModelsChanged]);

  const handleStart = async () => {
    setBusy(true);
    try {
      const s = await invoke<LocalServerStatus>('local_server_start');
      setStatus(s);
      if (s.running) void refreshModels();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    setBusy(true);
    try {
      setStatus(await invoke<LocalServerStatus>('local_server_stop'));
    } catch (err) {
      toast.error(String(err));
    } finally {
      setBusy(false);
    }
  };

  const handlePull = async () => {
    const name = pullName.trim();
    if (!name) return;
    setPulling({ name, percent: 0 });
    try {
      await invoke('local_pull_model', { name });
    } catch (err) {
      setPulling(null);
      toast.error(String(err));
    } finally {
      setPullName('');
    }
  };

  return (
    <div className="space-y-5">
      {/* Server status */}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-surface-1 px-3.5 py-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              status?.running ? 'bg-brand status-pulse' : 'bg-muted-foreground/40'
            }`}
          />
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground">
              {status?.running ? 'Ollama reachable' : 'Ollama not running'}
            </p>
            <p className="text-[11px] font-mono text-muted-foreground truncate">
              {status?.url ?? 'http://localhost:11434'} · {status?.message ?? 'probing…'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {status?.running ? (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={handleStop} disabled={busy}>
              <Square className="w-3 h-3" /> Stop
            </Button>
          ) : (
            <Button size="sm" className="h-7 text-xs gap-1" onClick={handleStart} disabled={busy}>
              <Play className="w-3 h-3" /> Start
            </Button>
          )}
        </div>
      </div>

      {/* Pull */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Download className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            value={pullName}
            onChange={(e) => setPullName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handlePull()}
            placeholder="Pull a model, e.g. qwen3.5:9b"
            className="pl-8 h-8 text-xs font-mono bg-surface-2 border-border/40"
          />
        </div>
        <Button size="sm" className="h-8 text-xs" onClick={handlePull} disabled={pulling !== null || !pullName.trim()}>
          Pull
        </Button>
      </div>
      {pulling && (
        <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-brand" />
          <span className="truncate">
            Pulling {pulling.name}
            {pulling.percent != null ? ` · ${Math.round(pulling.percent)}%` : '…'}
          </span>
        </div>
      )}

      {/* Installed models */}
      {models.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Installed ({models.length})
          </p>
          {models.map((m) => (
            <div
              key={m.name}
              className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-surface-1 px-3 py-1.5 text-xs"
            >
              <span className="font-mono text-foreground truncate">{m.name}</span>
              <span className="text-[11px] font-mono text-muted-foreground whitespace-nowrap">
                {[m.parameter_size, m.quantization, formatBytes(m.size_bytes)]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
          ))}
        </div>
      )}
      {!status?.running && models.length === 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
          <Circle className="w-3 h-3" /> Start the server to see and pull models.
        </p>
      )}
    </div>
  );
}
