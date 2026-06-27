import { useState, useCallback } from 'react';
import type { ChatMessage as ChatMessageType } from '@/types/chat';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { User, Bot, Copy, Check, Wrench, Brain, Sparkles } from 'lucide-react';

interface ChatMessageProps {
  message: ChatMessageType;
  isLast?: boolean;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderMarkdown(text: string): string {
  let html = text
    .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre class="bg-muted p-3 rounded-md overflow-x-auto my-2 text-sm"><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code class="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h3 class="text-lg font-semibold mt-3 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-xl font-semibold mt-4 mb-2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-2xl font-bold mt-4 mb-2">$1</h1>')
    .replace(/^- (.+)$/gm, '<li class="ml-4">$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>')
    .replace(/^(?!<[hl]|<li|<pre|<code)(.+)$/gm, '<p class="mb-1">$1</p>');
  
  return html;
}

export function ChatMessage({ message, isLast }: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [message.content]);

  const hasPluginCalls = message.metadata?.plugin_calls && message.metadata.plugin_calls.length > 0;
  const hasIntent = message.metadata?.intent;

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className={`group flex gap-3 px-4 py-3 transition-colors ${
          isUser
            ? 'bg-primary/5'
            : isAssistant
            ? 'hover:bg-muted/30'
            : 'bg-muted/50'
        }`}
      >
        {/* Avatar */}
        <div className="flex-shrink-0 mt-0.5">
          {isUser ? (
            <Avatar className="w-8 h-8 bg-primary">
              <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                <User className="w-4 h-4" />
              </AvatarFallback>
            </Avatar>
          ) : (
            <Avatar className="w-8 h-8 bg-gradient-to-br from-violet-500 to-fuchsia-500">
              <AvatarFallback className="bg-transparent text-white text-xs">
                <Bot className="w-4 h-4" />
              </AvatarFallback>
            </Avatar>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-foreground">
              {isUser ? 'You' : 'Weave AI'}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {formatTime(message.timestamp)}
            </span>
            {message.metadata?.model && (
              <Badge variant="outline" className="text-[9px] h-4 px-1">
                {message.metadata.model}
              </Badge>
            )}

            {/* Copy Button */}
            <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={handleCopy}
                  >
                    {copied ? (
                      <Check className="w-3 h-3 text-emerald-500" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{copied ? 'Copied!' : 'Copy message'}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Intent Badge */}
          {hasIntent && message.metadata!.intent!.confidence > 0.4 && (
            <div className="flex items-center gap-1.5 mb-2">
              <Badge
                variant="secondary"
                className="text-[10px] h-5 px-1.5 gap-1 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20"
              >
                <Brain className="w-2.5 h-2.5" />
                {message.metadata!.intent!.intent}
                <span className="opacity-60">
                  ({Math.round(message.metadata!.intent!.confidence * 100)}%)
                </span>
              </Badge>
              {message.metadata!.intent!.plugins.map((pid) => (
                <Badge
                  key={pid}
                  variant="outline"
                  className="text-[10px] h-5 px-1.5 gap-1"
                >
                  <Sparkles className="w-2.5 h-2.5" />
                  {pid.split('.').pop()}
                </Badge>
              ))}
            </div>
          )}

          {/* Plugin Calls */}
          {hasPluginCalls && (
            <div className="flex flex-wrap gap-1 mb-2">
              {message.metadata!.plugin_calls.map((call, i) => (
                <Badge
                  key={i}
                  variant="outline"
                  className={`text-[10px] h-5 px-1.5 gap-1 ${
                    call.status === 'success'
                      ? 'border-emerald-500/30 text-emerald-600'
                      : call.status === 'error'
                      ? 'border-destructive/30 text-destructive'
                      : 'border-primary/30 text-primary'
                  }`}
                >
                  <Wrench className="w-2.5 h-2.5" />
                  {call.plugin_id.split('.').pop()}::{call.capability}
                </Badge>
              ))}
            </div>
          )}

          {/* Message Content */}
          <div
            className="text-sm leading-relaxed text-foreground break-words prose prose-sm dark:prose-invert max-w-none"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}
