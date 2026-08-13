import { useState } from 'react';
import { usePluginStore } from '@/stores/usePluginStore';
import { PluginCard } from './PluginCard';
import { GithubPluginPanel } from './GithubPluginPanel';
import { AddMcpServerDialog } from './AddMcpServerDialog';
import type { Plugin } from '@/types/plugin';
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
  Github,
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
  const mcpServers = usePluginStore((s) => s.mcpServers);
  const oauthAuthorize = usePluginStore((s) => s.oauthAuthorize);

  const [refreshing, setRefreshing] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [showGithub, setShowGithub] = useState(false);

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

  /**
   * OAuth-gated MCP server behind this plugin (`com.weave.mcp.<server_id>`)
   * that still lacks a token: return an authorize handler for the card's
   * Authorize action, or null when auth isn't pending. A server can end up
   * here even if the Add dialog's one-shot flow was skipped or closed.
   */
  const mcpAuthorizeFor = (plugin: Plugin): (() => Promise<void> | void) | null => {
    const PREFIX = 'com.weave.mcp.';
    if (!plugin.id.startsWith(PREFIX)) return null;
    const serverId = plugin.id.slice(PREFIX.length);
    const server = mcpServers.find((s) => s.id === serverId);
    if (!server || !server.auth_required || server.has_token) return null;
    return () => oauthAuthorize(serverId);
  };

  const categoryCounts: Record<string, number> = {};
  for (const p of plugins) {
    categoryCounts[p.category] = (categoryCounts[p.category] || 0) + 1;
  }

  return (
    <div className="flex flex-col h-full w-full bg-background overflow-hidden">
      {/* ── Unified View Header ── */}
      <header className="flex items-center justify-between px-6 py-4 bg-surface-1 border-b border-border/40 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-surface-2 text-foreground/80">
            <Puzzle className="w-5 h-5 text-brand" />
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight text-foreground flex items-center gap-2">
              Plugin Marketplace
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-surface-3 text-muted-foreground">
                {plugins.length} loaded
              </span>
            </h1>
            <p className="text-xs text-muted-foreground font-mono">Extend AI OS capabilities and integrations</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Search plugins & capabilities..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 bg-surface-2 border-border/40 h-8 text-xs focus-visible:ring-1 focus-visible:ring-brand"
            />
          </div>
          <Button
            onClick={() => setShowGithub((s) => !s)}
            size="sm"
            variant={showGithub ? 'default' : 'outline'}
            className="gap-1.5 h-8 text-xs border-border/40"
          >
            <Github className="w-3.5 h-3.5" />
            {showGithub ? 'Marketplace' : 'GitHub'}
          </Button>
          <AddMcpServerDialog />
          <Button
            onClick={handleInstall}
            disabled={installing || isLoading}
            size="sm"
            variant="outline"
            className="gap-1.5 h-8 text-xs border-border/40 bg-surface-2"
          >
            <Download className={`w-3.5 h-3.5 ${installing ? 'animate-spin' : ''}`} />
            Install .wpk
          </Button>
          <Button
            onClick={handleRefresh}
            disabled={refreshing || isLoading}
            size="sm"
            variant="ghost"
            className="gap-1.5 h-8 text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 max-w-6xl mx-auto w-full">

        {/* ── Category Tabs ── */}
        {!showGithub && (
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
        )}

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
              {showGithub ? (
                <GithubPluginPanel />
              ) : isLoading ? (
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
                        {discoveredPlugins.map((p) => {
                          const authorize = mcpAuthorizeFor(p);
                          return (
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
                              authRequired={authorize !== null}
                              onAuthorize={authorize ?? undefined}
                            />
                          );
                        })}
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
