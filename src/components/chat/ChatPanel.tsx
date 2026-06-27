import { useEffect, useRef } from 'react';
import { useChatStore } from '@/stores/useChatStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { useChatStream } from '@/hooks/useChatStream';
import { Bot, Trash2, Sparkles } from 'lucide-react';

const SUGGESTED_PROMPTS = [
  { text: 'List files in current directory', icon: '📁' },
  { text: 'Calculate 42 * 18 + 7', icon: '🔢' },
  { text: 'Create a note about my ideas', icon: '📝' },
  { text: 'Convert 100 km to miles', icon: '🔄' },
  { text: 'What is sqrt(144) + 25?', icon: '🧮' },
];

export function ChatPanel() {
  const { messages, isStreaming, clearChat } = useChatStore();
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
    <div className="flex flex-col h-full bg-gradient-chat">
      {/* Minimal Header — clear button and streaming indicator only */}
      <div className="flex items-center justify-end h-10 px-4 flex-shrink-0">
        {isStreaming && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground animate-pulse">
            <Sparkles className="w-3 h-3" />
            Thinking...
          </span>
        )}
        {hasMessages && !isStreaming && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={clearChat}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      {/* Messages Area */}
      <ScrollArea className="flex-1 min-h-0" ref={scrollRef}>
        <div className="flex flex-col">
          {!hasMessages ? (
            /* Empty State */
            <div className="flex flex-col items-center justify-center min-h-[400px] px-8">
              <div className="glass-strong rounded-3xl p-8 mb-6">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-teal-400 flex items-center justify-center shadow-lg shadow-primary/25">
                  <Bot className="w-8 h-8 text-primary-foreground" />
                </div>
              </div>
              <h3 className="text-2xl font-semibold text-foreground mb-2">
                Welcome to Weave
              </h3>
              <p className="text-sm text-muted-foreground text-center max-w-md mb-8 leading-relaxed">
                Your AI-powered workspace. I can read files, calculate, take notes,
                and much more. Just ask me anything or try one of the suggestions below.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg">
                {SUGGESTED_PROMPTS.map((prompt, i) => (
                  <Button
                    key={i}
                    variant="outline"
                    className="h-auto py-3 px-4 justify-start text-left gap-3 text-sm glass hover:bg-accent/50 transition-all duration-200 hover:-translate-y-0.5"
                    onClick={() => useChatStore.getState().sendMessage(prompt.text)}
                  >
                    <span className="text-lg">{prompt.icon}</span>
                    <span className="truncate">{prompt.text}</span>
                  </Button>
                ))}
              </div>

              <div className="mt-8 text-xs text-muted-foreground/60 flex items-center gap-1.5">
                <Sparkles className="w-3 h-3" />
                Powered by AI with plugin capabilities
              </div>
            </div>
          ) : (
            /* Messages */
            <div className="py-4 space-y-1">
              {messages.map((msg, index) => (
                <ChatMessage key={msg.id} message={msg} isLast={index === messages.length - 1} />
              ))}
              {isStreaming && messages[messages.length - 1]?.role === 'assistant' && messages[messages.length - 1]?.content === '' && (
                <div className="flex items-center gap-1.5 px-4 py-2 text-xs text-muted-foreground">
                  <span>Thinking</span>
                  <div className="flex items-center gap-1">
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

      {/* Input */}
      <ChatInput />
    </div>
  );
}
