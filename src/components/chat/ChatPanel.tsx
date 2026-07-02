import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '@/stores/useChatStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { useChatStream } from '@/hooks/useChatStream';
import { Bot, History, PlusCircle, FolderOpen, Calculator, FileText, LayoutGrid, Workflow, Cpu, Loader2 } from 'lucide-react';
import { ChatHistorySidebar } from './ChatHistorySidebar';

import { useAppStore } from '@/stores/useAppStore';
import { Button } from '@/components/ui/button';
import { PlayCircle } from 'lucide-react';

const SUGGESTED_PROMPTS = [
  { category: 'Filesystem', text: 'List files in current directory', icon: FolderOpen, desc: 'Browse workspace files & folders', badge: 'bg-muted/80 text-muted-foreground border-border/60' },
  { category: 'Math & Calc', text: 'Calculate sqrt(144) + 42 * 18', icon: Calculator, desc: 'High precision calculations & conversions', badge: 'bg-muted/80 text-muted-foreground border-border/60' },
  { category: 'Workspace', text: 'Create a note summarizing my current ideas', icon: FileText, desc: 'Save ideas directly into your notes', badge: 'bg-muted/80 text-muted-foreground border-border/60' },
  { category: 'AI Canvas', text: 'Create a canvas node with architectural diagram', icon: LayoutGrid, desc: 'Autonomously build visual layouts', badge: 'bg-muted/80 text-muted-foreground border-border/60' },
  { category: 'Workflow', text: 'List available automated workflows', icon: Workflow, desc: 'Execute multi-step AI pipelines', badge: 'bg-muted/80 text-muted-foreground border-border/60' },
  { category: 'System', text: 'What is Weave and how do I use plugins?', icon: Cpu, desc: 'Learn about your agentic assistant', badge: 'bg-muted/80 text-muted-foreground border-border/60' },
];

export function ChatPanel({ isFloating = false }: { isFloating?: boolean }) {
  const { messages, isStreaming, startNewSession } = useChatStore();
  const isChatExpanded = useAppStore(s => s.isChatExpanded);
  const [showHistory, setShowHistory] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useChatStream();

  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isStreaming]);

  useEffect(() => {
    useChatStore.getState().loadHistory();
  }, []);

  const hasMessages = messages.length > 0;

  const toggleChat = useAppStore(s => s.toggleChat);

  if (isFloating && !isChatExpanded) {
    return (
      <div 
        className="w-full h-full flex items-center px-4 cursor-pointer bg-card/50 hover:bg-muted/50 transition-colors group"
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
    <div className="flex h-full overflow-hidden">
      {/* ── Sidebar ── */}
      {showHistory && (
        <ChatHistorySidebar onClose={() => setShowHistory(false)} />
      )}
      
      {/* ── Main Chat Area ── */}
      <div className="flex flex-col flex-1 min-w-0">
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden transition-all duration-300">
          {/* ── Toolbar ── */}
          <div className="flex items-center justify-between h-12 px-4 flex-shrink-0 gap-3 border-b border-border/40 bg-card/40 backdrop-blur-md z-10">
            <div className="flex items-center gap-2">
              <button
                type="button"
                title="Toggle History"
                onClick={() => setShowHistory(prev => !prev)}
                className={`flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-200 bg-transparent border-0 shadow-none ${showHistory ? 'text-primary scale-105' : 'text-muted-foreground hover:text-foreground hover:scale-105'} active:scale-95`}
              >
                <History className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              {isStreaming && (
                <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-semibold animate-pulse">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Thinking...
                </div>
              )}
              {!isStreaming && (
                <button
                  type="button"
                  title="Start a new chat session"
                  onClick={startNewSession}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-transparent border-0 shadow-none text-muted-foreground hover:text-foreground transition-all duration-200 active:scale-95 cursor-pointer"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">New Chat</span>
                </button>
              )}
            </div>
          </div>

      {/* ── Messages ── */}
      <ScrollArea className="flex-1 min-h-0" ref={scrollRef}>
        <div className="flex flex-col max-w-4xl mx-auto w-full">
          {!hasMessages ? (
            <EmptyState />
          ) : (
            <div className="py-2 space-y-4">
              {messages.filter(m => !m.metadata?.isHidden).map((msg, index, arr) => {
                let isConsecutive = false;
                if (index > 0) {
                  const prevMsg = arr[index - 1];
                  const prevIsFakeTool = prevMsg.role === 'user' && prevMsg.content.startsWith('Tool ') && prevMsg.content.includes(' returned:');
                  const currentIsFakeTool = msg.role === 'user' && msg.content.startsWith('Tool ') && msg.content.includes(' returned:');
                  
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
                messages[messages.length - 1]?.role === 'assistant' &&
                messages[messages.length - 1]?.content === '' && (
                  <div className="flex items-start gap-4 px-5 py-3">
                    <div className="w-8 h-8 rounded-md border bg-muted flex items-center justify-center flex-shrink-0">
                      <Bot className="w-4 h-4" />
                    </div>
                    <div className="flex gap-1 mt-2">
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                    </div>
                  </div>
                )}
              <div ref={bottomRef} className="h-4" />
            </div>
          )}
        </div>
        </ScrollArea>
        </div>

        {/* ── Approval Banner ── */}
        {(() => {
          const pendingApprovals = messages.flatMap(m => 
            (m.metadata?.plugin_calls || []).filter(c => c.status === 'pending_approval').map(c => ({ messageId: m.id, call: c }))
          );
          if (pendingApprovals.length === 0) return null;

          const handleAcceptAll = () => {
            pendingApprovals.forEach(({ messageId, call }) => {
              useChatStore.getState().executeToolCall(messageId, call.capability, true);
            });
          };

          const handleRejectAll = () => {
            pendingApprovals.forEach(({ messageId, call }) => {
              useChatStore.getState().executeToolCall(messageId, call.capability, false);
            });
          };

          return (
            <div className="mx-4 mb-2 p-3 bg-card border border-border rounded-xl shadow-lg flex items-center justify-between animate-in slide-in-from-bottom-2 fade-in duration-200">
              <div className="flex items-center gap-2 text-sm text-foreground">
                <PlayCircle className="w-4 h-4 text-orange-500 animate-pulse" />
                <span className="font-medium">AI wants to run {pendingApprovals.length} tool{pendingApprovals.length > 1 ? 's' : ''}.</span>
                <span className="text-muted-foreground text-xs ml-1 hidden sm:inline">(Files will be changed)</span>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="default" className="h-8 bg-green-600 hover:bg-green-700 text-white shadow-sm" onClick={handleAcceptAll}>
                  Accept
                </Button>
                <Button size="sm" variant="outline" className="h-8 text-red-500 border-red-200 hover:bg-red-50 hover:text-red-600" onClick={handleRejectAll}>
                  Reject
                </Button>
              </div>
            </div>
          );
        })()}

        {/* ── Input ── */}
        <div className="flex-shrink-0 bg-transparent">
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
    <div className="flex flex-col items-center justify-center min-h-[460px] px-6 py-8 animate-in fade-in zoom-in-95 duration-500">
      {/* Logo Badge (No Glow) */}
      <div className="mb-6 w-16 h-16 sm:w-20 sm:h-20 p-3.5 rounded-3xl bg-card border border-border shadow-md flex items-center justify-center transform hover:scale-105 transition-transform duration-300">
        <img src={logoLight} alt="Weave" className="w-full h-full object-contain dark:hidden" />
        <img src={logoDark} alt="Weave" className="w-full h-full object-contain hidden dark:block" />
      </div>

      <h2 className="text-2xl sm:text-3xl font-extrabold mb-2 text-foreground text-center tracking-tight">
        Welcome to Weave AI
      </h2>
      <p className="text-sm sm:text-base text-muted-foreground text-center max-w-md mb-8 leading-relaxed">
        Your next-generation autonomous workspace. Execute workflows, analyze code, manage files, and design on canvas.
      </p>

      {/* Suggestion grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 w-full max-w-4xl">
        {SUGGESTED_PROMPTS.map((p, i) => (
          <button
            key={i}
            type="button"
            className="group relative flex flex-col justify-between p-4 rounded-2xl border border-border/70 bg-card/60 hover:bg-card text-left transition-all duration-300 shadow-sm hover:shadow-lg hover:border-primary/40 hover:-translate-y-1 overflow-hidden"
            onClick={() => useChatStore.getState().sendMessage(p.text)}
          >
            <div className="flex items-start justify-between gap-2 mb-2.5">
              <div className="p-2 rounded-xl bg-muted/60 text-foreground group-hover:text-primary group-hover:scale-110 transition-all duration-300">
                <p.icon className="w-5 h-5 stroke-[2]" />
              </div>
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${p.badge}`}>
                {p.category}
              </span>
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-1">
                {p.text}
              </p>
              <p className="text-xs text-muted-foreground/80 mt-1 line-clamp-2 leading-relaxed">
                {p.desc}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
