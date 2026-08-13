import { useState } from 'react';
import { Check, AlertCircle, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import type { PluginCall } from '@/types/chat';
import { ArtifactCard } from './ArtifactCard';
import { ActiveArtifact } from '@/stores/useAppStore';

interface AgentActivityAccordionProps {
  calls: PluginCall[];
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
}: AgentActivityAccordionProps) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (!calls || calls.length === 0) return null;

  const artifacts = extractArtifactsFromCalls(calls);

  return (
    <div className="my-2 space-y-1.5 font-mono text-xs pl-2">
      <div className="flex flex-col gap-1.5 mt-2 mb-3">
        {calls.map((call, i) => {
          const isCallPending = call.status === 'pending' || call.status === 'pending_approval';
          const isCallError = call.status === 'error';
          const isExpanded = expandedIdx === i;

          return (
            <div key={i} className="rounded-lg bg-surface-1 overflow-hidden">
              <button
                type="button"
                onClick={() => setExpandedIdx(isExpanded ? null : i)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-surface-2 transition-colors cursor-pointer"
              >
                {isCallPending ? (
                  <Loader2 className="w-3.5 h-3.5 text-brand animate-spin shrink-0" />
                ) : isCallError ? (
                  <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
                ) : (
                  <Check className="w-3.5 h-3.5 text-brand shrink-0 check-pop" />
                )}
                <span className={isCallError ? "text-destructive font-medium" : (isCallPending ? "text-brand font-medium" : "text-foreground font-medium")}>
                  {call.capability.split('.').pop()?.replace(/_/g, ' ')}
                </span>
                <span className="text-muted-foreground opacity-60 ml-1">
                  {isCallPending ? 'running...' : isCallError ? 'failed' : 'completed'}
                </span>
                {isExpanded ? (
                  <ChevronDown className="w-3 h-3 ml-auto text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight className="w-3 h-3 ml-auto text-muted-foreground shrink-0" />
                )}
              </button>
              {isExpanded && (
                <div className="px-2 pb-2 space-y-2">
                  {call.params && Object.keys(call.params).length > 0 && (
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase font-sans font-bold">
                        Params
                      </div>
                      <pre className="mt-0.5 p-1.5 bg-surface-2 rounded text-[11px] font-mono overflow-x-auto text-foreground whitespace-pre-wrap max-h-40">
                        {JSON.stringify(call.params, null, 2)}
                      </pre>
                    </div>
                  )}
                  {call.result !== undefined && (
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase font-sans font-bold">
                        Result
                      </div>
                      <pre className="mt-0.5 p-1.5 bg-surface-2 rounded text-[11px] font-mono overflow-x-auto text-foreground whitespace-pre-wrap max-h-60">
                        {typeof call.result === 'string'
                          ? call.result
                          : JSON.stringify(call.result, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Artifact Cards for Created Notes/Files ── */}
      {artifacts.length > 0 && (
        <div className="mt-3 space-y-2">
          {artifacts.map((art, idx) => (
            <ArtifactCard key={idx} artifact={art} />
          ))}
        </div>
      )}
    </div>
  );
}

