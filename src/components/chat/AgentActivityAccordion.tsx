import { useState } from 'react';
import { ChevronDown, ChevronRight, CheckCircle2, Loader2, Sparkles, AlertCircle } from 'lucide-react';
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
  const uniqueCaps = new Set(calls.map((c) => c.capability)).size;
  const hasError = calls.some((c) => c.status === 'error');
  const isPending = calls.some((c) => c.status === 'pending' || c.status === 'pending_approval');
  const isActive = isStreaming || isPending;

  return (
    <div className="my-3.5 w-full border border-border/70 rounded-2xl overflow-hidden bg-card/60 backdrop-blur-md shadow-sm transition-all duration-200 hover:border-primary/40">
      {/* ── Accordion Header ── */}
      <div
        className="flex items-center justify-between px-4 py-2.5 cursor-pointer select-none bg-muted/30 hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2.5 overflow-hidden">
          {isActive ? (
            <Loader2 className="w-4 h-4 text-primary animate-spin flex-shrink-0" />
          ) : hasError ? (
            <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
          )}

          <div className="flex items-center gap-2 truncate">
            <span className="text-xs font-semibold text-foreground/90 tracking-tight flex items-center gap-1.5 truncate">
              <Sparkles className="w-3.5 h-3.5 text-primary opacity-80 inline flex-shrink-0" />
              {isActive
                ? `Agent working on ${totalCalls} action${totalCalls > 1 ? 's' : ''}...`
                : `Explored ${uniqueCaps} capabilit${uniqueCaps > 1 ? 'ies' : 'y'}, performed ${totalCalls} action${totalCalls > 1 ? 's' : ''}`}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          {hasError && (
            <span className="text-[10px] font-bold text-destructive bg-destructive/10 border border-destructive/20 px-2 py-0.5 rounded-full">
              1+ Failed
            </span>
          )}
          <span className="text-[11px] font-mono font-medium text-muted-foreground/80 bg-background/80 px-2 py-0.5 rounded-md border border-border/50">
            {totalCalls} {totalCalls === 1 ? 'step' : 'steps'}
          </span>
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform duration-200" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground transition-transform duration-200" />
          )}
        </div>
      </div>

      {/* ── Accordion Body (Step List) ── */}
      {expanded && (
        <div className="px-4 py-3 border-t border-border/50 bg-background/40 space-y-2.5 animate-fade-in">
          <div className="text-[11px] font-semibold text-muted-foreground/80 uppercase tracking-wider mb-2 flex items-center justify-between">
            <span>Execution Timeline</span>
            <span className="text-[10px] font-normal text-muted-foreground">Click steps to inspect details</span>
          </div>
          <div className="pl-1 space-y-2.5 border-l-2 border-primary/20 ml-1">
            {calls.map((call, i) => (
              <div key={i} className="pl-3 relative">
                {/* Timeline node dot */}
                <div className="absolute -left-[5px] top-4 w-2 h-2 rounded-full bg-primary/60 ring-4 ring-background" />
                <ToolCallCard call={call} messageId={messageId} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
