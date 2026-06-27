import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { View, ThemeMode } from '@/types/app';

interface AppState {
  activeView: View;
  theme: ThemeMode;
  isReady: boolean;
  appVersion: string;
  lastConfigUpdate: number;

  setActiveView: (view: View) => void;
  setTheme: (theme: ThemeMode) => void;
  setReady: (ready: boolean) => void;
  setVersion: (v: string) => void;
  refreshConfig: () => void;
}

export const useAppStore = create<AppState>()(
  immer((set) => ({
    activeView: 'chat',
    theme: 'system',
    isReady: false,
    appVersion: '0.1.0',
    lastConfigUpdate: 0,

    setActiveView: (view: View) => {
      set((state) => { state.activeView = view; });
    },

    setTheme: (theme: ThemeMode) => {
      set((state) => { state.theme = theme; });
      if (theme === 'dark') {
        document.documentElement.classList.add('dark');
      } else if (theme === 'light') {
        document.documentElement.classList.remove('dark');
      }
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
  }))
);
