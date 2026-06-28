import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '@/stores/useChatStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { useChatStream } from '@/hooks/useChatStream';
import { Bot, Trash2, History } from 'lucide-react';
import { ChatHistorySidebar } from './ChatHistorySidebar';

import { useAppStore } from '@/stores/useAppStore';
import { Button } from '@/components/ui/button';
import { PlayCircle, XCircle } from 'lucide-react';

const SUGGESTED_PROMPTS = [
  { text: 'List files in current directory', icon: '📁', desc: 'Browse filesystem' },
  { text: 'Calculate 42 * 18 + 7', icon: '🔢', desc: 'Math & conversions' },
  { text: 'Create a note about my ideas', icon: '📝', desc: 'Save notes' },
  { text: 'Convert 100 km to miles', icon: '🔄', desc: 'Unit conversion' },
  { text: 'What is sqrt(144) + 25?', icon: '🧮', desc: 'Calculation' },
];

export function ChatPanel({ isFloating = false }: { isFloating?: boolean }) {
  const { messages, isStreaming, clearChat } = useChatStore();
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
          <div className="flex items-center justify-between h-10 px-4 flex-shrink-0 gap-2 border-b border-transparent">
          <div>
            <button
              type="button"
              title="Toggle History"
              onClick={() => setShowHistory(!showHistory)}
              className={`flex items-center justify-center w-7 h-7 rounded-md transition-colors ${showHistory ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'} active:scale-95`}
            >
              <History className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            {isStreaming && (
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Thinking...
              </div>
            )}
            {hasMessages && !isStreaming && (
              <button
                type="button"
                title="Clear chat"
                onClick={clearChat}
                className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
              >
                <Trash2 className="w-4 h-4" />
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

import { Loader2 } from 'lucide-react';

import logoLight from '@/assets/weave-logo/light-mode.svg';
import logoDark from '@/assets/weave-logo/dark-mode.svg';

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[420px] px-6">
      <div className="w-16 h-16 flex items-center justify-center mb-6">
        <img src={logoLight} alt="Weave" className="w-full h-full object-contain dark:hidden" />
        <img src={logoDark} alt="Weave" className="w-full h-full object-contain hidden dark:block" />
      </div>

      <h2 className="text-xl font-semibold mb-2 text-foreground">
        Welcome to Weave
      </h2>
      <p className="text-sm text-muted-foreground text-center max-w-sm mb-8">
        Your AI-powered workspace. Read files, calculate, take notes — just ask.
      </p>

      {/* Suggestion grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl">
        {SUGGESTED_PROMPTS.map((p, i) => (
          <button
            key={i}
            type="button"
            className="flex items-start gap-3 p-3 rounded-lg border bg-card text-left transition-colors hover:bg-muted"
            onClick={() => useChatStore.getState().sendMessage(p.text)}
          >
            <span className="text-xl flex-shrink-0">{p.icon}</span>
            <div className="min-w-0 mt-0.5">
              <p className="text-sm font-medium text-foreground truncate">
                {p.text}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{p.desc}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
