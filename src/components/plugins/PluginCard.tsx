import { useState } from 'react';
import type { Plugin } from '@/types/plugin';
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

/* ── Simple toggle — replaces Radix Switch which causes WebKitGTK layout freeze ── */
function SimpleToggle({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className={`
        relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full
        border-2 border-transparent transition-colors duration-200
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
        disabled:cursor-not-allowed disabled:opacity-50
        ${checked ? 'bg-primary' : 'bg-input'}
      `}
    >
      <span
        className={`
          pointer-events-none block h-4 w-4 rounded-full bg-background shadow-sm
          transition-transform duration-200
          ${checked ? 'translate-x-4' : 'translate-x-0'}
        `}
      />
    </button>
  );
}

interface PluginCardProps {
  plugin: Plugin;
  isLoaded: boolean;
  onLoad: () => Promise<void> | void;
  onUnload: () => Promise<void> | void;
}

export function PluginCard({ plugin, isLoaded, onLoad, onUnload }: PluginCardProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [toggling, setToggling] = useState(false);

  // Rust serde serializes Error(String) as { "error": "msg" } due to rename_all="lowercase"
  const hasError = typeof plugin.state === 'object' && plugin.state !== null && 'error' in (plugin.state as any);

  const handleToggle = async () => {
    if (plugin.is_builtin || toggling) return;
    setToggling(true);
    try {
      if (isLoaded) await onUnload();
      else await onLoad();
    } finally {
      setToggling(false);
    }
  };

  const PluginIcon = PLUGIN_ICONS[plugin.id] || CATEGORY_ICONS[plugin.category] || Monitor;

  return (
    <>
      {/* ── Card ── */}
      <div className={`flex flex-col rounded-lg border bg-card ${isLoaded ? 'border-primary/50' : ''}`}>
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
          <p className="text-sm text-foreground/80 leading-relaxed mb-3" style={{ minHeight: '2.5rem' }}>
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
                  <SimpleToggle checked={isLoaded} onChange={handleToggle} disabled={hasError || toggling} />
                  <span className="text-xs font-medium text-foreground">
                    {toggling ? 'Loading...' : isLoaded ? 'Enabled' : 'Disabled'}
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

      {/* ── Details Dialog — only mounted when open ── */}
      {detailsOpen && (
        <Dialog open={true} onOpenChange={(open) => { if (!open) setDetailsOpen(false); }}>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-hidden flex flex-col p-0">
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

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 min-h-0">
              <p className="text-sm text-foreground/80 leading-relaxed">{plugin.description}</p>

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
                  <span className="font-medium">{plugin.author}</span>
                </div>
              </div>

              {plugin.capabilities.provide.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">
                    Capabilities ({plugin.capabilities.provide.length})
                  </h4>
                  <div className="space-y-2">
                    {plugin.capabilities.provide.map((cap) => {
                      const desc = plugin.capabilities.descriptions?.[cap];
                      return (
                        <div key={cap} className="p-3 rounded-md bg-muted/40 border text-xs">
                          <div className="font-mono font-semibold text-foreground mb-1">{cap}</div>
                          {desc && <p className="text-muted-foreground">{desc}</p>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t flex-shrink-0 flex items-center justify-between">
              {plugin.is_builtin ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <ShieldCheck className="w-4 h-4" />
                  Always Active
                </span>
              ) : (
                <div className="flex items-center gap-2">
                  <SimpleToggle checked={isLoaded} onChange={handleToggle} disabled={hasError} />
                  <span className="text-xs font-medium">{isLoaded ? 'Enabled' : 'Disabled'}</span>
                </div>
              )}
              <Button variant="outline" size="sm" onClick={() => setDetailsOpen(false)}>
                Close
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
