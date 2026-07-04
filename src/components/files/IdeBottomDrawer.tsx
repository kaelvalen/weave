import { useState, useRef, useEffect } from 'react';
import {
  Terminal,
  Play,
  Trash2,
  X,
  CheckCircle2,
  XCircle,
  Loader2,
  Bug,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ipc } from '@/lib/ipc';

interface TerminalEntry {
  id: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  success: boolean;
  timestamp: string;
}

interface ShellExecResult {
  command: string;
  stdout: string;
  stderr: string;
  exit_code: number | null;
  success: boolean;
  timeout_secs: number;
}

export interface IdeBottomDrawerProps {
  currentRoot: string;
  onClose: () => void;
  activeTab: 'terminal' | 'output' | 'diagnostics';
  onTabChange: (tab: 'terminal' | 'output' | 'diagnostics') => void;
  aiDiagnostics?: string | null;
  onRunDiagnostics?: () => void;
  isRunningDiagnostics?: boolean;
}

export function IdeBottomDrawer({
  currentRoot,
  onClose,
  activeTab,
  onTabChange,
  aiDiagnostics,
  onRunDiagnostics,
  isRunningDiagnostics,
}: IdeBottomDrawerProps) {
  const [cmd, setCmd] = useState('');
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<TerminalEntry[]>([
    {
      id: 'init',
      command: 'echo "Welcome to Weave IDE Terminal Console"',
      stdout: 'Welcome to Weave IDE Terminal Console\nType a command or use git / coder plugins.',
      stderr: '',
      exitCode: 0,
      success: true,
      timestamp: new Date().toLocaleTimeString(),
    },
  ]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  const handleRunCommand = async () => {
    if (!cmd.trim() || running) return;
    const commandStr = cmd.trim();
    setCmd('');
    setRunning(true);

    const tempId = Date.now().toString();
    const nowStr = new Date().toLocaleTimeString();

    try {
      const res = (await ipc.pluginExecute('com.weave.builtin.shell', 'shell.exec', {
        command: commandStr,
        cwd: currentRoot,
        timeout: 30,
      })) as ShellExecResult;

      setHistory((prev) => [
        ...prev,
        {
          id: tempId,
          command: commandStr,
          stdout: res.stdout || '',
          stderr: res.stderr || '',
          exitCode: res.exit_code,
          success: res.success,
          timestamp: nowStr,
        },
      ]);
    } catch (err) {
      setHistory((prev) => [
        ...prev,
        {
          id: tempId,
          command: commandStr,
          stdout: '',
          stderr: typeof err === 'string' ? err : (err as Error)?.message || 'Command execution failed',
          exitCode: 1,
          success: false,
          timestamp: nowStr,
        },
      ]);
    } finally {
      setRunning(false);
    }
  };

  const handleClearTerminal = () => {
    setHistory([]);
  };

  return (
    <div className="h-60 border-t border-border/80 bg-card/95 backdrop-blur-md flex flex-col shrink-0 select-none shadow-2xl animate-in slide-in-from-bottom duration-200 z-20">
      {/* Header & Tabs */}
      <div className="h-10 px-3 flex items-center justify-between border-b border-border/60 bg-muted/40">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onTabChange('terminal')}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 ${
              activeTab === 'terminal'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Terminal className="w-3.5 h-3.5 text-primary" />
            <span>Terminal</span>
          </button>
          <button
            type="button"
            onClick={() => onTabChange('output')}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 ${
              activeTab === 'output'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-blue-500" />
            <span>System Output</span>
          </button>
          <button
            type="button"
            onClick={() => onTabChange('diagnostics')}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 ${
              activeTab === 'diagnostics'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Bug className="w-3.5 h-3.5 text-amber-500" />
            <span>AI Diagnostics</span>
          </button>
        </div>

        <div className="flex items-center gap-1">
          {activeTab === 'terminal' && (
            <Button
              variant="ghost"
              size="icon"
              className="w-7 h-7 text-muted-foreground hover:text-foreground"
              onClick={handleClearTerminal}
              title="Clear Terminal Output"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="w-7 h-7 text-muted-foreground hover:text-foreground"
            onClick={onClose}
            title="Close Drawer"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 bg-background/90 overflow-hidden flex flex-col font-mono text-xs">
        {activeTab === 'terminal' && (
          <div className="flex-1 flex flex-col min-h-0">
            <ScrollArea className="flex-1 p-3 space-y-3">
              <div className="space-y-3">
                {history.map((item) => (
                  <div key={item.id} className="space-y-1">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span className="text-primary font-bold">{currentRoot || 'workspace'} $</span>
                      <span className="text-foreground font-semibold">{item.command}</span>
                      <span className="text-[10px] ml-auto opacity-60">{item.timestamp}</span>
                    </div>
                    {item.stdout && (
                      <pre className="text-foreground/90 whitespace-pre-wrap pl-4 border-l-2 border-primary/30 py-0.5 font-mono text-[11px] leading-relaxed">
                        {item.stdout}
                      </pre>
                    )}
                    {item.stderr && (
                      <pre className="text-red-400 whitespace-pre-wrap pl-4 border-l-2 border-red-500/50 py-0.5 font-mono text-[11px] leading-relaxed">
                        {item.stderr}
                      </pre>
                    )}
                    <div className="flex items-center gap-1 pl-4 text-[10px]">
                      {item.success ? (
                        <span className="text-green-500 flex items-center gap-1 font-sans">
                          <CheckCircle2 className="w-3 h-3" /> Exit code: {item.exitCode ?? 0}
                        </span>
                      ) : (
                        <span className="text-red-500 flex items-center gap-1 font-sans">
                          <XCircle className="w-3 h-3" /> Exit code: {item.exitCode ?? 1}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {running && (
                  <div className="flex items-center gap-2 text-primary py-1">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Executing command...</span>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
            </ScrollArea>

            {/* Input Bar */}
            <div className="p-2 border-t border-border/40 bg-card/40 flex items-center gap-2">
              <span className="text-primary font-bold pl-1">$</span>
              <Input
                placeholder="Enter shell command (e.g. npm test, ls -la, cargo check)..."
                value={cmd}
                onChange={(e) => setCmd(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRunCommand()}
                disabled={running}
                className="h-7 text-xs font-mono bg-transparent border-0 shadow-none focus-visible:ring-0 px-1 flex-1"
              />
              <Button
                size="sm"
                onClick={handleRunCommand}
                disabled={running || !cmd.trim()}
                className="h-7 px-3 text-xs bg-primary text-primary-foreground hover:bg-primary/90 rounded-md shrink-0 gap-1"
              >
                <Play className="w-3 h-3 fill-current" />
                <span>Run</span>
              </Button>
            </div>
          </div>
        )}

        {activeTab === 'output' && (
          <ScrollArea className="flex-1 p-4 font-mono text-xs">
            <div className="space-y-2 text-muted-foreground">
              <p className="text-foreground font-bold">System Output & Telemetry</p>
              <p>Active Workspace Root: <span className="text-primary">{currentRoot}</span></p>
              <p>IDE Engine Status: <span className="text-green-500 font-semibold">Online</span></p>
              <p>Plugin Registry: <span className="text-foreground">com.weave.builtin.git, com.weave.builtin.shell, com.weave.builtin.coder</span></p>
            </div>
          </ScrollArea>
        )}

        {activeTab === 'diagnostics' && (
          <ScrollArea className="flex-1 p-4 font-sans text-xs">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-foreground flex items-center gap-1.5">
                  <Bug className="w-4 h-4 text-amber-500" />
                  <span>AI Code Diagnostics & Lint Audit</span>
                </span>
                {onRunDiagnostics && (
                  <Button
                    size="sm"
                    onClick={onRunDiagnostics}
                    disabled={isRunningDiagnostics}
                    className="h-7 text-xs px-3 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border border-amber-500/30 rounded-lg gap-1.5"
                  >
                    {isRunningDiagnostics ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    <span>Run Project Audit</span>
                  </Button>
                )}
              </div>
              {aiDiagnostics ? (
                <div className="p-3 bg-muted/40 rounded-xl border border-border/60 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground">
                  {aiDiagnostics}
                </div>
              ) : (
                <p className="text-muted-foreground text-center py-8">
                  No diagnostics run yet. Select a file or click &quot;Run Project Audit&quot; to analyze code health.
                </p>
              )}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
