import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Check, AlertCircle, Loader2 } from 'lucide-react';
import { PluginCall } from '@/types/chat';

interface ToolCallCardProps {
  call: PluginCall;
  messageId: string;
}

export function ToolCallCard({ call }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isError = call.status === 'error';
  const isPending = call.status === 'pending' || call.status === 'pending_approval';

  useEffect(() => {
    if (call.status === 'success') {
      const caps = [
        'coder.write_file',
        'coder.apply_diff',
        'file.write',
        'file.delete',
        'file.mkdir',
      ];
      if (caps.includes(call.capability)) {
        window.dispatchEvent(new CustomEvent('weave-fs-refresh'));
      }
    }
  }, [call.status, call.capability]);

  return (
    <div className="border border-border/60 rounded bg-background/80 text-xs font-mono">
      <div
        className="flex items-center justify-between px-2.5 py-1 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-1.5 truncate">
          {isPending ? (
            <Loader2 className="w-3 h-3 text-foreground animate-spin shrink-0" />
          ) : isError ? (
            <AlertCircle className="w-3 h-3 text-destructive shrink-0" />
          ) : (
            <Check className="w-3 h-3 text-muted-foreground shrink-0" />
          )}
          <span className="text-foreground font-medium truncate">
            {call.capability}
          </span>
        </div>
        <div className="flex items-center gap-1 text-muted-foreground shrink-0">
          {isError && <span className="text-destructive font-semibold">Error</span>}
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </div>
      </div>

      {expanded && (
        <div className="p-2 border-t border-border/40 bg-muted/20 space-y-2">
          {call.params && Object.keys(call.params).length > 0 && (
            <div>
              <span className="text-[10px] text-muted-foreground uppercase font-sans font-bold">Params</span>
              <pre className="mt-0.5 p-1.5 bg-background rounded border text-[11px] font-mono overflow-x-auto text-foreground whitespace-pre-wrap max-h-40">
                {JSON.stringify(call.params, null, 2)}
              </pre>
            </div>
          )}

          {call.result && (
            <div>
              <span className="text-[10px] text-muted-foreground uppercase font-sans font-bold">Result</span>
              <pre className="mt-0.5 p-1.5 bg-background rounded border text-[11px] font-mono overflow-x-auto text-foreground whitespace-pre-wrap max-h-48">
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
}

