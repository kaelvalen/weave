import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Check, X, Globe, Search } from 'lucide-react';
import { PluginCall } from '@/types/chat';
import { useAppStore } from '@/stores/useAppStore';

interface ToolCallCardProps {
  call: PluginCall;
  messageId: string;
}

/** The backend's web.search result payload. */
type SearchResult = {
  title?: string;
  url?: string;
  snippet?: string;
};

type WebSearchPayload = {
  query?: string;
  results?: SearchResult[];
  count?: number;
};

/** Favicon-ish dot tones for search sources, like the design's trace. */
const SOURCE_TONES = [
  'bg-brand text-white',
  'bg-orange-500 text-white',
  'bg-emerald-500 text-white',
];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Search-variant rows: query + sources read (+N more), each a link. */
function SearchTrace({ payload }: { payload: WebSearchPayload }) {
  const results = payload.results ?? [];
  const visible = results.slice(0, 3);
  const rest = results.length - visible.length;

  return (
    <div className="flex flex-col gap-1 py-1">
      {payload.query && (
        <div
          className="flex h-6 items-center gap-2 px-1.5"
          style={{ animation: 'fade-up 300ms cubic-bezier(0.23,1,0.32,1) both' }}
        >
          <Search size={14} strokeWidth={2} className="shrink-0 text-muted-foreground" />
          <span className="text-[12.5px] text-muted-foreground">{payload.query}</span>
        </div>
      )}
      {visible.map((row, i) => (
        <a
          key={row.url ?? row.title ?? i}
          href={row.url}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-7 w-full items-center gap-2 rounded-[6px] px-1.5 py-0.5 text-left transition-colors duration-150 hover:bg-muted/50"
          style={{ animation: `fade-up 320ms cubic-bezier(0.23,1,0.32,1) ${i * 120}ms both` }}
        >
          <span
            className={`flex size-3.5 shrink-0 items-center justify-center rounded-full ${SOURCE_TONES[i % 3]}`}
          >
            <Globe size={9} strokeWidth={2.5} />
          </span>
          <span className="min-w-0 truncate text-[12.5px] font-medium text-foreground underline-offset-2 hover:underline">
            {row.title}
          </span>
          {row.url && (
            <span className="min-w-0 shrink-0 truncate text-[11.5px] text-muted-foreground">
              {hostOf(row.url)}
            </span>
          )}
        </a>
      ))}
      {rest > 0 && (
        <span
          className="px-1.5 text-[12px] text-muted-foreground"
          style={{ animation: 'fade-in 300ms ease-out both' }}
        >
          +{rest} more
        </span>
      )}
    </div>
  );
}

/** Map a capability to a terse verb like the tool-trace design:
 *  "coder.write_file" → Edit, "shell.run" → Run, "file.read" → Read. */
function verbFor(capability: string): string {
  if (capability === 'web.search') return 'Search';
  const last = capability.split('.').pop() ?? capability;
  const lower = last.toLowerCase();
  if (lower.startsWith('read') || lower.startsWith('search') || lower.startsWith('list'))
    return 'Read';
  if (lower.startsWith('write')) return 'Write';
  if (
    lower.startsWith('apply_diff') ||
    lower.startsWith('diff') ||
    lower.startsWith('edit') ||
    lower.startsWith('patch')
  )
    return 'Edit';
  if (
    lower.startsWith('run') ||
    lower.startsWith('exec') ||
    lower.startsWith('shell') ||
    lower.startsWith('command')
  )
    return 'Run';
  if (lower.startsWith('create') || lower.startsWith('mkdir')) return 'Create';
  if (lower.startsWith('calc')) return 'Calculate';
  return last.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The mono secondary on the right — usually the target file or command. */
function targetFor(call: PluginCall): string | null {
  const p = call.params;
  if (!p) return null;
  const candidate =
    (p.path as string) ??
    (p.file as string) ??
    (p.title as string) ??
    (p.command as string) ??
    (p.query as string) ??
    (p.url as string);
  return candidate ? String(candidate) : null;
}

export function ToolCallCard({ call }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isError = call.status === 'error';
  const isPending = call.status === 'pending' || call.status === 'pending_approval';

  useEffect(() => {
    if (call.status === 'success') {
      const caps = [
        'coder.write_file',
        'coder.apply_diff',
        'file.write',
        'file.delete',
        'file.mkdir',
      ];
      if (caps.includes(call.capability)) {
        window.dispatchEvent(new CustomEvent('weave-fs-refresh'));
      }
    }
  }, [call.status, call.capability]);

  const verb = verbFor(call.capability);
  const target = targetFor(call);

  // The Search variant: a web.search call renders its query + sources read
  // directly (no expandable verb row) once the results land.
  const isSearch = call.capability === 'web.search';
  const searchPayload = (call.result ?? {}) as WebSearchPayload;
  if (isSearch && call.status === 'success' && searchPayload.results?.length) {
    return <SearchTrace payload={searchPayload} />;
  }

  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className={`flex min-h-7 w-full items-center gap-2 rounded-[6px] px-1.5 py-0.5 text-left transition-colors ${
          expanded ? 'bg-muted/50' : 'hover:bg-muted/50'
        }`}
        style={{ animation: 'fade-up 320ms cubic-bezier(0.23,1,0.32,1) both' }}
      >
        {isPending ? (
          <span
            className="size-3 shrink-0 rounded-full border-[1.5px] border-border border-t-foreground"
            style={{ animation: 'spin 700ms linear infinite' }}
          />
        ) : isError ? (
          <X size={14} strokeWidth={2.5} className="shrink-0 text-destructive" />
        ) : (
          <Check size={14} strokeWidth={2.5} className="shrink-0 text-muted-foreground check-pop" />
        )}
        <span className="min-w-0 truncate text-[12.5px] font-medium text-foreground">{verb}</span>
        {target && (
          <span className="min-w-0 shrink-0 truncate font-mono text-[11.5px] text-muted-foreground">
            {target}
          </span>
        )}
        {isError && (
          <span className="shrink-0 text-[11px] font-semibold text-destructive">Error</span>
        )}
        {expanded ? (
          <ChevronDown size={12} className="ml-auto shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight size={12} className="ml-auto shrink-0 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="ml-6 space-y-2 px-1.5 pb-1.5">
          {call.params && Object.keys(call.params).length > 0 && (
            <div>
              <span className="text-[10px] text-muted-foreground uppercase font-sans font-bold">
                Params
              </span>
              <pre className="mt-0.5 p-1.5 bg-surface-2 rounded text-[11px] font-mono overflow-x-auto text-foreground whitespace-pre-wrap max-h-40">
                {JSON.stringify(call.params, null, 2)}
              </pre>
            </div>
          )}

          {call.result && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-muted-foreground uppercase font-sans font-bold">
                  Result
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    const contentStr =
                      typeof call.result === 'string'
                        ? call.result
                        : JSON.stringify(call.result, null, 2);
                    const titleStr =
                      (call.params?.title as string) ||
                      (call.params?.path as string) ||
                      (call.capability as string);

                    useAppStore.getState().openArtifact({
                      type: call.capability.includes('note') ? 'note' : 'file',
                      title: titleStr,
                      content: contentStr,
                    });
                  }}
                  className="px-2 py-0.5 bg-foreground text-background font-semibold rounded text-[10px] hover:opacity-90 transition-opacity cursor-pointer font-sans"
                >
                  Preview Artifact ↗
                </button>
              </div>
              <pre className="mt-0.5 p-1.5 bg-surface-2 rounded text-[11px] font-mono overflow-x-auto text-foreground whitespace-pre-wrap max-h-48">
                {typeof call.result === 'string'
                  ? call.result
                  : JSON.stringify(call.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
