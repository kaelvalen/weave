import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useApprovalModeStore } from '@/stores/useApprovalModeStore';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

/**
 * Ask / Auto-Approve approval-mode switcher, compact enough for the
 * composer's action row. Enabling Auto-Approve goes through a confirm
 * dialog; the amber state + shield icon mark the bypassed gate.
 */
export function ApprovalModeToggle() {
  const approvalMode = useApprovalModeStore((s) => s.mode);
  const setApprovalMode = useApprovalModeStore((s) => s.setMode);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isAuto = approvalMode === 'accept-edits';

  return (
    <>
      <div
        className="flex items-center bg-surface-3 rounded-lg p-0.5 border border-border/40 font-mono"
        title={
          isAuto
            ? 'The approval gate is bypassed: sensitive reads, network requests, and destructive operations run without confirmation until you switch back to Ask.'
            : 'Ask before running sensitive reads, network requests, and destructive operations.'
        }
      >
        <button
          type="button"
          onClick={() => setApprovalMode('ask')}
          className={`px-2 py-1 rounded-md text-[11px] transition-colors ${
            !isAuto
              ? 'bg-surface-1 text-foreground font-semibold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Ask
        </button>
        <button
          type="button"
          onClick={() => {
            if (isAuto) return;
            setConfirmOpen(true);
          }}
          className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] transition-colors ${
            isAuto
              ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 font-semibold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {isAuto && <ShieldAlert className="w-3 h-3" />}
          Auto
        </button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Bypass the approval gate?"
        description="In Auto-Approve mode, sensitive reads, network requests, and destructive operations run without confirmation. The mode persists across restarts and the Auto button stays lit as long as it is on — switch back to Ask anytime."
        confirmLabel="Enable Auto-Approve"
        onConfirm={() => {
          setApprovalMode('accept-edits');
        }}
      />
    </>
  );
}
