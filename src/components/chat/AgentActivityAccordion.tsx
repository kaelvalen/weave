import { Check, AlertCircle, Loader2 } from 'lucide-react';
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
  if (!calls || calls.length === 0) return null;

  const artifacts = extractArtifactsFromCalls(calls);

  return (
    <div className="my-2 space-y-1.5 font-mono text-xs pl-2">
      <div className="flex flex-col gap-1.5 mt-2 mb-3">
        {calls.map((call, i) => {
          const isCallPending = call.status === 'pending' || call.status === 'pending_approval';
          const isCallError = call.status === 'error';
          
          return (
            <div key={i} className="flex items-center gap-2">
              {isCallPending ? (
                <Loader2 className="w-3.5 h-3.5 text-orange-500 animate-spin shrink-0" />
              ) : isCallError ? (
                <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
              ) : (
                <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />
              )}
              <span className={isCallError ? "text-destructive font-medium" : (isCallPending ? "text-orange-500 font-medium" : "text-foreground font-medium")}>
                {call.capability.split('.').pop()?.replace(/_/g, ' ')}
              </span>
              <span className="text-muted-foreground opacity-60 ml-1">
                {isCallPending ? 'running...' : isCallError ? 'failed' : 'completed'}
              </span>
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

