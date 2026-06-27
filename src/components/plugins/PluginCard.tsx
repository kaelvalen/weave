import { useState } from 'react';
import type { Plugin } from '@/types/plugin';
import { usePluginStore } from '@/stores/usePluginStore';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Shield,
  ShieldCheck,
  Box,
  Brain,
  Code2,
  Puzzle,
  ChevronDown,
  Power,
  PowerOff,
  AlertTriangle,
} from 'lucide-react';

interface PluginCardProps {
  plugin: Plugin;
}

const categoryConfig = {
  system: { icon: Box, color: 'bg-blue-500/10 text-blue-600 border-blue-200' },
  productivity: { icon: Puzzle, color: 'bg-emerald-500/10 text-emerald-600 border-emerald-200' },
  development: { icon: Code2, color: 'bg-violet-500/10 text-violet-600 border-violet-200' },
  ai: { icon: Brain, color: 'bg-fuchsia-500/10 text-fuchsia-600 border-fuchsia-200' },
};

const stateConfig = {
  discovered: { label: 'Discovered', color: 'bg-muted text-muted-foreground' },
  loaded: { label: 'Loaded', color: 'bg-amber-500/10 text-amber-600' },
  active: { label: 'Active', color: 'bg-emerald-500/10 text-emerald-600' },
  unloaded: { label: 'Unloaded', color: 'bg-muted text-muted-foreground' },
};

export function PluginCard({ plugin }: PluginCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { loadPlugin, unloadPlugin, loadedPlugins } = usePluginStore();
  const isLoaded = loadedPlugins.includes(plugin.id) || plugin.state === 'active' || plugin.state === 'loaded';
  const hasError = typeof plugin.state === 'string' && plugin.state.startsWith('Error');

  const catConfig = categoryConfig[plugin.category] || categoryConfig.system;
  const CatIcon = catConfig.icon;
  const stateKey = typeof plugin.state === 'string' ? plugin.state : 'discovered';
  const stConfig = stateConfig[stateKey as keyof typeof stateConfig] || stateConfig.discovered;

  const handleToggle = async () => {
    if (plugin.is_builtin) return;
    if (isLoaded) {
      await unloadPlugin(plugin.id);
    } else {
      await loadPlugin(plugin.id);
    }
  };

  return (
    <Card className="group transition-all hover:shadow-md border-border/60 glass">
      <CardHeader className="p-4 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${catConfig.color}`}>
              <CatIcon className="w-4.5 h-4.5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h3 className="font-medium text-sm text-foreground truncate">{plugin.name}</h3>
                {plugin.is_builtin && (
                  <Badge variant="outline" className="text-[9px] h-4 px-1 flex-shrink-0">
                    Built-in
                  </Badge>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground truncate">
                {plugin.id}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Badge variant="outline" className={`text-[10px] h-5 px-1.5 ${stConfig.color}`}>
              {hasError ? (
                <span className="flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  Error
                </span>
              ) : (
                stConfig.label
              )}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 pt-2">
        <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
          {plugin.description}
        </p>

        {/* Meta */}
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground mb-3">
          <span>v{plugin.version}</span>
          <span className="truncate">by {plugin.author}</span>
        </div>

        {/* Capabilities */}
        {plugin.capabilities.provide.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {plugin.capabilities.provide.slice(0, 4).map((cap) => (
              <Badge key={cap} variant="secondary" className="text-[9px] h-4 px-1">
                {cap}
              </Badge>
            ))}
            {plugin.capabilities.provide.length > 4 && (
              <Badge variant="secondary" className="text-[9px] h-4 px-1">
                +{plugin.capabilities.provide.length - 4}
              </Badge>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between">
          {!plugin.is_builtin && (
            <Button
              size="sm"
              variant={isLoaded ? 'outline' : 'default'}
              className="h-7 text-xs gap-1.5"
              onClick={handleToggle}
            >
              {isLoaded ? (
                <>
                  <PowerOff className="w-3 h-3" />
                  Unload
                </>
              ) : (
                <>
                  <Power className="w-3 h-3" />
                  Load
                </>
              )}
            </Button>
          )}
          {plugin.is_builtin && (
            <Badge variant="outline" className="text-[10px] h-6 gap-1 bg-emerald-500/5 text-emerald-600 border-emerald-200">
              <ShieldCheck className="w-3 h-3" />
              Always Active
            </Badge>
          )}

          <Collapsible open={expanded} onOpenChange={setExpanded}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
                Details
                <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
              </Button>
            </CollapsibleTrigger>
          </Collapsible>
        </div>

        {/* Expanded Details */}
        <Collapsible open={expanded} onOpenChange={setExpanded}>
          <CollapsibleContent>
            <Separator className="my-3" />
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Runtime</span>
                <Badge variant="outline" className="text-[10px] h-5">
                  {plugin.runtime.runtime_type}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Sandbox</span>
                <Badge variant="outline" className="text-[10px] h-5 gap-1">
                  {plugin.runtime.sandbox === 'strict' ? (
                    <Shield className="w-3 h-3" />
                  ) : (
                    <ShieldCheck className="w-3 h-3" />
                  )}
                  {plugin.runtime.sandbox}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">UI Type</span>
                <span className="font-mono text-[10px]">{plugin.ui.ui_type}</span>
              </div>
              {plugin.capabilities.read.length > 0 && (
                <div>
                  <span className="text-muted-foreground">Read Access</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {plugin.capabilities.read.map((r) => (
                      <Badge key={r} variant="outline" className="text-[9px] h-4 px-1">
                        {r}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {plugin.capabilities.write.length > 0 && (
                <div>
                  <span className="text-muted-foreground">Write Access</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {plugin.capabilities.write.map((w) => (
                      <Badge key={w} variant="outline" className="text-[9px] h-4 px-1">
                        {w}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
