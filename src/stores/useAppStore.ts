import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { View } from '@/types/app';

interface AppState {
  activeView: View;
  isReady: boolean;
  appVersion: string;
  lastConfigUpdate: number;
  isChatExpanded: boolean;

  setActiveView: (view: View) => void;
  setReady: (ready: boolean) => void;
  setVersion: (v: string) => void;
  refreshConfig: () => void;
  toggleChat: (expanded?: boolean) => void;
}

export const useAppStore = create<AppState>()(
  immer((set) => ({
    activeView: 'files',
    isReady: false,
    appVersion: '0.2.0',
    lastConfigUpdate: 0,
    isChatExpanded: false,

    setActiveView: (view: View) => {
      set((state) => { state.activeView = view; });
    },

    setReady: (ready: boolean) => {
      set((state) => { state.isReady = ready; });
    },

    setVersion: (v: string) => {
      set((state) => { state.appVersion = v; });
    },

    refreshConfig: () => {
      set((state) => { state.lastConfigUpdate = Date.now(); });
    },

    toggleChat: (expanded?: boolean) => {
      set((state) => {
        state.isChatExpanded = expanded !== undefined ? expanded : !state.isChatExpanded;
      });
    },
  }))
);
