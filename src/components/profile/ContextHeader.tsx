import { Sparkles, CheckCircle2, ShieldAlert, User, Brain, Terminal, BarChart2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export type ProfileTab = 'identity' | 'memory' | 'behavior' | 'insights';

interface ContextHeaderProps {
  memoryHealth: number;
  totalSignals: number;
  pendingConfirmations: number;
  isLoading: boolean;
  activeTab: ProfileTab;
  onTabChange: (tab: ProfileTab) => void;
  userName: string;
  userRole: string;
}

export function ContextHeader({
  memoryHealth,
  totalSignals,
  pendingConfirmations,
  isLoading,
  activeTab,
  onTabChange,
  userName,
  userRole,
}: ContextHeaderProps) {
  // Generate ASCII block progress bar for tech aesthetic
  const filledBlocks = Math.round((memoryHealth / 100) * 8);
  const emptyBlocks = 8 - filledBlocks;
  const asciiBar = '█'.repeat(Math.max(0, filledBlocks)) + '░'.repeat(Math.max(0, emptyBlocks));

  const tabs: { id: ProfileTab; label: string; icon: typeof User }[] = [
    { id: 'identity', label: 'Identity & Stack', icon: User },
    { id: 'memory', label: 'Memory Stream', icon: Brain },
    { id: 'behavior', label: 'AI Directives', icon: Terminal },
    { id: 'insights', label: 'Insights & Backup', icon: BarChart2 },
  ];

  return (
    <div className="px-8 py-5 border-b border-border/40 bg-card/30 backdrop-blur-md flex flex-col gap-5 shrink-0 select-none">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* User Identity Info */}
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-indigo-600 via-purple-600 to-pink-500 flex items-center justify-center text-white font-extrabold text-base shadow-md ring-2 ring-primary/20 shrink-0">
            {userName
              .split(' ')
              .map((n) => n[0])
              .join('')
              .slice(0, 2)
              .toUpperCase() || 'WV'}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight text-foreground">
                {userName}
              </h1>
              <Badge
                variant="outline"
                className="text-[10px] py-0.5 px-2 font-mono font-semibold bg-emerald-500/10 text-emerald-500 border-emerald-500/30 flex items-center gap-1 shadow-2xs"
              >
                <CheckCircle2 className="w-3 h-3" />
                <span>Context Synced</span>
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">
              {userRole}
            </p>
          </div>
        </div>

        {/* Memory Health Monitor Badge Panel */}
        <div className="flex items-center gap-4 bg-background/60 border border-border/50 px-4 py-2 rounded-2xl backdrop-blur-sm shadow-2xs">
          <div>
            <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground mb-0.5">
              <span>Memory Health</span>
              <span className="text-primary font-bold">{isLoading ? '...' : `${memoryHealth}%`}</span>
            </div>
            <div className="font-mono text-xs text-primary tracking-tighter select-none flex items-center gap-1">
              <span>{asciiBar}</span>
            </div>
          </div>

          <div className="w-px h-8 bg-border/50" />

          <div className="text-right font-mono">
            <div className="text-xs font-bold text-foreground">
              {isLoading ? '-' : totalSignals} <span className="font-normal text-muted-foreground text-[11px]">learned signals</span>
            </div>
            {pendingConfirmations > 0 ? (
              <div className="text-[10px] text-amber-500 font-medium flex items-center justify-end gap-1 mt-0.5">
                <ShieldAlert className="w-3 h-3" />
                <span>{pendingConfirmations} pending</span>
              </div>
            ) : (
              <div className="text-[10px] text-emerald-500/90 font-medium flex items-center justify-end gap-1 mt-0.5">
                <Sparkles className="w-3 h-3 text-emerald-500" />
                <span>High Confidence</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Navigation Tab Bar */}
      <div className="flex items-center gap-1 bg-muted/40 p-1 rounded-xl border border-border/40 w-fit">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-mono font-medium transition-all ${
                isActive
                  ? 'bg-background text-foreground shadow-sm font-semibold border border-border/50'
                  : 'text-muted-foreground hover:text-foreground hover:bg-background/40'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
