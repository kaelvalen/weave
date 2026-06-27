import { useState } from 'react';
import { usePluginStore } from '@/stores/usePluginStore';
import { PluginCard } from './PluginCard';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Search,
  RefreshCw,
  Package,
  Box,
  Puzzle,
  Code2,
  Brain,
  Layers,
} from 'lucide-react';

const CATEGORIES = [
  { value: null, label: 'All', icon: Layers },
  { value: 'system', label: 'System', icon: Box },
  { value: 'productivity', label: 'Productivity', icon: Puzzle },
  { value: 'development', label: 'Development', icon: Code2 },
  { value: 'ai', label: 'AI', icon: Brain },
];

export function PluginMarket() {
  const { plugins, isLoading, discoverPlugins, searchQuery, setSearchQuery, selectedCategory, setCategory } = usePluginStore();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await discoverPlugins();
    setRefreshing(false);
  };

  const filteredPlugins = plugins.filter((plugin) => {
    const matchesSearch = !searchQuery ||
      plugin.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      plugin.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      plugin.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      plugin.capabilities.provide.some((c) => c.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesCategory = !selectedCategory || plugin.category === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  const builtinPlugins = filteredPlugins.filter((p) => p.is_builtin);
  const discoveredPlugins = filteredPlugins.filter((p) => !p.is_builtin);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between h-12 px-4 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-medium">Plugins</h2>
          <Badge variant="secondary" className="text-[10px] h-5">
            {filteredPlugins.length}
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={handleRefresh}
          disabled={refreshing || isLoading}
        >
          <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Search & Filters */}
      <div className="p-4 space-y-3 flex-shrink-0 bg-gradient-subtle">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search plugins by name, ID, or capability..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 text-sm glass-input"
          />
        </div>

        {/* Category Tabs */}
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const isActive = selectedCategory === cat.value;
            return (
              <Button
                key={cat.label}
                variant={isActive ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={() => setCategory(cat.value)}
              >
                <Icon className="w-3.5 h-3.5" />
                {cat.label}
                <span className="text-muted-foreground">
                  {cat.value === null
                    ? filteredPlugins.length
                    : plugins.filter((p) => p.category === cat.value).length}
                </span>
              </Button>
            );
          })}
        </div>
      </div>

      <Separator />

      {/* Plugin List */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4">
          {isLoading ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="space-y-3 p-4 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <Skeleton className="w-9 h-9 rounded-lg" />
                    <div className="space-y-1.5 flex-1">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                  </div>
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                  <div className="flex gap-1">
                    <Skeleton className="h-4 w-14" />
                    <Skeleton className="h-4 w-14" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredPlugins.length === 0 ? (
            /* Empty State */
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Package className="w-12 h-12 mb-4 opacity-40" />
              <h3 className="text-base font-medium text-foreground mb-1">
                {searchQuery || selectedCategory ? 'No matching plugins' : 'No plugins found'}
              </h3>
              <p className="text-sm max-w-md text-center">
                {searchQuery || selectedCategory
                  ? 'Try adjusting your search or filters.'
                  : 'Plugins will appear here when discovered. Place .wpk files in ~/.weave/plugins/'}
              </p>
              {!searchQuery && !selectedCategory && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4 gap-1.5"
                  onClick={handleRefresh}
                >
                  <RefreshCw className="w-3 h-3" />
                  Scan for Plugins
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {/* Built-in Plugins */}
              {builtinPlugins.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                    <Box className="w-3.5 h-3.5" />
                    Built-in Plugins
                  </h3>
                  <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                    {builtinPlugins.map((plugin) => (
                      <PluginCard key={plugin.id} plugin={plugin} />
                    ))}
                  </div>
                </div>
              )}

              {/* Discovered Plugins */}
              {discoveredPlugins.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                    <Package className="w-3.5 h-3.5" />
                    Discovered Plugins
                  </h3>
                  <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                    {discoveredPlugins.map((plugin) => (
                      <PluginCard key={plugin.id} plugin={plugin} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
