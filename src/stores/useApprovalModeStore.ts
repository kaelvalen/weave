import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ApprovalMode = 'ask' | 'accept-edits';

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
      setMode: (mode) => set({ mode }),
      toggle: () => set({ mode: get().mode === 'ask' ? 'accept-edits' : 'ask' }),
    }),
    {
      name: 'weave-approval-mode',
    }
  )
);
