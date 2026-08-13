import type { ReactNode } from 'react';

interface ViewHeaderProps {
  title: string;
  /** Short count/label next to the title. */
  count?: string;
  /** Right-aligned actions (search inputs, buttons, ...). */
  actions?: ReactNode;
}

/**
 * Minimal view title row — deliberately NOT a bar: no background, no icon
 * tile, no subtitle. Just a small uppercase label in the app's existing
 * section-label language (Goal / Plan / Steps), with actions on the right.
 */
export function ViewHeader({ title, count, actions }: ViewHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-4 px-6 pt-5 pb-3 shrink-0">
      <div className="flex items-baseline gap-2 min-w-0">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {title}
        </h2>
        {count && (
          <span className="text-[11px] font-mono text-muted-foreground/60 whitespace-nowrap">
            {count}
          </span>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
