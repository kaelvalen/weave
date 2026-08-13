import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';

export type ApprovalMode = 'ask' | 'accept-edits';

/** Push the mode to the backend so the agent loop actually bypasses the
 *  gate (previously the toggle was UI-only: the banner still appeared
 *  despite "gate off" being shown). Best-effort — a failed sync must not
 *  break the toggle. */
const syncToBackend = (mode: ApprovalMode) => {
  invoke('chat_set_approval_mode', { autoApprove: mode === 'accept-edits' }).catch(() => {});
};

interface ApprovalState {
  /** Whether destructive tool calls require per-call confirmation.
   *  - `ask`          : prompt the user for each destructive call (default)
   *  - `accept-edits` : auto-approve destructive calls for the whole session
   */
  mode: ApprovalMode;
  setMode: (mode: ApprovalMode) => void;
  toggle: () => void;
}

export const useApprovalModeStore = create<ApprovalState>()(
  persist(
    (set, get) => ({
      mode: 'ask',
      setMode: (mode) => {
        set({ mode });
        syncToBackend(mode);
      },
      toggle: () => {
        const next = get().mode === 'ask' ? 'accept-edits' : 'ask';
        set({ mode: next });
        syncToBackend(next);
      },
    }),
    {
      name: 'weave-approval-mode',
      onRehydrateStorage: () => (state) => {
        if (state) syncToBackend(state.mode);
      },
    }
  )
);
