import { useState, type ReactNode } from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';

/**
 * Collapsible trace wrapper with the same visual language as GoalTrace —
 * a compact sparkle header that expands into the trace content. Used to
 * keep old (segment-less) messages inside a trace box instead of rendering
 * the activity list bare.
 */
export function TraceBox({
  defaultOpen = false,
  title = 'Tool activity',
  children,
}: {
  defaultOpen?: boolean;
  title?: string;
  children: ReactNode;
}) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const expanded = manualOpen ?? defaultOpen;

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setManualOpen((current) => !(current ?? defaultOpen))}
        className="-mx-1.5 flex w-fit items-center gap-2 rounded-md px-1.5 py-1 transition-colors duration-100 hover:bg-muted/50"
      >
        <Sparkles
          size={16}
          strokeWidth={1.5}
          fill="currentColor"
          className="text-muted-foreground/60"
        />
        <span
          className="text-[13px] font-medium whitespace-nowrap text-muted-foreground"
          style={{ animation: 'fade-in 350ms ease-out both' }}
        >
          {title}
        </span>
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
          <div className="mt-1 pl-4">{children}</div>
        </div>
      </div>
    </div>
  );
}
