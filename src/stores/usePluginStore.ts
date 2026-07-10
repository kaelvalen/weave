import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import type { GithubRepo, Plugin, PluginCategory } from '@/types/plugin';
import { extractError } from '@/lib/errors';

interface PluginState {
  plugins: Plugin[];
  loadedPlugins: string[];
  autoLoadPlugins: string[];
  activePlugin: string | null;
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
  selectedCategory: string | null;
  githubRepos: GithubRepo[];
  githubOrg: string;

  discoverPlugins: () => Promise<void>;
  installFromFile: (sourcePath: string) => Promise<void>;
  loadPlugin: (id: string) => Promise<void>;
  unloadPlugin: (id: string) => Promise<void>;
  executeCapability: (
    pluginId: string,
    cap: string,
    params: Record<string, unknown>
  ) => Promise<unknown>;
  getPluginIdForCapability: (cap: string) => string | undefined;
  getPluginsByCategory: (cat: PluginCategory) => Plugin[];
  setSearchQuery: (q: string) => void;
  setCategory: (c: string | null) => void;
  refreshPlugins: () => Promise<void>;
  clearError: () => void;
  fetchGithubPlugins: (org?: string) => Promise<void>;
  installFromGithubRepo: (repoUrl: string) => Promise<void>;
  installFromGithubRelease: (repoUrl: string, tag?: string, asset?: string) => Promise<void>;
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
      githubRepos: [],
      githubOrg: 'weave-plugins',

      discoverPlugins: async () => {
        set((state) => {
          state.isLoading = true;
          state.error = null;
        });
        try {
          const plugins: Plugin[] = await invoke('plugin_discover');

          // Find plugins that should be auto-loaded but aren't yet
          const { autoLoadPlugins } = get();
          const toLoad = plugins.filter(
            (p) => autoLoadPlugins.includes(p.id) && p.state !== 'active' && p.state !== 'loaded'
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
            get().loadPlugin(p.id);
          }
        } catch (err) {
          const msg = extractError(err);
          toast.error(`Plugin discovery failed: ${msg}`);
          set((state) => {
            state.isLoading = false;
            state.error = `Plugin discovery failed: ${msg}`;
          });
        }
      },

      installFromFile: async (sourcePath: string) => {
        set((state) => {
          state.isLoading = true;
          state.error = null;
        });
        try {
          const plugins: Plugin[] = await invoke('plugin_install_from_file', {
            sourcePath,
          });
          set((state) => {
            state.plugins = plugins;
            state.loadedPlugins = plugins
              .filter((p) => p.state === 'active' || p.state === 'loaded')
              .map((p) => p.id);
            state.isLoading = false;
          });
          toast.success('Plugin installed successfully');
        } catch (err) {
          const msg = extractError(err);
          toast.error(`Plugin install failed: ${msg}`);
          set((state) => {
            state.isLoading = false;
            state.error = `Plugin install failed: ${msg}`;
          });
        }
      },

      loadPlugin: async (id: string) => {
        set((state) => {
          state.error = null;
        });
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
            if (!state.autoLoadPlugins.includes(id)) {
              state.autoLoadPlugins.push(id);
            }
          });
        } catch (err) {
          const msg = extractError(err);
          toast.error(`Failed to load ${id}: ${msg}`);
          set((state) => {
            state.error = `Failed to load ${id}: ${msg}`;
          });
        }
      },

      unloadPlugin: async (id: string) => {
        set((state) => {
          state.error = null;
        });
        try {
          await invoke('plugin_unload', { pluginId: id });
          set((state) => {
            const idx = state.plugins.findIndex((p) => p.id === id);
            if (idx >= 0) {
              state.plugins[idx] = { ...state.plugins[idx], state: 'unloaded' };
            }
            state.loadedPlugins = state.loadedPlugins.filter((pid) => pid !== id);
            state.autoLoadPlugins = state.autoLoadPlugins.filter((pid) => pid !== id);
          });
        } catch (err) {
          const msg = extractError(err);
          toast.error(`Failed to unload ${id}: ${msg}`);
          set((state) => {
            state.error = `Failed to unload ${id}: ${msg}`;
          });
        }
      },

      executeCapability: async (pluginId: string, cap: string, params: Record<string, unknown>) => {
        return invoke('plugin_execute', { pluginId, capability: cap, params });
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
        set((state) => {
          state.searchQuery = q;
        });
      },

      setCategory: (c: string | null) => {
        set((state) => {
          state.selectedCategory = c;
        });
      },

      refreshPlugins: async () => {
        await get().discoverPlugins();
      },

      clearError: () => {
        set((state) => {
          state.error = null;
        });
      },

      fetchGithubPlugins: async (org?: string) => {
        const targetOrg = org || get().githubOrg;
        set((state) => {
          state.isLoading = true;
          state.error = null;
        });
        try {
          const repos: GithubRepo[] = await invoke('plugin_list_github_repos', {
            org: targetOrg,
          });
          set((state) => {
            state.githubRepos = repos;
            state.githubOrg = targetOrg;
            state.isLoading = false;
          });
        } catch (err) {
          const msg = extractError(err);
          toast.error(`Failed to list GitHub plugins: ${msg}`);
          set((state) => {
            state.isLoading = false;
            state.error = `Failed to list GitHub plugins: ${msg}`;
          });
        }
      },

      installFromGithubRepo: async (repoUrl: string) => {
        set((state) => {
          state.isLoading = true;
          state.error = null;
        });
        try {
          const plugins: Plugin[] = await invoke('plugin_install_from_github_repo', {
            repoUrl,
          });
          set((state) => {
            state.plugins = plugins;
            state.loadedPlugins = plugins
              .filter((p) => p.state === 'active' || p.state === 'loaded')
              .map((p) => p.id);
            state.isLoading = false;
          });
          toast.success('Plugin installed from GitHub repository');
        } catch (err) {
          const msg = extractError(err);
          toast.error(`GitHub plugin install failed: ${msg}`);
          set((state) => {
            state.isLoading = false;
            state.error = `GitHub plugin install failed: ${msg}`;
          });
        }
      },

      installFromGithubRelease: async (repoUrl: string, tag?: string, asset?: string) => {
        set((state) => {
          state.isLoading = true;
          state.error = null;
        });
        try {
          const plugins: Plugin[] = await invoke('plugin_install_from_github_release', {
            repoUrl,
            tag,
            asset_name: asset,
          });
          set((state) => {
            state.plugins = plugins;
            state.loadedPlugins = plugins
              .filter((p) => p.state === 'active' || p.state === 'loaded')
              .map((p) => p.id);
            state.isLoading = false;
          });
          toast.success('Plugin installed from GitHub release');
        } catch (err) {
          const msg = extractError(err);
          toast.error(`GitHub release install failed: ${msg}`);
          set((state) => {
            state.isLoading = false;
            state.error = `GitHub release install failed: ${msg}`;
          });
        }
      },
    })),
    {
      name: 'weave-plugin-store',
      partialize: (state) => ({ autoLoadPlugins: state.autoLoadPlugins }),
    }
  )
);
