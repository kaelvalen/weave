import React, { useState, useCallback } from 'react';
import { useChatStore } from '@/stores/useChatStore';
import type { ChatMessage as ChatMessageType, PluginCall } from '@/types/chat';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { User, Bot, Copy, Check, Brain, Edit2, RefreshCw } from 'lucide-react';
import { ToolCallCard } from './ToolCallCard';
import { AgentActivityAccordion } from './AgentActivityAccordion';
import { Textarea } from '@/components/ui/textarea';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';

SyntaxHighlighter.registerLanguage('tsx', tsx);
SyntaxHighlighter.registerLanguage('typescript', typescript);
SyntaxHighlighter.registerLanguage('rust', rust);
SyntaxHighlighter.registerLanguage('json', json);
SyntaxHighlighter.registerLanguage('bash', bash);
SyntaxHighlighter.registerLanguage('python', python);

interface ChatMessageProps {
  message: ChatMessageType;
  isLast?: boolean;
  isConsecutive?: boolean;
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface CodeBlockProps extends React.HTMLAttributes<HTMLElement> {
  node?: unknown;
  inline?: boolean;
}

// Custom code block component for ReactMarkdown
const CodeBlock = ({ inline, className, children, ...props }: CodeBlockProps) => {
  const [isCopied, setIsCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || '');
  const lang = match ? match[1] : '';

  const handleCopy = () => {
    navigator.clipboard.writeText(String(children).replace(/\n$/, ''));
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  if (!inline && match) {
    return (
      <div className="relative group rounded-md overflow-hidden my-4 border border-border">
        <div className="flex items-center justify-between px-4 py-1.5 bg-muted/50 border-b border-border">
          <span className="text-xs font-mono text-muted-foreground">{lang}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground transition-opacity opacity-0 group-hover:opacity-100"
            onClick={handleCopy}
          >
            {isCopied ? (
              <Check className="w-3.5 h-3.5 text-green-500" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </Button>
        </div>
        <SyntaxHighlighter
          {...props}
          style={vscDarkPlus}
          language={lang}
          PreTag="div"
          customStyle={{
            margin: 0,
            padding: '1rem',
            background: 'transparent',
            fontSize: '13px',
            overflowX: 'auto',
          }}
          wrapLines={true}
        >
          {String(children).replace(/\n$/, '')}
        </SyntaxHighlighter>
      </div>
    );
  }

  return (
    <code
      {...props}
      className={`${className} bg-muted text-foreground px-1.5 py-0.5 rounded-md text-sm font-mono border border-border/50 break-all whitespace-pre-wrap`}
    >
      {children}
    </code>
  );
};

function MsgAvatar({ role }: { role: 'user' | 'assistant' }) {
  const isUser = role === 'user';
  return (
    <div
      className={`w-8 h-8 rounded-xl border flex items-center justify-center flex-shrink-0 shadow-sm transition-transform duration-300 group-hover:scale-105 ${
        isUser
          ? 'bg-gradient-to-br from-primary to-primary/80 text-primary-foreground border-primary/20'
          : 'bg-gradient-to-br from-blue-500/10 via-indigo-500/10 to-purple-500/10 text-primary border-primary/20 shadow-indigo-500/5'
      }`}
    >
      {isUser ? (
        <User className="w-4 h-4 stroke-[2.5]" />
      ) : (
        <Bot className="w-4 h-4 text-indigo-500 dark:text-indigo-400 stroke-[2.5]" />
      )}
    </div>
  );
}

function InlineBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-muted/80 text-muted-foreground border border-border/60 shadow-sm">
      {children}
    </span>
  );
}

export const ChatMessage = React.memo(function ChatMessage({
  message,
  isLast: _isLast,
  isConsecutive,
}: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);

  const isStreaming = useChatStore((s) => s.isStreaming);
  const editAndResend = useChatStore((s) => s.editAndResend);
  const regenerateResponse = useChatStore((s) => s.regenerateResponse);
  const isAssistant = message.role === 'assistant';
  const showCursor = _isLast && isStreaming && isAssistant;

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [message.content]);

  const handleEditSave = () => {
    if (editContent.trim() && editContent !== message.content) {
      editAndResend(message.id, editContent);
    }
    setIsEditing(false);
  };

  const hasPluginCalls = (message.metadata?.plugin_calls?.length ?? 0) > 0;
  const hasIntent = message.metadata?.intent;

  // Detect raw OpenRouter tool return messages injected by backend
  const isFakeToolUser =
    message.role === 'user' &&
    message.content.startsWith('Tool ') &&
    message.content.includes(' returned:');
  let fakeToolCall: PluginCall | null = null;

  if (isFakeToolUser) {
    const match = message.content.match(
      /^Tool ([\w.-]+) returned:\s*([\s\S]*?)\s*(?:\n*Please continue.*)?$/
    );
    if (match) {
      const pluginId = match[1];
      const resultStr = match[2];
      let result: unknown = resultStr;
      try {
        result = JSON.parse(resultStr);
      } catch {
        /* keep raw string on parse failure */
      }

      fakeToolCall = {
        plugin_id: pluginId,
        capability: pluginId.includes('.') ? pluginId.split('.').pop()! : 'execute',
        params: { note: 'Parameters were parsed by local tool engine' },
        status: 'success',
        result: result as Record<string, unknown>,
      };
    }
  }

  if (fakeToolCall) {
    return (
      <div className="group flex items-start gap-4 px-5 py-1">
        <div className="flex-shrink-0 w-8" />
        <div className="flex-1 min-w-0">
          <ToolCallCard call={fakeToolCall} messageId={message.id} />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`group flex items-start gap-3.5 px-4 sm:px-6 transition-colors ${isConsecutive ? 'py-1' : 'py-3 hover:bg-muted/20 rounded-2xl'}`}
    >
      {/* Avatar */}
      <div className="flex-shrink-0 mt-0.5 w-8">
        {!isConsecutive && <MsgAvatar role={message.role as 'user' | 'assistant'} />}
      </div>

      {/* Content Area */}
      <div className="flex-1 min-w-0">
        {/* Meta row */}
        {!isConsecutive && (
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs sm:text-sm font-bold text-foreground">
              {message.role === 'user' ? 'You' : 'Weave AI'}
            </span>
            <span className="text-[11px] text-muted-foreground/70 font-mono">
              {formatTime(message.timestamp)}
            </span>
            {message.metadata?.model && <InlineBadge>{message.metadata.model}</InlineBadge>}

            {/* Actions */}
            <div className="opacity-0 group-hover:opacity-100 transition-opacity ml-auto flex items-center gap-1 bg-card/80 backdrop-blur-sm border border-border/60 rounded-lg px-1 py-0.5 shadow-sm">
              {isAssistant && !isStreaming && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 rounded-md hover:bg-muted"
                      onClick={() => regenerateResponse(message.id)}
                    >
                      <RefreshCw className="w-3.5 h-3.5 text-muted-foreground hover:text-primary transition-colors" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Regenerate response</p>
                  </TooltipContent>
                </Tooltip>
              )}
              {!isAssistant && !isEditing && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 rounded-md hover:bg-muted"
                      onClick={() => setIsEditing(true)}
                    >
                      <Edit2 className="w-3.5 h-3.5 text-muted-foreground hover:text-primary transition-colors" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Edit message</p>
                  </TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 rounded-md hover:bg-muted"
                    onClick={handleCopy}
                  >
                    {copied ? (
                      <Check className="w-3.5 h-3.5 text-green-500" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-muted-foreground hover:text-primary transition-colors" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{copied ? 'Copied!' : 'Copy'}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        )}

        {/* Intent & Plugin chips */}
        {(hasIntent || hasPluginCalls) && (
          <div className="flex flex-wrap gap-1.5 mb-2.5">
            {hasIntent && message.metadata!.intent!.confidence > 0.4 && (
              <InlineBadge>
                <Brain className="w-3 h-3 text-purple-500 animate-pulse" />
                {message.metadata!.intent!.intent} (
                {Math.round(message.metadata!.intent!.confidence * 100)}%)
              </InlineBadge>
            )}
          </div>
        )}

        {/* Tool Call Cards -> Agent Activity Accordion */}
        {hasPluginCalls && (
          <AgentActivityAccordion
            calls={message.metadata!.plugin_calls}
            messageId={message.id}
            isStreaming={isStreaming && _isLast}
          />
        )}

        {/* Incomplete Tool Call Warning — only after streaming finishes, since while
            streaming the closing </call> tag may simply not have arrived yet. */}
        {!isStreaming &&
          /<\s*call\s+plugin=/i.test(message.content) &&
          !/<\/\s*call\s*>/i.test(message.content) && (
            <div className="mt-2 mb-3 p-3 bg-yellow-500/10 border border-yellow-500/30 text-yellow-600 dark:text-yellow-400 text-xs rounded-xl flex items-start gap-2.5 shadow-sm">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="flex-shrink-0 mt-0.5"
              >
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
              </svg>
              <span className="leading-relaxed">
                The model's response was truncated (likely due to max_tokens), so the operation did
                not complete. Increase <strong>max_tokens</strong> in Settings, or ask the model to
                write the file in smaller chunks.
              </span>
            </div>
          )}

        {/* Message Body */}
        <div
          className={`text-sm text-foreground leading-relaxed break-words ${
            message.role === 'user' && !isEditing
              ? 'inline-block bg-primary/5 dark:bg-muted/40 border border-primary/10 dark:border-border/60 rounded-2xl px-4 py-3 shadow-sm font-sans'
              : 'w-full'
          }`}
        >
          {message.images && message.images.length > 0 && (
            <div className="flex flex-wrap gap-2.5 mb-3">
              {message.images.map((img, idx) => (
                <div
                  key={idx}
                  className="overflow-hidden rounded-xl border border-border shadow-md max-w-[300px] max-h-[300px] bg-background"
                >
                  <img
                    src={img}
                    alt="attachment"
                    className="w-full h-full object-contain hover:scale-105 transition-transform duration-300"
                  />
                </div>
              ))}
            </div>
          )}
          {isEditing ? (
            <div className="mt-2 flex flex-col gap-2.5 w-full">
              <Textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="min-h-[100px] font-sans rounded-xl border-primary/40 focus-visible:ring-primary shadow-inner p-3"
                autoFocus
              />
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl h-8 px-3 text-xs"
                  onClick={() => {
                    setIsEditing(false);
                    setEditContent(message.content);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="rounded-xl h-8 px-4 text-xs bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
                  onClick={handleEditSave}
                  disabled={!editContent.trim() || isStreaming}
                >
                  Save & Submit
                </Button>
              </div>
            </div>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-pre:p-0 prose-pre:bg-transparent prose-pre:m-0 break-words font-sans">
              {message.content
                .replace(/<\s*call[\s\S]*?(?:<\/\s*call\s*>|$)/gi, '')
                .trim() === '' && hasPluginCalls && !isStreaming ? (
                <div className="mt-1 py-2 px-3.5 bg-primary/5 dark:bg-primary/10 border border-primary/20 rounded-xl text-xs font-medium text-primary flex items-center gap-2 animate-fade-in shadow-2xs">
                  <Check className="w-4 h-4 text-primary flex-shrink-0" />
                  <span>Autonomous task execution completed successfully.</span>
                </div>
              ) : (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                  components={{ code: CodeBlock }}
                >
                  {message.content
                    .replace(/<\s*call[\s\S]*?(?:<\/\s*call\s*>|$)/gi, '')
                    .replace(/\\\[([\s\S]*?)\\\]/g, '$$$$$1$$$$')
                    .replace(/\\\((.*?)\\\)/g, '$$$1$$')}
                </ReactMarkdown>
              )}
            </div>
          )}
          {showCursor && !isEditing && <span className="streaming-cursor" />}
        </div>
      </div>
    </div>
  );
});
