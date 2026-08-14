import { useLayoutEffect, useRef, useState } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { useChatStore } from '@/stores/useChatStore';
import type { View } from '@/types/app';
import {
  MessageSquare,
  FolderOpen,
  BookOpen,
  Plug,
  Settings,
  Search,
  Plus,
  ChevronsUpDown,
  type LucideIcon,
} from 'lucide-react';

interface NavItem {
  key: string;
  view: View;
  label: string;
  icon: LucideIcon;
  /** Hover-revealed "+" — starts a new conversation for Conversations. */
  plus?: boolean;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

/**
 * Workspace navigator — real views, real counts. The active (or hovered)
 * row carries a single gliding highlight; the search filters the nav and
 * "/" focuses it, Enter opens the command palette.
 */
const SECTIONS: NavSection[] = [
  {
    label: 'Workspace',
    items: [
      { key: 'chat', view: 'chat', label: 'Conversations', icon: MessageSquare, plus: true },
      { key: 'files', view: 'files', label: 'Files', icon: FolderOpen },
      { key: 'knowledge', view: 'knowledge', label: 'Knowledge', icon: BookOpen },
    ],
  },
  {
    label: 'Objects',
    items: [
      { key: 'plugins', view: 'plugins', label: 'Plugins', icon: Plug },
      { key: 'settings', view: 'settings', label: 'Settings', icon: Settings },
    ],
  },
];

const ALL_ITEMS: NavItem[] = SECTIONS.flatMap((s) => s.items);

export function WorkspaceSidebar() {
  const activeView = useAppStore((s) => s.activeView);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const startNewSession = useChatStore((s) => s.startNewSession);
  const conversationTitle = useChatStore((s) => s.conversationTitle);
  // Real badge: tool calls waiting on the approval gate across messages.
  const pendingApprovals = useChatStore(
    (s) =>
      s.messages.flatMap((m) =>
        (m.metadata?.plugin_calls ?? []).filter((c) => c.status === 'pending_approval')
      ).length
  );

  const [hovered, setHovered] = useState<string | null>(null);
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  const [query, setQuery] = useState('');
  const navRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const searchRef = useRef<HTMLInputElement>(null);

  const activeKey = ALL_ITEMS.find((i) => i.view === activeView)?.key ?? 'chat';
  const q = query.trim().toLowerCase();
  const visibleItems = q
    ? ALL_ITEMS.filter((item) => item.label.toLowerCase().includes(q))
    : ALL_ITEMS;
  const visibleSections = SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => visibleItems.includes(item)),
  })).filter((section) => section.items.length > 0);
  const noMatches = q.length > 0 && visibleItems.length === 0;

  /* one gliding highlight follows hovered / active, like the nav in the
     composer menus */
  useLayoutEffect(() => {
    const container = navRef.current;
    const target = itemRefs.current[hovered ?? activeKey];
    if (!container || !target || !target.isConnected) return;
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    setBox({
      top: targetRect.top - containerRect.top,
      height: targetRect.height,
    });
  }, [hovered, activeKey, query, noMatches]);

  // "/" focuses quick search from anywhere (except while typing).
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openCommandPalette = () => {
    window.dispatchEvent(new CustomEvent('open-command-palette'));
  };

  return (
    <aside className="w-60 flex-shrink-0 flex flex-col h-full bg-background select-none">
      <div className="m-2 flex flex-1 flex-col overflow-hidden rounded-xl bg-surface-1 p-2">
        {/* workspace row */}
        <button
          type="button"
          onClick={() => setActiveView('chat')}
          className="mb-2 flex w-full items-center gap-2.5 rounded-md p-1.5 text-left transition-[background-color,transform] duration-100 hover:bg-muted active:scale-[0.96]"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-foreground text-[13px] font-semibold text-background">
            W
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium leading-tight text-foreground">
              Weave
            </span>
            <span className="block truncate text-[11px] leading-tight text-muted-foreground/70">
              {conversationTitle !== 'New Chat' ? conversationTitle : 'Workspace'}
            </span>
          </span>
          <ChevronsUpDown size={12} strokeWidth={2} className="shrink-0 text-muted-foreground/70" />
        </button>

        {/* quick search — filters the nav; "/" focuses, Enter opens the palette */}
        <label className="mb-1 flex h-8 items-center gap-2 rounded-md bg-surface-2 px-2.5">
          <Search size={12} strokeWidth={2} className="shrink-0 text-muted-foreground/70" />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                openCommandPalette();
              } else if (event.key === 'Escape') {
                setQuery('');
                event.currentTarget.blur();
              }
            }}
            placeholder="Quick search"
            aria-label="Quick search"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground/70"
          />
          <kbd className="flex size-4 items-center justify-center rounded-[5px] bg-surface-1 text-[10px] text-muted-foreground/70">
            /
          </kbd>
        </label>

        {/* accent action — real: a brand-new conversation */}
        <button
          type="button"
          onClick={() => void startNewSession()}
          className="mb-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] font-medium text-brand transition-[background-color,transform] duration-100 hover:bg-brand/10 active:scale-[0.96]"
        >
          <span className="min-w-0 flex-1 truncate text-left">New chat</span>
          <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-brand text-white">
            <Plus size={9} strokeWidth={3} />
          </span>
        </button>

        {/* nav items with one gliding highlight */}
        <div
          ref={navRef}
          onMouseLeave={() => setHovered(null)}
          className="relative flex flex-col gap-2 overflow-y-auto"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 rounded-[7px] bg-muted"
            style={{
              top: box?.top ?? 0,
              height: box?.height ?? 0,
              opacity: box ? 1 : 0,
              transition:
                'top 220ms cubic-bezier(0.23,1,0.32,1), height 220ms cubic-bezier(0.23,1,0.32,1), opacity 150ms ease',
            }}
          />
          {noMatches && (
            <div className="px-2 py-1.5 text-[12px] text-muted-foreground/70">
              No matches for “{q}”
            </div>
          )}
          {visibleSections.map((section) => (
            <div key={section.label}>
              <div className="px-2 pb-1 pt-1 text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
                {section.label}
              </div>
              <div className="flex flex-col gap-px">
                {section.items.map((item) => {
                  const isActive = item.key === activeKey;
                  return (
                    <button
                      key={item.key}
                      ref={(el) => {
                        itemRefs.current[item.key] = el;
                      }}
                      type="button"
                      onMouseEnter={() => setHovered(item.key)}
                      onFocus={() => setHovered(item.key)}
                      onBlur={() => setHovered(null)}
                      onClick={() => setActiveView(item.view)}
                      aria-current={isActive ? 'page' : undefined}
                      className="group relative z-10 flex w-full items-center gap-2 rounded-[7px] px-2 py-1.5 text-left transition-[color,transform] duration-150 active:scale-[0.96]"
                    >
                      <span className={isActive ? 'text-foreground' : 'text-muted-foreground/70'}>
                        <item.icon size={13} strokeWidth={1.8} />
                      </span>
                      <span
                        className={`min-w-0 flex-1 truncate text-[13px] transition-colors duration-150 ${
                          isActive ? 'font-medium text-foreground' : 'text-muted-foreground'
                        }`}
                      >
                        {item.label}
                      </span>
                      {item.key === 'chat' && pendingApprovals > 0 && (
                        <span
                          key={pendingApprovals}
                          className={`flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10.5px] font-semibold tabular-nums ${
                            isActive
                              ? 'bg-surface-2 text-muted-foreground'
                              : 'bg-brand/10 text-brand'
                          }`}
                          style={{ animation: 'pop-in 250ms cubic-bezier(0.23,1,0.32,1) both' }}
                        >
                          {pendingApprovals}
                        </span>
                      )}
                      {item.plus && (
                        <span
                          className={`flex size-4 items-center justify-center rounded-[5px] text-muted-foreground/70 opacity-0 transition-[background-color,color,opacity] duration-100 group-hover:opacity-100 hover:bg-border/70 hover:text-foreground ${
                            isActive ? 'opacity-100' : ''
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void startNewSession();
                          }}
                          role="button"
                          tabIndex={-1}
                          aria-label="New conversation"
                        >
                          <Plus size={10} strokeWidth={2.5} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
