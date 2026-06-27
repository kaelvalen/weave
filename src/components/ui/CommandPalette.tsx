import { useEffect, useState } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { Search, FolderOpen, Package, Settings as SettingsIcon, MessageCircle, FileText } from 'lucide-react';

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { setActiveView } = useAppStore();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  if (!open) return null;

  const actions = [
    { id: 'chat', label: 'Go to Chat', icon: MessageCircle, onSelect: () => setActiveView('chat') },
    { id: 'files', label: 'Go to File Manager', icon: FolderOpen, onSelect: () => setActiveView('files') },
    { id: 'notes', label: 'Go to Notes', icon: FileText, onSelect: () => setActiveView('notes') },
    { id: 'plugins', label: 'Go to Plugins', icon: Package, onSelect: () => setActiveView('plugins') },
    { id: 'settings', label: 'Go to Settings', icon: SettingsIcon, onSelect: () => setActiveView('settings') },
  ];

  const filtered = actions.filter((a) => a.label.toLowerCase().includes(query.toLowerCase()));

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
            className="flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            placeholder="Type a command or search..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="max-h-[300px] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No results found.
            </div>
          ) : (
            filtered.map((action) => (
              <button
                key={action.id}
                onClick={() => {
                  action.onSelect();
                  setOpen(false);
                  setQuery('');
                }}
                className="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
              >
                <action.icon className="mr-2 h-4 w-4" />
                {action.label}
              </button>
            ))
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
