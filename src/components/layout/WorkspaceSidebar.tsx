import { useState } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import type { View } from '@/types/app';
import {
  MessageSquare,
  FolderOpen,
  BookOpen,
  Plug,
  Settings,
  ChevronRight,
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

/**
 * Workspace navigator — not a feature list. Four domains, each expanding
 * to reveal its objects. The section containing the active view always
 * stays open; the rest collapse to a single quiet line.
 */
const SECTIONS: NavSection[] = [
  {
    label: 'Workspace',
    items: [
      { view: 'chat', label: 'Conversations', icon: MessageSquare },
      { view: 'files', label: 'Files', icon: FolderOpen },
    ],
  },
  {
    label: 'Knowledge',
    items: [{ view: 'knowledge', label: 'Knowledge', icon: BookOpen }],
  },
  {
    label: 'Runtime',
    items: [{ view: 'plugins', label: 'Plugins', icon: Plug }],
  },
  {
    label: 'System',
    items: [{ view: 'settings', label: 'Settings', icon: Settings }],
  },
];

function NavButton({
  item,
  isActive,
  onSelect,
}: {
  item: NavItem;
  isActive: boolean;
  onSelect: (view: View) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item.view)}
      className={`relative flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] text-left transition-colors ${
        isActive
          ? 'bg-brand/10 text-foreground font-medium'
          : 'text-muted-foreground hover:text-foreground hover:bg-surface-1'
      }`}
    >
      {isActive && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-full bg-brand" />
      )}
      <item.icon className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? 'text-brand' : ''}`} />
      <span className="truncate">{item.label}</span>
    </button>
  );
}

export function WorkspaceSidebar() {
  const activeView = useAppStore((s) => s.activeView);
  const setActiveView = useAppStore((s) => s.setActiveView);
  // Sections the user explicitly closed; the active section can never collapse.
  const [closed, setClosed] = useState<Record<string, boolean>>({});

  const sectionOfActive = SECTIONS.find((s) => s.items.some((i) => i.view === activeView))?.label;
  const isOpen = (label: string) => label === sectionOfActive || !closed[label];

  return (
    <aside className="w-48 flex-shrink-0 flex flex-col h-full bg-background select-none">
      <nav className="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-1">
        {SECTIONS.map((section) => {
          const open = isOpen(section.label);
          return (
            <div key={section.label} className="flex flex-col gap-0.5">
              <button
                type="button"
                onClick={() =>
                  setClosed((prev) => ({ ...prev, [section.label]: !prev[section.label] }))
                }
                className="group flex items-center gap-1 px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70 hover:text-muted-foreground transition-colors"
              >
                <ChevronRight
                  className={`w-3 h-3 transition-transform duration-150 ${open ? 'rotate-90' : ''} ${
                    section.label === sectionOfActive ? 'text-brand' : ''
                  }`}
                />
                {section.label}
              </button>
              {open &&
                section.items.map((item) => (
                  <NavButton
                    key={item.view}
                    item={item}
                    isActive={activeView === item.view}
                    onSelect={setActiveView}
                  />
                ))}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
