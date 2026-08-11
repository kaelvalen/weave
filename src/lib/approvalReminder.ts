import { toast } from 'sonner';

export type ApprovalMode = 'ask' | 'accept-edits';

/** Once-per-runtime guard (React StrictMode double-mounts effects in dev). */
let reminderShown = false;

export function resetApprovalReminderForTests() {
  reminderShown = false;
}

/**
 * Phase-7 finding #9: the approval mode is persisted (useApprovalModeStore),
 * so a bypassed gate from a previous session must not go unnoticed. Show a
 * single, non-dismissable startup reminder when Auto-Approve is active, with
 * an action to switch back to Ask.
 *
 * Returns true when the reminder was shown.
 */
export function maybeWarnAboutBypassedGate(
  getMode: () => ApprovalMode,
  setMode: (mode: ApprovalMode) => void
): boolean {
  if (reminderShown || getMode() !== 'accept-edits') return false;
  reminderShown = true;
  toast.warning(
    'Approval gate is OFF (Auto-Approve mode from a previous session). Sensitive and destructive tool calls will run without confirmation.',
    {
      duration: Infinity,
      action: {
        label: 'Switch to Ask',
        onClick: () => setMode('ask'),
      },
    }
  );
  return true;
}
