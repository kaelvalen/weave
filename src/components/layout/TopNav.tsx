import { useAppStore } from '@/stores/useAppStore';
import { useChatStore } from '@/stores/useChatStore';
import { useRuntimeStore } from '@/stores/useRuntimeStore';
import { useSystemPulse } from '@/hooks/useSystemPulse';
import { effectiveTps, formatTps } from '@/lib/modelStats';
import { Settings, User, Search, PanelLeft, PanelRight } from 'lucide-react';

/**
 * Ambient Runtime — a small living status readout in the top-right corner.
 * Idle: "● Ready · model · tps". Busy: "● Executing · model · N steps".
 */
function AmbientStatus() {
  const { modelStats } = useSystemPulse();
  const selectedModel = useChatStore((s) => s.selectedModel);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const runningCount = useRuntimeStore(
    (s) => s.executions.filter((e) => e.status === 'running').length
  );

  const busy = isStreaming || runningCount > 0;
  const tps = effectiveTps(modelStats);

  return (
    <div
      className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground select-none"
      title={busy ? 'Runtime is executing' : 'Runtime is ready'}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full bg-brand ${busy ? 'status-pulse' : ''}`}
        aria-hidden
      />
      <span className={busy ? 'text-brand font-medium' : 'text-foreground font-medium'}>
        {busy ? 'Executing' : 'Ready'}
      </span>
      {selectedModel && (
        <>
          <span className="text-muted-foreground/50">·</span>
          <span className="max-w-[140px] truncate">{selectedModel}</span>
        </>
      )}
      {busy && runningCount > 0 ? (
        <>
          <span className="text-muted-foreground/50">·</span>
          <span>
            {runningCount} step{runningCount === 1 ? '' : 's'}
          </span>
        </>
      ) : (
        tps != null && (
          <>
            <span className="text-muted-foreground/50">·</span>
            <span>{formatTps(tps)} tok/s</span>
          </>
        )
      )}
    </div>
  );
}

export function TopNav() {
  const isLeftSidebarOpen = useAppStore((s) => s.isLeftSidebarOpen);
  const isRightPanelOpen = useAppStore((s) => s.isRightPanelOpen);
  const toggleLeftSidebar = useAppStore((s) => s.toggleLeftSidebar);
  const toggleRightPanel = useAppStore((s) => s.toggleRightPanel);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const activeView = useAppStore((s) => s.activeView);

  const handleCommandPalette = () => {
    window.dispatchEvent(new CustomEvent('open-command-palette'));
  };

  const toggleClass = (active: boolean) =>
    `p-1.5 rounded-md transition-colors ${
      active
        ? 'bg-surface-3 text-foreground'
        : 'text-muted-foreground hover:text-foreground hover:bg-surface-2'
    }`;

  return (
    <header
      className="h-11 w-full bg-background flex items-center justify-between px-3 select-none flex-shrink-0 z-40"
      data-tauri-drag-region
    >
      {/* Left: Sidebar Toggle, Brand & Search */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={toggleLeftSidebar}
          title="Toggle Threads Sidebar"
          className={toggleClass(isLeftSidebarOpen)}
        >
          <PanelLeft className="w-3.5 h-3.5" />
        </button>

        <div className="flex items-center gap-2 ml-1 mr-1">
          <span className="w-2 h-2 bg-gradient-to-br from-brand to-brand/50 rounded-[3px]" />
          <span className="text-xs font-bold tracking-[0.18em] uppercase text-foreground">
            Weave
          </span>
        </div>

        <button
          type="button"
          onClick={handleCommandPalette}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-surface-1 hover:bg-surface-2 text-muted-foreground hover:text-foreground text-[11px] transition-colors ml-1"
        >
          <Search className="w-3 h-3" />
          <span>Search...</span>
          <kbd className="text-[9px] font-mono bg-surface-3 px-1 rounded">⌘K</kbd>
        </button>
      </div>

      {/* Right: Ambient Runtime + Actions */}
      <div className="flex items-center gap-3">
        <AmbientStatus />
        <div className="w-px h-4 bg-border/60" aria-hidden />
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={toggleRightPanel}
            title="Toggle Artifact Side Panel"
            className={toggleClass(isRightPanelOpen)}
          >
            <PanelRight className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setActiveView(activeView === 'profile' ? 'chat' : 'profile')}
            title="Profile"
            className={toggleClass(activeView === 'profile')}
          >
            <User className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setActiveView(activeView === 'settings' ? 'chat' : 'settings')}
            title="Settings"
            className={toggleClass(activeView === 'settings')}
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
}
