import { useState, useEffect } from 'react';
import { usePluginStore } from '@/stores/usePluginStore';
import { PluginCard } from './PluginCard';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, RefreshCw, Package, Box, Puzzle, Code2, Brain, Layers, Zap, AlertCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

const CATEGORIES = [
  { value: null,           label: 'All',          icon: Layers },
  { value: 'system',       label: 'System',        icon: Box },
  { value: 'productivity', label: 'Productivity',  icon: Puzzle },
  { value: 'development',  label: 'Development',   icon: Code2 },
  { value: 'ai',           label: 'AI',            icon: Brain },
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

  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(clearError, 5000);
      return () => clearTimeout(timer);
    }
  }, [error, clearError]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await discoverPlugins();
    setRefreshing(false);
  };

  const filteredPlugins = plugins.filter((p) => {
    const q = searchQuery.toLowerCase();
    const matchSearch = !q ||
      p.name.toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.capabilities.provide.some((c) => c.toLowerCase().includes(q));
    const matchCat = !selectedCategory || p.category === selectedCategory;
    return matchSearch && matchCat;
  });

  const builtinPlugins    = filteredPlugins.filter((p) => p.is_builtin);
  const discoveredPlugins = filteredPlugins.filter((p) => !p.is_builtin);

  const categoryCounts: Record<string, number> = {};
  for (const p of plugins) {
    categoryCounts[p.category] = (categoryCounts[p.category] || 0) + 1;
  }

  return (
    <div className="flex flex-col h-full w-full bg-transparent pt-16">
      <div className="flex flex-col h-full max-w-5xl mx-auto w-full px-6">
        {/* ── Header ── */}
        <div className="flex items-center justify-between py-8 flex-shrink-0">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold tracking-tight text-foreground">Plugins</h2>
              <span className="text-xs text-muted-foreground font-mono px-2 py-0.5 rounded-full bg-muted border">
                {plugins.length} available
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">Discover, manage, and extend Weave's capabilities.</p>
          </div>

          <Button
            onClick={handleRefresh}
            disabled={refreshing || isLoading}
            className="gap-2 shadow-sm"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-card rounded-t-xl border-x border-t shadow-sm">

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

      {/* ── Search & Filters ── */}
      <div className="px-6 py-4 flex-shrink-0 space-y-4 border-b bg-muted/30">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, ID, or capability..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-background"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const isActive = selectedCategory === cat.value;
            const count = cat.value ? (categoryCounts[cat.value] || 0) : plugins.length;
            return (
              <button
                key={cat.label}
                type="button"
                onClick={() => setCategory(cat.value)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium border ${
                  isActive
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <Icon className="w-4 h-4" />
                {cat.label}
                <span className={`text-[10px] font-mono px-1 rounded ${
                  isActive ? 'bg-primary-foreground/20' : 'bg-muted'
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

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
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted border">{builtinPlugins.length}</span>
                  </h3>
                  <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                    {builtinPlugins.map((p) => (
                      <PluginCard
                        key={p.id}
                        plugin={p}
                        isLoaded={loadedPlugins.includes(p.id) || p.state === 'active' || p.state === 'loaded'}
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
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted border">{discoveredPlugins.length}</span>
                  </h3>
                  <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                    {discoveredPlugins.map((p) => (
                      <PluginCard
                        key={p.id}
                        plugin={p}
                        isLoaded={loadedPlugins.includes(p.id) || p.state === 'active' || p.state === 'loaded'}
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
