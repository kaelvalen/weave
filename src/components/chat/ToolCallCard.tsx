import { useState, useEffect } from 'react';
import { Wrench, ChevronDown, ChevronRight, CheckCircle2, XCircle } from 'lucide-react';
import { PluginCall } from '@/types/chat';
import { FileCode, FileDiff, CheckCircle, PlayCircle, Loader2 } from 'lucide-react';



interface ToolCallCardProps {
  call: PluginCall;
  messageId: string;
}

export function ToolCallCard({ call }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isError = call.status === 'error';
  const pluginName = call.plugin_id.split('.').pop() || call.plugin_id;

  useEffect(() => {
    if (call.status === 'success') {
      const caps = ['coder.write_file', 'coder.apply_diff', 'file.write', 'file.delete', 'file.mkdir'];
      if (caps.includes(call.capability)) {
        window.dispatchEvent(new CustomEvent('weave-fs-refresh'));
      }
    }
  }, [call.status, call.capability]);

  const renderCoderResult = () => {
    if (!call.result) return null;
    const res = call.result as any;
    
    if (call.capability === 'coder.apply_diff') {
      const oldStr = (call.params.old_str as string) || '';
      const newStr = (call.params.new_str as string) || '';
      const targetPath = (call.params.path as string) || 'unknown';
      
      return (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
            <FileDiff className="w-3.5 h-3.5" />
            Applied Diff in <span className="font-mono bg-muted/50 px-1 rounded">{targetPath}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] font-mono">
            <div className="bg-red-500/10 border border-red-500/20 rounded p-2 overflow-x-auto whitespace-pre">
              <div className="text-red-500/70 mb-1 text-[9px] uppercase tracking-wider font-sans font-bold">Removed</div>
              <div className="text-red-500">{oldStr}</div>
            </div>
            <div className="bg-green-500/10 border border-green-500/20 rounded p-2 overflow-x-auto whitespace-pre">
              <div className="text-green-500/70 mb-1 text-[9px] uppercase tracking-wider font-sans font-bold">Added</div>
              <div className="text-green-500">{newStr}</div>
            </div>
          </div>
          {res.backed_up && <div className="text-[10px] text-muted-foreground mt-1 text-right">Backed up to .weave.bak</div>}
        </div>
      );
    }
    
    if (call.capability === 'coder.write_file') {
      return (
        <div className="mt-2 flex items-center gap-2 p-2 bg-muted/30 border rounded text-xs">
          <FileCode className="w-4 h-4 text-blue-500" />
          <span>Wrote <strong>{res.bytes_written}</strong> bytes to <code className="bg-background px-1 py-0.5 rounded border">{res.path}</code></span>
        </div>
      );
    }

    if (call.capability === 'coder.run_check' || call.capability === 'coder.run_tests') {
      const success = res.success;
      return (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium">
            {success ? <CheckCircle className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-red-500" />}
            {call.capability === 'coder.run_tests' ? 'Test Results' : 'Check Results'} ({res.check_type})
          </div>
          <div className="text-[11px] font-mono bg-background/50 border rounded p-2 overflow-x-auto whitespace-pre max-h-[250px] overflow-y-auto">
            <div className="text-muted-foreground mb-1">$ {res.command}</div>
            <div className={success ? 'text-foreground' : 'text-red-400'}>{res.stdout || res.stderr || 'No output'}</div>
          </div>
          {(res.tests_passed !== null && res.tests_passed !== undefined) && (
            <div className="flex gap-4 text-[11px]">
              <span className="text-green-500 font-medium">{res.tests_passed} Passed</span>
              {res.tests_failed > 0 && <span className="text-red-500 font-medium">{res.tests_failed} Failed</span>}
            </div>
          )}
        </div>
      );
    }
    
    // Default fallback for coder
    return null;
  };

  const isCoderPlugin = call.plugin_id === 'com.weave.builtin.coder';

  return (
    <div className="my-3 max-w-full w-fit border rounded-xl overflow-hidden bg-muted/40 backdrop-blur-sm text-sm shadow-sm transition-all hover:shadow-md">
      <div 
        className="flex items-center justify-between px-3 py-1.5 cursor-pointer hover:bg-muted/60 transition-colors gap-6"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          {call.status === 'pending_approval' ? (
            <PlayCircle className="w-4 h-4 text-orange-500 animate-pulse" />
          ) : call.status === 'pending' ? (
            <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
          ) : isError ? (
            <XCircle className="w-4 h-4 text-destructive" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-green-500" />
          )}
          <span className="font-medium text-muted-foreground/90 text-xs">
            {isCoderPlugin ? <PlayCircle className="w-3.5 h-3.5 inline mr-1.5 text-blue-500 opacity-80" /> : <Wrench className="w-3.5 h-3.5 inline mr-1.5 text-muted-foreground opacity-70" />}
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
              {isCoderPlugin ? (
                renderCoderResult() || (
                  <pre className="mt-1 p-2 bg-background/50 rounded border text-[11px] font-mono overflow-x-auto text-foreground whitespace-pre-wrap break-words max-h-[300px] overflow-y-auto">
                    {typeof call.result === 'string' ? call.result : JSON.stringify(call.result, null, 2)}
                  </pre>
                )
              ) : (
                <pre className="mt-1 p-2 bg-background/50 rounded border text-[11px] font-mono overflow-x-auto text-foreground whitespace-pre-wrap break-words max-h-[300px] overflow-y-auto">
                  {typeof call.result === 'string' ? call.result : JSON.stringify(call.result, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
