import { useAppStore } from '@/stores/useAppStore';
import {
  MessageSquare,
  Package,
  FolderOpen,
  Settings,
  FileText,
  Database,
  Cpu,
  GitBranch,
  PenTool,
  User,
  Search,
} from 'lucide-react';
import type { View } from '@/types/app';

const navItems: { view: View; label: string; icon: typeof MessageSquare }[] = [
  { view: 'chat', label: 'Chat', icon: MessageSquare },
  { view: 'files', label: 'Files', icon: FolderOpen },
  { view: 'notes', label: 'Notes', icon: FileText },
  { view: 'knowledge', label: 'Knowledge', icon: Database },
  { view: 'models', label: 'Models', icon: Cpu },
  { view: 'workflows', label: 'Workflows', icon: GitBranch },
  { view: 'canvas', label: 'Canvas', icon: PenTool },
  { view: 'plugins', label: 'Plugins', icon: Package },
];

export function TopNav() {
  const activeView = useAppStore((s) => s.activeView);
  const setActiveView = useAppStore((s) => s.setActiveView);

  const handleCommandPalette = () => {
    window.dispatchEvent(new CustomEvent('open-command-palette'));
  };

  return (
    <header
      className="h-11 w-full border-b border-border bg-background/95 backdrop-blur-md flex items-center justify-between px-4 select-none flex-shrink-0 z-40"
      data-tauri-drag-region
    >
      {/* Left: Brand & Quick Search */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 font-mono font-bold text-xs tracking-wider uppercase text-foreground">
          <span className="w-2.5 h-2.5 bg-foreground rounded-sm" />
          <span>WEAVE</span>
        </div>

        <button
          type="button"
          onClick={handleCommandPalette}
          className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-muted/60 hover:bg-muted text-muted-foreground text-xs font-mono border border-border/50 transition-colors"
        >
          <Search className="w-3 h-3" />
          <span>Search...</span>
          <kbd className="text-[10px] bg-background border border-border px-1 rounded">⌘K</kbd>
        </button>
      </div>

      {/* Center: Monochrome Nav Tabs */}
      <nav className="flex items-center gap-0.5">
        {navItems.map((item) => {
          const isActive = activeView === item.view;
          const Icon = item.icon;

          return (
            <button
              key={item.view}
              type="button"
              onClick={() => setActiveView(item.view)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
                isActive
                  ? 'bg-foreground text-background shadow-xs font-semibold'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Right: Profile & Settings */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setActiveView('profile')}
          title="Profile & Memory"
          className={`p-1.5 rounded-md transition-colors ${
            activeView === 'profile'
              ? 'bg-foreground text-background'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          }`}
        >
          <User className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setActiveView('settings')}
          title="Settings"
          className={`p-1.5 rounded-md transition-colors ${
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

