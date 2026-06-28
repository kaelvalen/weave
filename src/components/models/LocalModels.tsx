import { Cpu, Download, Activity, Trash2, StopCircle, HardDrive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

interface LocalModelInfo {
  name: string;
  size_bytes: number;
}

interface SystemStats {
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

export function LocalModels() {
  const [models, setModels] = useState<LocalModelInfo[]>([]);
  const [stats, setStats] = useState<SystemStats>({ ram_usage: 0, ram_total: 16_000_000_000 });
  const [downloadUrl, setDownloadUrl] = useState('');
  const [activeDownload, setActiveDownload] = useState<DownloadProgress | null>(null);

  const fetchModels = async () => {
    try {
      const data = await invoke<LocalModelInfo[]>('list_local_models');
      setModels(data);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchStats = async () => {
    try {
      const data = await invoke<SystemStats>('get_system_stats');
      setStats(data);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchModels();
    
    // Poll stats
    fetchStats();
    const interval = setInterval(fetchStats, 2000);
    
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
      unlisten.then(f => f());
    };
  }, []);

  const handleDownload = async () => {
    if (!downloadUrl.includes('.gguf')) {
      toast.error('URL must point to a .gguf file');
      return;
    }
    
    const urlParts = downloadUrl.split('/');
    const filename = urlParts[urlParts.length - 1].split('?')[0];

    try {
      setActiveDownload({ filename, downloaded: 0, total: null, done: false, error: null });
      await invoke('download_local_model', { url: downloadUrl, filename });
      setDownloadUrl('');
    } catch (e) {
      toast.error(String(e));
      setActiveDownload(null);
    }
  };

  const handleDelete = async (filename: string) => {
    try {
      await invoke('delete_local_model', { filename });
      toast.success('Model deleted');
      fetchModels();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="flex flex-col h-full w-full bg-background pt-16">
      <div className="flex flex-col h-full max-w-6xl mx-auto w-full px-6">
        
        {/* Header */}
        <div className="flex items-center justify-between py-8 flex-shrink-0">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <Cpu className="w-6 h-6 text-primary" />
              Local Models Manager
            </h2>
            <p className="text-sm text-muted-foreground mt-1">Download and run open-source models completely offline.</p>
          </div>
          <div className="flex items-center gap-3">
            <Input 
              placeholder="Paste HuggingFace .gguf URL..." 
              value={downloadUrl}
              onChange={e => setDownloadUrl(e.target.value)}
              className="w-72"
            />
            <Button className="gap-2" onClick={handleDownload} disabled={!!activeDownload}>
              <Download className="w-4 h-4" /> Download
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 grid grid-cols-3 gap-6 mb-12 min-h-0">
          
          {/* Main List */}
          <div className="col-span-2 border rounded-xl bg-card overflow-hidden flex flex-col">
            <div className="border-b px-6 py-4 bg-muted/20 flex justify-between items-center">
              <h3 className="font-semibold">Installed Models</h3>
              <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full">{models.length} Models</span>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              
              {activeDownload && !activeDownload.done && (
                <div className="border border-primary/30 bg-primary/5 rounded-lg p-4 flex flex-col gap-2 relative overflow-hidden">
                  <div className="flex justify-between items-center z-10">
                    <span className="font-medium text-sm">{activeDownload.filename}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatBytes(activeDownload.downloaded)} / {activeDownload.total ? formatBytes(activeDownload.total) : '?'}
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden z-10">
                    <div 
                      className="h-full bg-primary transition-all duration-300" 
                      style={{ width: activeDownload.total ? `${(activeDownload.downloaded / activeDownload.total) * 100}%` : '5%' }}
                    ></div>
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
                models.map(m => (
                  <div key={m.name} className="flex justify-between items-center p-4 border rounded-lg hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded bg-secondary flex items-center justify-center">
                        <Cpu className="w-5 h-5 text-muted-foreground" />
                      </div>
                      <div>
                        <h4 className="font-medium text-sm">{m.name}</h4>
                        <p className="text-xs text-muted-foreground">{formatBytes(m.size_bytes)}</p>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-600 hover:bg-red-500/10" onClick={() => handleDelete(m.name)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Performance Monitor Panel */}
          <div className="border rounded-xl bg-card overflow-hidden flex flex-col">
            <div className="border-b px-6 py-4 bg-muted/20 flex items-center justify-between">
              <h3 className="font-semibold flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" /> System Resources
              </h3>
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
            </div>
            <div className="p-6 space-y-6">
              
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-muted-foreground font-medium">RAM Usage</span>
                  <span className="font-mono text-xs">{formatBytes(stats.ram_usage)} / {formatBytes(stats.ram_total)}</span>
                </div>
                <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-primary/80 transition-all duration-500"
                    style={{ width: `${(stats.ram_usage / stats.ram_total) * 100}%` }}
                  ></div>
                </div>
              </div>

              <div className="pt-6 border-t">
                <h4 className="text-sm font-semibold mb-4">Active Server</h4>
                <div className="bg-muted/30 rounded-lg p-4 border text-center flex flex-col items-center justify-center gap-2">
                  <StopCircle className="w-8 h-8 text-muted-foreground/40" />
                  <p className="text-xs text-muted-foreground font-mono">Server is stopped.</p>
                </div>
              </div>

            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
