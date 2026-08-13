import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import type { GithubRepo, McpServerSummary, Plugin, PluginCategory } from '@/types/plugin';
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
  mcpServers: McpServerSummary[];

  discoverPlugins: () => Promise<void>;
  installFromFile: (sourcePath: string) => Promise<void>;
  loadPlugin: (id: string) => Promise<void>;
  unloadPlugin: (id: string) => Promise<void>;
  executeCapability: (
    pluginId: string,
    cap: string,
    params: Record<string, unknown>,
    traceId?: string
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
  fetchMcpServers: () => Promise<void>;
  addMcpServer: (url: string, name: string) => Promise<boolean>;
  oauthAuthorize: (serverId: string) => Promise<unknown>;
  oauthRefresh: (serverId: string) => Promise<void>;
  removeMcpServer: (serverId: string) => Promise<void>;
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
      mcpServers: [],

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

      executeCapability: async (
        pluginId: string,
        cap: string,
        params: Record<string, unknown>,
        traceId?: string
      ) => {
        return invoke('plugin_execute', { pluginId, capability: cap, params, traceId });
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

      fetchMcpServers: async () => {
        try {
          const servers: McpServerSummary[] = await invoke('mcp_list_servers');
          set((state) => {
            state.mcpServers = servers;
          });
        } catch (err) {
          const msg = extractError(err);
          toast.error(`Failed to list MCP servers: ${msg}`);
        }
      },

      // MCP-sourced capabilities default to approval-gated on the backend
      // (docs/phase8-mcp-spec.md Part 2 §2) — no client-side gating logic
      // here, this only adds the server as a capability source.
      addMcpServer: async (url: string, name: string) => {
        set((state) => {
          state.isLoading = true;
          state.error = null;
        });
        try {
          const plugin: Plugin = await invoke('mcp_add_server', { url, name });
          set((state) => {
            const idx = state.plugins.findIndex((p) => p.id === plugin.id);
            if (idx >= 0) {
              state.plugins[idx] = plugin;
            } else {
              state.plugins.push(plugin);
            }
            state.loadedPlugins.push(plugin.id);
            state.isLoading = false;
          });
          await get().fetchMcpServers();
          toast.success(`Added MCP server "${plugin.name}"`);
          return true;
        } catch (err) {
          const msg = extractError(err);
          toast.error(`Failed to add MCP server: ${msg}`);
          set((state) => {
            state.isLoading = false;
            state.error = `Failed to add MCP server: ${msg}`;
          });
          return false;
        }
      },

      // OAuth 2.1 / CIMD (docs/phase8-mcp-spec.md Part 2 §4–§5): opens the
      // authorization page in the system browser; the backend's loopback
      // listener captures the redirect and exchanges the code for tokens,
      // so this command resolves only after the round trip (or timeout).
      oauthAuthorize: async (serverId: string) => {
        set((state) => {
          state.isLoading = true;
          state.error = null;
        });
        try {
          const result = await invoke('mcp_oauth_authorize', { serverId });
          // Backend re-registered the plugin with the authorized tool list;
          // refresh BOTH state sources — mcpServers (server summary) and
          // plugins (the DISCOVERED cards render from this). Only fetching
          // mcpServers leaves the cards showing the pre-auth 0-tool plugin.
          await get().fetchMcpServers();
          await get().discoverPlugins();
          set((state) => {
            state.isLoading = false;
          });
          toast.success(`Authorized MCP server "${serverId}"`);
          return result;
        } catch (err) {
          const msg = extractError(err);
          toast.error(`OAuth authorization failed: ${msg}`);
          set((state) => {
            state.isLoading = false;
            state.error = `OAuth authorization failed: ${msg}`;
          });
          throw err;
        }
      },

      oauthRefresh: async (serverId: string) => {
        try {
          await invoke('mcp_oauth_refresh', { serverId });
          await get().fetchMcpServers();
          toast.success('Access token refreshed');
        } catch (err) {
          const msg = extractError(err);
          toast.error(`Token refresh failed: ${msg}`);
        }
      },

      removeMcpServer: async (serverId: string) => {
        try {
          await invoke('mcp_remove_server', { serverId });
          set((state) => {
            state.plugins = state.plugins.filter((p) => p.id !== `com.weave.mcp.${serverId}`);
            state.mcpServers = state.mcpServers.filter((s) => s.id !== serverId);
          });
          toast.success('MCP server removed');
        } catch (err) {
          const msg = extractError(err);
          toast.error(`Failed to remove MCP server: ${msg}`);
        }
      },
    })),
    {
      name: 'weave-plugin-store',
      partialize: (state) => ({ autoLoadPlugins: state.autoLoadPlugins }),
    }
  )
);
