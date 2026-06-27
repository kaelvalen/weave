import { useState, useCallback } from 'react';
import { useChatStore } from '@/stores/useChatStore';
import type { ChatMessage as ChatMessageType } from '@/types/chat';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { User, Bot, Copy, Check, Brain } from 'lucide-react';
import { ToolCallCard } from './ToolCallCard';

interface ChatMessageProps {
  message: ChatMessageType;
  isLast?: boolean;
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderMarkdown(text: string): string {
  return text
    .replace(/```(\w+)?\n([\s\S]*?)```/g,
      '<pre class="bg-muted p-4 rounded-lg border overflow-x-auto my-3 text-sm"><code class="font-mono text-foreground">$2</code></pre>')
    .replace(/`([^`]+)`/g,
      '<code class="px-1 py-0.5 rounded-md bg-muted text-foreground border font-mono text-sm">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-foreground">$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h3 class="text-sm font-semibold mt-4 mb-2 text-foreground">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-base font-semibold mt-5 mb-2 text-foreground">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-lg font-bold mt-5 mb-3 text-foreground">$1</h1>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 mb-1 list-disc">$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 mb-1 list-decimal">$1</li>')
    .replace(/^(?!<[hl]|<li|<pre)(.+)$/gm, '<p class="mb-2 last:mb-0">$1</p>');
}

function MsgAvatar({ role }: { role: 'user' | 'assistant' }) {
  const isUser = role === 'user';
  return (
    <div
      className={`w-8 h-8 rounded-md border flex items-center justify-center flex-shrink-0 ${
        isUser ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
      }`}
    >
      {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
    </div>
  );
}

function InlineBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground border">
      {children}
    </span>
  );
}

export function ChatMessage({ message, isLast: _isLast }: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const isAssistant = message.role === 'assistant';
  const showCursor  = _isLast && isStreaming && isAssistant;

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [message.content]);

  const hasPluginCalls = (message.metadata?.plugin_calls?.length ?? 0) > 0;
  const hasIntent      = message.metadata?.intent;

  return (
    <div className="group flex items-start gap-4 px-5 py-2">
      {/* Avatar */}
      <div className="flex-shrink-0 mt-1">
        <MsgAvatar role={message.role as 'user' | 'assistant'} />
      </div>

      {/* Content Area */}
      <div className="flex-1 min-w-0">
        {/* Meta row */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-semibold">
            {message.role === 'user' ? 'You' : 'Weave AI'}
          </span>
          <span className="text-xs text-muted-foreground font-mono">
            {formatTime(message.timestamp)}
          </span>
          {message.metadata?.model && (
            <InlineBadge>{message.metadata.model}</InlineBadge>
          )}

          {/* Copy button */}
          <div className="opacity-0 group-hover:opacity-100 transition-opacity ml-auto">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopy}>
                  {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>{copied ? 'Copied!' : 'Copy'}</p></TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Intent & Plugin chips */}
        {(hasIntent || hasPluginCalls) && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {hasIntent && message.metadata!.intent!.confidence > 0.4 && (
              <InlineBadge>
                <Brain className="w-3 h-3" />
                {message.metadata!.intent!.intent} ({Math.round(message.metadata!.intent!.confidence * 100)}%)
              </InlineBadge>
            )}
          </div>
        )}
        
        {/* Tool Call Cards */}
        {hasPluginCalls && (
          <div className="flex flex-col gap-2 my-3">
            {message.metadata!.plugin_calls.map((call, i) => (
              <ToolCallCard key={i} call={call} />
            ))}
          </div>
        )}

        {/* Message Body */}
        <div className="text-sm text-foreground leading-relaxed break-words">
          <div
            className="prose prose-sm dark:prose-invert max-w-none"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
          />
          {showCursor && <span className="streaming-cursor" />}
        </div>
      </div>
    </div>
  );
}
