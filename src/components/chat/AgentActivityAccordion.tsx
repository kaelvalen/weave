import { useState } from 'react';
import { AlertCircle, Check, ChevronDown, ChevronRight } from 'lucide-react';
import type { PluginCall } from '@/types/chat';
import { ArtifactCard } from './ArtifactCard';
import { ActiveArtifact } from '@/stores/useAppStore';
import { extractArtifactsFromCalls as extractBaseArtifacts } from '@/lib/extractArtifacts';

interface AgentActivityAccordionProps {
  calls: PluginCall[];
}

function CallIcon({ call }: { call: PluginCall }) {
  const isPending = call.status === 'pending' || call.status === 'pending_approval';
  const isError = call.status === 'error';
  if (isPending) {
    return (
      <span
        className="size-3 shrink-0 rounded-full border-[1.5px] border-border border-t-foreground"
        style={{ animation: 'spin 700ms linear infinite' }}
      />
    );
  }
  if (isError) {
    return <AlertCircle size={14} strokeWidth={2} className="shrink-0 text-destructive" />;
  }
  return <Check size={14} strokeWidth={2.5} className="shrink-0 text-muted-foreground check-pop" />;
}

export function AgentActivityAccordion({ calls }: AgentActivityAccordionProps) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (!calls || calls.length === 0) return null;

  const artifacts: ActiveArtifact[] = extractBaseArtifacts(calls).map(
    ({ type, title, content, path }) => ({ type, title, content, path })
  );

  return (
    <div className="flex flex-col gap-1 py-1">
      {calls.map((call, i) => {
        const isCallPending = call.status === 'pending' || call.status === 'pending_approval';
        const isCallError = call.status === 'error';
        const isExpanded = expandedIdx === i;
        const label = call.capability.split('.').pop()?.replace(/_/g, ' ') || call.capability;

        return (
          <div key={i} className="flex flex-col">
            <button
              type="button"
              onClick={() => setExpandedIdx(isExpanded ? null : i)}
              className="flex min-h-7 w-full items-center gap-2 rounded-[6px] px-1.5 py-0.5 text-left transition-colors hover:bg-muted/50"
              style={{ animation: `fade-up 320ms cubic-bezier(0.23,1,0.32,1) ${i * 120}ms both` }}
            >
              <CallIcon call={call} />
              <span
                className={`min-w-0 truncate text-[12.5px] font-medium ${
                  isCallError
                    ? 'text-destructive'
                    : isCallPending
                      ? 'text-foreground'
                      : 'text-foreground'
                }`}
              >
                {label}
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground/70">
                {isCallPending ? 'running…' : isCallError ? 'failed' : 'completed'}
              </span>
              {isExpanded ? (
                <ChevronDown size={12} className="ml-auto shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight size={12} className="ml-auto shrink-0 text-muted-foreground" />
              )}
            </button>
            {isExpanded && (
              <div className="ml-6 space-y-2 px-1.5 pb-1.5">
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

      {/* ── Artifact Cards for Created Notes/Files ── */}
      {artifacts.length > 0 && (
        <div className="mt-2 space-y-2">
          {artifacts.map((art, idx) => (
            <ArtifactCard key={idx} artifact={art} />
          ))}
        </div>
      )}
    </div>
  );
}
