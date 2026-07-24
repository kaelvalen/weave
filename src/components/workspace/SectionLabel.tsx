/**
 * Shared chrome label for Execution Workspace sections
 * (GOAL / PLAN / OUTPUT) — mono, 10px, uppercase, tracking-wider.
 */
export function SectionLabel({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`font-mono text-[10px] uppercase tracking-wider text-muted-foreground ${className}`}>
      {children}
    </div>
  );
}
