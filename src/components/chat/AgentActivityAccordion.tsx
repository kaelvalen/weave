import { useState } from 'react';
import { ChevronDown, ChevronRight, Check, AlertCircle, Loader2 } from 'lucide-react';
import { PluginCall } from '@/types/chat';
import { ToolCallCard } from './ToolCallCard';

interface AgentActivityAccordionProps {
  calls: PluginCall[];
  messageId: string;
  isStreaming?: boolean;
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

  return (
    <div className="my-2 border border-border/80 rounded-md overflow-hidden bg-muted/20 font-mono text-xs">
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
  );
}

