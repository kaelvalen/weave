import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Copy, Check, RefreshCw, ThumbsUp, ThumbsDown } from 'lucide-react';
import type { ChatMessage } from '@/types/chat';
import { useChatStore } from '@/stores/useChatStore';

/* ─────────────────────────────────────────────────────────
 * STREAMED-MESSAGE FOOTER
 * Once the stream settles: an action row (copy / retry /
 * thumbs), the sources the model actually read (from
 * web.search / web.fetch tool calls), and follow-up prompts
 * derived from the search query — all real, none fabricated.
 * ───────────────────────────────────────────────────────── */

type Source = { name: string; domain: string; url: string };

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Sources actually consulted by this turn: web.search results + fetched URLs. */
function extractSources(message: ChatMessage): Source[] {
  const sources: Source[] = [];
  for (const call of message.metadata?.plugin_calls ?? []) {
    if (call.status !== 'success') continue;
    const result = (call.result ?? {}) as Record<string, unknown>;
    if (call.capability === 'web.search') {
      const results = Array.isArray(result.results) ? (result.results as Source[]) : [];
      for (const r of results.slice(0, 4)) {
        const url = r.url ?? '';
        if (!url) continue;
        sources.push({
          name: r.name || hostOf(url),
          domain: hostOf(url),
          url,
        });
      }
    } else if (call.capability === 'web.fetch') {
      const url = (call.params.url as string) ?? (result.url as string);
      if (url && sources.length < 8) {
        sources.push({ name: hostOf(url), domain: hostOf(url), url });
      }
    }
    if (sources.length >= 8) break;
  }
  return sources;
}

/** Follow-ups derived from the turn's real web-search query. */
function deriveFollowUps(message: ChatMessage): { label: string; prompt: string }[] {
  const search = (message.metadata?.plugin_calls ?? []).find(
    (c) => c.capability === 'web.search' && c.status === 'success'
  );
  const query = (search?.params.query as string)?.trim();
  if (!query) return [];
  return [
    { label: `Keep researching “${query.slice(0, 40)}”`, prompt: `Keep researching: ${query}` },
    {
      label: 'Summarize what the sources say',
      prompt: 'Summarize what the sources from your web search say.',
    },
    {
      label: 'Save the best findings to a note',
      prompt: 'Save the best findings from the web search to a note.',
    },
  ];
}

/** Deterministic letter avatar for a source (offline-safe, no favicon fetch). */
function SourceAvatar({ domain, size }: { domain: string; size: 'sm' | 'md' }) {
  const hue = useMemo(() => {
    let h = 0;
    for (const ch of domain) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return h;
  }, [domain]);
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full font-bold text-white ${
        size === 'sm' ? 'size-3.5 text-[8px]' : 'size-4 text-[9px]'
      }`}
      style={{ background: `hsl(${hue} 55% 42%)` }}
    >
      {domain[0]?.toUpperCase()}
    </span>
  );
}

export function StreamingExtras({ message }: { message: ChatMessage }) {
  const regenerateResponse = useChatStore((s) => s.regenerateResponse);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const [copied, setCopied] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);

  const sources = useMemo(() => extractSources(message), [message]);
  const followUps = useMemo(() => deriveFollowUps(message), [message]);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="flex flex-col gap-2.5">
      {/* action row + sources stack — fades in once the stream settles */}
      <div
        className="mt-2 flex items-center gap-0.5"
        style={{ animation: 'fade-in 400ms ease-out both' }}
      >
        <button
          type="button"
          aria-label="Copy response"
          onClick={handleCopy}
          className="flex size-6 items-center justify-center rounded-[6px] text-muted-foreground transition-colors duration-100 hover:bg-muted hover:text-foreground"
        >
          {copied ? (
            <Check size={15} strokeWidth={2} className="text-emerald-500" />
          ) : (
            <Copy size={15} strokeWidth={1.8} />
          )}
        </button>
        <button
          type="button"
          aria-label="Regenerate response"
          onClick={() => void regenerateResponse(message.id)}
          className="flex size-6 items-center justify-center rounded-[6px] text-muted-foreground transition-colors duration-100 hover:bg-muted hover:text-foreground"
        >
          <RefreshCw size={15} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          aria-label="Good response"
          aria-pressed={feedback === 'up'}
          onClick={() => {
            setFeedback('up');
            toast.success('Thanks for the feedback!');
          }}
          className={`flex size-6 items-center justify-center rounded-[6px] transition-colors duration-100 hover:bg-muted ${
            feedback === 'up' ? 'text-emerald-500' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <ThumbsUp size={15} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          aria-label="Bad response"
          aria-pressed={feedback === 'down'}
          onClick={() => {
            setFeedback('down');
            toast.success('Thanks for the feedback!');
          }}
          className={`flex size-6 items-center justify-center rounded-[6px] transition-colors duration-100 hover:bg-muted ${
            feedback === 'down' ? 'text-red-500' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <ThumbsDown size={15} strokeWidth={1.8} />
        </button>

        {sources.length > 0 && (
          <button
            type="button"
            aria-expanded={sourcesOpen}
            onClick={() => setSourcesOpen((current) => !current)}
            className="ml-1.5 flex items-center gap-1.5 rounded-[6px] px-1 py-0.5 text-left transition-colors duration-150 hover:bg-muted"
          >
            <span className="flex -space-x-1">
              {sources.slice(0, 3).map((source) => (
                <span key={source.url} className="rounded-full border-[1.5px] border-background">
                  <SourceAvatar domain={source.domain} size="sm" />
                </span>
              ))}
            </span>
            <span className="text-[12px] text-muted-foreground">
              {sources.length} source{sources.length > 1 ? 's' : ''}
            </span>
          </button>
        )}
      </div>

      {/* expandable sources panel — the sources the model actually read */}
      {sources.length > 0 && (
        <div
          className="grid transition-[grid-template-rows,opacity] duration-300"
          style={{
            gridTemplateRows: sourcesOpen ? '1fr' : '0fr',
            opacity: sourcesOpen ? 1 : 0,
            transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)',
          }}
        >
          <div className="overflow-hidden">
            <div className="mt-1 flex flex-col rounded-[10px] bg-surface-2 p-1">
              {sources.map((source) => (
                <a
                  key={source.url}
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 rounded-[6px] px-1.5 py-1 text-[12px] text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
                >
                  <SourceAvatar domain={source.domain} size="md" />
                  <span className="min-w-0 truncate underline-offset-2 hover:underline">
                    {source.name}
                  </span>
                  <span className="ml-auto shrink-0 font-mono text-[10.5px] text-muted-foreground/70">
                    {source.domain}
                  </span>
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* follow-ups — real prompts derived from the turn's search query */}
      {followUps.length > 0 && (
        <div className="mt-1" style={{ animation: 'fade-in 400ms ease-out both' }}>
          <p className="text-[12px] font-medium text-muted-foreground">Follow-ups</p>
          <div className="mt-0.5 flex flex-col">
            {followUps.map((item, i) => (
              <button
                key={item.prompt}
                type="button"
                onClick={() => void sendMessage(item.prompt)}
                className="-mx-1.5 flex items-center gap-2 rounded-[7px] border-b border-border px-1.5 py-1.5 text-left text-[12.5px] text-foreground transition-colors duration-100 hover:bg-muted/50"
                style={{
                  animation: `fade-up 350ms cubic-bezier(0.23,1,0.32,1) ${i * 90}ms both`,
                }}
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0 text-muted-foreground"
                >
                  <path d="M9 10l-5 5 5 5" />
                  <path d="M20 4v7a4 4 0 0 1-4 4H4" />
                </svg>
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
