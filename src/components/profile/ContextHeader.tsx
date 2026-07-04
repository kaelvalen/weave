import { Sparkles, CheckCircle2, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface ContextHeaderProps {
  memoryHealth: number;
  totalSignals: number;
  pendingConfirmations: number;
  isLoading: boolean;
}

export function ContextHeader({
  memoryHealth,
  totalSignals,
  pendingConfirmations,
  isLoading,
}: ContextHeaderProps) {
  // Generate ASCII block progress bar for tech aesthetic
  const filledBlocks = Math.round((memoryHealth / 100) * 8);
  const emptyBlocks = 8 - filledBlocks;
  const asciiBar = '█'.repeat(Math.max(0, filledBlocks)) + '░'.repeat(Math.max(0, emptyBlocks));

  return (
    <div className="px-8 py-5 border-b border-border/30 bg-background flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-sm">
          <Sparkles className="w-5 h-5 animate-pulse text-primary" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-extrabold tracking-tight text-foreground font-mono">
              Weave Context OS
            </h1>
            <Badge
              variant="outline"
              className="text-[11px] py-0 px-2 font-mono font-semibold bg-emerald-500/10 text-emerald-500 border-emerald-500/30 flex items-center gap-1 shadow-sm"
            >
              <CheckCircle2 className="w-3 h-3" />
              <span>Synced ●</span>
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            AI autonomously reads and synthesizes these signals across all coding workflows and sessions.
          </p>
        </div>
      </div>

      {/* Memory Health Monitor Panel */}
      <div className="flex items-center gap-5 bg-card/40 border border-border/40 px-4 py-2 rounded-xl backdrop-blur-sm">
        <div>
          <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground mb-0.5">
            <span>Memory Health</span>
            <span className="text-primary font-bold">{isLoading ? '...' : `${memoryHealth}%`}</span>
          </div>
          <div className="font-mono text-xs text-primary tracking-tighter select-none flex items-center gap-1">
            <span>{asciiBar}</span>
          </div>
        </div>

        <div className="w-px h-8 bg-border/40" />

        <div className="text-right font-mono">
          <div className="text-xs font-bold text-foreground">
            {isLoading ? '-' : totalSignals} <span className="font-normal text-muted-foreground text-[11px]">learned signals</span>
          </div>
          {pendingConfirmations > 0 && (
            <div className="text-[10px] text-amber-500 font-medium flex items-center justify-end gap-1 mt-0.5">
              <ShieldAlert className="w-3 h-3" />
              <span>{pendingConfirmations} pending confirmations</span>
            </div>
          )}
          {pendingConfirmations === 0 && (
            <div className="text-[10px] text-muted-foreground/70 mt-0.5">
              High confidence stream
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
