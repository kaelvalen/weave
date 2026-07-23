import { useAppStore } from '@/stores/useAppStore';
import {
  Settings,
  User,
  Search,
  PanelLeft,
  PanelRight,
} from 'lucide-react';

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

  return (
    <header
      className="h-10 w-full border-b border-border bg-background flex items-center justify-between px-3 select-none flex-shrink-0 z-40 font-mono text-xs"
      data-tauri-drag-region
    >
      {/* Left: Brand, Sidebar Toggle & Search */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggleLeftSidebar}
          title="Toggle Threads Sidebar"
          className={`p-1 rounded transition-colors ${
            isLeftSidebarOpen
              ? 'bg-foreground text-background'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          }`}
        >
          <PanelLeft className="w-3.5 h-3.5" />
        </button>

        <div className="flex items-center gap-2 font-bold tracking-wider uppercase text-foreground ml-1">
          <span className="w-2 h-2 bg-foreground rounded-xs" />
          <span>WEAVE</span>
        </div>

        <button
          type="button"
          onClick={handleCommandPalette}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-muted/50 hover:bg-muted text-muted-foreground text-[11px] border border-border transition-colors ml-2"
        >
          <Search className="w-3 h-3" />
          <span>Search...</span>
          <kbd className="text-[9px] bg-background border border-border px-1 rounded">⌘K</kbd>
        </button>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={toggleRightPanel}
          title="Toggle Artifact Side Panel"
          className={`p-1.5 rounded transition-colors ${
            isRightPanelOpen
              ? 'bg-foreground text-background'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          }`}
        >
          <PanelRight className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setActiveView(activeView === 'profile' ? 'chat' : 'profile')}
          title="Profile"
          className={`p-1.5 rounded transition-colors ${
            activeView === 'profile'
              ? 'bg-foreground text-background'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          }`}
        >
          <User className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setActiveView(activeView === 'settings' ? 'chat' : 'settings')}
          title="Settings"
          className={`p-1.5 rounded transition-colors ${
            activeView === 'settings'
              ? 'bg-foreground text-background'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          }`}
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
}

