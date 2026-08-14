import { useMemo, useState } from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';

/**
 * Expandable reasoning trace — the design's "Reasoning" variant, backed by
 * the provider's real thinking tokens (streamed via chat-reasoning-chunk).
 *
 * While the model thinks the header shimmers "Thinking" and the trace stays
 * open; once the reasoning phase settles it collapses to "Thought for Ns"
 * and stays manually expandable.
 */
export function ReasoningTrace({
  text,
  active,
  seconds,
}: {
  text: string;
  active: boolean;
  seconds?: number;
}) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const expanded = manualOpen ?? active;

  // One row per paragraph — prose that reads like the model's internal notes.
  const rows = useMemo(
    () =>
      text
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean),
    [text]
  );

  if (rows.length === 0 && !active) return null;

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setManualOpen((current) => !(current ?? active))}
        className="-mx-1.5 flex w-fit items-center gap-2 rounded-md px-1.5 py-1 transition-colors duration-100 hover:bg-muted/50"
      >
        <Sparkles
          size={16}
          strokeWidth={1.5}
          fill="currentColor"
          className={active ? 'text-muted-foreground' : 'text-muted-foreground/60'}
        />
        {active ? (
          <span
            className="bg-clip-text text-[13px] font-medium whitespace-nowrap text-transparent"
            style={{
              backgroundImage:
                'linear-gradient(90deg, hsl(var(--muted-foreground)) 35%, hsl(var(--foreground)) 50%, hsl(var(--muted-foreground)) 65%)',
              backgroundSize: '200% 100%',
              animation: 'shimmer-text 1.4s linear infinite',
            }}
          >
            Thinking
          </span>
        ) : (
          <span
            className="text-[13px] font-medium whitespace-nowrap text-muted-foreground"
            style={{ animation: 'fade-in 350ms ease-out both' }}
          >
            {seconds ? `Thought for ${seconds}s` : 'Reasoning'}
          </span>
        )}
        <ChevronDown
          size={14}
          strokeWidth={2.2}
          className="shrink-0 text-muted-foreground transition-transform duration-300"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0)' }}
        />
      </button>

      <div
        className="grid transition-[grid-template-rows,opacity] duration-400"
        style={{
          gridTemplateRows: expanded ? '1fr' : '0fr',
          opacity: expanded ? 1 : 0,
          transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)',
        }}
      >
        <div className="overflow-hidden">
          <div className="flex flex-col gap-1 py-1">
            {rows.map((row, i) => (
              <div
                key={i}
                className="flex min-h-7 w-full items-center gap-2 rounded-[6px] px-1.5 py-0.5 text-left"
                style={{
                  animation: `fade-up 320ms cubic-bezier(0.23,1,0.32,1) ${i * 120}ms both`,
                }}
              >
                <span className="whitespace-normal text-[12.5px] leading-relaxed text-muted-foreground">
                  {row}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
