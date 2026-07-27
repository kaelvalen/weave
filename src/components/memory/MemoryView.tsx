import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePluginStore } from '@/stores/usePluginStore';
import { useRuntimeStore } from '@/stores/useRuntimeStore';
import type { MemoryEvent } from '@/hooks/profile/useMemories';
import type { UserProfile } from '@/hooks/profile/useProfile';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Brain, Check, Pencil, Plus, Search, Trash2, User, X } from 'lucide-react';
import { toast } from 'sonner';

const MEMORY_PLUGIN = 'com.weave.builtin.memory';

function getMemoryCategory(entry: MemoryEvent): 'Working' | 'Episodic' | 'Procedural' | 'Semantic' {
  const t = entry.tags.map((tag) => tag.toLowerCase());
  const k = entry.key.toLowerCase();
  
  if (t.includes('working') || t.includes('context') || k.includes('current') || k.includes('active')) return 'Working';
  if (t.includes('procedural') || t.includes('rule') || t.includes('instruction') || k.includes('rule') || k.includes('instruction') || k.includes('directive') || t.includes('manual')) return 'Procedural';
  if (t.includes('episodic') || t.includes('event') || t.includes('history') || k.includes('event') || k.includes('log') || k.startsWith('run_')) return 'Episodic';
  
  return 'Semantic';
}

function formatTs(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleString();
}

export function MemoryView() {
  const executeCapability = usePluginStore((s) => s.executeCapability);
  const events = useRuntimeStore((s) => s.events);

  const [entries, setEntries] = useState<MemoryEvent[]>([]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [query, setQuery] = useState('');

  const [teachKey, setTeachKey] = useState('');
  const [teachValue, setTeachValue] = useState('');
  const [isTeaching, setIsTeaching] = useState(false);

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [pendingDelete, setPendingDelete] = useState<MemoryEvent | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setUnavailable(false);
    try {
      const res = (await executeCapability(MEMORY_PLUGIN, 'memory.recall', {})) as {
        memory?: Record<string, unknown>;
      };
      const list: MemoryEvent[] = [];
      for (const [k, v] of Object.entries(res?.memory ?? {})) {
        if (k.startsWith('_')) continue;
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          const obj = v as Record<string, unknown>;
          list.push({
            id: String(obj.id || `mem_${k}`),
            key: k,
            content: String(obj.content ?? JSON.stringify(v)),
            source: String(obj.source || 'conversation'),
            confidence: typeof obj.confidence === 'number' ? obj.confidence : 0.85,
            timestamp: String(obj.timestamp || new Date().toISOString()),
            tags: Array.isArray(obj.tags) ? obj.tags.map(String) : ['general'],
          });
        } else {
          list.push({
            id: `mem_${k}`,
            key: k,
            content: typeof v === 'string' ? v : JSON.stringify(v),
            source: 'conversation',
            confidence: 0.85,
            timestamp: new Date().toISOString(),
            tags: ['general'],
          });
        }
      }
      list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setEntries(list);
    } catch (err) {
      console.error('Failed to load memory:', err);
      setUnavailable(true);
    } finally {
      setIsLoading(false);
    }
  }, [executeCapability]);

  const loadProfile = useCallback(async () => {
    try {
      const res = (await executeCapability(MEMORY_PLUGIN, 'memory.get_profile', {})) as {
        profile?: UserProfile;
      };
      if (res?.profile) setProfile(res.profile);
    } catch (err) {
      console.error('Failed to load memory profile:', err);
    }
  }, [executeCapability]);

  useEffect(() => {
    load();
    loadProfile();
  }, [load, loadProfile]);

  // Reload when the runtime reports a memory mutation (any source: chat tools,
  // profile panel, or this view). Select the array once and derive the latest
  // timestamp — filtering inside the zustand selector would allocate a new
  // array per call and loop rerenders.
  const lastMemoryUpdateTs = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].kind === 'memory_updated') return events[i].ts;
    }
    return null;
  }, [events]);

  useEffect(() => {
    if (lastMemoryUpdateTs) load();
  }, [lastMemoryUpdateTs, load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (m) =>
        m.key.toLowerCase().includes(q) ||
        m.content.toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q))
    );
  }, [entries, query]);

  const groupedMemory = useMemo(() => {
    const groups: Record<string, MemoryEvent[]> = {
      Semantic: [],
      Procedural: [],
      Episodic: [],
      Working: [],
    };
    for (const m of filtered) {
      groups[getMemoryCategory(m)].push(m);
    }
    return Object.entries(groups).filter(([, list]) => list.length > 0);
  }, [filtered]);

  const handleTeach = async () => {
    const key = teachKey
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '');
    const content = teachValue.trim();
    if (!key || !content || isTeaching) return;
    setIsTeaching(true);
    try {
      const timestamp = new Date().toISOString();
      const entry: MemoryEvent = {
        id: `mem_${Date.now().toString(36)}`,
        key,
        content,
        source: 'manual input',
        confidence: 0.95,
        timestamp,
        tags: ['manual'],
      };
      await executeCapability(MEMORY_PLUGIN, 'memory.store', {
        key,
        value: entry,
        id: entry.id,
        content,
        source: entry.source,
        confidence: entry.confidence,
        timestamp,
        tags: entry.tags,
      });
      toast.success(`Stored "${key}" in memory`);
      setTeachKey('');
      setTeachValue('');
      load();
    } catch (err) {
      console.error('Failed to store memory:', err);
      toast.error('Failed to store memory');
    } finally {
      setIsTeaching(false);
    }
  };

  const handleSaveEdit = async (entry: MemoryEvent) => {
    const content = editContent.trim();
    if (!content) return;
    try {
      const updated: MemoryEvent = {
        ...entry,
        content,
        timestamp: new Date().toISOString(),
      };
      await executeCapability(MEMORY_PLUGIN, 'memory.store', {
        key: updated.key,
        value: updated,
        id: updated.id,
        content: updated.content,
        source: updated.source,
        confidence: updated.confidence,
        timestamp: updated.timestamp,
        tags: updated.tags,
      });
      toast.success(`Updated "${entry.key}"`);
      setEditingKey(null);
      load();
    } catch (err) {
      console.error('Failed to update memory:', err);
      toast.error('Failed to update memory');
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    try {
      await executeCapability(MEMORY_PLUGIN, 'memory.delete', { key: pendingDelete.key });
      setEntries((prev) => prev.filter((m) => m.key !== pendingDelete.key));
      toast.success(`Deleted "${pendingDelete.key}"`);
    } catch (err) {
      console.error('Failed to delete memory:', err);
      toast.error('Failed to delete memory');
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-background overflow-hidden">
      {/* ── Unified View Header ── */}
      <header className="flex items-center justify-between px-6 py-4 bg-surface-1 border-b border-border/40 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-surface-2 text-foreground/80">
            <Brain className="w-5 h-5 text-brand" />
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight text-foreground flex items-center gap-2">
              Memory Substrate
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-surface-3 text-muted-foreground">
                {filtered.length} entries
              </span>
            </h1>
            <p className="text-xs text-muted-foreground font-mono">Persistent knowledge, learned directives, and semantic context graph</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative w-64">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search memory graph..."
              className="pl-8 h-8 text-xs font-mono bg-surface-2 border-border/40 focus-visible:ring-1 focus-visible:ring-brand"
            />
          </div>
        </div>
      </header>

      {/* ── Memory content ── */}
      <div className="flex-1 min-h-0 w-full overflow-y-auto p-6 max-w-6xl mx-auto space-y-6">
        {/* Teach AI Bar */}
        <div className="p-4 rounded-xl bg-surface-1 border border-border/40 flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground shrink-0">
            <Plus className="w-4 h-4 text-brand" />
            Teach AI
          </div>
          <Input
            value={teachKey}
            onChange={(e) => setTeachKey(e.target.value)}
            placeholder="key (e.g. preferred_theme)"
            className="w-48 h-8 text-xs font-mono bg-surface-2 border-border/40"
          />
          <Input
            value={teachValue}
            onChange={(e) => setTeachValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleTeach();
            }}
            placeholder="Teach the assistant a rule, preference, or fact..."
            className="flex-1 h-8 text-xs font-mono bg-surface-2 border-border/40"
          />
          <button
            type="button"
            onClick={handleTeach}
            disabled={isTeaching || !teachKey.trim() || !teachValue.trim()}
            className="flex items-center gap-1.5 px-3 h-8 rounded-lg bg-brand text-brand-foreground font-mono text-xs hover:bg-brand/90 transition-colors disabled:opacity-40 disabled:pointer-events-none shrink-0"
          >
            Teach
          </button>
        </div>

        <ScrollArea className="flex-1">
          {unavailable ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 select-none">
              <Brain className="w-6 h-6 text-muted-foreground/50" />
              <p className="font-mono text-xs text-muted-foreground">
                Memory plugin unavailable — load it from the Plugins view.
              </p>
            </div>
          ) : isLoading && entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 select-none">
              <p className="font-mono text-xs text-muted-foreground">Loading memory...</p>
            </div>
          ) : (
            <div className="p-2 flex flex-col gap-2 max-w-3xl">
              {profile && (
                <div className="rounded border border-border bg-card p-3 flex flex-col gap-2">
                  <div className="flex items-center gap-2 font-mono">
                    <User className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                      User profile
                    </span>
                    <span className="text-[10px] text-muted-foreground/60">read-only</span>
                  </div>
                  <div className="font-mono text-xs text-foreground">
                    <span className="font-semibold">{profile.name}</span>
                    {profile.role && (
                      <span className="text-muted-foreground"> · {profile.role}</span>
                    )}
                  </div>
                  {profile.bio && (
                    <p className="font-mono text-[11px] text-muted-foreground leading-relaxed">
                      {profile.bio}
                    </p>
                  )}
                  {profile.tech_stack.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1">
                      {profile.tech_stack.map((t) => (
                        <span
                          key={t}
                          className="px-1.5 py-0.5 rounded border border-border font-mono text-[10px] text-muted-foreground"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  {profile.ai_directives && (
                    <p className="font-mono text-[11px] text-muted-foreground/80 italic leading-relaxed">
                      “{profile.ai_directives}”
                    </p>
                  )}
                </div>
              )}

              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-16 select-none">
                  <Brain className="w-6 h-6 text-muted-foreground/50" />
                  <p className="font-mono text-xs text-muted-foreground">
                    {entries.length === 0
                      ? 'No memory entries yet — teach the assistant something above.'
                      : 'No entries match the current search.'}
                  </p>
                </div>
              ) : (
                groupedMemory.map(([category, items]) => (
                  <div key={category} className="flex flex-col gap-2 mt-4 first:mt-0">
                    <div className="flex items-center gap-2 font-mono px-1">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                        {category} Memory
                      </span>
                      <span className="text-[10px] text-muted-foreground/60">{items.length} items</span>
                    </div>
                    {items.map((entry) => (
                      <div
                        key={entry.key}
                        className="rounded border border-border bg-card p-3 flex flex-col gap-2"
                      >
                        <div className="flex items-center gap-2 font-mono min-w-0">
                          <span className="text-xs font-semibold text-foreground truncate">
                            {entry.key}
                          </span>
                          <span className="px-1.5 py-0.5 rounded border border-border text-[10px] text-muted-foreground flex-shrink-0">
                            {entry.source}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded border text-[10px] flex-shrink-0 ${
                              entry.confidence >= 0.8
                                ? 'border-emerald-500/30 text-emerald-500'
                                : 'border-amber-500/30 text-amber-500'
                            }`}
                          >
                            {Math.round(entry.confidence * 100)}%
                          </span>
                          {entry.tags.map((t) => (
                            <span
                              key={t}
                              className="px-1.5 py-0.5 rounded border border-border text-[10px] text-muted-foreground/70 flex-shrink-0"
                            >
                              {t}
                            </span>
                          ))}
                          <span className="text-[10px] text-muted-foreground/60 truncate ml-auto flex-shrink-0">
                            {formatTs(entry.timestamp)}
                          </span>
                          {editingKey !== entry.key && (
                            <div className="flex items-center gap-0.5 flex-shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingKey(entry.key);
                                  setEditContent(entry.content);
                                }}
                                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                                title="Edit entry"
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setPendingDelete(entry)}
                                className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                title="Delete entry"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                        </div>

                        {editingKey === entry.key ? (
                          <div className="flex flex-col gap-1.5">
                            <Textarea
                              value={editContent}
                              onChange={(e) => setEditContent(e.target.value)}
                              className="text-xs font-mono bg-background border-border min-h-20"
                              autoFocus
                            />
                            <div className="flex items-center gap-1.5 justify-end">
                              <button
                                type="button"
                                onClick={() => setEditingKey(null)}
                                className="flex items-center gap-1 px-2 h-6 rounded border border-border font-mono text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                              >
                                <X className="w-3 h-3" />
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSaveEdit(entry)}
                                disabled={!editContent.trim()}
                                className="flex items-center gap-1 px-2 h-6 rounded border border-emerald-500/30 font-mono text-[11px] text-emerald-500 hover:bg-emerald-500/10 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                              >
                                <Check className="w-3 h-3" />
                                Save
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="font-mono text-[11px] text-foreground/90 leading-relaxed whitespace-pre-wrap break-words">
                            {entry.content}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          )}
        </ScrollArea>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Delete memory entry"
        description={
          pendingDelete
            ? `Remove "${pendingDelete.key}" from the assistant's persistent memory? This cannot be undone.`
            : undefined
        }
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
      />
    </div>
  );
}
