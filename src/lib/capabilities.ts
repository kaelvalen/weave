/**
 * Capabilities that mutate files or system state and therefore require
 * explicit user approval before execution. This set is the single source of
 * truth for the approval gate in `useChatStore` and for the "requires
 * approval" badges in the Capabilities view.
 */
export const DESTRUCTIVE_CAPS: ReadonlySet<string> = new Set([
  'file.write',
  'file.delete',
  'coder.write_file',
  'coder.apply_diff',
  'coder.revert_file',
  'shell.exec',
  'shell.run',
  'note.delete',
]);

/** Whether executing this capability can modify files or system state. */
export function isDestructiveCapability(name: string): boolean {
  return DESTRUCTIVE_CAPS.has(name);
}
