import { Download, ShieldAlert, Terminal } from 'lucide-react';

interface SystemFooterProps {
  onExport: () => void;
  onClear: () => Promise<void>;
  totalSignals: number;
}

export function SystemFooter({ onExport, onClear, totalSignals }: SystemFooterProps) {
  return (
    <div className="mt-12 pt-6 border-t border-border/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs font-mono text-muted-foreground pb-8 select-none">
      <div className="flex items-center gap-2">
        <Terminal className="w-3.5 h-3.5 text-primary" />
        <span>Weave Context OS v3.0</span>
        <span className="opacity-40">|</span>
        <span>Storage: <code className="text-foreground/80 bg-muted/40 px-1 py-0.5 rounded">~/.weave/memory.json</code></span>
      </div>

      <div className="flex items-center gap-6">
        <button
          type="button"
          onClick={onExport}
          className="flex items-center gap-1.5 hover:text-foreground transition-colors py-1 group"
          title="Download complete JSON backup of identity and memory event stream"
        >
          <Download className="w-3.5 h-3.5 text-primary group-hover:scale-110 transition-transform" />
          <span>Export Backup ({totalSignals} signals)</span>
        </button>

        <span className="opacity-30">|</span>

        <button
          type="button"
          onClick={onClear}
          className="flex items-center gap-1.5 text-destructive/80 hover:text-destructive transition-colors py-1 group"
          title="Reset all dynamic memory signals while keeping personal identity intact"
        >
          <ShieldAlert className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
          <span>Reset Memory Stream</span>
        </button>
      </div>
    </div>
  );
}
