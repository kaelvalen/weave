import React, { useState, useCallback } from 'react';
import { useChatStore } from '@/stores/useChatStore';
import type { ChatMessage as ChatMessageType, PluginCall } from '@/types/chat';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { User, Bot, Copy, Check, Brain, Edit2, RefreshCw } from 'lucide-react';
import { ToolCallCard } from './ToolCallCard';
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

// Custom code block component for ReactMarkdown
const CodeBlock = ({ node, inline, className, children, ...props }: any) => {
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
          <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground transition-opacity opacity-0 group-hover:opacity-100" onClick={handleCopy}>
            {isCopied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
          </Button>
        </div>
        <SyntaxHighlighter
          {...props}
          style={vscDarkPlus}
          language={lang}
          PreTag="div"
          customStyle={{ margin: 0, padding: '1rem', background: 'transparent', fontSize: '13px', overflowX: 'auto' }}
          wrapLines={true}
        >
          {String(children).replace(/\n$/, '')}
        </SyntaxHighlighter>
      </div>
    );
  }

  return (
    <code {...props} className={`${className} bg-muted text-foreground px-1.5 py-0.5 rounded-md text-sm font-mono border border-border/50 break-all whitespace-pre-wrap`}>
      {children}
    </code>
  );
};

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

export const ChatMessage = React.memo(function ChatMessage({ message, isLast: _isLast, isConsecutive }: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  
  const isStreaming = useChatStore(s => s.isStreaming);
  const editAndResend = useChatStore(s => s.editAndResend);
  const regenerateResponse = useChatStore(s => s.regenerateResponse);
  const isAssistant = message.role === 'assistant';
  const showCursor  = _isLast && isStreaming && isAssistant;

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
  const hasIntent      = message.metadata?.intent;

  // Detect raw OpenRouter tool return messages injected by backend
  const isFakeToolUser = message.role === 'user' && message.content.startsWith('Tool ') && message.content.includes(' returned:');
  let fakeToolCall: PluginCall | null = null;
  
  if (isFakeToolUser) {
    const match = message.content.match(/^Tool ([\w.-]+) returned:\s*([\s\S]*?)\s*(?:\n*Please continue.*)?$/);
    if (match) {
      const pluginId = match[1];
      const resultStr = match[2];
      let result: any = resultStr;
      try { result = JSON.parse(resultStr); } catch (e) {}
      
      fakeToolCall = {
        plugin_id: pluginId,
        capability: pluginId.includes('.') ? pluginId.split('.').pop()! : 'execute',
        params: { note: "Parameters were parsed by local tool engine" },
        status: 'success',
        result
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
    <div className={`group flex items-start gap-4 px-5 ${isConsecutive ? 'py-0.5' : 'py-2'}`}>
      {/* Avatar */}
      <div className="flex-shrink-0 mt-1 w-8">
        {!isConsecutive && <MsgAvatar role={message.role as 'user' | 'assistant'} />}
      </div>

      {/* Content Area */}
      <div className="flex-1 min-w-0">
        {/* Meta row */}
        {!isConsecutive && (
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

          {/* Actions */}
          <div className="opacity-0 group-hover:opacity-100 transition-opacity ml-auto flex items-center gap-1">
            {isAssistant && !isStreaming && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => regenerateResponse(message.id)}>
                    <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>Regenerate response</p></TooltipContent>
              </Tooltip>
            )}
            {!isAssistant && !isEditing && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setIsEditing(true)}>
                    <Edit2 className="w-3.5 h-3.5 text-muted-foreground" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>Edit message</p></TooltipContent>
              </Tooltip>
            )}
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
        )}

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
              <ToolCallCard key={i} call={call} messageId={message.id} />
            ))}
          </div>
        )}

        {/* Incomplete Tool Call Warning */}
        {message.content.includes('<call plugin=') && !message.content.includes('</call>') && (
          <div className="mt-2 mb-3 px-3 py-2 bg-yellow-500/10 border border-yellow-500/20 text-yellow-600 dark:text-yellow-400 text-xs rounded-md flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
            <span>Modelin yanıtı (max_tokens sınırı nedeniyle) yarıda kesildi. İşlem tamamlanamadı. <strong>Settings</strong>'den max_tokens değerini artırabilir veya modele dosyayı parça parça yazmasını söyleyebilirsiniz.</span>
          </div>
        )}

        {/* Message Body */}
        <div className="text-sm text-foreground leading-relaxed break-words">
          {message.images && message.images.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {message.images.map((img, idx) => (
                <img key={idx} src={img} alt="attachment" className="max-w-[300px] max-h-[300px] object-contain rounded-md border" />
              ))}
            </div>
          )}
          {isEditing ? (
            <div className="mt-2 flex flex-col gap-2">
              <Textarea 
                value={editContent} 
                onChange={(e) => setEditContent(e.target.value)} 
                className="min-h-[100px] font-sans"
                autoFocus
              />
              <div className="flex items-center justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => { setIsEditing(false); setEditContent(message.content); }}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleEditSave} disabled={!editContent.trim() || isStreaming}>
                  Save & Submit
                </Button>
              </div>
            </div>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-[calc(100vw-120px)] prose-p:leading-relaxed prose-pre:p-0 prose-pre:bg-transparent prose-pre:m-0 break-words">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex]}
                components={{ code: CodeBlock as any }}
              >
                {message.content
                  .replace(/<call[\s\S]*?<\/call>/g, '')
                  .replace(/\\\[([\s\S]*?)\\\]/g, '$$$$$1$$$$')
                  .replace(/\\\((.*?)\\\)/g, '$$$1$$')
                }
              </ReactMarkdown>
            </div>
          )}
          {showCursor && !isEditing && <span className="streaming-cursor" />}
        </div>
      </div>
    </div>
  );
});
