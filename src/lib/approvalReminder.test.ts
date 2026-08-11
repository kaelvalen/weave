import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  maybeWarnAboutBypassedGate,
  resetApprovalReminderForTests,
  type ApprovalMode,
} from './approvalReminder';

vi.mock('sonner', () => ({
  toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

import { toast } from 'sonner';

describe('maybeWarnAboutBypassedGate (Phase-7 #9)', () => {
  beforeEach(() => {
    resetApprovalReminderForTests();
    vi.mocked(toast.warning).mockClear();
  });

  it('shows the reminder exactly once per runtime when Auto-Approve is active', () => {
    let mode: ApprovalMode = 'accept-edits';
    const getMode = () => mode;
    const setMode = (m: ApprovalMode) => {
      mode = m;
    };

    expect(maybeWarnAboutBypassedGate(getMode, setMode)).toBe(true);
    // StrictMode double-mount / second effect run must not re-show it.
    expect(maybeWarnAboutBypassedGate(getMode, setMode)).toBe(false);
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });

  it('does not show the reminder in Ask mode', () => {
    const shown = maybeWarnAboutBypassedGate(() => 'ask', () => {});
    expect(shown).toBe(false);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('offers an action that switches back to Ask', () => {
    let mode: ApprovalMode = 'accept-edits';
    maybeWarnAboutBypassedGate(
      () => mode,
      (m) => {
        mode = m;
      }
    );

    const call = vi.mocked(toast.warning).mock.calls[0];
    expect(call[1]).toMatchObject({ duration: Infinity });
    const action = (call[1] as { action?: { label: string; onClick: () => void } }).action;
    expect(action?.label).toBe('Switch to Ask');
    action?.onClick();
    expect(mode).toBe('ask');
  });
});
