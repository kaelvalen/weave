import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import {
  Search,
  FolderOpen,
  Package,
  Settings as SettingsIcon,
  MessageCircle,
  FileText,
  BookOpen,
  Workflow,
  LayoutTemplate,
  Brain,
} from 'lucide-react';

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const { setActiveView } = useAppStore();

  const actions = useMemo(
    () => [
      {
        id: 'chat',
        label: 'Go to Chat',
        icon: MessageCircle,
        onSelect: () => setActiveView('chat'),
      },
      {
        id: 'files',
        label: 'Go to File Manager',
        icon: FolderOpen,
        onSelect: () => setActiveView('files'),
      },
      { id: 'notes', label: 'Go to Notes', icon: FileText, onSelect: () => setActiveView('notes') },
      {
        id: 'knowledge',
        label: 'Go to Knowledge',
        icon: BookOpen,
        onSelect: () => setActiveView('knowledge'),
      },
      {
        id: 'workflows',
        label: 'Go to Workflows',
        icon: Workflow,
        onSelect: () => setActiveView('workflows'),
      },
      {
        id: 'canvas',
        label: 'Go to Canvas',
        icon: LayoutTemplate,
        onSelect: () => setActiveView('canvas'),
      },
      {
        id: 'plugins',
        label: 'Go to Plugins',
        icon: Package,
        onSelect: () => setActiveView('plugins'),
      },
      { id: 'models', label: 'Go to Models', icon: Brain, onSelect: () => setActiveView('models') },
      {
        id: 'settings',
        label: 'Go to Settings',
        icon: SettingsIcon,
        onSelect: () => setActiveView('settings'),
      },
    ],
    [setActiveView]
  );

  const filtered = useMemo(
    () => actions.filter((a) => a.label.toLowerCase().includes(query.toLowerCase())),
    [actions, query]
  );

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
      if (
        e.key === '/' &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName) &&
        !(e.target as HTMLElement).isContentEditable
      ) {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };

    const handleCustomOpen = () => setOpen(true);

    document.addEventListener('keydown', down);
    window.addEventListener('open-command-palette', handleCustomOpen);
    return () => {
      document.removeEventListener('keydown', down);
      window.removeEventListener('open-command-palette', handleCustomOpen);
    };
  }, []);

  if (!open) return null;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (filtered.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % filtered.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const action = filtered[activeIndex];
      if (action) {
        action.onSelect();
        setOpen(false);
        setQuery('');
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const activeId =
    activeIndex >= 0 && filtered[activeIndex] ? `cmd-item-${filtered[activeIndex].id}` : undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] sm:pt-[20vh]">
      <div
        className="fixed inset-0 bg-background/80 backdrop-blur-sm transition-all"
        onClick={() => setOpen(false)}
      />
      <div className="relative z-50 w-full max-w-lg overflow-hidden rounded-xl border bg-card shadow-2xl">
        <div className="flex items-center border-b px-3">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <input
            autoFocus
            role="combobox"
            aria-expanded={open}
            aria-controls="cmd-list"
            aria-activedescendant={activeId}
            className="flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            placeholder="Type a command or search..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div
          id="cmd-list"
          role="listbox"
          aria-activedescendant={activeId}
          className="max-h-[300px] overflow-y-auto p-2"
        >
          {filtered.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">No results found.</div>
          ) : (
            filtered.map((action, index) => {
              const isActive = index === activeIndex;
              return (
                <button
                  key={action.id}
                  id={`cmd-item-${action.id}`}
                  role="option"
                  aria-selected={isActive}
                  onClick={() => {
                    action.onSelect();
                    setOpen(false);
                    setQuery('');
                  }}
                  className={`relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 ${
                    isActive ? 'bg-accent text-accent-foreground' : ''
                  }`}
                >
                  <action.icon className="mr-2 h-4 w-4" />
                  {action.label}
                </button>
              );
            })
          )}
        </div>
        <div className="border-t px-4 py-2 flex items-center justify-between bg-muted/50 text-[10px] text-muted-foreground">
          <span>Search capabilities</span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded border bg-background font-mono">↑</kbd>
            <kbd className="px-1.5 py-0.5 rounded border bg-background font-mono">↓</kbd>
            to navigate
            <kbd className="px-1.5 py-0.5 rounded border bg-background font-mono ml-2">↵</kbd>
            to select
          </span>
        </div>
      </div>
    </div>
  );
}
