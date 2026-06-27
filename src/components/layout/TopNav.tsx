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
    <div className="flex justify-center pt-3 px-4">
      <nav className="glass-strong flex items-center gap-3 rounded-2xl px-3 py-2 w-full max-w-4xl mx-auto">
        {/* Logo */}
        <div className="flex items-center gap-2 mr-2 flex-shrink-0">
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
            <Waves className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="font-semibold text-sm text-foreground hidden sm:inline">Weave</span>
        </div>

        {/* Nav Items */}
        <div className="flex items-center gap-1 flex-1">
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
                  flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium transition-all duration-150
                  ${isActive
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  }
                `}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
