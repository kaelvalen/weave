import { useAppStore } from '@/stores/useAppStore';
import { MessageCircle, Package, FolderOpen, Settings, Waves } from 'lucide-react';
import type { View } from '@/types/app';

const navItems: { view: View; label: string; icon: typeof MessageCircle }[] = [
  { view: 'chat', label: 'Chat', icon: MessageCircle },
  { view: 'plugins', label: 'Plugins', icon: Package },
  { view: 'files', label: 'Files', icon: FolderOpen },
  { view: 'settings', label: 'Settings', icon: Settings },
];

export function TopNav() {
  const activeView = useAppStore((s) => s.activeView);
  const setActiveView = useAppStore((s) => s.setActiveView);

  return (
    <div
      className="flex justify-center pt-3 px-4 pb-2 cursor-default select-none"
      data-tauri-drag-region
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <nav
        className="relative flex items-center justify-between gap-2 w-full max-w-4xl mx-auto rounded-[2rem] px-2 py-2 liquid-glass"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Logo */}
        <div
          className="relative z-10 flex items-center gap-2 pl-2 pr-3 flex-shrink-0"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary to-teal-400 flex items-center justify-center shadow-lg shadow-primary/25">
            <Waves className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="font-semibold text-sm text-foreground hidden sm:inline tracking-tight">
            Weave
          </span>
        </div>

        {/* Center Nav Items */}
        <div
          className="relative z-10 flex items-center gap-1 flex-1 justify-center"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {navItems.map((item) => {
            const isActive = activeView === item.view;
            const Icon = item.icon;
            return (
              <button
                key={item.view}
                type="button"
                onClick={() => setActiveView(item.view)}
                aria-current={isActive ? 'page' : undefined}
                className={`
                  relative flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium
                  transition-all duration-200 ease-out
                  ${isActive
                    ? 'text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  }
                `}
              >
                {isActive && (
                  <span className="absolute inset-0 rounded-xl bg-gradient-to-b from-primary to-primary/90 shadow-lg shadow-primary/30" />
                )}
                <Icon className="w-4 h-4 relative z-10" />
                <span className="hidden sm:inline relative z-10">{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Right spacer for balance — keeps nav centered */}
        <div className="w-[76px] hidden sm:block flex-shrink-0" aria-hidden="true" />
      </nav>
    </div>
  );
}
