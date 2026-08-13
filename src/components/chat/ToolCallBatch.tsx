import { useState } from 'react';
import { Check, AlertCircle, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import type { PluginCall } from '@/types/chat';
import { ToolCallCard } from './ToolCallCard';

interface ToolCallBatchProps {
  calls: PluginCall[];
  messageId: string;
  /** Auto-opens while the turn is still streaming, collapses when done. */
  live?: boolean;
}

/**
 * Compact, click-to-expand group of the tool calls that ran at one point in
 * the stream. Rendered inline between text slices in true chronological
 * order — a collapsed one-line row when done, expanded while running.
 */
export function ToolCallBatch({ calls, messageId, live }: ToolCallBatchProps) {
  const [open, setOpen] = useState(Boolean(live));

  // While the turn is streaming, keep the batch expanded as new calls land.
  // Derived from the `live` prop instead of an effect: when live flips on,
  // this re-renders with open=true without a setState-in-effect cascade.
  const expanded = live || open;

  if (calls.length === 0) return null;

  const pending = calls.some(
    (c) => c.status === 'pending' || c.status === 'pending_approval'
  );
  const failed = calls.filter((c) => c.status === 'error').length;

  return (
    <div className="rounded-lg bg-surface-1 overflow-hidden border border-border/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-surface-2 transition-colors cursor-pointer"
      >
        {pending ? (
          <Loader2 className="w-3.5 h-3.5 text-brand animate-spin shrink-0" />
        ) : failed > 0 ? (
          <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
        ) : (
          <Check className="w-3.5 h-3.5 text-brand shrink-0 check-pop" />
        )}
        <span className="font-mono text-xs text-foreground font-medium">
          {calls.length} tool call{calls.length > 1 ? 's' : ''}
        </span>
        <span className="text-[10px] font-mono text-muted-foreground opacity-70">
          {pending
            ? 'running…'
            : failed > 0
              ? `${calls.length - failed} ok · ${failed} failed`
              : 'completed'}
        </span>
        {expanded ? (
          <ChevronDown className="w-3 h-3 ml-auto text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 ml-auto text-muted-foreground shrink-0" />
        )}
      </button>
      {expanded && (
        <div className="px-1.5 pb-1.5 space-y-1">
          {calls.map((call) => (
            <ToolCallCard key={call.call_id ?? call.capability} call={call} messageId={messageId} />
          ))}
        </div>
      )}
    </div>
  );
}
