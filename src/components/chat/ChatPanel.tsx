import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '@/stores/useChatStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { useChatStream } from '@/hooks/useChatStream';
import {
  Bot,
  History,
  PlusCircle,
  FolderOpen,
  Calculator,
  FileText,
  LayoutGrid,
  Workflow,
  Cpu,
  Loader2,
  ArrowDown,
  ShieldCheck,
  ShieldQuestion,
  Check,
  Minimize2,
  Sparkles,
  Bug,
  HelpCircle,
  Code2,
  FileCode,
  Copy,
  X,
} from 'lucide-react';
import { ChatHistorySidebar } from './ChatHistorySidebar';

import { useAppStore } from '@/stores/useAppStore';
import { useApprovalModeStore } from '@/stores/useApprovalModeStore';
import { Button } from '@/components/ui/button';
import { PlayCircle } from 'lucide-react';
const SUGGESTED_PROMPTS = [
  {
    category: 'Filesystem',
    text: 'List files in current directory',
    icon: FolderOpen,
    desc: 'Browse workspace files & folders',
    badge: 'bg-muted/80 text-muted-foreground border-border/60',
  },
  {
    category: 'Math & Calc',
    text: 'Calculate sqrt(144) + 42 * 18',
    icon: Calculator,
    desc: 'High precision calculations & conversions',
    badge: 'bg-muted/80 text-muted-foreground border-border/60',
  },
  {
    category: 'Workspace',
    text: 'Create a note summarizing my current ideas',
    icon: FileText,
    desc: 'Save ideas directly into your notes',
    badge: 'bg-muted/80 text-muted-foreground border-border/60',
  },
  {
    category: 'AI Canvas',
    text: 'Create a canvas node with architectural diagram',
    icon: LayoutGrid,
    desc: 'Autonomously build visual layouts',
    badge: 'bg-muted/80 text-muted-foreground border-border/60',
  },
  {
    category: 'Workflow',
    text: 'List available automated workflows',
    icon: Workflow,
    desc: 'Execute multi-step AI pipelines',
    badge: 'bg-muted/80 text-muted-foreground border-border/60',
  },
  {
    category: 'System',
    text: 'What is Weave and how do I use plugins?',
    icon: Cpu,
    desc: 'Learn about your agentic assistant',
    badge: 'bg-muted/80 text-muted-foreground border-border/60',
  },
];

export function ChatPanel({
  isFloating = false,
  isAgentVariant = false,
  isDocked = false,
  selectedFile,
  onCodeAction,
}: {
  isFloating?: boolean;
  isAgentVariant?: boolean;
  isDocked?: boolean;
  selectedFile?: { name: string; path: string; type: string } | null;
  onCodeAction?: (type: 'explain' | 'bugs' | 'refactor') => void;
}) {
  const { messages, isStreaming, startNewSession } = useChatStore();
  const isChatExpanded = useAppStore((s) => s.isChatExpanded);
  const [showHistory, setShowHistory] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);
  const approvalMode = useApprovalModeStore((s) => s.mode);
  const setApprovalMode = useApprovalModeStore((s) => s.setMode);

  useChatStream();

  // Track whether the user is near the bottom of the scroll area.
  // While streaming, we only auto-scroll if the user hasn't scrolled up to read history.
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

  useEffect(() => {
    useChatStore.getState().loadHistory();
  }, []);

  const toggleChat = useAppStore((s) => s.toggleChat);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isFloating && isChatExpanded && e.key === 'Escape') {
        toggleChat(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFloating, isChatExpanded, toggleChat]);

  const hasMessages = messages.length > 0;

  if (isFloating && !isChatExpanded) {
    if (isAgentVariant) {
      return (
        <div
          className="w-full h-full flex items-center px-3 sm:px-3.5 cursor-pointer bg-gradient-to-r from-card/95 to-card/85 hover:from-primary/15 hover:to-card/95 transition-all group rounded-full select-none"
          onClick={() => toggleChat(true)}
          title="Open Weave AI Agent Panel (⌘J / Ctrl+J)"
        >
          <div className="flex items-center gap-2 w-full min-w-0">
            <div className="w-6 sm:w-7 h-6 sm:h-7 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center group-hover:scale-110 group-hover:bg-primary group-hover:text-primary-foreground text-primary transition-all shrink-0 shadow-sm">
              <Bot className="w-3.5 sm:w-4 h-3.5 sm:h-4 animate-pulse" />
            </div>
            <span className="text-foreground/90 group-hover:text-foreground text-xs font-bold flex-1 truncate tracking-tight transition-colors">
              Weave Agent
            </span>
            <div className="flex items-center gap-0.5 text-[10px] text-muted-foreground group-hover:text-primary font-mono font-bold uppercase bg-background/80 px-2 py-0.5 rounded-full border border-border/60 shadow-xs shrink-0 transition-all">
              <span>⌘J</span>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div
        className="w-full h-full flex items-center px-4 cursor-pointer bg-card/50 hover:bg-muted/50 transition-colors group rounded-2xl"
        onClick={() => toggleChat(true)}
      >
        <div className="flex items-center gap-3 w-full">
          <Bot className="w-5 h-5 text-primary/80 group-hover:text-primary transition-colors" />
          <span className="text-muted-foreground/70 group-hover:text-muted-foreground text-sm flex-1 font-medium transition-colors">
            Ask Weave anything...
          </span>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-semibold uppercase tracking-widest bg-background/50 px-2 py-1 rounded border border-border/50 shadow-sm opacity-60 group-hover:opacity-100 transition-opacity">
            <kbd className="font-sans">Ctrl</kbd>+<kbd className="font-sans">J</kbd>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex h-full overflow-hidden ${isDocked ? 'w-full bg-transparent border-0 rounded-none' : !isFloating ? 'border border-border/40 bg-card shadow-sm rounded-2xl' : 'w-full rounded-2xl'}`}
    >
      {/* ── Sidebar ── */}
      {showHistory && <ChatHistorySidebar onClose={() => setShowHistory(false)} />}

      {/* ── Main Chat Area ── */}
      <div className="flex flex-col flex-1 min-w-0">
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden transition-all duration-300">
          {/* ── Toolbar ── */}
          <div className={`flex items-center justify-between px-3.5 flex-shrink-0 gap-2 border-b border-border/40 bg-card/80 backdrop-blur-md z-10 ${isDocked ? 'h-11 rounded-none bg-muted/30' : 'h-12 rounded-t-2xl'}`}>
            <div className="flex items-center gap-2 min-w-0">
              {isDocked ? (
                <div className="flex items-center gap-2 min-w-0 pr-2">
                  <Sparkles className="w-3.5 h-3.5 text-primary shrink-0 animate-pulse" />
                  <span className="text-xs font-bold tracking-wide uppercase text-foreground truncate font-sans">
                    Weave Agent
                  </span>
                  <span className="text-[10px] font-mono bg-green-500/10 text-green-500 px-1.5 py-0.5 rounded-full shrink-0 border border-green-500/20">
                    Active
                  </span>
                </div>
              ) : isFloating && isAgentVariant ? (
                <div className="flex items-center gap-2 pr-2 border-r border-border/40 min-w-0 shrink-0">
                  <div className="w-6 h-6 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
                    <Bot className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <span className="text-xs font-bold tracking-wide uppercase text-foreground truncate hidden sm:inline">
                    Weave Agent
                  </span>
                </div>
              ) : null}
              <button
                type="button"
                title="Toggle History"
                onClick={() => setShowHistory((prev) => !prev)}
                className={`flex items-center justify-center w-7 h-7 rounded-lg transition-all duration-200 bg-transparent border-0 shadow-none shrink-0 ${showHistory ? 'text-primary scale-105' : 'text-muted-foreground hover:text-foreground hover:scale-105'} active:scale-95`}
              >
                <History className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {/* Approval Mode Switcher */}
              <div
                role="group"
                aria-label="Edit approval mode"
                className="flex items-center bg-muted/50 rounded-md p-0.5 border border-border"
              >
                <button
                  type="button"
                  onClick={() => setApprovalMode('ask')}
                  title="Ask mode — confirm each file-changing action before it runs"
                  aria-pressed={approvalMode === 'ask'}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    approvalMode === 'ask'
                      ? 'bg-foreground text-background font-semibold'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <ShieldQuestion className="w-3.5 h-3.5 shrink-0" />
                  <span>Ask</span>
                </button>
                <button
                  type="button"
                  onClick={() => setApprovalMode('accept-edits')}
                  title="Accept Edits mode — auto-approve file changes for this session"
                  aria-pressed={approvalMode === 'accept-edits'}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    approvalMode === 'accept-edits'
                      ? 'bg-foreground text-background font-semibold'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                  <span>Auto-Approve</span>
                </button>
              </div>

              {isStreaming && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-semibold animate-pulse">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span className={isFloating && isAgentVariant ? 'hidden' : 'inline'}>Thinking...</span>
                </div>
              )}
              {!isStreaming && (
                <button
                  type="button"
                  title="Start a new chat session"
                  onClick={startNewSession}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-transparent border-0 shadow-none text-muted-foreground hover:text-foreground transition-all duration-200 active:scale-95 cursor-pointer"
                >
                  <PlusCircle className="w-3.5 h-3.5 shrink-0" />
                  <span className={isFloating && isAgentVariant ? 'hidden' : 'hidden sm:inline'}>New Chat</span>
                </button>
              )}
              {isFloating && !isDocked && (
                <button
                  type="button"
                  title="Minimize chat (Ctrl+J or Esc)"
                  onClick={() => toggleChat(false)}
                  className="flex items-center justify-center w-7 h-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-all duration-200 active:scale-95 cursor-pointer ml-0.5 shrink-0"
                >
                  <Minimize2 className="w-4 h-4" />
                </button>
              )}
              {isDocked && (
                <button
                  type="button"
                  title="Close Weave Agent Sidebar (Ctrl+J)"
                  onClick={() => toggleChat(false)}
                  className="flex items-center justify-center w-7 h-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-all duration-200 active:scale-95 cursor-pointer ml-0.5 shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* ── Messages ── */}
          <ScrollArea className="flex-1 min-h-0">
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="flex flex-col max-w-4xl mx-auto w-full min-w-0 pr-3 sm:pr-4"
            >
              {!hasMessages ? (
                isDocked ? (
                  <DockedEmptyState selectedFile={selectedFile} onCodeAction={onCodeAction} />
                ) : (
                  <EmptyState />
                )
              ) : (
                <div className="py-2 space-y-4">
                  {messages
                    .filter((m) => !m.metadata?.isHidden)
                    .map((msg, index, arr) => {
                      let isConsecutive = false;
                      if (index > 0) {
                        const prevMsg = arr[index - 1];
                        const prevIsFakeTool =
                          prevMsg.role === 'user' &&
                          prevMsg.content.startsWith('Tool ') &&
                          prevMsg.content.includes(' returned:');
                        const currentIsFakeTool =
                          msg.role === 'user' &&
                          msg.content.startsWith('Tool ') &&
                          msg.content.includes(' returned:');

                        const prevEffectiveRole = prevIsFakeTool ? 'assistant' : prevMsg.role;
                        const currentEffectiveRole = currentIsFakeTool ? 'assistant' : msg.role;

                        if (prevEffectiveRole === currentEffectiveRole) {
                          isConsecutive = true;
                        }
                      }

                      return (
                        <ChatMessage
                          key={msg.id}
                          message={msg}
                          isLast={index === arr.length - 1}
                          isConsecutive={isConsecutive}
                        />
                      );
                    })}
                  {isStreaming &&
                    (messages[messages.length - 1]?.role === 'user' ||
                      (messages[messages.length - 1]?.role === 'assistant' &&
                        messages[messages.length - 1]?.content === '')) && (
                      <div className="flex items-start gap-3.5 px-4 sm:px-6 py-3 animate-fade-in">
                        <div className="w-8 h-8 rounded-xl border bg-gradient-to-br from-blue-500/10 via-indigo-500/10 to-purple-500/10 text-primary border-primary/20 flex items-center justify-center flex-shrink-0 shadow-sm">
                          <Bot className="w-4 h-4 text-indigo-500 dark:text-indigo-400 stroke-[2.5]" />
                        </div>
                        <div className="flex flex-col gap-1.5 mt-0.5">
                          <div className="flex items-center gap-2">
                            <span className="text-xs sm:text-sm font-bold text-foreground">Weave AI</span>
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 shadow-2xs animate-pulse font-sans">
                              <Sparkles className="w-3 h-3 text-purple-500 animate-spin" /> Thinking...
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-1.5">
                            <span className="w-2 h-2 rounded-full bg-primary/70 animate-bounce" style={{ animationDelay: '0ms' }} />
                            <span className="w-2 h-2 rounded-full bg-primary/70 animate-bounce" style={{ animationDelay: '150ms' }} />
                            <span className="w-2 h-2 rounded-full bg-primary/70 animate-bounce" style={{ animationDelay: '300ms' }} />
                          </div>
                        </div>
                      </div>
                    )}
                  <div ref={bottomRef} className="h-4" />
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Scroll-to-bottom button — only when the user has scrolled up during/after streaming */}
          {!isPinnedToBottom && (
            <div className="relative">
              <button
                type="button"
                onClick={scrollToBottom}
                aria-label="Scroll to latest message"
                title="Scroll to latest"
                className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center justify-center w-8 h-8 rounded-full bg-card border border-border shadow-lg text-foreground hover:bg-muted transition-colors"
              >
                <ArrowDown className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* ── Approval Banner ── */}
        {(() => {
          const pendingApprovals = messages.flatMap((m) =>
            (m.metadata?.plugin_calls || [])
              .filter((c) => c.status === 'pending_approval')
              .map((c) => ({ messageId: m.id, call: c }))
          );
          if (pendingApprovals.length === 0) return null;

          const handleAcceptAll = () => {
            pendingApprovals.forEach(({ messageId, call }) => {
              useChatStore.getState().executeToolCall(messageId, call.capability, true);
            });
          };

          const handleAcceptAllForSession = () => {
            // Switch to Accept Edits mode so subsequent destructive calls run without prompting,
            // then approve the currently pending batch.
            useApprovalModeStore.getState().setMode('accept-edits');
            handleAcceptAll();
          };

          const handleRejectAll = () => {
            pendingApprovals.forEach(({ messageId, call }) => {
              useChatStore.getState().executeToolCall(messageId, call.capability, false);
            });
          };

          return (
            <div className="mx-4 mb-2 p-3 bg-card border border-border rounded-xl shadow-lg flex items-center justify-between animate-in slide-in-from-bottom-2 fade-in duration-200">
              <div className="flex items-center gap-2 text-sm text-foreground min-w-0">
                <PlayCircle className="w-4 h-4 text-orange-500 animate-pulse flex-shrink-0" />
                <span className="font-medium">
                  AI wants to run {pendingApprovals.length} tool
                  {pendingApprovals.length > 1 ? 's' : ''}.
                </span>
                <span className="text-muted-foreground text-xs ml-1 hidden sm:inline">
                  (Files will be changed)
                </span>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <Button
                  size="sm"
                  variant="default"
                  className="h-8 bg-green-600 hover:bg-green-700 text-white shadow-sm gap-1.5"
                  onClick={handleAcceptAll}
                  title="Approve this batch only"
                >
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 border-green-300 text-green-700 hover:bg-green-50 hover:text-green-800 dark:border-green-500/40 dark:text-green-400 dark:hover:bg-green-500/10"
                  onClick={handleAcceptAllForSession}
                  title="Approve this batch and auto-approve file edits for the rest of the session"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Accept All Edits</span>
                  <span className="sm:hidden">All</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-red-500 border-red-200 hover:bg-red-50 hover:text-red-600"
                  onClick={handleRejectAll}
                >
                  Reject
                </Button>
              </div>
            </div>
          );
        })()}

        {/* ── Input ── */}
        <div className="flex-shrink-0 bg-transparent rounded-b-2xl">
          <ChatInput />
        </div>
      </div>
    </div>
  );
}

import logoLight from '@/assets/weave-logo/light-mode.svg';
import logoDark from '@/assets/weave-logo/dark-mode.svg';

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center min-h-0 my-auto px-4 sm:px-6 py-4 animate-in fade-in zoom-in-95 duration-500 max-w-full overflow-y-auto">
      {/* Logo Badge (No Glow) */}
      <div className="mb-3 sm:mb-4 w-12 h-12 sm:w-14 sm:h-14 p-2.5 rounded-2xl bg-card border border-border shadow-sm flex items-center justify-center transform hover:scale-105 transition-transform duration-300">
        <img src={logoLight} alt="Weave" className="w-full h-full object-contain dark:hidden" />
        <img
          src={logoDark}
          alt="Weave"
          className="w-full h-full object-contain hidden dark:block"
        />
      </div>

      <h2 className="text-xl sm:text-2xl font-extrabold mb-1 text-foreground text-center tracking-tight">
        Welcome to Weave AI
      </h2>
      <p className="text-xs sm:text-sm text-muted-foreground text-center max-w-md mb-5 leading-relaxed">
        Your next-generation autonomous workspace. Execute workflows, analyze code, manage files,
        and design on canvas.
      </p>

      {/* Suggestion grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 w-full max-w-3xl">
        {SUGGESTED_PROMPTS.map((p, i) => (
          <button
            key={i}
            type="button"
            className="group relative flex flex-col justify-between p-3 rounded-xl border border-border/70 bg-card/60 hover:bg-card text-left transition-all duration-300 shadow-sm hover:shadow-md hover:border-primary/40 hover:-translate-y-0.5 overflow-hidden min-w-0"
            onClick={() => useChatStore.getState().sendMessage(p.text)}
          >
            <div className="flex items-center justify-between gap-1.5 mb-1.5 min-w-0">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className="p-1.5 rounded-lg bg-muted/60 text-foreground group-hover:text-primary transition-colors flex-shrink-0">
                  <p.icon className="w-4 h-4 stroke-[2]" />
                </div>
                <span className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                  {p.text}
                </span>
              </div>
              <span
                className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border whitespace-nowrap flex-shrink-0 ${p.badge}`}
              >
                {p.category}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground/80 pl-7 line-clamp-1 leading-relaxed">
              {p.desc}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

function DockedEmptyState({
  selectedFile,
  onCodeAction,
}: {
  selectedFile?: { name: string; path: string; type: string } | null;
  onCodeAction?: (type: 'explain' | 'bugs' | 'refactor') => void;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-col min-h-0 my-auto px-4 py-5 animate-in fade-in zoom-in-95 duration-400 max-w-full">
      {/* Subtle Greeting */}
      <div className="flex items-center gap-2.5 mb-2">
        <div className="w-8 h-8 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 shadow-sm">
          <Sparkles className="w-4 h-4 text-primary animate-pulse" />
        </div>
        <div>
          <h2 className="text-sm font-extrabold text-foreground tracking-tight font-sans">Weave AI IDE Assistant</h2>
          <p className="text-[11px] text-muted-foreground">Autonomous context & code intelligence</p>
        </div>
      </div>

      {/* Selected File Context Chip if available */}
      {selectedFile && selectedFile.type !== 'directory' ? (
        <div className="my-3 p-2.5 rounded-xl border border-primary/30 bg-primary/5 flex items-center justify-between gap-2 shadow-sm">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-1.5 rounded-lg bg-primary/10 text-primary shrink-0">
              <FileCode className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold text-foreground truncate font-mono">{selectedFile.name}</div>
              <div className="text-[10px] font-mono text-muted-foreground truncate opacity-80">{selectedFile.path}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(selectedFile.path);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="p-1.5 rounded-md hover:bg-primary/15 text-muted-foreground hover:text-primary transition-colors shrink-0 cursor-pointer"
            title="Copy file path"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      ) : (
        <div className="my-3 p-2.5 rounded-xl border border-border/60 bg-muted/30 flex items-center gap-2 text-xs text-muted-foreground">
          <FolderOpen className="w-4 h-4 shrink-0 text-muted-foreground/80" />
          <span>No file active. Select a file in the tree to unlock contextual code actions.</span>
        </div>
      )}

      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mt-2 mb-2 px-0.5">
        Code Intelligence Actions
      </div>

      {/* Clean 1-Column Action List (Zero Squishing) */}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => {
            if (onCodeAction && selectedFile && selectedFile.type !== 'directory') {
              onCodeAction('explain');
            } else {
              useChatStore.getState().sendMessage('Explain the project structure and main architectural patterns in this codebase.');
            }
          }}
          className="group flex items-start gap-3 p-3 rounded-xl border border-border/70 bg-card/40 hover:bg-card hover:border-blue-500/40 text-left transition-all duration-200 shadow-sm hover:shadow cursor-pointer min-w-0"
        >
          <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500 group-hover:bg-blue-500 group-hover:text-white transition-colors shrink-0 mt-0.5 shadow-sm">
            <HelpCircle className="w-4 h-4 stroke-[2]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold text-foreground group-hover:text-blue-500 transition-colors truncate">
              {selectedFile && selectedFile.type !== 'directory' ? `Explain "${selectedFile.name}"` : 'Explain Project Architecture'}
            </div>
            <div className="text-[11px] text-muted-foreground/90 line-clamp-1 mt-0.5 leading-relaxed">
              Summarize logic, dependencies, and key patterns
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            if (onCodeAction && selectedFile && selectedFile.type !== 'directory') {
              onCodeAction('bugs');
            } else {
              useChatStore.getState().sendMessage('Scan the workspace for potential security vulnerabilities, race conditions, or performance bottlenecks.');
            }
          }}
          className="group flex items-start gap-3 p-3 rounded-xl border border-border/70 bg-card/40 hover:bg-card hover:border-red-500/40 text-left transition-all duration-200 shadow-sm hover:shadow cursor-pointer min-w-0"
        >
          <div className="p-2 rounded-lg bg-red-500/10 text-red-500 group-hover:bg-red-500 group-hover:text-white transition-colors shrink-0 mt-0.5 shadow-sm">
            <Bug className="w-4 h-4 stroke-[2]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold text-foreground group-hover:text-red-500 transition-colors truncate">
              {selectedFile && selectedFile.type !== 'directory' ? `Scan "${selectedFile.name}" for Bugs` : 'Scan Workspace for Risks'}
            </div>
            <div className="text-[11px] text-muted-foreground/90 line-clamp-1 mt-0.5 leading-relaxed">
              Analyze edge cases, memory leaks, and vulnerabilities
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            if (onCodeAction && selectedFile && selectedFile.type !== 'directory') {
              onCodeAction('refactor');
            } else {
              useChatStore.getState().sendMessage('Suggest clean code refactorings, design improvements, or generate boilerplate unit tests.');
            }
          }}
          className="group flex items-start gap-3 p-3 rounded-xl border border-border/70 bg-card/40 hover:bg-card hover:border-green-500/40 text-left transition-all duration-200 shadow-sm hover:shadow cursor-pointer min-w-0"
        >
          <div className="p-2 rounded-lg bg-green-500/10 text-green-500 group-hover:bg-green-500 group-hover:text-white transition-colors shrink-0 mt-0.5 shadow-sm">
            <Code2 className="w-4 h-4 stroke-[2]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold text-foreground group-hover:text-green-500 transition-colors truncate">
              {selectedFile && selectedFile.type !== 'directory' ? `Refactor "${selectedFile.name}"` : 'Suggest Refactor & Tests'}
            </div>
            <div className="text-[11px] text-muted-foreground/90 line-clamp-1 mt-0.5 leading-relaxed">
              Apply best practices and generate test coverage
            </div>
          </div>
        </button>
      </div>
    </div>
  );
}

