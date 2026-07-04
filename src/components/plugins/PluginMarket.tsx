import { useState } from 'react';
import { usePluginStore } from '@/stores/usePluginStore';
import { PluginCard } from './PluginCard';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Search,
  RefreshCw,
  Package,
  Box,
  Puzzle,
  Code2,
  Brain,
  Layers,
  Zap,
  AlertCircle,
  X,
  Download,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { open as openDialog } from '@tauri-apps/plugin-dialog';

const CATEGORIES = [
  { value: null, label: 'All', icon: Layers },
  { value: 'system', label: 'System', icon: Box },
  { value: 'productivity', label: 'Productivity', icon: Puzzle },
  { value: 'development', label: 'Development', icon: Code2 },
  { value: 'ai', label: 'AI', icon: Brain },
];

export function PluginMarket() {
  const plugins = usePluginStore((s) => s.plugins);
  const isLoading = usePluginStore((s) => s.isLoading);
  const error = usePluginStore((s) => s.error);
  const loadedPlugins = usePluginStore((s) => s.loadedPlugins);
  const searchQuery = usePluginStore((s) => s.searchQuery);
  const selectedCategory = usePluginStore((s) => s.selectedCategory);
  const discoverPlugins = usePluginStore((s) => s.discoverPlugins);
  const setSearchQuery = usePluginStore((s) => s.setSearchQuery);
  const setCategory = usePluginStore((s) => s.setCategory);
  const clearError = usePluginStore((s) => s.clearError);
  const loadPlugin = usePluginStore((s) => s.loadPlugin);
  const unloadPlugin = usePluginStore((s) => s.unloadPlugin);
  const installFromFile = usePluginStore((s) => s.installFromFile);

  const [refreshing, setRefreshing] = useState(false);
  const [installing, setInstalling] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await discoverPlugins();
    setRefreshing(false);
  };

  const handleInstall = async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        filters: [{ name: 'Weave Plugin', extensions: ['wpk'] }],
      });
      if (!selected || typeof selected !== 'string') return;
      setInstalling(true);
      await installFromFile(selected);
    } catch {
      // user cancelled or dialog failed — nothing to surface
    } finally {
      setInstalling(false);
    }
  };

  const filteredPlugins = plugins.filter((p) => {
    const q = searchQuery.toLowerCase();
    const matchSearch =
      !q ||
      p.name.toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.capabilities.provide.some((c) => c.toLowerCase().includes(q));
    const matchCat = !selectedCategory || p.category === selectedCategory;
    return matchSearch && matchCat;
  });

  const builtinPlugins = filteredPlugins.filter((p) => p.is_builtin);
  const discoveredPlugins = filteredPlugins.filter((p) => !p.is_builtin);

  const categoryCounts: Record<string, number> = {};
  for (const p of plugins) {
    categoryCounts[p.category] = (categoryCounts[p.category] || 0) + 1;
  }

  return (
    <div className="flex flex-col h-full w-full bg-transparent pt-16">
      <div className="flex flex-col h-full max-w-6xl mx-auto w-full px-6">
        {/* ── Compact Command Bar ── */}
        <div className="flex items-center justify-between gap-4 py-4 flex-shrink-0 border-b border-border/60">
          <div className="flex items-center gap-3 flex-1 max-w-xl">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search plugins by name, ID, or capability..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 bg-card/80 border-border/80 h-9 text-xs focus-visible:ring-1"
              />
            </div>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="text-xs text-muted-foreground hover:text-foreground px-2"
              >
                Clear
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={handleInstall}
              disabled={installing || isLoading}
              size="sm"
              variant="outline"
              className="gap-1.5 h-9 text-xs shadow-sm bg-card"
              title="Install a plugin from a .wpk file"
            >
              <Download className={`w-3.5 h-3.5 ${installing ? 'animate-spin' : ''}`} />
              + Install .wpk
            </Button>
            <Button
              onClick={handleRefresh}
              disabled={refreshing || isLoading}
              size="sm"
              variant="ghost"
              className="gap-1.5 h-9 text-xs hover:bg-muted"
              title="Refresh plugins"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* ── Category Tabs ── */}
        <div className="py-3 flex items-center gap-1.5 flex-wrap flex-shrink-0">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const isActive = selectedCategory === cat.value;
            const count = cat.value ? categoryCounts[cat.value] || 0 : plugins.length;
            return (
              <button
                key={cat.label}
                type="button"
                onClick={() => setCategory(cat.value)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-foreground text-background shadow-sm scale-105'
                    : 'bg-card/60 text-muted-foreground hover:bg-muted hover:text-foreground border border-border/40'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {cat.label}
                <span
                  className={`text-[10px] font-mono px-1 rounded-full ${
                    isActive ? 'bg-background/20 text-background' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── Body ── */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-card/40 rounded-t-xl border-x border-t border-border/60 shadow-inner">
          {/* ── Error Banner ── */}
          {error && (
            <div className="mx-6 mt-3 flex items-center gap-2 px-3 py-2 rounded-md bg-destructive/10 border border-destructive/20 text-sm text-destructive">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1 truncate">{error}</span>
              <button onClick={clearError} className="flex-shrink-0 hover:opacity-70">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* ── Content ── */}
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="px-6 py-6 pb-32">
              {isLoading ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="p-4 rounded-lg border bg-card space-y-3">
                      <div className="flex gap-3">
                        <Skeleton className="w-10 h-10 rounded" />
                        <div className="space-y-2 flex-1">
                          <Skeleton className="h-4 w-24" />
                          <Skeleton className="h-3 w-16" />
                        </div>
                      </div>
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-3 w-2/3" />
                    </div>
                  ))}
                </div>
              ) : filteredPlugins.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20">
                  <Package className="w-12 h-12 text-muted-foreground mb-4 opacity-50" />
                  <h3 className="text-lg font-medium mb-2">No plugins found</h3>
                  <p className="text-sm text-muted-foreground text-center max-w-sm">
                    Try adjusting your search or drop a .wpk file in your plugins directory.
                  </p>
                </div>
              ) : (
                <div className="space-y-8">
                  {builtinPlugins.length > 0 && (
                    <section>
                      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
                        <Box className="w-4 h-4" /> Built-in
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted border">
                          {builtinPlugins.length}
                        </span>
                      </h3>
                      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                        {builtinPlugins.map((p) => (
                          <PluginCard
                            key={p.id}
                            plugin={p}
                            isLoaded={
                              loadedPlugins.includes(p.id) ||
                              p.state === 'active' ||
                              p.state === 'loaded'
                            }
                            onLoad={() => loadPlugin(p.id)}
                            onUnload={() => unloadPlugin(p.id)}
                          />
                        ))}
                      </div>
                    </section>
                  )}
                  {discoveredPlugins.length > 0 && (
                    <section>
                      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
                        <Zap className="w-4 h-4" /> Discovered
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted border">
                          {discoveredPlugins.length}
                        </span>
                      </h3>
                      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                        {discoveredPlugins.map((p) => (
                          <PluginCard
                            key={p.id}
                            plugin={p}
                            isLoaded={
                              loadedPlugins.includes(p.id) ||
                              p.state === 'active' ||
                              p.state === 'loaded'
                            }
                            onLoad={() => loadPlugin(p.id)}
                            onUnload={() => unloadPlugin(p.id)}
                          />
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
