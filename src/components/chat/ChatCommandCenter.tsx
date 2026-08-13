import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '@/stores/useChatStore';
import { useApprovalModeStore } from '@/stores/useApprovalModeStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { useChatStream } from '@/hooks/useChatStream';
import { ApprovalBanner } from './ApprovalBanner';
import { ExecutionPanel } from '@/components/execution/ExecutionPanel';
import {
  PlusCircle,
  FolderOpen,
  Calculator,
  FileText,
  Workflow,
  ArrowDown,
  MessageSquare,
  Trash2,
  ChevronDown,
  Activity,
  X,
  ShieldAlert,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import logoLight from '@/assets/weave-logo/light-mode.svg';
import logoDark from '@/assets/weave-logo/dark-mode.svg';

const SUGGESTED_PROMPTS = [
  {
    text: 'Analyze this repository',
    desc: 'Map structure, entry points and key patterns',
    prompt: 'Analyze the repository structure and explain the main architectural patterns',
    icon: FolderOpen,
    chips: ['Filesystem', 'Git', 'Rust'],
  },
  {
    text: 'Summarize my notes',
    desc: 'Distill recent ideas into an actionable note',
    prompt: 'Create a note summarizing my current ideas',
    icon: FileText,
    chips: ['Memory', 'Markdown', 'Search'],
  },
  {
    text: 'Run a workflow',
    desc: 'Execute a multi-step automated pipeline',
    prompt: 'List available automated workflows',
    icon: Workflow,
    chips: ['Planner', 'Tools'],
  },
  {
    text: 'Calculate precisely',
    desc: 'High-precision math and unit conversions',
    prompt: 'Calculate sqrt(144) + 42 * 18',
    icon: Calculator,
    chips: ['Math', 'Units'],
  },
];

export function ChatCommandCenter() {
  const {
    sessions,
    listSessions,
    loadSession,
    startNewSession,
    deleteSession,
    conversationId,
    messages,
    isStreaming,
  } = useChatStore();
  
  const approvalMode = useApprovalModeStore((s) => s.mode);
  const setApprovalMode = useApprovalModeStore((s) => s.setMode);

  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);
  const [confirmAutoApprove, setConfirmAutoApprove] = useState(false);
  const [isExecutionPanelOpen, setIsExecutionPanelOpen] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);

  useChatStream();

  useEffect(() => {
    listSessions();
    useChatStore.getState().loadHistory();
  }, [listSessions]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        setIsExecutionPanelOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setIsPinnedToBottom(distanceFromBottom < 80);
  };

  useEffect(() => {
    if (bottomRef.current && isPinnedToBottom) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isStreaming, isPinnedToBottom]);

  const scrollToBottom = () => {
    setIsPinnedToBottom(true);
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const activeSessionObj = sessions.find((s) => s.id === conversationId);
  const hasMessages = messages.length > 0;

  return (
    <div className="flex h-full w-full bg-background overflow-hidden">
      {/* ── Main Conversation Stream Canvas ── */}
      <div className="flex-1 flex flex-col min-w-0 bg-background relative">
        {/* ── Unified View Header ── */}
        <header className="flex items-center justify-between px-6 py-4 bg-surface-1 border-b border-border/40 shrink-0">
          <div className="flex items-center gap-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 px-3 py-1.5 rounded-xl bg-surface-2 hover:bg-surface-3 transition-colors text-left border border-border/40 group">
                  <div className="p-1.5 rounded-lg bg-surface-3 text-brand">
                    <MessageSquare className="w-4 h-4" />
                  </div>
                  <div>
                    <h1 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-1.5">
                      <span className="truncate max-w-[220px] sm:max-w-[340px]">
                        {activeSessionObj?.title || 'Conversations'}
                      </span>
                      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground transition-transform" />
                    </h1>
                    <p className="text-[11px] text-muted-foreground font-mono">
                      {sessions.length} thread{sessions.length === 1 ? '' : 's'}
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-80 bg-surface-1 border-border/40 p-1.5 shadow-xl">
                <div className="flex items-center justify-between px-3 py-2 border-b border-border/40 mb-1">
                  <span className="text-[11px] font-mono font-semibold text-muted-foreground uppercase tracking-wider">
                    Thread Switcher
                  </span>
                  <button
                    onClick={startNewSession}
                    className="flex items-center gap-1 text-xs text-brand hover:underline font-mono"
                  >
                    <PlusCircle className="w-3.5 h-3.5" /> New Thread
                  </button>
                </div>
                <ScrollArea className="max-h-72">
                  <div className="flex flex-col gap-0.5 p-1">
                    {sessions.length === 0 ? (
                      <div className="text-xs text-muted-foreground text-center py-4 font-mono">
                        No threads found
                      </div>
                    ) : (
                      sessions.map((s) => (
                        <DropdownMenuItem
                          key={s.id}
                          onClick={() => loadSession(s.id)}
                          className={`flex items-center justify-between px-3 py-2 text-xs rounded-lg cursor-pointer group ${
                            s.id === conversationId
                              ? 'bg-surface-3 text-foreground font-semibold border-l-2 border-brand'
                              : 'text-muted-foreground hover:text-foreground hover:bg-surface-2'
                          }`}
                        >
                          <span className="truncate flex-1 font-sans">{s.title || 'Untitled Thread'}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSessionToDelete(s.id);
                            }}
                            className="opacity-0 group-hover:opacity-100 hover:text-destructive p-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </DropdownMenuItem>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={startNewSession}
              size="sm"
              variant="outline"
              className="gap-1.5 h-8 text-xs border-border/40 bg-surface-2"
              title="Start a new chat thread"
            >
              <PlusCircle className="w-3.5 h-3.5 text-brand" />
              New Thread
            </Button>

            {/* Approval Mode Switcher */}
            <div className="flex items-center gap-2">
              <div className="flex items-center bg-surface-2 rounded-lg p-0.5 border border-border/40 font-mono">
                <button
                  type="button"
                  onClick={() => setApprovalMode('ask')}
                  className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                    approvalMode === 'ask'
                      ? 'bg-surface-3 text-foreground font-semibold'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Ask
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (approvalMode === 'accept-edits') return;
                    setConfirmAutoApprove(true);
                  }}
                  className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                    approvalMode === 'accept-edits'
                      ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 font-semibold'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Auto-Approve
                </button>
              </div>
              {approvalMode === 'accept-edits' && (
                <span
                  className="flex items-center gap-1 text-[10px] font-mono text-amber-600 dark:text-amber-400 whitespace-nowrap"
                  title="The approval gate is bypassed: sensitive reads, network requests, and destructive operations run without confirmation until you switch back to Ask."
                >
                  <ShieldAlert className="w-3 h-3" />
                  gate off — runs without confirmation
                </span>
              )}
            </div>

            <Button
              variant="outline"
              size="sm"
              className={`h-8 px-3 text-xs rounded-lg border-border/40 ${
                isExecutionPanelOpen
                  ? 'bg-surface-3 text-brand border-brand/50'
                  : 'bg-surface-2 text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setIsExecutionPanelOpen(!isExecutionPanelOpen)}
              title="Toggle Execution Panel (Ctrl+E)"
            >
              <Activity className="w-3.5 h-3.5 mr-1.5" />
              Executions
            </Button>

            {isStreaming && (
              <div className="flex items-center gap-1.5 text-xs text-brand font-mono px-2 py-1 rounded bg-brand/10">
                <span className="w-1.5 h-1.5 rounded-full bg-brand status-pulse" />
                Thinking
              </div>
            )}
          </div>
        </header>

        {/* Empty state: goal-first hero with the composer centered.
            With messages: normal scrollable stream + composer pinned to the bottom. */}
        {!hasMessages ? (
          <div className="flex-1 min-h-0 overflow-y-auto relative">
            <div className="min-h-full flex flex-col items-center justify-center px-6 py-10 relative">
              <div className="w-full max-w-2xl flex flex-col items-center">
                <div className="flex items-center gap-2.5 mb-6">
                  <img src={logoLight} alt="Weave" className="w-8 h-8 dark:hidden" />
                  <img src={logoDark} alt="Weave" className="w-8 h-8 hidden dark:block" />
                  <span className="font-display text-sm font-semibold tracking-[0.22em] uppercase text-foreground">
                    Weave
                  </span>
                </div>
                <h2 className="font-display text-4xl font-bold tracking-tight text-foreground text-center mb-3">
                  What is your goal?
                </h2>
                <p className="text-sm text-muted-foreground text-center mb-9">
                  State a goal — Weave plans, then executes it.
                </p>

                <div className="w-full mb-6">
                  <ChatInput />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full">
                  {SUGGESTED_PROMPTS.map((p, i) => (
                    <button
                      key={i}
                      type="button"
                      className="lift group flex flex-col gap-1.5 p-3.5 rounded-xl bg-surface-1 hover:bg-surface-2 text-left"
                      onClick={() => useChatStore.getState().sendMessage(p.prompt)}
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="p-1.5 rounded-lg bg-surface-2 group-hover:bg-surface-3 text-muted-foreground group-hover:text-brand transition-colors">
                          <p.icon className="w-4 h-4" />
                        </div>
                        <span className="text-[13px] font-medium text-foreground">{p.text}</span>
                      </div>
                      <p className="text-xs text-muted-foreground pl-[34px] line-clamp-1">
                        {p.desc}
                      </p>
                      <div className="flex flex-wrap gap-1 pl-[34px]">
                        {p.chips.map((chip) => (
                          <span
                            key={chip}
                            className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-3/70 text-muted-foreground"
                          >
                            {chip}
                          </span>
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <ScrollArea className="flex-1 min-h-0">
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="flex flex-col max-w-4xl mx-auto w-full min-w-0 p-4 sm:p-6"
            >
              <div className="py-2 space-y-4">
                {messages
                  .filter((m) => !m.metadata?.isHidden)
                  .map((msg, index, arr) => (
                    <ChatMessage
                      key={msg.id}
                      message={msg}
                      isLast={index === arr.length - 1}
                    />
                  ))}
                <div ref={bottomRef} className="h-4" />
              </div>
            </div>
          </ScrollArea>
        )}

        {!isPinnedToBottom && (
          <div className="relative">
            <button
              type="button"
              onClick={scrollToBottom}
              className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center justify-center w-7 h-7 rounded-full bg-card border border-border text-foreground hover:bg-muted transition-colors"
            >
              <ArrowDown className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Composer — pinned to the bottom once a conversation exists */}
        {hasMessages && (
          <div className="flex-shrink-0">
            <ApprovalBanner />
            <ChatInput />
          </div>
        )}

        {/* Bottom Drawer for ExecutionPanel */}
        {isExecutionPanelOpen && (
          <div className="h-[40vh] min-h-[300px] flex flex-col bg-surface-1 animate-in slide-in-from-bottom-2">
            <div className="h-8 flex items-center justify-between px-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground flex items-center gap-1.5">
                <Activity className="w-3 h-3" />
                Execution Workspace
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="w-5 h-5 text-muted-foreground hover:text-foreground"
                onClick={() => setIsExecutionPanelOpen(false)}
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <ExecutionPanel />
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!sessionToDelete}
        onOpenChange={(open) => !open && setSessionToDelete(null)}
        title="Delete thread?"
        description="This conversation will be permanently removed. This action cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (sessionToDelete) deleteSession(sessionToDelete);
        }}
      />

      <ConfirmDialog
        open={confirmAutoApprove}
        onOpenChange={setConfirmAutoApprove}
        title="Bypass the approval gate?"
        description="In Auto-Approve mode, sensitive reads, network requests, and destructive operations run without confirmation. The mode persists across restarts — a startup notice will remind you each session. Switch back to Ask anytime."
        confirmLabel="Enable Auto-Approve"
        onConfirm={() => {
          setApprovalMode('accept-edits');
        }}
      />
    </div>
  );
}
