/**
 * Capabilities that mutate files or system state and therefore require
 * explicit user approval before execution. This set is the single source of
 * truth for the approval gate in `useChatStore` and for the "requires
 * approval" badges in the Capabilities view.
 */
export const DESTRUCTIVE_CAPS: ReadonlySet<string> = new Set([
  'file.write',
  'file.delete',
  'file.mkdir',
  'coder.write_file',
  'coder.apply_diff',
  'coder.apply_patch',
  'coder.revert_file',
  'coder.undo',
  'coder.redo',
  'coder.rename_symbol',
  'coder.format',
  'coder.lint',
  'coder.run_check',
  'coder.run_tests',
  'coder.git_commit',
  'shell.exec',
  'shell.run',
  'git.init',
  'git.add',
  'git.commit',
  'db.execute',
  'note.delete',
  'note.update',
  'note.toggle_pin',
  'memory.store',
  'memory.delete',
  'memory.update_profile',
  'canvas.add_node',
  'canvas.update_node',
  'canvas.delete_node',
  'canvas.connect_nodes',
  'canvas.clear',
  'workflow.create',
  'workflow.delete',
]);

/**
 * Capabilities that read local data or make network requests. They are not
 * destructive, but they are the main exfiltration surface: a prompt-injected
 * tool call could otherwise ship file contents or internal web endpoints to
 * the cloud model without the user noticing. They therefore sit behind the
 * same approval gate as destructive capabilities.
 */
export const SENSITIVE_CAPS: ReadonlySet<string> = new Set([
  'file.read',
  'file.list',
  'file.search',
  'coder.read_file',
  'coder.list_dir',
  'coder.symbols',
  'coder.search',
  'coder.find_references',
  'coder.history',
  'coder.git_status',
  'coder.git_diff',
  'coder.patch_preview',
  'git.status',
  'git.log',
  'git.diff',
  'git.branch',
  'db.query',
  'db.tables',
  'web.fetch',
  'http.request',
  'note.list',
  'note.get',
  'note.search',
  'memory.recall',
  'memory.list',
  'memory.get_profile',
  'workflow.list',
  'workflow.get',
]);

/** Whether executing this capability can modify files or system state. */
export function isDestructiveCapability(name: string): boolean {
  return DESTRUCTIVE_CAPS.has(name);
}

/** Whether this capability can read local data or reach the network. */
export function isSensitiveCapability(name: string): boolean {
  return SENSITIVE_CAPS.has(name);
}

/**
 * Whether this capability requires user approval before execution:
 * destructive capabilities, plus sensitive read/network capabilities.
 */
export function requiresApproval(name: string): boolean {
  return isDestructiveCapability(name) || isSensitiveCapability(name);
}
