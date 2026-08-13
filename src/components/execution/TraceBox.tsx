import { useState, type ReactNode } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronRight } from 'lucide-react';

/**
 * Collapsible trace wrapper with the same visual language as GoalTrace —
 * a one-line "Trace: <id>" header that expands on click. Used to keep old
 * (segment-less) messages inside a trace box instead of rendering the
 * activity list bare.
 */
export function TraceBox({
  goalId,
  defaultOpen = false,
  children,
}: {
  goalId: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mb-2 last:mb-0">
      <div className="rounded-lg bg-surface-1">
        <CollapsibleTrigger className="w-full flex items-center gap-2 px-2.5 py-1.5 font-mono text-xs hover:bg-surface-2 rounded-t-lg transition-colors group">
          <ChevronRight className="w-3 h-3 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
          <span className="text-foreground font-semibold truncate">Trace: {goalId.slice(0, 8)}</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-2.5 pb-2.5">{children}</div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
