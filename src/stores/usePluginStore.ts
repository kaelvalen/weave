import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
import type { Plugin, PluginCategory } from '@/types/plugin';

/** Extract a human-readable message from Tauri error objects.
 *  Tauri serializes Rust enums as { "VariantName": data }, not plain strings. */
function extractError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && err !== null) {
    // Tauri serializes WeaveError variants as { "VariantName": "msg" } or { "VariantName": { field: value } }
    const keys = Object.keys(err);
    if (keys.length > 0) {
      const val = (err as any)[keys[0]];
      if (typeof val === 'string') return val;
      if (typeof val === 'object' && val !== null) {
        // e.g. { plugin_id: "...", reason: "..." }
        return val.reason || val.message || val.stderr || JSON.stringify(val);
      }
    }
    return JSON.stringify(err);
  }
  return String(err);
}

interface PluginState {
  plugins: Plugin[];
  loadedPlugins: string[];
  autoLoadPlugins: string[];
  activePlugin: string | null;
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
  selectedCategory: string | null;

  discoverPlugins: () => Promise<void>;
  loadPlugin: (id: string) => Promise<void>;
  unloadPlugin: (id: string) => Promise<void>;
  executeCapability: (pluginId: string, cap: string, params: Record<string, unknown>) => Promise<unknown>;
  getPluginIdForCapability: (cap: string) => string | undefined;
  getPluginsByCategory: (cat: PluginCategory) => Plugin[];
  setSearchQuery: (q: string) => void;
  setCategory: (c: string | null) => void;
  refreshPlugins: () => Promise<void>;
  clearError: () => void;
}

export const usePluginStore = create<PluginState>()(
  persist(
    immer((set, get) => ({
      plugins: [],
      loadedPlugins: [],
      autoLoadPlugins: [],
      activePlugin: null,
    isLoading: false,
    error: null,
    searchQuery: '',
    selectedCategory: null,

    discoverPlugins: async () => {
      set((state) => { state.isLoading = true; state.error = null; });
      try {
        const plugins: Plugin[] = await invoke('plugin_discover');
        
        // Find plugins that should be auto-loaded but aren't yet
        const { autoLoadPlugins } = get();
        const toLoad = plugins.filter(p => 
          autoLoadPlugins.includes(p.id) && p.state !== 'active' && p.state !== 'loaded'
        );

        set((state) => {
          state.plugins = plugins;
          state.loadedPlugins = plugins
            .filter((p) => p.state === 'active' || p.state === 'loaded')
            .map((p) => p.id);
          state.isLoading = false;
        });

        // Trigger background loads for saved plugins
        for (const p of toLoad) {
          get().loadPlugin(p.id).catch(console.error);
        }
      } catch (err) {
        const msg = extractError(err);
        console.error('Failed to discover plugins:', msg);
        set((state) => { state.isLoading = false; state.error = `Plugin discovery failed: ${msg}`; });
      }
    },

    loadPlugin: async (id: string) => {
      set((state) => { state.error = null; });
      try {
        const plugin: Plugin = await invoke('plugin_load', { pluginId: id });
        set((state) => {
          const idx = state.plugins.findIndex((p) => p.id === id);
          if (idx >= 0) { state.plugins[idx] = plugin; }
          if (!state.loadedPlugins.includes(id)) { state.loadedPlugins.push(id); }
          if (!state.autoLoadPlugins.includes(id)) { state.autoLoadPlugins.push(id); }
        });
      } catch (err) {
        const msg = extractError(err);
        console.error(`Failed to load plugin ${id}:`, msg);
        set((state) => { state.error = `Failed to load ${id}: ${msg}`; });
      }
    },

    unloadPlugin: async (id: string) => {
      set((state) => { state.error = null; });
      try {
        await invoke('plugin_unload', { pluginId: id });
        set((state) => {
          const idx = state.plugins.findIndex((p) => p.id === id);
          if (idx >= 0) { state.plugins[idx] = { ...state.plugins[idx], state: 'unloaded' }; }
          state.loadedPlugins = state.loadedPlugins.filter((pid) => pid !== id);
          state.autoLoadPlugins = state.autoLoadPlugins.filter((pid) => pid !== id);
        });
      } catch (err) {
        const msg = extractError(err);
        console.error(`Failed to unload plugin ${id}:`, msg);
        set((state) => { state.error = `Failed to unload ${id}: ${msg}`; });
      }
    },

    executeCapability: async (pluginId: string, cap: string, params: Record<string, unknown>) => {
      try {
        const result = await invoke('plugin_execute', { pluginId, capability: cap, params });
        return result;
      } catch (err) {
        console.error(`Failed to execute ${pluginId}::${cap}:`, err);
        throw err;
      }
    },

    getPluginIdForCapability: (cap: string) => {
      const state = get();
      for (const plugin of state.plugins) {
        if (plugin.capabilities?.provide?.includes(cap)) {
          return plugin.id;
        }
      }
      return undefined;
    },

    getPluginsByCategory: (cat: PluginCategory) => {
      return get().plugins.filter((p) => p.category === cat);
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

    clearError: () => {
      set((state) => { state.error = null; });
    },
  })),
  {
    name: 'weave-plugin-store',
    partialize: (state) => ({ autoLoadPlugins: state.autoLoadPlugins }),
  }
  )
);
