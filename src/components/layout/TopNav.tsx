import { useAppStore } from '@/stores/useAppStore';
import { MessageCircle, Package, FolderOpen, Settings, FileText, Database, Cpu, GitBranch, PenTool } from 'lucide-react';
import type { View } from '@/types/app';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const navItems: { view: View; label: string; icon: typeof MessageCircle }[] = [
  { view: 'chat',      label: 'Chat',      icon: MessageCircle },
  { view: 'files',     label: 'Files',     icon: FolderOpen },
  { view: 'notes',     label: 'Notes',     icon: FileText },
  { view: 'knowledge', label: 'Knowledge', icon: Database },
  { view: 'models',    label: 'Models',    icon: Cpu },
  { view: 'workflows', label: 'Workflows', icon: GitBranch },
  { view: 'canvas',    label: 'Canvas',    icon: PenTool },
  { view: 'plugins',   label: 'Plugins',   icon: Package },
];

export function TopNav() {
  const activeView   = useAppStore((s) => s.activeView);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const isChatExpanded = useAppStore((s) => s.isChatExpanded);
  const toggleChat = useAppStore((s) => s.toggleChat);

  return (
    <header
      className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex items-center justify-between gap-4 h-12 px-2 select-none rounded-full bg-card/80 border border-border backdrop-blur-md shadow-sm"
      data-tauri-drag-region
      style={{
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      {/* ── Nav Links ── */}
      <nav
        className="flex items-center gap-1"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {navItems.map((item) => {
          const isChatButton = item.view === 'chat';
          const isActive = isChatButton ? isChatExpanded : activeView === item.view;
          const Icon = item.icon;
          return (
            <Tooltip key={item.view}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => isChatButton ? toggleChat() : setActiveView(item.view)}
                  className={[
                    'relative flex items-center justify-center w-8 h-8 rounded-full',
                    'transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isActive ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  ].join(' ')}
                >
                  <Icon className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={8}>
                <p>{item.label}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}

        <div className="w-px h-4 bg-border mx-1" />

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setActiveView('settings')}
              className={[
                'relative flex items-center justify-center w-8 h-8 rounded-full',
                'transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                activeView === 'settings' ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              ].join(' ')}
            >
              <Settings className="w-4 h-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={8}>
            <p>Settings</p>
          </TooltipContent>
        </Tooltip>
      </nav>
    </header>
  );
}
