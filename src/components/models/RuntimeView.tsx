import { Cpu, Download, Activity, Trash2, StopCircle, HardDrive, Play, Square, Search, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { extractError } from '@/lib/errors';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useRuntimeStore } from '@/stores/useRuntimeStore';
import { useChatStore } from '@/stores/useChatStore';
import type { LocalModelDetails, ModelStats } from '@/types/runtime';
import {
  effectiveTps,
  findLoadedModel,
  formatContextLength,
  formatTokensCompact,
  formatTps,
  formatVram,
  isActiveModel,
  modelNamesMatch,
} from '@/lib/modelStats';

interface LocalModelInfo {
  name: string;
  size_bytes: number;
}

interface SystemStats {
  cpu_usage: number;
  ram_usage: number;
  ram_total: number;
}

interface DownloadProgress {
  filename: string;
  downloaded: number;
  total: number | null;
  done: boolean;
  error: string | null;
}

interface LocalServerStatus {
  running: boolean;
  url: string;
  pid: number | null;
  message: string;
}

/** One row of the process monitor — dot, process name, live detail, value. */
function ProcessRow({
  live,
  name,
  detail,
  value,
}: {
  live: boolean;
  name: string;
  detail: string;
  value?: string;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface-2 transition-colors">
      <span
        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
          live ? 'bg-brand status-pulse' : 'bg-muted-foreground/40'
        }`}
      />
      <span className="w-24 flex-shrink-0 text-[13px] font-medium text-foreground">{name}</span>
      <span className="flex-1 min-w-0 font-mono text-[11px] text-muted-foreground truncate">
        {detail}
      </span>
      {value && (
        <span className="font-mono text-[11px] text-foreground flex-shrink-0">{value}</span>
      )}
    </div>
  );
}

function Meter({ percent }: { percent: number }) {
  return (
    <div className="h-1 w-full bg-surface-3 rounded-full overflow-hidden">
      <div
        className="h-full bg-brand/80 transition-all duration-700"
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}

export function RuntimeView() {
  const [models, setModels] = useState<LocalModelInfo[]>([]);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [modelDetails, setModelDetails] = useState<Record<string, LocalModelDetails>>({});
  const [modelStats, setModelStats] = useState<ModelStats | null>(null);
  const [downloadUrl, setDownloadUrl] = useState('');
  const [activeDownload, setActiveDownload] = useState<DownloadProgress | null>(null);
  const [modelToDelete, setModelToDelete] = useState<string | null>(null);
  const [serverStatus, setServerStatus] = useState<LocalServerStatus | null>(null);
  const [serverBusy, setServerBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('weave_favorite_models');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const executions = useRuntimeStore((s) => s.executions);
  const observability = useRuntimeStore((s) => s.observability);
  const isStreaming = useChatStore((s) => s.isStreaming);

  const runningSteps = executions.filter((e) => e.status === 'running').length;
  const plannerBusy = isStreaming || runningSteps > 0;
  const tps = effectiveTps(modelStats);

  const toggleFavorite = (name: string) => {
    setFavorites((prev) => {
      const next = prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name];
      localStorage.setItem('weave_favorite_models', JSON.stringify(next));
      return next;
    });
  };

  // Best-effort GGUF header parse per model file; fields that come back null
  // (or files that fail) simply render no badges — nothing is fabricated.
  const fetchModelDetails = async (list: LocalModelInfo[]) => {
    const next: Record<string, LocalModelDetails> = {};
    await Promise.all(
      list.map(async (m) => {
        try {
          next[m.name] = await invoke<LocalModelDetails>('local_model_info', { filename: m.name });
        } catch {
          // No readable header for this file — its detail badges stay hidden.
        }
      })
    );
    setModelDetails(next);
  };

  const fetchModels = async () => {
    try {
      const data = await invoke<LocalModelInfo[]>('list_local_models');
      setModels(data);
      fetchModelDetails(data);
    } catch (e) {
      toast.error(`Failed to load local models: ${extractError(e)}`);
    }
  };

  const fetchStats = async () => {
    try {
      const data = await invoke<SystemStats>('get_system_stats');
      setStats(data);
    } catch (e) {
      // Stats are polled every 2s; toast on every failure would be noisy.
      console.warn('Failed to fetch system stats', e);
    }
  };

  const fetchModelStats = async () => {
    try {
      const data = await invoke<ModelStats>('runtime_get_model_stats');
      setModelStats(data);
    } catch (e) {
      // Polled every 10s; keep previous values on failure.
      console.warn('Failed to fetch model stats', e);
    }
  };

  const fetchServerStatus = async () => {
    try {
      const data = await invoke<LocalServerStatus>('local_server_status');
      setServerStatus(data);
    } catch (e) {
      console.warn('Failed to fetch local server status', e);
    }
  };

  const handleStartServer = async () => {
    setServerBusy(true);
    try {
      const data = await invoke<LocalServerStatus>('local_server_start');
      setServerStatus(data);
      toast.success(data.message);
      // Give Ollama a moment, then re-probe for accurate reachability.
      setTimeout(fetchServerStatus, 1500);
    } catch (e) {
      toast.error(`Failed to start server: ${extractError(e)}`);
    } finally {
      setServerBusy(false);
    }
  };

  const handleStopServer = async () => {
    setServerBusy(true);
    try {
      const data = await invoke<LocalServerStatus>('local_server_stop');
      setServerStatus(data);
      toast.success(data.message);
    } catch (e) {
      toast.error(`Failed to stop server: ${extractError(e)}`);
    } finally {
      setServerBusy(false);
    }
  };

  useEffect(() => {
    // Standard data-fetch on mount: load installed models and poll system stats.
    fetchModels();
    fetchServerStatus();

    // Poll stats
    fetchStats();
    const interval = setInterval(fetchStats, 2000);

    // Poll loaded/VRAM/TPS model stats while this view is mounted
    fetchModelStats();
    const modelStatsInterval = setInterval(fetchModelStats, 10000);

    // Listen to download progress
    const unlisten = listen<DownloadProgress>('download-progress', (event) => {
      setActiveDownload(event.payload);
      if (event.payload.done) {
        if (event.payload.error) {
          toast.error(`Download failed: ${event.payload.error}`);
        } else {
          toast.success(`${event.payload.filename} downloaded successfully!`);
        }
        setTimeout(() => setActiveDownload(null), 2000);
        fetchModels();
      }
    });

    return () => {
      clearInterval(interval);
      clearInterval(modelStatsInterval);
      unlisten.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDownload = async () => {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(downloadUrl);
    } catch {
      toast.error('Please enter a valid URL');
      return;
    }
    if (!parsedUrl.pathname.toLowerCase().endsWith('.gguf')) {
      toast.error('URL must point to a .gguf file');
      return;
    }

    const filename = parsedUrl.pathname.split('/').pop() || 'model.gguf';

    try {
      setActiveDownload({ filename, downloaded: 0, total: null, done: false, error: null });
      await invoke('download_local_model', { url: downloadUrl, filename });
      setDownloadUrl('');
    } catch (e) {
      toast.error(extractError(e));
      setActiveDownload(null);
    }
  };

  const handleDelete = async (filename: string) => {
    try {
      await invoke('delete_local_model', { filename });
      toast.success('Model deleted');
      fetchModels();
    } catch (e) {
      toast.error(extractError(e));
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Match a loaded runtime model back to its local file to reuse the parsed
  // GGUF context length; null when there's no matching file or no header data.
  const loadedContextLength = (loadedName: string): number | null => {
    const local = models.find((m) => modelNamesMatch(m.name, loadedName));
    return local ? (modelDetails[local.name]?.context_length ?? null) : null;
  };

  // ── Process monitor derivations (real data only) ──
  const activeModelName =
    modelStats?.active_model ?? modelStats?.loaded_models[0]?.name ?? null;
  const activeLoaded = activeModelName
    ? modelStats?.loaded_models.find((lm) => lm.name === activeModelName)
    : undefined;
  // The last-used model may be a cloud provider (telemetry records it for
  // every request); only GGUF-matched names are provably local. The local
  // server being down must not claim inference is "offline" while a remote
  // model is clearly generating.
  const activeModelIsLocal =
    activeModelName != null && loadedContextLength(activeModelName) != null;
  const inferenceDetail = !modelStats
    ? 'probing…'
    : activeModelName
      ? activeModelName +
        (activeLoaded?.vram_bytes != null ? ` · VRAM ${formatVram(activeLoaded.vram_bytes)}` : '') +
        (loadedContextLength(activeModelName) != null
          ? ` · Ctx ${formatContextLength(loadedContextLength(activeModelName)!)}`
          : '') +
        (modelStats.ollama_running || activeModelIsLocal ? '' : ' · remote')
      : !modelStats.ollama_running
        ? 'offline — server not running'
        : 'no model loaded';

  const toolFailures = observability
    ? Object.values(observability.tool_metrics).reduce((acc, m) => acc + m.failure_count, 0)
    : 0;
  const memHitRate =
    observability && observability.memory_reads > 0
      ? Math.round((observability.memory_hits / observability.memory_reads) * 100)
      : null;

  return (
    <div className="flex flex-col h-full w-full bg-background overflow-hidden">
      {/* ── Unified View Header ── */}
      <header className="flex items-center justify-between px-6 py-4 bg-surface-1 border-b border-border/40 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-surface-2 text-foreground/80">
            <Activity className="w-5 h-5 text-brand" />
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight text-foreground flex items-center gap-2">
              Runtime Process Monitor
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-surface-3 text-muted-foreground">
                {models.length} local models
              </span>
            </h1>
            <p className="text-xs text-muted-foreground font-mono">Live process telemetry, inference performance & resource allocation</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative w-64">
            <Input
              placeholder="Paste HuggingFace .gguf URL..."
              value={downloadUrl}
              onChange={(e) => setDownloadUrl(e.target.value)}
              className="h-8 bg-surface-2 border-border/40 text-xs focus-visible:ring-1 focus-visible:ring-brand"
            />
          </div>
          <Button
            size="sm"
            className="gap-1.5 h-8 text-xs bg-brand text-brand-foreground hover:bg-brand/90"
            onClick={handleDownload}
            disabled={!!activeDownload}
          >
            <Download className="w-3.5 h-3.5" />
            Download GGUF
          </Button>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 max-w-6xl mx-auto w-full space-y-4">

        {/* ── Process Monitor — the Activity Monitor heart of the view ── */}
        <div className="rounded-xl bg-surface-1 px-2 py-2 flex-shrink-0">
          <div className="flex items-center justify-between px-3 pt-1 pb-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
              Processes
            </span>
            <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  plannerBusy ? 'bg-brand status-pulse' : 'bg-muted-foreground/40'
                }`}
              />
              {plannerBusy ? 'active' : 'ambient'}
            </span>
          </div>
          <ProcessRow
            live={plannerBusy}
            name="Planner"
            detail={
              plannerBusy
                ? `executing · ${runningSteps || 1} step${(runningSteps || 1) === 1 ? '' : 's'}`
                : 'watching workspace'
            }
            value={observability ? `${observability.total_planner_runs} runs` : undefined}
          />
          <ProcessRow
            live={!!activeModelName}
            name="Inference"
            detail={inferenceDetail}
            value={
              tps != null
                ? `${formatTps(tps)} tok/s`
                : modelStats
                  ? `${formatTokensCompact(modelStats.total_tokens)} tok`
                  : undefined
            }
          />
          <ProcessRow
            live={!!observability && observability.total_tool_calls > 0}
            name="Tools"
            detail={
              observability
                ? `${observability.total_tool_calls} calls this session`
                : 'no activity yet'
            }
            value={toolFailures > 0 ? `${toolFailures} failed` : 'ok'}
          />
          <ProcessRow
            live={memHitRate != null}
            name="Memory"
            detail={
              observability && observability.memory_reads > 0
                ? `${observability.memory_hits}/${observability.memory_reads} reads served`
                : 'no reads yet'
            }
            value={memHitRate != null ? `${memHitRate}% hits` : undefined}
          />
          <ProcessRow
            live={!!serverStatus?.running}
            name="Local Server"
            detail={
              serverStatus?.running
                ? `${serverStatus.url}${serverStatus.pid ? ` · pid ${serverStatus.pid}` : ''}`
                : serverStatus?.message || 'stopped'
            }
            value={serverStatus?.running ? 'listening' : 'stopped'}
          />
        </div>

        {/* Body */}
        <div className="grid grid-cols-3 gap-4 min-h-0">
          {/* Installed Models */}
          <div className="col-span-2 rounded-xl bg-surface-1 overflow-hidden flex flex-col max-h-[52vh]">
            <div className="px-4 py-3 flex justify-between items-center gap-4 flex-shrink-0">
              <div className="flex items-center gap-2">
                <h3 className="font-display font-semibold text-sm">Installed Models</h3>
                <span className="text-[10px] bg-surface-2 text-muted-foreground px-2 py-0.5 rounded-full font-mono">
                  {models.length}
                </span>
              </div>
              <div className="relative w-56">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input
                  placeholder="Search installed models..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 h-8 text-xs font-mono bg-surface-2 border-transparent"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
              {activeDownload && !activeDownload.done && (
                <div className="bg-surface-2 rounded-lg p-4 flex flex-col gap-2 relative overflow-hidden mb-1">
                  <div className="flex justify-between items-center z-10">
                    <span className="font-medium text-sm">{activeDownload.filename}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatBytes(activeDownload.downloaded)} /{' '}
                      {activeDownload.total ? formatBytes(activeDownload.total) : '?'}
                    </span>
                  </div>
                  <div className="h-1 w-full bg-surface-3 rounded-full overflow-hidden z-10">
                    <div
                      className="h-full bg-brand transition-all duration-300"
                      style={{
                        width: activeDownload.total
                          ? `${(activeDownload.downloaded / activeDownload.total) * 100}%`
                          : '5%',
                      }}
                    />
                  </div>
                </div>
              )}

              {models.length === 0 && !activeDownload ? (
                <div className="flex flex-col items-center justify-center h-48 text-center">
                  <HardDrive className="w-12 h-12 text-muted-foreground/30 mb-4" />
                  <h4 className="text-lg font-medium">No Local Models Found</h4>
                  <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                    Paste a .gguf download link from HuggingFace to get started.
                  </p>
                </div>
              ) : (
                models
                  .filter((m) => m.name.toLowerCase().includes(searchQuery.toLowerCase()))
                  .sort((a, b) => {
                    const isFavA = favorites.includes(a.name);
                    const isFavB = favorites.includes(b.name);
                    if (isFavA && !isFavB) return -1;
                    if (!isFavA && isFavB) return 1;
                    return a.name.localeCompare(b.name);
                  })
                  .map((m) => {
                    const isFav = favorites.includes(m.name);
                    const details = modelDetails[m.name];
                    const loaded = findLoadedModel(modelStats, m.name);
                    const rowTps = isActiveModel(modelStats, m.name)
                      ? effectiveTps(modelStats)
                      : null;
                    return (
                      <div
                        key={m.name}
                        className="flex justify-between items-center px-3 py-2.5 rounded-lg hover:bg-surface-2 transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-lg bg-surface-2 flex items-center justify-center flex-shrink-0">
                            <Cpu className="w-4 h-4 text-muted-foreground" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <h4 className="font-medium text-[13px] truncate">{m.name}</h4>
                              {isFav && (
                                <Star className="w-3 h-3 fill-amber-500 text-amber-500 flex-shrink-0" />
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                              <span className="text-[11px] text-muted-foreground font-mono">
                                {formatBytes(m.size_bytes)}
                              </span>
                              {details?.quant && (
                                <span className="text-[11px] text-muted-foreground font-mono">
                                  {details.quant}
                                </span>
                              )}
                              {details?.context_length != null && (
                                <span className="text-[11px] text-muted-foreground font-mono">
                                  ctx {formatContextLength(details.context_length)}
                                </span>
                              )}
                              {details?.parameter_count && (
                                <span className="text-[11px] text-muted-foreground font-mono">
                                  {details.parameter_count}
                                </span>
                              )}
                              {loaded && (
                                <span className="flex items-center gap-1.5 text-[11px] font-mono text-brand">
                                  <span className="w-1.5 h-1.5 rounded-full bg-brand" />
                                  loaded
                                  {loaded.vram_bytes != null && (
                                    <span className="text-muted-foreground">
                                      · {formatVram(loaded.vram_bytes)}
                                    </span>
                                  )}
                                </span>
                              )}
                              {rowTps != null && (
                                <span className="text-[11px] font-mono text-brand">
                                  {formatTps(rowTps)} tok/s
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                            onClick={() => toggleFavorite(m.name)}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <Star className={`w-4 h-4 ${isFav ? 'fill-foreground text-foreground' : ''}`} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-destructive"
                            onClick={() => setModelToDelete(m.name)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          </div>

          {/* Resources + Server control */}
          <div className="rounded-xl bg-surface-1 overflow-hidden flex flex-col max-h-[52vh]">
            <div className="px-4 py-3 flex items-center gap-2 flex-shrink-0">
              <Activity className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-display font-semibold text-sm">Resources</h3>
            </div>
            <div className="px-4 pb-4 space-y-5 overflow-y-auto">
              {stats && (
                <>
                  <div>
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className="text-muted-foreground">CPU</span>
                      <span className="font-mono text-foreground">
                        {Math.round(stats.cpu_usage)}%
                      </span>
                    </div>
                    <Meter percent={stats.cpu_usage} />
                  </div>
                  <div>
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className="text-muted-foreground">RAM</span>
                      <span className="font-mono text-foreground">
                        {formatBytes(stats.ram_usage)} / {formatBytes(stats.ram_total)}
                      </span>
                    </div>
                    <Meter percent={(stats.ram_usage / stats.ram_total) * 100} />
                  </div>
                </>
              )}

              <div className="pt-1">
                <h4 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70 mb-2">
                  Local Server
                </h4>
                <div className="bg-surface-2 rounded-lg p-4 flex flex-col items-center justify-center gap-3">
                  {serverStatus?.running ? (
                    <>
                      <div className="flex items-center gap-2 text-brand">
                        <span className="w-1.5 h-1.5 rounded-full bg-brand status-pulse" />
                        <span className="text-xs font-mono">listening</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground font-mono text-center break-all">
                        {serverStatus.url}
                        {serverStatus.pid ? ` (pid ${serverStatus.pid})` : ''}
                      </p>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-2 mt-1 hover:bg-surface-3"
                        onClick={handleStopServer}
                        disabled={serverBusy}
                      >
                        <Square className="w-3.5 h-3.5" /> Stop
                      </Button>
                    </>
                  ) : (
                    <>
                      <StopCircle className="w-8 h-8 text-muted-foreground/40" />
                      <p className="text-xs text-muted-foreground font-mono text-center">
                        {serverStatus?.message || 'Server is stopped.'}
                      </p>
                      <Button
                        size="sm"
                        className="h-8 gap-2 mt-1 bg-brand text-brand-foreground hover:bg-brand/90"
                        onClick={handleStartServer}
                        disabled={serverBusy}
                      >
                        <Play className="w-3.5 h-3.5" /> Start Server
                      </Button>
                      <p className="text-[10px] text-muted-foreground text-center max-w-[200px]">
                        Starts <code className="font-mono">ollama serve</code> locally. Install
                        Ollama first if you haven't.
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!modelToDelete}
        onOpenChange={(open) => !open && setModelToDelete(null)}
        title="Delete model?"
        description="This model file will be permanently deleted and its disk space freed. This action cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (modelToDelete) handleDelete(modelToDelete);
        }}
      />
    </div>
  );
}
