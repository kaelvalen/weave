import { useState } from 'react';
import { ChevronDown, ChevronRight, Check, AlertCircle, Loader2 } from 'lucide-react';
import { PluginCall } from '@/types/chat';
import { ToolCallCard } from './ToolCallCard';
import { ArtifactCard } from './ArtifactCard';
import { ActiveArtifact } from '@/stores/useAppStore';

interface AgentActivityAccordionProps {
  calls: PluginCall[];
  messageId: string;
  isStreaming?: boolean;
}

function extractArtifactsFromCalls(calls: PluginCall[]): ActiveArtifact[] {
  const artifacts: ActiveArtifact[] = [];

  for (const call of calls) {
    if (call.status !== 'success') continue;
    const cap = call.capability;
    const params = (call.params || {}) as Record<string, unknown>;
    const result = (call.result || {}) as Record<string, unknown>;

    if (cap.includes('note.create') || cap.includes('note.update') || cap.includes('note.get')) {
      const title = (params.title as string) || (result.title as string) || 'Note';
      const content = (params.content as string) || (result.content as string) || (typeof call.result === 'string' ? call.result : '');
      if (content || title) {
        artifacts.push({ title, type: 'note', content });
      }
    } else if (cap.includes('write_file') || cap.includes('file.write') || cap.includes('apply_diff')) {
      const path = (params.path as string) || (result.path as string) || 'file.txt';
      const title = path.split('/').pop() || path;
      const content = (params.content as string) || (params.new_str as string) || (typeof call.result === 'string' ? call.result : '');
      artifacts.push({ title, type: 'file', content, path });
    }
  }

  // Deduplicate by title & type to prevent card flooding
  const uniqueArtifacts: ActiveArtifact[] = [];
  for (const art of artifacts) {
    if (!uniqueArtifacts.some((a) => a.title === art.title && a.type === art.type)) {
      uniqueArtifacts.push(art);
    }
  }

  return uniqueArtifacts;
}

export function AgentActivityAccordion({
  calls,
  messageId,
  isStreaming,
}: AgentActivityAccordionProps) {
  const [expanded, setExpanded] = useState(false);

  if (!calls || calls.length === 0) return null;

  const totalCalls = calls.length;
  const hasError = calls.some((c) => c.status === 'error');
  const isPending = calls.some((c) => c.status === 'pending' || c.status === 'pending_approval');
  const isActive = isStreaming || isPending;
  const artifacts = extractArtifactsFromCalls(calls);

  return (
    <div className="my-2 space-y-2 font-mono text-xs">
      <div className="border border-border/80 rounded-md overflow-hidden bg-muted/20">
        {/* ── Accordion Header ── */}
        <button
          type="button"
          className="w-full flex items-center justify-between px-3 py-1.5 cursor-pointer select-none hover:bg-muted/40 transition-colors text-left"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-2 min-w-0">
            {isActive ? (
              <Loader2 className="w-3.5 h-3.5 text-foreground animate-spin shrink-0" />
            ) : hasError ? (
              <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
            ) : (
              <Check className="w-3.5 h-3.5 text-foreground shrink-0" />
            )}

            <span className="text-muted-foreground truncate">
              {isActive ? (
                <span className="text-foreground">Executing {totalCalls} action{totalCalls > 1 ? 's' : ''}...</span>
              ) : (
                <span>
                  Tool: <code className="text-foreground font-medium">{calls.map((c) => c.capability).join(', ')}</code>
                </span>
              )}
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0 text-muted-foreground">
            <span>{totalCalls} step{totalCalls > 1 ? 's' : ''}</span>
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </div>
        </button>

        {/* ── Accordion Body ── */}
        {expanded && (
          <div className="p-2 border-t border-border/60 bg-background/60 space-y-1.5">
            {calls.map((call, i) => (
              <ToolCallCard key={i} call={call} messageId={messageId} />
            ))}
          </div>
        )}
      </div>

      {/* ── Artifact Cards for Created Notes/Files ── */}
      {artifacts.map((art, idx) => (
        <ArtifactCard key={idx} artifact={art} />
      ))}
    </div>
  );
}

