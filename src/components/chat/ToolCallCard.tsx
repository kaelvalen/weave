import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Check, AlertCircle, Loader2 } from 'lucide-react';
import { PluginCall } from '@/types/chat';
import { useAppStore } from '@/stores/useAppStore';

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
    <div className="rounded-lg bg-surface-1 text-xs font-mono">
      <div
        className="flex items-center justify-between px-2.5 py-1.5 cursor-pointer hover:bg-surface-2 rounded-lg transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-1.5 truncate">
          {isPending ? (
            <Loader2 className="w-3 h-3 text-brand animate-spin shrink-0" />
          ) : isError ? (
            <AlertCircle className="w-3 h-3 text-destructive shrink-0" />
          ) : (
            <Check className="w-3 h-3 text-brand shrink-0 check-pop" />
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
        <div className="p-2 space-y-2">
          {call.params && Object.keys(call.params).length > 0 && (
            <div>
              <span className="text-[10px] text-muted-foreground uppercase font-sans font-bold">Params</span>
              <pre className="mt-0.5 p-1.5 bg-surface-2 rounded text-[11px] font-mono overflow-x-auto text-foreground whitespace-pre-wrap max-h-40">
                {JSON.stringify(call.params, null, 2)}
              </pre>
            </div>
          )}

          {call.result && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-muted-foreground uppercase font-sans font-bold">Result</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    const contentStr = typeof call.result === 'string'
                      ? call.result
                      : JSON.stringify(call.result, null, 2);
                    const titleStr = (call.params?.title as string) ||
                      (call.params?.path as string) ||
                      (call.capability as string);

                    useAppStore.getState().openArtifact({
                      type: call.capability.includes('note') ? 'note' : 'file',
                      title: titleStr,
                      content: contentStr,
                    });
                  }}
                  className="px-2 py-0.5 bg-foreground text-background font-semibold rounded text-[10px] hover:opacity-90 transition-opacity cursor-pointer font-sans"
                >
                  Preview Artifact ↗
                </button>
              </div>
              <pre className="mt-0.5 p-1.5 bg-surface-2 rounded text-[11px] font-mono overflow-x-auto text-foreground whitespace-pre-wrap max-h-48">
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

