import { useMemo, useState } from 'react';
import { useChatStore } from '@/stores/useChatStore';
import { useRuntimeStore } from '@/stores/useRuntimeStore';
import { useAppStore } from '@/stores/useAppStore';
import type { PluginCall } from '@/types/chat';
import { extractArtifactsFromCalls } from '@/lib/extractArtifacts';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { toast } from 'sonner';
import {
  Package,
  Search,
  StickyNote,
  FileText,
  Code2,
  Copy,
  Check,
  Download,
  X,
  FolderOpen,
  Radio,
  MessageSquare,
} from 'lucide-react';

type ArtifactType = 'note' | 'file' | 'code' | 'markdown';

interface ArtifactItem {
  key: string;
  title: string;
  type: ArtifactType;
  content: string;
  path?: string;
  language?: string;
  source: 'chat' | 'live';
  timestamp?: string;
  capability?: string;
}

const TYPE_ORDER: ArtifactType[] = ['note', 'file', 'code', 'markdown'];

const TYPE_ICONS: Record<ArtifactType, typeof StickyNote> = {
  note: StickyNote,
  file: FileText,
  code: Code2,
  markdown: FileText,
};

const CODE_EXTENSIONS: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  rs: 'rust',
  py: 'python',
  json: 'json',
  toml: 'toml',
  yaml: 'yaml',
  yml: 'yaml',
  sh: 'bash',
  css: 'css',
  html: 'html',
  sql: 'sql',
};

function languageForPath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const ext = path.split('.').pop()?.toLowerCase();
  return ext ? CODE_EXTENSIONS[ext] : undefined;
}

function typeForPath(path: string | undefined): ArtifactType {
  if (!path) return 'file';
  const ext = path.split('.').pop()?.toLowerCase();
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext && CODE_EXTENSIONS[ext]) return 'code';
  return 'file';
}

/** Maps the shared artifact extraction onto the view's richer item shape
 *  (key/source/timestamp/language/capability provenance). */
function extractFromCalls(calls: PluginCall[], messageTs: number): ArtifactItem[] {
  // ChatMessage timestamps are UNIX seconds; Date expects milliseconds.
  const timestamp = new Date(messageTs * 1000).toISOString();
  return extractArtifactsFromCalls(calls).map((art) =>
    art.type === 'file'
      ? {
          key: `chat:file:${art.path}`,
          title: art.title,
          type: typeForPath(art.path),
          content: art.content,
          path: art.path,
          language: languageForPath(art.path),
          source: 'chat',
          timestamp,
          capability: art.capability,
        }
      : {
          key: `chat:note:${art.title}`,
          title: art.title,
          type: 'note',
          content: art.content,
          source: 'chat',
          timestamp,
          capability: art.capability,
        }
  );
}

export function ArtifactsView() {
  const messages = useChatStore((s) => s.messages);
  const events = useRuntimeStore((s) => s.events);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const setPendingFileReveal = useAppStore((s) => s.setPendingFileReveal);

  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const items = useMemo<ArtifactItem[]>(() => {
    // Historical: artifacts from the currently loaded chat thread.
    const historical = messages.flatMap((msg) =>
      extractFromCalls(msg.metadata?.plugin_calls ?? [], msg.timestamp)
    );

    // Live: artifact_produced runtime events (reference only, no content).
    const live: ArtifactItem[] = events
      .filter((e) => e.kind === 'artifact_produced' && e.artifact_ref)
      .map((e) => {
        const ref = e.artifact_ref as string;
        const isNote = (e.capability ?? '').includes('note');
        const title = isNote ? ref : ref.split('/').pop() || ref;
        return {
          key: `live:${e.step_id}:${ref}`,
          title,
          type: isNote ? ('note' as const) : typeForPath(ref),
          content: '',
          path: isNote ? undefined : ref,
          language: isNote ? undefined : languageForPath(ref),
          source: 'live' as const,
          timestamp: e.ts,
          capability: e.capability ?? undefined,
        };
      });

    // Merge + dedupe by title & type, preferring chat items (they carry content).
    const merged: ArtifactItem[] = [];
    for (const item of [...historical, ...live]) {
      if (!merged.some((a) => a.title === item.title && a.type === item.type)) {
        merged.push(item);
      }
    }
    return merged;
  }, [messages, events]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        (i.path ?? '').toLowerCase().includes(q) ||
        (i.capability ?? '').toLowerCase().includes(q)
    );
  }, [items, query]);

  const grouped = useMemo(() => {
    return TYPE_ORDER.map((type) => ({
      type,
      items: filtered.filter((i) => i.type === type),
    })).filter((g) => g.items.length > 0);
  }, [filtered]);

  const selected = useMemo(
    () => items.find((i) => i.key === selectedKey) ?? null,
    [items, selectedKey]
  );

  const handleCopy = () => {
    if (!selected?.content) return;
    navigator.clipboard.writeText(selected.content);
    setCopied(true);
    toast.success('Content copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!selected?.content) return;
    const blob = new Blob([selected.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = selected.title || 'artifact.txt';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Downloaded artifact file');
  };

  const isCode = selected?.type === 'code' || !!selected?.language;

  return (
    <div className="flex flex-col h-full w-full bg-background overflow-hidden">
      {/* ── Unified View Header ── */}
      <header className="flex items-center justify-between px-6 py-4 bg-surface-1 border-b border-border/40 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-surface-2 text-foreground/80">
            <Package className="w-5 h-5 text-brand" />
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight text-foreground flex items-center gap-2">
              Artifact Explorer
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-surface-3 text-muted-foreground">
                {items.length} items
              </span>
            </h1>
            <p className="text-xs text-muted-foreground font-mono">Synthesized products, generated code, and dynamic workspace outputs</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative w-64">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search artifacts..."
              className="pl-8 h-8 text-xs font-mono bg-surface-2 border-border/40 focus-visible:ring-1 focus-visible:ring-brand"
            />
          </div>
        </div>
      </header>

      {/* ── Artifact list and preview split ── */}
      <div className="flex flex-1 min-h-0 w-full overflow-hidden">
        <div className="flex-1 flex flex-col min-w-0 h-full border-r border-border/40">

        <div className="px-3 py-2 border-b border-border flex-shrink-0">
          <div className="relative">
            <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search artifacts..."
              className="pl-7 h-7 text-xs font-mono bg-card border-border"
            />
          </div>
        </div>

        <ScrollArea className="flex-1">
          {grouped.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 select-none">
              <Package className="w-6 h-6 text-muted-foreground/50" />
              <p className="font-mono text-xs text-muted-foreground">No artifacts yet</p>
              <p className="font-mono text-[11px] text-muted-foreground/70 text-center max-w-xs">
                Artifacts appear when tools create notes or write files. Currently scoped to the
                active chat thread and live runtime events.
              </p>
            </div>
          ) : (
            <div className="p-2 flex flex-col gap-3">
              {grouped.map((group) => {
                const Icon = TYPE_ICONS[group.type];
                return (
                  <div key={group.type} className="flex flex-col gap-0.5">
                    <div className="px-2 py-1 font-mono text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                      {group.type}s ({group.items.length})
                    </div>
                    {group.items.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setSelectedKey(item.key)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded font-mono text-xs text-left transition-colors ${
                          selectedKey === item.key ? 'bg-accent' : 'hover:bg-muted/50'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        <span className="text-foreground font-semibold truncate">{item.title}</span>
                        <span
                          className={`px-1 py-0 rounded border font-mono text-[9px] uppercase flex-shrink-0 ${
                            item.source === 'live'
                              ? 'border-emerald-500/30 text-emerald-500'
                              : 'border-border text-muted-foreground'
                          }`}
                          title={item.source === 'live' ? 'live runtime event' : 'chat thread'}
                        >
                          {item.source === 'live' ? (
                            <Radio className="w-2.5 h-2.5" />
                          ) : (
                            <MessageSquare className="w-2.5 h-2.5" />
                          )}
                        </span>
                        <span className="flex-1" />
                        {item.timestamp && (
                          <span className="text-muted-foreground/70 text-[11px]">
                            {new Date(item.timestamp).toLocaleDateString()}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* ── Preview column ── */}
      {selected && (
        <aside className="w-[28rem] flex-shrink-0 flex flex-col h-full border-l border-border bg-card">
          <div className="h-10 px-3 flex items-center justify-between border-b border-border flex-shrink-0 font-mono text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-semibold text-foreground truncate">{selected.title}</span>
              <span className="px-1.5 py-0.5 rounded border border-border font-mono text-[10px] text-muted-foreground uppercase flex-shrink-0">
                {selected.type}
              </span>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {selected.content && (
                <>
                  <button
                    type="button"
                    onClick={handleCopy}
                    title="Copy content"
                    className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={handleDownload}
                    title="Download file"
                    className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setSelectedKey(null)}
                title="Close preview"
                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {selected.path && (
            <div className="px-3 py-1.5 border-b border-border flex items-center gap-2 font-mono text-[11px] text-muted-foreground flex-shrink-0">
              <span className="truncate">{selected.path}</span>
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => {
                  setPendingFileReveal(selected.path ?? null);
                  setActiveView('files');
                }}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-border hover:bg-muted/50 hover:text-foreground transition-colors"
                title="Reveal this file in the Files view"
              >
                <FolderOpen className="w-3 h-3" />
                Files
              </button>
            </div>
          )}

          <div className="flex-1 overflow-hidden font-sans leading-relaxed relative">
            {!selected.content ? (
              <div className="h-full flex flex-col items-center justify-center gap-2 p-6 select-none">
                <p className="font-mono text-xs text-muted-foreground">Reference only</p>
                <p className="font-mono text-[11px] text-muted-foreground/70 text-center max-w-xs">
                  This artifact comes from a live runtime event, which carries its reference but not
                  its content.
                </p>
              </div>
            ) : isCode ? (
              <div className="p-4 h-full overflow-y-auto">
                <SyntaxHighlighter
                  language={selected.language || 'text'}
                  style={vscDarkPlus}
                  customStyle={{
                    margin: 0,
                    padding: '1.25rem',
                    borderRadius: '0.5rem',
                    fontSize: '0.8rem',
                    backgroundColor: 'hsl(var(--muted) / 0.4)',
                    border: '1px solid hsl(var(--border))',
                  }}
                >
                  {selected.content}
                </SyntaxHighlighter>
              </div>
            ) : (
              <div className="p-6 h-full overflow-y-auto prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-headings:font-bold prose-code:font-mono prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                >
                  {selected.content}
                </ReactMarkdown>
              </div>
            )}
          </div>
        </aside>
      )}
      </div>
    </div>
  );
}
