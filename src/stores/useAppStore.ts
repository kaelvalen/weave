import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { View } from '@/types/app';

export type CapabilityTab = 'context' | 'files' | 'notes' | 'knowledge' | 'models' | 'workflows' | 'canvas' | 'plugins';

export interface ActiveArtifact {
  id?: string;
  type: 'note' | 'file' | 'markdown' | 'code' | 'canvas';
  title: string;
  content: string;
  path?: string;
  language?: string;
}

interface AppState {
  activeView: View;
  activeCapabilityTab: CapabilityTab;
  isLeftSidebarOpen: boolean;
  isRightPanelOpen: boolean;
  activeArtifact: ActiveArtifact | null;
  isReady: boolean;
  appVersion: string;
  lastConfigUpdate: number;
  isChatExpanded: boolean;

  setActiveView: (view: View) => void;
  setActiveCapabilityTab: (tab: CapabilityTab) => void;
  toggleLeftSidebar: () => void;
  setRightPanelOpen: (open: boolean) => void;
  toggleRightPanel: () => void;
  openCapability: (tab: CapabilityTab) => void;
  openArtifact: (artifact: ActiveArtifact) => void;
  closeArtifact: () => void;
  setReady: (ready: boolean) => void;
  setVersion: (v: string) => void;
  refreshConfig: () => void;
  toggleChat: (expanded?: boolean) => void;
}

export const useAppStore = create<AppState>()(
  immer((set) => ({
    activeView: 'chat',
    activeCapabilityTab: 'context',
    isLeftSidebarOpen: true,
    isRightPanelOpen: false,
    activeArtifact: null,
    isReady: false,
    appVersion: '0.2.0',
    lastConfigUpdate: 0,
    isChatExpanded: false,

    setActiveView: (view: View) => {
      set((state) => {
        state.activeView = view;
      });
    },

    setActiveCapabilityTab: (tab: CapabilityTab) => {
      set((state) => {
        state.activeCapabilityTab = tab;
      });
    },

    toggleLeftSidebar: () => {
      set((state) => {
        state.isLeftSidebarOpen = !state.isLeftSidebarOpen;
      });
    },

    setRightPanelOpen: (open: boolean) => {
      set((state) => {
        state.isRightPanelOpen = open;
      });
    },

    toggleRightPanel: () => {
      set((state) => {
        state.isRightPanelOpen = !state.isRightPanelOpen;
        if (!state.isRightPanelOpen) {
          state.activeArtifact = null;
        }
      });
    },

    openCapability: (tab: CapabilityTab) => {
      set((state) => {
        state.activeView = 'chat';
        state.activeCapabilityTab = tab;
        state.isRightPanelOpen = true;
      });
    },

    openArtifact: (artifact: ActiveArtifact) => {
      set((state) => {
        state.activeArtifact = artifact;
        state.isRightPanelOpen = true;
      });
    },

    closeArtifact: () => {
      set((state) => {
        state.activeArtifact = null;
      });
    },

    setReady: (ready: boolean) => {
      set((state) => {
        state.isReady = ready;
      });
    },

    setVersion: (v: string) => {
      set((state) => {
        state.appVersion = v;
      });
    },

    refreshConfig: () => {
      set((state) => {
        state.lastConfigUpdate = Date.now();
      });
    },

    toggleChat: (expanded?: boolean) => {
      set((state) => {
        state.isChatExpanded = expanded !== undefined ? expanded : !state.isChatExpanded;
      });
    },
  }))
);
