import { useEffect, useRef } from 'react';
import { useChatStore } from '@/stores/useChatStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
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
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between h-12 px-4 border-b border-border bg-card/50 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-medium">AI Assistant</h2>
          {isStreaming && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground animate-pulse">
              <Sparkles className="w-3 h-3" />
              Thinking...
            </span>
          )}
        </div>
        {hasMessages && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-destructive"
            onClick={clearChat}
          >
            <Trash2 className="w-3 h-3" />
            Clear
          </Button>
        )}
      </div>

      {/* Messages Area */}
      <ScrollArea className="flex-1 min-h-0" ref={scrollRef}>
        <div className="flex flex-col">
          {!hasMessages ? (
            /* Empty State */
            <div className="flex flex-col items-center justify-center min-h-[400px] px-8">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-5">
                <Bot className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-xl font-semibold text-foreground mb-2">
                Welcome to Weave
              </h3>
              <p className="text-sm text-muted-foreground text-center max-w-md mb-8 leading-relaxed">
                Your AI-powered workspace. I can read files, calculate, take notes,
                and much more. Just ask me anything or try one of the suggestions below.
              </p>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
                {SUGGESTED_PROMPTS.map((prompt, i) => (
                  <Button
                    key={i}
                    variant="outline"
                    className="h-auto py-2.5 px-3 justify-start text-left gap-2 text-sm hover:bg-accent transition-colors"
                    onClick={() => useChatStore.getState().sendMessage(prompt.text)}
                  >
                    <span className="text-base">{prompt.icon}</span>
                    <span className="truncate">{prompt.text}</span>
                  </Button>
                ))}
              </div>

              <div className="mt-8 text-xs text-muted-foreground/60 flex items-center gap-1">
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
              {isStreaming && messages[messages.length - 1]?.role === 'assistant' && (
                <div className="px-4 py-2">
                  <span className="inline-flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
                  </span>
                </div>
              )}
              <div ref={bottomRef} className="h-4" />
            </div>
          )}
        </div>
      </ScrollArea>

      <Separator />

      {/* Input */}
      <ChatInput />
    </div>
  );
}
