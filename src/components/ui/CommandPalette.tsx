import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { usePluginStore } from '@/stores/usePluginStore';
import { extractError } from '@/lib/errors';
import { toast } from 'sonner';
import {
  Search,
  FolderOpen,
  Package,
  Settings as SettingsIcon,
  MessageCircle,
  BookOpen,
  Brain,
  Zap,
  type LucideIcon,
} from 'lucide-react';

const MEMORY_PLUGIN = 'com.weave.builtin.memory';
const MEMORY_RESULT_LIMIT = 5;
const MEMORY_SEARCH_DEBOUNCE_MS = 250;

interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  onSelect: () => void;
}

interface IndexedItem {
  item: PaletteItem;
  index: number;
}

interface PaletteGroup {
  label: string;
  items: IndexedItem[];
}

interface MemoryHit {
  key: string;
  content: string;
}

/** Extract the content string from a stored memory value (same shape as MemoryView). */
function memoryContentOf(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    return String(obj.content ?? JSON.stringify(value));
  }
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * Capability schemas are now JSON Schema documents. Any schema with
 * properties/required keys needs user input; `{}`/missing schemas are safe to
 * run with empty params.
 */
function schemaNeedsParams(schema: unknown): boolean {
  if (schema === undefined || schema === null) return false;
  if (typeof schema !== 'object') return true;
  const obj = schema as Record<string, unknown>;
  const properties = obj.properties;
  if (properties && typeof properties === 'object' && Object.keys(properties).length > 0) {
    return true;
  }
  const required = obj.required;
  if (Array.isArray(required) && required.length > 0) {
    return true;
  }
  return false;
}

/** Build a `{prop: ""}` example from a schema's properties for the template. */
function exampleFromSchema(schema: unknown): Record<string, unknown> {
  if (typeof schema !== 'object' || schema === null) return {};
  const properties = (schema as Record<string, unknown>).properties;
  if (typeof properties !== 'object' || properties === null) return {};
  const example: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(properties as Record<string, unknown>)) {
    if (prop && typeof prop === 'object') {
      const type = (prop as Record<string, unknown>).type;
      if (type === 'boolean') example[key] = false;
      else if (type === 'number' || type === 'integer') example[key] = 0;
      else example[key] = '';
    }
  }
  return example;
}

export { schemaNeedsParams, exampleFromSchema };

function runCapability(
  execute: (pluginId: string, capability: string, params: Record<string, unknown>) => Promise<unknown>,
  pluginId: string,
  capability: string,
  schema: unknown
): void {
  if (schemaNeedsParams(schema)) {
    const template = `/${capability} ${JSON.stringify(exampleFromSchema(schema))}`;
    navigator.clipboard.writeText(template).then(
      () => toast.success('Parametreleri doldurup sohbete yapıştırın'),
      () => toast.error('Failed to copy to clipboard')
    );
    return;
  }
  execute(pluginId, capability, {})
    .then(() => toast.success(`Ran ${capability}`))
    .catch((err) => toast.error(`${capability} failed: ${extractError(err)}`));
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [memoryHits, setMemoryHits] = useState<MemoryHit[]>([]);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const plugins = usePluginStore((s) => s.plugins);
  const executeCapability = usePluginStore((s) => s.executeCapability);

  const navActions = useMemo<PaletteItem[]>(
    () => [
      {
        id: 'chat',
        label: 'Go to Workspace',
        icon: MessageCircle,
        onSelect: () => setActiveView('chat'),
      },
      {
        id: 'knowledge',
        label: 'Go to Knowledge',
        icon: BookOpen,
        onSelect: () => setActiveView('knowledge'),
      },
      {
        id: 'files',
        label: 'Go to File Manager',
        icon: FolderOpen,
        onSelect: () => setActiveView('files'),
      },
      {
        id: 'plugins',
        label: 'Go to Plugins',
        icon: Package,
        onSelect: () => setActiveView('plugins'),
      },
      {
        id: 'settings',
        label: 'Go to Settings',
        icon: SettingsIcon,
        onSelect: () => setActiveView('settings'),
      },
    ],
    [setActiveView]
  );

  const capabilities = useMemo<PaletteItem[]>(
    () =>
      plugins.flatMap((plugin) =>
        (plugin.capabilities?.provide ?? []).map((cap) => {
          const description = plugin.capabilities.descriptions?.[cap] ?? '';
          return {
            id: `cap:${plugin.id}:${cap}`,
            label: cap,
            hint: description ? `${plugin.name} · ${description}` : plugin.name,
            icon: Zap,
            onSelect: () =>
              runCapability(executeCapability, plugin.id, cap, plugin.capabilities.schemas?.[cap]),
          };
        })
      ),
    [plugins, executeCapability]
  );

  // Memory search (debounced). memory.recall has no server-side query param —
  // it returns all entries, so filtering happens client-side, like MemoryView.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setMemoryHits([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = (await executeCapability(MEMORY_PLUGIN, 'memory.recall', {})) as {
          memory?: Record<string, unknown>;
        };
        if (cancelled) return;
        const needle = q.toLowerCase();
        const hits: MemoryHit[] = [];
        for (const [key, value] of Object.entries(res?.memory ?? {})) {
          if (key.startsWith('_')) continue;
          const content = memoryContentOf(value);
          if (key.toLowerCase().includes(needle) || content.toLowerCase().includes(needle)) {
            hits.push({ key, content });
          }
          if (hits.length >= MEMORY_RESULT_LIMIT) break;
        }
        setMemoryHits(hits);
      } catch {
        // Memory plugin unavailable — show no memory section.
        if (!cancelled) setMemoryHits([]);
      }
    }, MEMORY_SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query, executeCapability]);

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

  const q = query.trim().toLowerCase();

  const filteredNav = useMemo(
    () => navActions.filter((a) => !q || a.label.toLowerCase().includes(q)),
    [navActions, q]
  );

  const filteredCapabilities = useMemo(
    () =>
      capabilities.filter(
        (c) => !q || c.label.toLowerCase().includes(q) || (c.hint ?? '').toLowerCase().includes(q)
      ),
    [capabilities, q]
  );

  const memoryItems = useMemo<PaletteItem[]>(
    () =>
      memoryHits.map((hit) => ({
        id: `mem:${hit.key}`,
        label: hit.key,
        hint: hit.content.length > 80 ? `${hit.content.slice(0, 80)}…` : hit.content,
        icon: Brain,
        onSelect: () => {
          navigator.clipboard.writeText(hit.content).then(
            () => toast.success(`Copied "${hit.key}" to clipboard`),
            () => toast.error('Failed to copy to clipboard')
          );
        },
      })),
    [memoryHits]
  );

  const groups = useMemo<PaletteGroup[]>(() => {
    let index = 0;
    const out: PaletteGroup[] = [];
    const push = (label: string, items: PaletteItem[]) => {
      if (items.length === 0) return;
      out.push({ label, items: items.map((item) => ({ item, index: index++ })) });
    };
    push('Navigate', filteredNav);
    push('Capabilities', filteredCapabilities);
    push('Memory', memoryItems);
    return out;
  }, [filteredNav, filteredCapabilities, memoryItems]);

  const flatItems = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const safeIndex = flatItems.length === 0 ? 0 : Math.min(activeIndex, flatItems.length - 1);

  if (!open) return null;

  const handleSelect = (item: PaletteItem) => {
    item.onSelect();
    setOpen(false);
    setQuery('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (flatItems.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((safeIndex + 1) % flatItems.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((safeIndex - 1 + flatItems.length) % flatItems.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const entry = flatItems[safeIndex];
      if (entry) handleSelect(entry.item);
    }
  };

  const activeId =
    flatItems.length > 0 && flatItems[safeIndex]
      ? `cmd-item-${flatItems[safeIndex].item.id}`
      : undefined;

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
          {flatItems.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">No results found.</div>
          ) : (
            groups.map((group) => (
              <div key={group.label}>
                <div className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground select-none">
                  {group.label}
                </div>
                {group.items.map(({ item, index }) => {
                  const isActive = index === safeIndex;
                  return (
                    <button
                      key={item.id}
                      id={`cmd-item-${item.id}`}
                      role="option"
                      aria-selected={isActive}
                      onClick={() => handleSelect(item)}
                      className={`relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 ${
                        isActive ? 'bg-accent text-accent-foreground' : ''
                      }`}
                    >
                      <item.icon className="mr-2 h-4 w-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                      {item.hint && (
                        <span className="ml-auto pl-3 truncate text-xs text-muted-foreground">
                          {item.hint}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="border-t px-4 py-2 flex items-center justify-between bg-muted/50 text-[10px] text-muted-foreground">
          <span>Navigate · Run capability · Search memory</span>
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
