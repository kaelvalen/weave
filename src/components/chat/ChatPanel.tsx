import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '@/stores/useChatStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { useChatStream } from '@/hooks/useChatStream';
import { Bot, Trash2, History } from 'lucide-react';
import { ChatHistorySidebar } from './ChatHistorySidebar';

const SUGGESTED_PROMPTS = [
  { text: 'List files in current directory', icon: '📁', desc: 'Browse filesystem' },
  { text: 'Calculate 42 * 18 + 7', icon: '🔢', desc: 'Math & conversions' },
  { text: 'Create a note about my ideas', icon: '📝', desc: 'Save notes' },
  { text: 'Convert 100 km to miles', icon: '🔄', desc: 'Unit conversion' },
  { text: 'What is sqrt(144) + 25?', icon: '🧮', desc: 'Calculation' },
];

export function ChatPanel() {
  const { messages, isStreaming, clearChat } = useChatStore();
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

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Sidebar ── */}
      {showHistory && (
        <ChatHistorySidebar onClose={() => setShowHistory(false)} />
      )}
      
      {/* ── Main Chat Area ── */}
      <div className="flex flex-col flex-1 min-w-0">
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
              {messages.filter(m => !m.metadata?.isHidden).map((msg, index, arr) => (
                <ChatMessage key={msg.id} message={msg} isLast={index === arr.length - 1} />
              ))}
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

      {/* ── Input ── */}
      <ChatInput />
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
