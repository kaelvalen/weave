import { SectionLabel } from './SectionLabel';

/**
 * Flat surface card framing a user message as an executable GOAL.
 * Presentational wrapper — hover actions and body are injected by the caller
 * so copy/edit behavior stays in ChatMessage.
 */
export function GoalCard({
  headerRight,
  children,
}: {
  /** Timestamp / hover actions rendered on the label row. */
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-surface-1 px-4 py-3">
      <div className="flex items-center gap-2">
        <SectionLabel>Goal</SectionLabel>
        {headerRight}
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}
