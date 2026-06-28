import { useState } from 'react';
import { Wrench, ChevronDown, ChevronRight, CheckCircle2, XCircle } from 'lucide-react';
import { PluginCall } from '@/types/chat';

interface ToolCallCardProps {
  call: PluginCall;
}

export function ToolCallCard({ call }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isError = call.status === 'error';
  const pluginName = call.plugin_id.split('.').pop() || call.plugin_id;

  return (
    <div className="my-3 max-w-full w-fit border rounded-xl overflow-hidden bg-muted/40 backdrop-blur-sm text-sm shadow-sm transition-all hover:shadow-md">
      <div 
        className="flex items-center justify-between px-3 py-1.5 cursor-pointer hover:bg-muted/60 transition-colors gap-6"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          {isError ? (
            <XCircle className="w-4 h-4 text-destructive" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-green-500" />
          )}
          <span className="font-medium text-muted-foreground/90 text-xs">
            <Wrench className="w-3.5 h-3.5 inline mr-1.5 text-muted-foreground opacity-70" />
            {pluginName}::{call.capability}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isError && <span className="text-xs text-destructive font-medium">Failed</span>}
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </div>
      
      {expanded && (
        <div className="px-3 py-2 border-t bg-muted/30">
          <div className="mb-2">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Parameters</span>
            <pre className="mt-1 p-2 bg-background/50 rounded border text-[11px] font-mono overflow-x-auto text-foreground whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto">
              {JSON.stringify(call.params, null, 2)}
            </pre>
          </div>
          {call.result && (
            <div>
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Result</span>
              <pre className="mt-1 p-2 bg-background/50 rounded border text-[11px] font-mono overflow-x-auto text-foreground whitespace-pre-wrap break-words max-h-[300px] overflow-y-auto">
                {typeof call.result === 'string' ? call.result : JSON.stringify(call.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
