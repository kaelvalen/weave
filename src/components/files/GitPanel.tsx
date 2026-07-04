import { useState, useEffect, useCallback } from 'react';
import {
  GitBranch,
  GitCommit,
  GitPullRequest,
  Plus,
  RefreshCw,
  Check,
  Loader2,
  History,
  Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ipc } from '@/lib/ipc';
import { toast } from 'sonner';

interface GitFileChange {
  code: string;
  path: string;
  staged: boolean;
}

interface GitStatusResult {
  status: string;
  branch: string;
  is_repo?: boolean;
  success: boolean;
}

interface GitLogResult {
  log: string;
  limit: number;
  success: boolean;
}

interface GitBranchResult {
  branches: string[];
  current: string;
  count: number;
  success: boolean;
}

interface GitDiffResult {
  diff: string;
  staged: boolean;
  success: boolean;
}

export interface GitPanelProps {
  currentRoot: string;
  onSelectFile: (path: string, name: string) => void;
  onOpenDiff?: (path: string, diffText: string) => void;
}

export function GitPanel({ currentRoot, onSelectFile, onOpenDiff }: GitPanelProps) {
  const [loading, setLoading] = useState(false);
  const [isGitRepo, setIsGitRepo] = useState<boolean>(true);
  const [branch, setBranch] = useState<string>('main');
  const [changes, setChanges] = useState<GitFileChange[]>([]);
  const [commitMsg, setCommitMsg] = useState('');
  const [committing, setCommitting] = useState(false);
  const [activeTab, setActiveTab] = useState<'changes' | 'history' | 'branches'>('changes');
  const [history, setHistory] = useState<{ hash: string; message: string }[]>([]);
  const [branches, setBranches] = useState<{ list: string[]; current: string }>({
    list: [],
    current: 'main',
  });

  const parseStatus = (raw: string): GitFileChange[] => {
    if (!raw || !raw.trim()) return [];
    return raw
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 2)
      .map((line) => {
        const code = line.substring(0, 2);
        const path = line.substring(2).trim();
        // If first char is not space and not '?', it's staged
        const staged = code[0] !== ' ' && code[0] !== '?';
        return { code: code.trim(), path, staged };
      });
  };

  const fetchStatus = useCallback(async () => {
    if (!currentRoot) return;
    setLoading(true);
    try {
      const res = (await ipc.pluginExecute('com.weave.builtin.git', 'git.status', {
        directory: currentRoot,
      })) as GitStatusResult;
      if (res && res.success !== false) {
        if (res.is_repo === false) {
          setIsGitRepo(false);
          setChanges([]);
          setBranch('main');
        } else {
          setIsGitRepo(true);
          setBranch(res.branch || 'main');
          setChanges(parseStatus(res.status || ''));
        }
      }
    } catch (err: unknown) {
      console.error('Failed to fetch git status:', err);
      const errStr = String(err).toLowerCase();
      if (errStr.includes('not a git repository') || errStr.includes('fatal:')) {
        setIsGitRepo(false);
        setChanges([]);
      }
    } finally {
      setLoading(false);
    }
  }, [currentRoot]);

  const fetchHistory = useCallback(async () => {
    if (!currentRoot) return;
    try {
      const res = (await ipc.pluginExecute('com.weave.builtin.git', 'git.log', {
        directory: currentRoot,
        limit: 15,
      })) as GitLogResult;
      if (res && res.log) {
        const parsed = res.log
          .split('\n')
          .filter((l) => l.trim().length > 0)
          .map((l) => {
            const parts = l.split(' ');
            const hash = parts[0] || '';
            const message = parts.slice(1).join(' ');
            return { hash, message };
          });
        setHistory(parsed);
      }
    } catch (err) {
      console.error('Failed to fetch git history:', err);
    }
  }, [currentRoot]);

  const fetchBranches = useCallback(async () => {
    if (!currentRoot) return;
    try {
      const res = (await ipc.pluginExecute('com.weave.builtin.git', 'git.branch', {
        directory: currentRoot,
      })) as GitBranchResult;
      if (res && res.branches) {
        setBranches({
          list: res.branches.map((b) => b.replace(/^\*\s*/, '')),
          current: res.current || 'main',
        });
      }
    } catch (err) {
      console.error('Failed to fetch git branches:', err);
    }
  }, [currentRoot]);

  useEffect(() => {
    fetchStatus();
    if (activeTab === 'history') fetchHistory();
    if (activeTab === 'branches') fetchBranches();
  }, [currentRoot, activeTab, fetchStatus, fetchHistory, fetchBranches]);

  const handleStageFile = async (path: string) => {
    try {
      await ipc.pluginExecute('com.weave.builtin.git', 'git.add', {
        directory: currentRoot,
        path,
      });
      toast.success(`Staged ${path}`);
      fetchStatus();
    } catch (err) {
      toast.error(`Failed to stage ${path}`);
      console.error(err);
    }
  };

  const handleStageAll = async () => {
    try {
      await ipc.pluginExecute('com.weave.builtin.git', 'git.add', {
        directory: currentRoot,
        path: '.',
      });
      toast.success('Staged all changes');
      fetchStatus();
    } catch (err) {
      toast.error('Failed to stage changes');
      console.error(err);
    }
  };

  const handleCommit = async () => {
    if (!commitMsg.trim()) {
      toast.error('Please enter a commit message');
      return;
    }
    setCommitting(true);
    try {
      await ipc.pluginExecute('com.weave.builtin.git', 'git.commit', {
        directory: currentRoot,
        message: commitMsg.trim(),
      });
      toast.success('Committed changes successfully');
      setCommitMsg('');
      fetchStatus();
      if (activeTab === 'history') fetchHistory();
    } catch (err) {
      toast.error('Commit failed. Make sure changes are staged.');
      console.error(err);
    } finally {
      setCommitting(false);
    }
  };

  const handleViewDiff = async (change: GitFileChange) => {
    if (!onOpenDiff) {
      onSelectFile(`${currentRoot}/${change.path}`, change.path.split('/').pop() || change.path);
      return;
    }
    try {
      const res = (await ipc.pluginExecute('com.weave.builtin.git', 'git.diff', {
        directory: currentRoot,
        staged: change.staged,
        file: change.path,
      })) as GitDiffResult;
      if (res && res.diff !== undefined) {
        onOpenDiff(`${currentRoot}/${change.path}`, res.diff);
      }
    } catch (err) {
      console.error('Failed to load diff:', err);
      toast.error('Could not load git diff');
    }
  };

  const stagedChanges = changes.filter((c) => c.staged);
  const unstagedChanges = changes.filter((c) => !c.staged);

  return (
    <div className="flex flex-col h-full bg-card/60 select-none">
      {/* Header */}
      <div className="p-3 border-b border-border/60 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-primary" />
            <span className="text-xs font-bold text-foreground">Source Control</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="w-6 h-6 text-muted-foreground hover:text-foreground"
            onClick={() => fetchStatus()}
            disabled={loading}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* Branch Badge & Tabs when tracked by Git */}
        {isGitRepo && (
          <>
            <div className="flex items-center justify-between bg-muted/40 px-2.5 py-1 rounded-lg border border-border/40">
              <div className="flex items-center gap-1.5 text-xs font-mono font-medium text-foreground">
                <GitPullRequest className="w-3.5 h-3.5 text-blue-500" />
                <span className="truncate max-w-[140px]">{branch}</span>
              </div>
              <span className="text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary font-semibold rounded font-mono">
                {changes.length} {changes.length === 1 ? 'change' : 'changes'}
              </span>
            </div>

            {/* Navigation Tabs */}
            <div className="flex border border-border/60 rounded-lg p-0.5 bg-muted/20">
              <button
                type="button"
                onClick={() => setActiveTab('changes')}
                className={`flex-1 py-1 text-[11px] font-medium rounded-md transition-colors ${
                  activeTab === 'changes' ? 'bg-background text-foreground shadow-sm font-semibold' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Changes ({changes.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('history')}
                className={`flex-1 py-1 text-[11px] font-medium rounded-md transition-colors ${
                  activeTab === 'history' ? 'bg-background text-foreground shadow-sm font-semibold' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                History
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('branches')}
                className={`flex-1 py-1 text-[11px] font-medium rounded-md transition-colors ${
                  activeTab === 'branches' ? 'bg-background text-foreground shadow-sm font-semibold' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Branches
              </button>
            </div>
          </>
        )}
      </div>

      {/* Tab Content or Empty Repo Initialization */}
      {!isGitRepo ? (
        <div className="flex flex-col items-center justify-center flex-1 my-auto px-6 py-10 text-center animate-in fade-in zoom-in-95 duration-300">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4 shadow-sm">
            <GitBranch className="w-6 h-6 text-primary" />
          </div>
          <h3 className="text-base font-bold text-foreground mb-1">No Git Repository</h3>
          <p className="text-xs text-muted-foreground max-w-xs mb-6 leading-relaxed">
            This workspace is not tracked by Git yet. Initialize a repository to start version control, branch management, and AI diff summaries.
          </p>
          <Button
            onClick={async () => {
              try {
                setLoading(true);
                await ipc.pluginExecute('com.weave.builtin.git', 'git.init', { directory: currentRoot });
                toast.success('Initialized empty Git repository');
                setIsGitRepo(true);
                fetchStatus();
              } catch (e: unknown) {
                const errObj = e as Record<string, unknown>;
                const msg = errObj?.message || errObj?.error || (typeof e === 'string' ? e : JSON.stringify(e));
                toast.error(`Failed to initialize git: ${msg}`);
              } finally {
                setLoading(false);
              }
            }}
            disabled={loading}
            className="h-9 px-5 text-xs font-semibold gap-2 bg-primary text-primary-foreground hover:bg-primary/90 shadow-md transition-all duration-200 cursor-pointer"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitBranch className="w-4 h-4" />}
            <span>Initialize Git Repository</span>
          </Button>
        </div>
      ) : (
        <ScrollArea className="flex-1 min-h-0">
          {activeTab === 'changes' && (
          <div className="p-3 space-y-4">
            {/* Commit Input Box */}
            <div className="space-y-2 bg-muted/20 p-2.5 rounded-xl border border-border/60">
              <Input
                placeholder="Commit message..."
                value={commitMsg}
                onChange={(e) => setCommitMsg(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCommit()}
                className="text-xs h-8 bg-background border-border/80"
              />
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  onClick={handleCommit}
                  disabled={committing || !commitMsg.trim() || changes.length === 0}
                  className="flex-1 h-7 text-xs font-medium gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg"
                >
                  {committing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitCommit className="w-3.5 h-3.5" />}
                  <span>Commit</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleStageAll}
                  disabled={unstagedChanges.length === 0}
                  className="h-7 text-xs px-2.5 gap-1 rounded-lg"
                  title="Stage All Unstaged Changes"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Stage All</span>
                </Button>
              </div>
            </div>

            {/* Staged Changes */}
            {stagedChanges.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-muted-foreground px-1">
                  <span>Staged Changes ({stagedChanges.length})</span>
                </div>
                <div className="space-y-1">
                  {stagedChanges.map((c, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between p-1.5 rounded-lg bg-green-500/5 hover:bg-green-500/10 border border-green-500/20 text-xs transition-colors group cursor-pointer"
                      onClick={() => handleViewDiff(c)}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="w-4 h-4 rounded bg-green-500/20 text-green-500 font-mono font-bold text-[10px] flex items-center justify-center shrink-0">
                          {c.code}
                        </span>
                        <span className="truncate font-mono text-foreground">{c.path}</span>
                      </div>
                      <Eye className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity ml-1 shrink-0" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Unstaged Changes */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-muted-foreground px-1">
                <span>Changes ({unstagedChanges.length})</span>
              </div>
              {unstagedChanges.length === 0 && stagedChanges.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  <Check className="w-8 h-8 mx-auto text-green-500/50 mb-2" />
                  <p className="text-xs font-semibold text-foreground">Working Tree Clean</p>
                  <p className="text-[11px] text-muted-foreground">No uncommitted changes</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {unstagedChanges.map((c, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between p-1.5 rounded-lg bg-background/60 hover:bg-muted/80 border border-border/40 text-xs transition-colors group"
                    >
                      <div
                        className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer"
                        onClick={() => handleViewDiff(c)}
                      >
                        <span className="w-4 h-4 rounded bg-amber-500/20 text-amber-500 font-mono font-bold text-[10px] flex items-center justify-center shrink-0">
                          {c.code}
                        </span>
                        <span className="truncate font-mono text-foreground">{c.path}</span>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={() => handleStageFile(c.path)}
                          className="w-6 h-6 rounded bg-primary/10 hover:bg-primary/20 text-primary flex items-center justify-center"
                          title="Stage Change"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="p-3 space-y-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground px-1">
              Recent Commits
            </span>
            {history.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">No commit history found</p>
            ) : (
              <div className="space-y-1.5">
                {history.map((item, i) => (
                  <div
                    key={i}
                    className="p-2 rounded-lg bg-background/80 border border-border/40 space-y-1 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded text-[10px]">
                        {item.hash}
                      </span>
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <History className="w-3 h-3" /> Commit
                      </span>
                    </div>
                    <p className="text-foreground text-[11px] leading-tight font-sans truncate" title={item.message}>
                      {item.message}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'branches' && (
          <div className="p-3 space-y-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground px-1">
              Local Branches
            </span>
            <div className="space-y-1">
              {branches.list.map((b, i) => {
                const isCurrent = b === branches.current;
                return (
                  <div
                    key={i}
                    className={`flex items-center justify-between p-2 rounded-lg text-xs font-mono ${
                      isCurrent
                        ? 'bg-primary/15 border border-primary/40 text-primary font-bold'
                        : 'bg-background/80 border border-border/40 text-foreground hover:bg-muted/60'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <GitBranch className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{b}</span>
                    </div>
                    {isCurrent && (
                      <span className="text-[9px] uppercase px-1.5 py-0.5 bg-primary text-primary-foreground rounded font-sans">
                        Active
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </ScrollArea>
      )}
    </div>
  );
}
