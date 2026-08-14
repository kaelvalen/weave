import { useEffect, useMemo, useState } from 'react';

/* ─────────────────────────────────────────────────────────
 * STREAMING TEXT
 * Words resolve out of blur as the backend streams them in;
 * bare URLs in the text render as tiny favicon chips in
 * context. Shown only while the message is still streaming —
 * the settled markdown takes over once it completes.
 * ───────────────────────────────────────────────────────── */

const WORD_MS = 55;

/** Deterministic avatar for a domain: initial on a hue derived from it. */
function SourceAvatar({ domain }: { domain: string }) {
  const hue = useMemo(() => {
    let h = 0;
    for (const ch of domain) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return h;
  }, [domain]);
  return (
    <span
      className="flex size-3.5 shrink-0 items-center justify-center rounded-[4px] text-[8px] font-bold text-white"
      style={{ background: `hsl(${hue} 55% 42%)` }}
    >
      {domain[0]?.toUpperCase()}
    </span>
  );
}

/** A bare URL mid-sentence → tiny favicon chip, like the design's citations. */
function SourceChip({ url }: { url: string }) {
  let domain = url;
  try {
    domain = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    /* keep raw */
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="mx-0.5 inline-flex translate-y-[-1px] items-center gap-1 rounded-[5px] bg-surface-2 py-[1px] pr-[5px] pl-[3px] align-middle font-mono text-[10.5px] text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
      style={{ animation: 'pop-in 250ms cubic-bezier(0.23,1,0.32,1) both' }}
      onClick={(e) => e.stopPropagation()}
    >
      <SourceAvatar domain={domain} />
      <span>{domain}</span>
    </a>
  );
}

/** Split text into words that may each carry an embedded URL citation. */
type Word = { text: string; cite?: string };

function tokenize(text: string): Word[] {
  const out: Word[] = [];
  for (const word of text.split(' ')) {
    const urlMatch = word.match(/(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/i);
    if (urlMatch && urlMatch.index !== undefined) {
      let raw = urlMatch[1];
      // strip trailing punctuation that belongs to the sentence, not the URL
      raw = raw.replace(/[.,;:!?)\]]+$/, '');
      const before = word.slice(0, urlMatch.index);
      const after = word.slice(urlMatch.index + urlMatch[1].length);
      if (before) out.push({ text: before });
      if (raw) out.push({ text: '', cite: raw.startsWith('www.') ? `https://${raw}` : raw });
      if (after) out.push({ text: after });
    } else {
      out.push({ text: word });
    }
  }
  return out;
}

export function StreamingText({ text }: { text: string }) {
  const [revealed, setRevealed] = useState(0);
  const words = useMemo(() => tokenize(text), [text]);

  useEffect(() => {
    const t = setInterval(() => setRevealed((r) => r + 1), WORD_MS);
    return () => clearInterval(t);
  }, []);

  const visible = Math.min(revealed, words.length);

  return (
    <p className="w-full whitespace-pre-wrap text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]">
      {words.slice(0, visible).map((word, i) =>
        word.cite ? (
          <SourceChip key={`${i}-${word.cite}`} url={word.cite} />
        ) : (
          <span
            key={`${i}-${word.text}`}
            className="inline [will-change:filter,opacity]"
            style={{ animation: 'stream-in 420ms cubic-bezier(0.22,0.61,0.25,1) both' }}
          >
            {word.text}{' '}
          </span>
        )
      )}
      <span className="streaming-cursor" />
    </p>
  );
}
