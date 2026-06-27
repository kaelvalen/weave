import { useState } from 'react';
import type { Plugin } from '@/types/plugin';
import { usePluginStore } from '@/stores/usePluginStore';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Shield, ShieldCheck, AlertTriangle, Zap,
  Monitor, Puzzle, Code2, Brain, FolderOpen, Calculator, StickyNote,
  Terminal, Globe, Database, GitBranch, Send, HardDrive, Info,
} from 'lucide-react';

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  system: Monitor,
  productivity: Puzzle,
  development: Code2,
  ai: Brain,
};

const PLUGIN_ICONS: Record<string, React.ElementType> = {
  'com.weave.builtin.file': FolderOpen,
  'com.weave.builtin.calc': Calculator,
  'com.weave.builtin.note': StickyNote,
  'com.weave.builtin.sys': Monitor,
  'com.weave.builtin.shell': Terminal,
  'com.weave.builtin.web': Globe,
  'com.weave.builtin.db': Database,
  'com.weave.builtin.git': GitBranch,
  'com.weave.builtin.http': Send,
  'com.weave.builtin.memory': HardDrive,
};

interface PluginCardProps { plugin: Plugin }

export function PluginCard({ plugin }: PluginCardProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { loadPlugin, unloadPlugin, loadedPlugins } = usePluginStore();

  const isLoaded = loadedPlugins.includes(plugin.id) || plugin.state === 'active' || plugin.state === 'loaded';
  const hasError = typeof plugin.state === 'string' && plugin.state.startsWith('Error');

  const handleToggle = async () => {
    if (plugin.is_builtin) return;
    if (isLoaded) await unloadPlugin(plugin.id);
    else await loadPlugin(plugin.id);
  };

  const PluginIcon = PLUGIN_ICONS[plugin.id] || CATEGORY_ICONS[plugin.category] || Monitor;

  return (
    <>
      {/* ── Card ── */}
      <div className={`flex flex-col rounded-lg border bg-card transition-shadow hover:shadow-sm ${isLoaded ? 'border-primary/50' : ''}`}>
        {/* Header */}
        <div className="flex items-start gap-3 p-4 pb-3">
          <div className={`w-10 h-10 rounded-md flex items-center justify-center flex-shrink-0 ${isLoaded ? 'bg-primary/10' : 'bg-muted'}`}>
            <PluginIcon className={`w-5 h-5 ${isLoaded ? 'text-primary' : 'text-muted-foreground'}`} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <h3 className="text-sm font-semibold text-foreground truncate">{plugin.name}</h3>
              {plugin.is_builtin && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-foreground border">
                  Built-in
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground font-mono truncate">{plugin.id}</p>
          </div>

          <span className={`flex-shrink-0 inline-flex items-center gap-1 h-5 px-2 rounded text-[10px] font-medium border ${
            hasError ? 'bg-destructive/10 text-destructive border-destructive/20' :
            isLoaded ? 'bg-primary/10 text-primary border-primary/20' :
            'bg-muted text-muted-foreground border-border'
          }`}>
            {hasError ? <AlertTriangle className="w-3 h-3" /> : isLoaded ? <Zap className="w-3 h-3" /> : null}
            {hasError ? 'Error' : isLoaded ? 'Active' : 'Off'}
          </span>
        </div>

        {/* Body */}
        <div className="flex-1 px-4 pb-4">
          <p className="text-sm text-foreground/80 leading-relaxed line-clamp-2 mb-3">
            {plugin.description}
          </p>

          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
            <span className="font-mono px-1.5 py-0.5 rounded bg-muted border">v{plugin.version}</span>
            <span className="truncate">by {plugin.author}</span>
            <span className="ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted border">
              {plugin.capabilities.provide.length} tools
            </span>
          </div>

          <div className="flex items-center justify-between gap-2 border-t pt-3">
            <div className="flex items-center gap-2">
              {plugin.is_builtin ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <ShieldCheck className="w-4 h-4" />
                  Always Active
                </span>
              ) : (
                <div className="flex items-center gap-2">
                  <Switch checked={isLoaded} onCheckedChange={handleToggle} disabled={hasError} />
                  <span className="text-xs font-medium text-foreground">
                    {isLoaded ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
              )}
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs px-2 gap-1.5"
              onClick={() => setDetailsOpen(true)}
            >
              <Info className="w-3.5 h-3.5" />
              Details
            </Button>
          </div>
        </div>
      </div>

      {/* ── Details Dialog ── */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-hidden flex flex-col p-0">
          {/* Dialog Header */}
          <DialogHeader className="px-6 pt-6 pb-4 border-b flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-md flex items-center justify-center flex-shrink-0 ${isLoaded ? 'bg-primary/10' : 'bg-muted'}`}>
                <PluginIcon className={`w-5 h-5 ${isLoaded ? 'text-primary' : 'text-muted-foreground'}`} />
              </div>
              <div className="min-w-0 flex-1">
                <DialogTitle className="text-base font-semibold leading-tight">{plugin.name}</DialogTitle>
                <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate">{plugin.id}</p>
              </div>
              <span className={`flex-shrink-0 inline-flex items-center gap-1 h-5 px-2 rounded text-[10px] font-medium border ${
                isLoaded ? 'bg-primary/10 text-primary border-primary/20' : 'bg-muted text-muted-foreground border-border'
              }`}>
                {isLoaded ? <Zap className="w-3 h-3" /> : null}
                {isLoaded ? 'Active' : 'Inactive'}
              </span>
            </div>
          </DialogHeader>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 min-h-0">
            {/* Description */}
            <p className="text-sm text-foreground/80 leading-relaxed">{plugin.description}</p>

            {/* Meta */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-2.5 rounded-md bg-muted/50 border">
                <span className="text-muted-foreground block mb-1">Runtime</span>
                <code className="font-mono font-medium">{plugin.runtime.runtime_type}</code>
              </div>
              <div className="p-2.5 rounded-md bg-muted/50 border">
                <span className="text-muted-foreground block mb-1">Sandbox</span>
                <span className="inline-flex items-center gap-1 font-medium">
                  {plugin.runtime.sandbox === 'strict' ? <Shield className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                  {plugin.runtime.sandbox}
                </span>
              </div>
              <div className="p-2.5 rounded-md bg-muted/50 border">
                <span className="text-muted-foreground block mb-1">Version</span>
                <span className="font-mono font-medium">v{plugin.version}</span>
              </div>
              <div className="p-2.5 rounded-md bg-muted/50 border">
                <span className="text-muted-foreground block mb-1">Author</span>
                <span className="font-medium truncate">{plugin.author}</span>
              </div>
            </div>

            {/* Capabilities */}
            {plugin.capabilities.provide.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">
                  Capabilities ({plugin.capabilities.provide.length})
                </h4>
                <div className="space-y-2">
                  {plugin.capabilities.provide.map((cap) => {
                    const desc = plugin.capabilities.descriptions?.[cap];
                    const schema = plugin.capabilities.schemas?.[cap];
                    return (
                      <div key={cap} className="p-3 rounded-md bg-muted/40 border text-xs">
                        <div className="font-mono font-semibold text-foreground mb-1">{cap}</div>
                        {desc && <p className="text-muted-foreground mb-1.5">{desc}</p>}
                        {schema && (
                          <code className="text-[10px] font-mono text-muted-foreground/70 bg-background/60 px-1.5 py-0.5 rounded block truncate">
                            {schema}
                          </code>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Access */}
            {(plugin.capabilities.read.length > 0 || plugin.capabilities.write.length > 0) && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">Access</h4>
                <div className="space-y-2">
                  {plugin.capabilities.read.length > 0 && (
                    <div>
                      <span className="text-xs text-muted-foreground block mb-1">Read</span>
                      <div className="flex flex-wrap gap-1">
                        {plugin.capabilities.read.map((r) => (
                          <span key={r} className="text-[10px] px-1.5 py-0.5 rounded bg-muted border font-mono">{r}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {plugin.capabilities.write.length > 0 && (
                    <div>
                      <span className="text-xs text-muted-foreground block mb-1">Write</span>
                      <div className="flex flex-wrap gap-1">
                        {plugin.capabilities.write.map((w) => (
                          <span key={w} className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive border font-mono">{w}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t flex-shrink-0 flex items-center justify-between">
            {plugin.is_builtin ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <ShieldCheck className="w-4 h-4" />
                Always Active
              </span>
            ) : (
              <div className="flex items-center gap-2">
                <Switch checked={isLoaded} onCheckedChange={handleToggle} disabled={hasError} />
                <span className="text-xs font-medium">{isLoaded ? 'Enabled' : 'Disabled'}</span>
              </div>
            )}
            <Button variant="outline" size="sm" onClick={() => setDetailsOpen(false)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
