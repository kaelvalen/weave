import { useState } from 'react';
import { useAppStore, ActiveArtifact } from '@/stores/useAppStore';
import { useChatStore } from '@/stores/useChatStore';
import { FileText, Code2, Search, X, ArrowRight } from 'lucide-react';

export function ArtifactsListPanel() {
  const [search, setSearch] = useState('');
  const openArtifact = useAppStore((s) => s.openArtifact);
  const setRightPanelOpen = useAppStore((s) => s.setRightPanelOpen);
  const messages = useChatStore((s) => s.messages);

  // Collect artifacts strictly from active chat thread messages
  const chatArtifacts: ActiveArtifact[] = [];
  for (const msg of messages) {
    if (msg.metadata?.plugin_calls) {
      for (const call of msg.metadata.plugin_calls) {
        if (call.status !== 'success') continue;
        const cap = call.capability;
        const params = (call.params || {}) as Record<string, unknown>;
        const result = (call.result || {}) as Record<string, unknown>;

        if (cap.includes('note.create') || cap.includes('note.update') || cap.includes('note.get')) {
          const title = (params.title as string) || (result.title as string) || 'Note';
          const content =
            (params.content as string) ||
            (result.content as string) ||
            (typeof call.result === 'string' ? call.result : '');
          if (title || content) {
            chatArtifacts.push({ title, type: 'note', content });
          }
        } else if (
          cap.includes('write_file') ||
          cap.includes('file.write') ||
          cap.includes('apply_diff')
        ) {
          const path = (params.path as string) || (result.path as string) || 'file.txt';
          const title = path.split('/').pop() || path;
          const content =
            (params.content as string) ||
            (params.new_str as string) ||
            (typeof call.result === 'string' ? call.result : '');
          chatArtifacts.push({ title, type: 'file', content, path });
        }
      }
    }
  }

  // Deduplicate by title
  const threadArtifacts: ActiveArtifact[] = [];
  for (const ca of chatArtifacts) {
    if (!threadArtifacts.some((a) => a.title === ca.title)) {
      threadArtifacts.push(ca);
    }
  }

  const filtered = threadArtifacts.filter(
    (a) =>
      a.title.toLowerCase().includes(search.toLowerCase()) ||
      a.content.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex-1 flex flex-col h-full bg-background border-l border-border font-mono text-xs overflow-hidden">
      {/* Header */}
      <div className="h-10 px-3 flex items-center justify-between border-b border-border flex-shrink-0 bg-card select-none">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-foreground" />
          <span className="font-bold text-foreground text-sm">Thread Artifacts ({threadArtifacts.length})</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setRightPanelOpen(false)}
            title="Close side panel"
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Search Input */}
      <div className="p-2 border-b border-border/60 bg-muted/20">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search artifacts & notes..."
            className="w-full bg-background border border-border rounded px-8 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-colors"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Artifacts List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground font-sans">
            <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-xs">No artifacts found.</p>
            <p className="text-[11px] text-muted-foreground/70 mt-1">
              Ask AI to create notes or write files to generate artifacts.
            </p>
          </div>
        ) : (
          filtered.map((art, idx) => (
            <div
              key={idx}
              onClick={() => openArtifact(art)}
              className="p-2.5 rounded border border-border/60 bg-card hover:bg-muted/40 cursor-pointer transition-all flex items-center justify-between group"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-7 h-7 rounded border border-border bg-background flex items-center justify-center shrink-0">
                  {art.type === 'code' ? (
                    <Code2 className="w-3.5 h-3.5 text-foreground" />
                  ) : (
                    <FileText className="w-3.5 h-3.5 text-foreground" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-foreground text-xs truncate group-hover:underline">
                    {art.title}
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate max-w-[240px]">
                    {art.content.replace(/^#+\s+/gm, '').slice(0, 60)}...
                  </div>
                </div>
              </div>

              <ArrowRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition-all shrink-0 ml-2" />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
