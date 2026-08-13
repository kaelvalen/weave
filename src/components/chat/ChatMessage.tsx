import React, { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { useChatStore } from '@/stores/useChatStore';
import { usePluginStore } from '@/stores/usePluginStore';
import { extractError } from '@/lib/errors';
import type { ChatMessage as ChatMessageType, PluginCall } from '@/types/chat';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Copy, Check, Brain, Edit2, RefreshCw, Loader2, FileCode } from 'lucide-react';
import { ToolCallCard } from './ToolCallCard';
import { ToolCallBatch } from './ToolCallBatch';
import { AgentActivityAccordion } from './AgentActivityAccordion';
import { ArtifactCard } from './ArtifactCard';
import { useAppStore, ActiveArtifact } from '@/stores/useAppStore';
import { Textarea } from '@/components/ui/textarea';
import { GoalCard } from '@/components/workspace/GoalCard';
import { GoalTrace } from '@/components/execution/GoalTrace';
import { TraceBox } from '@/components/execution/TraceBox';
import { usePlanForGoal, useStepsForGoal, useGoalStats } from '@/components/workspace/runtimeSelectors';
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
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Same cleaning as `cleanedMarkdown`, applied to one interleaved text slice. */
function cleanSlice(text: string): string {
  return text
    .replace(/<\s*(?:think|thought)\s*>[\s\S]*?(?:<\/\s*(?:think|thought)\s*>|$)/gi, '')
    .replace(/<\s*call[\s\S]*?(?:<\/\s*call\s*>|$)/gi, '')
    .replace(/<\/?(?:call|think|thought)[^>]*$/gi, '')
    .replace(/\\\[([\s\S]*?)\\\]/g, '$$$$$1$$$$')
    .replace(/\\\((.*?)\)/g, '$$$1$$');
}

interface CodeBlockProps extends React.HTMLAttributes<HTMLElement> {
  node?: unknown;
  inline?: boolean;
}

// Custom code block component for ReactMarkdown
const CodeBlock = React.memo(function CodeBlock({ inline, className, children, ...props }: CodeBlockProps) {
  const [isCopied, setIsCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || '');
  const lang = match ? match[1] : '';

  const handleCopy = () => {
    navigator.clipboard.writeText(String(children).replace(/\n$/, ''));
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleSaveAsArtifact = async () => {
    const codeContent = String(children).replace(/\n$/, '');
    const ext = lang === 'python' ? 'py' : lang === 'rust' ? 'rs' : lang === 'typescript' || lang === 'tsx' ? 'ts' : lang || 'txt';
    const conversationId = useChatStore.getState().conversationId || 'default';
    const filename = `code_artifact_${Date.now().toString().slice(-4)}.${ext}`;
    const artifactPath = `artifacts/${conversationId}/${filename}`;
    const pluginId = usePluginStore.getState().getPluginIdForCapability('coder.write_file') || 'com.weave.builtin.coder';
    try {
      await invoke('plugin_execute', {
        pluginId,
        capability: 'coder.write_file',
        params: { path: artifactPath, content: codeContent },
      });
      toast.success(`Saved artifact to session storage: ${filename}`);
      useAppStore.getState().openArtifact({
        type: 'file',
        title: filename,
        content: codeContent,
        path: artifactPath,
      });
    } catch (err) {
      toast.error(`Failed to save artifact: ${extractError(err)}`);
    }
  };

  if (!inline && match) {
    return (
      <div className="relative group rounded-xl overflow-hidden my-4 border border-border/40 bg-surface-1">
        <div className="flex items-center justify-between px-4 py-2 bg-surface-2 border-b border-border/40 font-mono text-xs">
          <span className="text-muted-foreground font-semibold">{lang}</span>
          <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={handleSaveAsArtifact}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-surface-3 text-muted-foreground hover:text-brand hover:border-brand/40 border border-border/40 transition-colors"
              title="Save as Artifact in Workspace"
            >
              <FileCode className="w-3.5 h-3.5 text-brand" />
              Save Artifact
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={handleCopy}
            >
              {isCopied ? (
                <Check className="w-3.5 h-3.5 text-green-500" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </Button>
          </div>
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
});

function InlineBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-muted/50 text-muted-foreground border border-border">
      {children}
    </span>
  );
}

interface HoverActionsProps {
  isAssistant: boolean;
  isStreaming: boolean;
  isEditing?: boolean;
  copied: boolean;
  onCopy: () => void;
  onEdit?: () => void;
  onRegenerate: () => void;
}

function HoverActions({
  isAssistant,
  isStreaming,
  isEditing,
  copied,
  onCopy,
  onEdit,
  onRegenerate,
}: HoverActionsProps) {
  return (
    <div className="opacity-0 group-hover:opacity-100 transition-opacity ml-auto flex items-center gap-0.5">
      {isAssistant && !isStreaming && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 rounded-md hover:bg-muted"
              onClick={onRegenerate}
            >
              <RefreshCw className="w-3.5 h-3.5 text-muted-foreground hover:text-primary transition-colors" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Regenerate response</p>
          </TooltipContent>
        </Tooltip>
      )}
      {!isAssistant && !isEditing && onEdit && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 rounded-md hover:bg-muted"
              onClick={onEdit}
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
            onClick={onCopy}
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
  );
}

export const ChatMessage = React.memo(function ChatMessage({
  message,
  isLast: _isLast,
}: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);

  const isStreaming = useChatStore((s) => (_isLast ? s.isStreaming : false));
  const editAndResend = useChatStore((s) => s.editAndResend);
  const regenerateResponse = useChatStore((s) => s.regenerateResponse);
  const isAssistant = message.role === 'assistant';
  const showCursor = _isLast && isStreaming && isAssistant;

  // Runtime events for this goal. goalId === this assistant message's id: it is
  // the traceId passed to plugin_execute, so runtime events carry it as goal_id.
  const executionSteps = useStepsForGoal(message.id);
  const executionPlan = usePlanForGoal(message.id);
  const hasRuntimeExecution = isAssistant && (executionSteps.length > 0 || executionPlan != null);

  const pairedMessageId = useChatStore((s) => {
    if (message.role === 'assistant') return null;
    const idx = s.messages.findIndex((m) => m.id === message.id);
    if (idx !== -1 && idx + 1 < s.messages.length) {
      const next = s.messages[idx + 1];
      if (next.role === 'assistant') return next.id;
    }
    return null;
  });
  
  const statsTargetId = pairedMessageId ?? message.id;
  const stats = useGoalStats(statsTargetId);

  const cleanedMarkdown = React.useMemo(() => {
    return message.content
      .replace(/<\s*(?:think|thought)\s*>[\s\S]*?(?:<\/\s*(?:think|thought)\s*>|$)/gi, '')
      .replace(/<\s*call[\s\S]*?(?:<\/\s*call\s*>|$)/gi, '')
      .replace(/<\/?(?:call|think|thought)[^>]*$/gi, '')
      .replace(/\\\[([\s\S]*?)\\\]/g, '$$$$$1$$$$')
      .replace(/\\\((.*?)\)/g, '$$$1$$');
  }, [message.content]);

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
  const intent = message.metadata?.intent;

  // Stream-order interleave: text slices and tool-call batches rendered at
  // the positions they actually occurred. Absent for history loaded before
  // segments existed — those fall back to the grouped layout below.
  const segments = message.metadata?.segments;
  const hasSegments = !!segments && segments.length > 0;

  const renderInterleaved = () => {
    if (!segments) return null;
    let offset = 0;
    return segments.map((seg, i) => {
      if (seg.t === 'text') {
        const slice = message.content.slice(offset, offset + seg.len);
        offset += seg.len;
        if (!slice.trim()) return null;
        return (
          <div
            key={i}
            className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-pre:p-0 prose-pre:bg-transparent prose-pre:m-0 break-words font-sans"
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
              components={{ code: CodeBlock }}
            >
              {cleanSlice(slice)}
            </ReactMarkdown>
          </div>
        );
      }
      const calls = seg.calls
        .map((id) => message.metadata!.plugin_calls.find((c) => c.call_id === id))
        .filter((c): c is PluginCall => Boolean(c));
      if (calls.length === 0) return null;
      return (
        <ToolCallBatch
          key={i}
          calls={calls}
          messageId={message.id}
          live={isStreaming}
        />
      );
    });
  };

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
    const isNoteOrFile =
      fakeToolCall.capability.includes('note') ||
      fakeToolCall.capability.includes('file') ||
      fakeToolCall.capability.includes('write') ||
      fakeToolCall.capability.includes('create');

    const resObj = (fakeToolCall.result || {}) as Record<string, unknown>;
    const artifactTitle =
      (resObj.title as string) || (resObj.path as string) || fakeToolCall.capability;

    const artifactContent =
      (resObj.content as string) ||
      (typeof fakeToolCall.result === 'string'
        ? fakeToolCall.result
        : JSON.stringify(fakeToolCall.result, null, 2));

    const artifactObj: ActiveArtifact | null = isNoteOrFile
      ? {
          type: fakeToolCall.capability.includes('note') ? 'note' : 'file',
          title: artifactTitle,
          content: artifactContent,
        }
      : null;

    return (
      <div className="group flex flex-col gap-1 px-5 py-1">
        <div className="flex-1 min-w-0">
          <ToolCallCard call={fakeToolCall} messageId={message.id} />
          {artifactObj && <ArtifactCard artifact={artifactObj} />}
        </div>
      </div>
    );
  }

  const imagesBlock = message.images && message.images.length > 0 && (
    <div className="flex flex-wrap gap-2.5 mb-3">
      {message.images.map((img, idx) => (
        <div
          key={idx}
          className="overflow-hidden rounded-xl border border-border max-w-[300px] max-h-[300px] bg-background"
        >
          <img
            src={img}
            alt="attachment"
            className="w-full h-full object-contain hover:scale-105 transition-transform duration-300"
          />
        </div>
      ))}
    </div>
  );

  // ── User message → GOAL card ──
  if (!isAssistant) {

    return (
      <div className="group px-4 sm:px-6 py-1.5">
        <GoalCard
          stats={stats}
          headerRight={
            <>
              <span className="text-[10px] font-mono text-muted-foreground/60">
                {formatTime(message.timestamp)}
              </span>
              <HoverActions
                isAssistant={false}
                isStreaming={isStreaming}
                isEditing={isEditing}
                copied={copied}
                onCopy={handleCopy}
                onEdit={() => setIsEditing(true)}
                onRegenerate={() => regenerateResponse(message.id)}
              />
            </>
          }
        >
          {isEditing ? (
            <div className="mt-1 flex flex-col gap-2.5 w-full">
              <Textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="min-h-[100px] font-sans rounded-xl border-primary/40 focus-visible:ring-primary p-3"
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
                  className="rounded-xl h-8 px-4 text-xs bg-primary hover:bg-primary/90 text-primary-foreground"
                  onClick={handleEditSave}
                  disabled={!editContent.trim() || isStreaming}
                >
                  Save & Submit
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-sm font-medium text-foreground leading-relaxed break-words w-full font-sans">
              {imagesBlock}
              <div className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-pre:p-0 prose-pre:bg-transparent prose-pre:m-0 break-words font-sans font-medium">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                  components={{ code: CodeBlock }}
                >
                  {cleanedMarkdown}
                </ReactMarkdown>
              </div>
            </div>
          )}
        </GoalCard>
      </div>
    );
  }

  // ── Assistant message → EXECUTION + OUTPUT ──
  const hasOutputContent = cleanedMarkdown.trim() !== '';
  const showsCompletedNotice = !hasOutputContent && hasPluginCalls && !isStreaming;
  const showsExecutingPlaceholder = !hasOutputContent && !showsCompletedNotice && showCursor;

  return (
    <div className="group px-4 sm:px-6 py-3 transition-colors hover:bg-muted/20 rounded-2xl">
      {/* Meta row */}
      <div className="flex items-center gap-2 mb-1.5 text-muted-foreground">
        <span className="text-[10px] font-mono opacity-60">{formatTime(message.timestamp)}</span>
        {message.metadata?.model && <InlineBadge>{message.metadata.model}</InlineBadge>}
        <HoverActions
          isAssistant
          isStreaming={isStreaming}
          copied={copied}
          onCopy={handleCopy}
          onRegenerate={() => regenerateResponse(message.id)}
        />
      </div>

      {/* Intent chip — hidden when the backend reports no intent */}
      {intent && intent.confidence > 0.4 && (
        <div className="flex flex-wrap gap-1.5 mb-2.5">
          <InlineBadge>
            <Brain className="w-3 h-3 text-purple-500 animate-pulse" />
            {intent.intent} ({Math.round(intent.confidence * 100)}%)
          </InlineBadge>
        </div>
      )}

      {/* Stream-order interleave: text and tool calls rendered where they
          actually happened, each batch a compact click-to-expand row. */}
      {hasSegments ? (
        <div className="mt-2 space-y-3">
          {renderInterleaved()}
          {isStreaming && <span className="streaming-cursor" />}
        </div>
      ) : (
        <>
          {/* Execution section — live plan + step timeline sourced from runtime events.
              Mutually exclusive with the metadata accordion below: the trace box
              only renders when runtime events exist for this goal, otherwise the
              empty "No execution steps yet" box appeared next to the accordion
              (events are in-memory, so after a restart or before the first event
              arrives they are absent and the box was pure noise). */}
          {hasRuntimeExecution && (
            <div className="my-3">
              <GoalTrace goalId={message.id} defaultOpen={isStreaming} />
            </div>
          )}

          {/* Fallback: metadata-driven activity for history without runtime events —
              kept inside a collapsible trace box, matching the layout of
              event-backed traces. */}
          {hasPluginCalls && !hasRuntimeExecution && (
            <div className="my-3">
              <TraceBox goalId={message.id} defaultOpen={isStreaming}>
                <AgentActivityAccordion calls={message.metadata!.plugin_calls} />
              </TraceBox>
            </div>
          )}
        </>
      )}

      {/* Incomplete Tool Call Warning — only after streaming finishes, since while
          streaming the closing </call> tag may simply not have arrived yet. */}
      {!isStreaming &&
        /<\s*call\s+plugin=/i.test(message.content) &&
        !/<\/\s*call\s*>/i.test(message.content) && (
          <div className="mt-2 mb-3 p-3 bg-yellow-500/10 border border-yellow-500/30 text-yellow-600 dark:text-yellow-400 text-xs rounded-xl flex items-start gap-2.5">
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

      {/* Thinking Accordion Component */}
      {(() => {
        let thinkingText = '';

        const thinkMatch = message.content.match(/<(?:think|thought)>([\s\S]*?)(?:<\/(?:think|thought)>|$)/i);
        if (thinkMatch) {
          thinkingText = thinkMatch[1].trim();
        }

        return (
          <>
            {thinkingText && (
              <details
                open
                className="mb-3 group/think bg-surface-1 rounded-lg overflow-hidden text-xs"
              >
                <summary className="flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none font-mono text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors">
                  <Brain className="w-3.5 h-3.5 text-foreground shrink-0" />
                  <span>Thought Process</span>
                  <span className="text-[10px] text-muted-foreground/70 font-mono ml-auto group-open/think:hidden">
                    [+] Show
                  </span>
                  <span className="text-[10px] text-muted-foreground/70 font-mono ml-auto hidden group-open/think:inline">
                    [-] Hide
                  </span>
                </summary>
                <div className="p-3 font-mono text-[11px] text-muted-foreground whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
                  {thinkingText}
                </div>
              </details>
            )}
          </>
        );
      })()}

      {/* Output section — main assistant response. Skipped for segment
          messages: their text is already rendered inline between batches. */}
      {!hasSegments && (hasOutputContent || showsCompletedNotice) && (
        <div className="mt-2 text-sm text-foreground leading-relaxed break-words w-full font-sans">
          {imagesBlock}
          {showsExecutingPlaceholder ? (
            <div className="flex items-center gap-1.5 py-1 font-mono text-xs text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-brand" />
              <span>Executing...</span>
              {showCursor && <span className="streaming-cursor" />}
            </div>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-pre:p-0 prose-pre:bg-transparent prose-pre:m-0 break-words font-sans">
              {showsCompletedNotice ? (
                <div className="mt-1 py-2 px-3.5 bg-surface-2 border border-border/40 rounded-xl text-xs font-medium text-foreground flex items-center gap-2">
                  <Check className="w-4 h-4 text-brand flex-shrink-0" />
                  <span>Autonomous task execution completed successfully.</span>
                </div>
              ) : (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                  components={{ code: CodeBlock }}
                >
                  {cleanedMarkdown}
                </ReactMarkdown>
              )}
            </div>
          )}
          {showCursor && !showsExecutingPlaceholder && <span className="streaming-cursor" />}
        </div>
      )}
    </div>
  );
});
