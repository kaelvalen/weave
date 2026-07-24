import { useAppStore } from '@/stores/useAppStore';
import type { View } from '@/types/app';
import {
  Activity,
  MessageSquare,
  Package,
  Brain,
  Boxes,
  FolderOpen,
  StickyNote,
  Plug,
  Cpu,
  User,
  Settings,
  type LucideIcon,
} from 'lucide-react';

interface NavItem {
  view: View;
  label: string;
  icon: LucideIcon;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
    label: 'Workspace',
    items: [
      { view: 'chat', label: 'Conversations', icon: MessageSquare },
      { view: 'execution', label: 'Executions', icon: Activity },
    ],
  },
  {
    label: 'Knowledge',
    items: [
      { view: 'artifacts', label: 'Artifacts', icon: Package },
      { view: 'memory', label: 'Memory', icon: Brain },
      { view: 'files', label: 'Files', icon: FolderOpen },
      { view: 'notes', label: 'Notes', icon: StickyNote },
    ],
  },
  {
    label: 'System',
    items: [
      { view: 'capabilities', label: 'Capabilities', icon: Boxes },
      { view: 'plugins', label: 'Plugins', icon: Plug },
      { view: 'models', label: 'Models', icon: Cpu },
    ],
  },
  {
    label: 'Settings',
    items: [
      { view: 'profile', label: 'Profile', icon: User },
      { view: 'settings', label: 'Settings', icon: Settings },
    ],
  },
];

export function WorkspaceSidebar() {
  const activeView = useAppStore((s) => s.activeView);
  const setActiveView = useAppStore((s) => s.setActiveView);

  return (
    <aside className="w-44 flex-shrink-0 flex flex-col h-full border-r border-border bg-card select-none">
      <nav className="flex-1 overflow-y-auto p-2 flex flex-col gap-3">
        {SECTIONS.map((section) => (
          <div key={section.label} className="flex flex-col gap-0.5">
            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-2 py-1 font-mono">
              {section.label}
            </div>
            {section.items.map((item) => {
              const isActive = activeView === item.view;
              return (
                <button
                  key={item.view}
                  type="button"
                  onClick={() => setActiveView(item.view)}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded font-mono text-xs text-left transition-colors ${
                    isActive
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  }`}
                >
                  <item.icon className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
