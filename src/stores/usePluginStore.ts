import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { invoke } from '@tauri-apps/api/core';
import type { Plugin } from '@/types/plugin';

interface PluginState {
  plugins: Plugin[];
  loadedPlugins: string[];
  activePlugin: string | null;
  isLoading: boolean;
  searchQuery: string;
  selectedCategory: string | null;

  discoverPlugins: () => Promise<void>;
  loadPlugin: (id: string) => Promise<void>;
  unloadPlugin: (id: string) => Promise<void>;
  executeCapability: (pluginId: string, cap: string, params: Record<string, unknown>) => Promise<unknown>;
  setSearchQuery: (q: string) => void;
  setCategory: (c: string | null) => void;
  refreshPlugins: () => Promise<void>;
}

export const usePluginStore = create<PluginState>()(
  immer((set, get) => ({
    plugins: [],
    loadedPlugins: [],
    activePlugin: null,
    isLoading: false,
    searchQuery: '',
    selectedCategory: null,

    discoverPlugins: async () => {
      set((state) => { state.isLoading = true; });
      try {
        const plugins: Plugin[] = await invoke('plugin_discover');
        set((state) => {
          state.plugins = plugins;
          state.loadedPlugins = plugins
            .filter((p) => p.state === 'active' || p.state === 'loaded')
            .map((p) => p.id);
          state.isLoading = false;
        });
      } catch (err) {
        console.error('Failed to discover plugins:', err);
        set((state) => { state.isLoading = false; });
      }
    },

    loadPlugin: async (id: string) => {
      try {
        const plugin: Plugin = await invoke('plugin_load', { pluginId: id });
        set((state) => {
          const idx = state.plugins.findIndex((p) => p.id === id);
          if (idx >= 0) {
            state.plugins[idx] = plugin;
          }
          if (!state.loadedPlugins.includes(id)) {
            state.loadedPlugins.push(id);
          }
        });
      } catch (err) {
        console.error(`Failed to load plugin ${id}:`, err);
      }
    },

    unloadPlugin: async (id: string) => {
      try {
        await invoke('plugin_unload', { pluginId: id });
        set((state) => {
          const idx = state.plugins.findIndex((p) => p.id === id);
          if (idx >= 0) {
            state.plugins[idx] = { ...state.plugins[idx], state: 'unloaded' };
          }
          state.loadedPlugins = state.loadedPlugins.filter((pid) => pid !== id);
        });
      } catch (err) {
        console.error(`Failed to unload plugin ${id}:`, err);
      }
    },

    executeCapability: async (pluginId: string, cap: string, params: Record<string, unknown>) => {
      try {
        const result = await invoke('plugin_execute', {
          pluginId,
          capability: cap,
          params,
        });
        return result;
      } catch (err) {
        console.error(`Failed to execute ${pluginId}::${cap}:`, err);
        throw err;
      }
    },

    setSearchQuery: (q: string) => {
      set((state) => { state.searchQuery = q; });
    },

    setCategory: (c: string | null) => {
      set((state) => { state.selectedCategory = c; });
    },

    refreshPlugins: async () => {
      await get().discoverPlugins();
    },
  }))
);
