import { describe, it, expect, beforeEach, vi } from 'vitest';
import { usePluginStore } from './usePluginStore';
import { invoke } from '@tauri-apps/api/core';
import type { Plugin, PluginCategory } from '@/types/plugin';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue([]) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function makePlugin(
  id: string,
  category: PluginCategory,
  state: string,
  provide: string[] = []
): Plugin {
  return {
    id,
    name: id,
    version: '1.0.0',
    author: 'test',
    description: `${id} plugin`,
    capabilities: { read: [], write: [], provide, schemas: {}, descriptions: {} },
    runtime: { type: 'builtin', entry: '', sandbox: 'strict' },
    ui: { ui_type: 'none', entry: '' },
    state,
    is_builtin: false,
    category,
  } as Plugin;
}

const filePlugin = makePlugin('file', 'system', 'active', ['file.read', 'file.write']);
const calcPlugin = makePlugin('calc', 'productivity', 'inactive', ['calc.eval']);
const coderPlugin = makePlugin('coder', 'development', 'loaded', ['coder.read_file']);

describe('usePluginStore', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockClear();
    usePluginStore.setState({
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
    });
  });

  it('discoverPlugins populates plugins and the loaded set via plugin_discover', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([filePlugin, calcPlugin, coderPlugin]);
    await usePluginStore.getState().discoverPlugins();
    const s = usePluginStore.getState();
    expect(invoke).toHaveBeenCalledWith('plugin_discover');
    expect(s.plugins).toHaveLength(3);
    expect(s.loadedPlugins).toEqual(['file', 'coder']);
    expect(s.isLoading).toBe(false);
  });

  it('records an error and stays quiet on discover failure', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('boom'));
    await usePluginStore.getState().discoverPlugins();
    const s = usePluginStore.getState();
    expect(s.error).toContain('boom');
    expect(s.plugins).toHaveLength(0);
  });

  it('loadPlugin marks a plugin loaded via plugin_load', async () => {
    usePluginStore.setState({ plugins: [filePlugin, calcPlugin] });
    vi.mocked(invoke).mockResolvedValueOnce({ ...calcPlugin, state: 'loaded' });
    await usePluginStore.getState().loadPlugin('calc');
    const s = usePluginStore.getState();
    expect(invoke).toHaveBeenCalledWith('plugin_load', { pluginId: 'calc' });
    expect(s.loadedPlugins).toContain('calc');
    expect(s.plugins.find((p) => p.id === 'calc')?.state).toBe('loaded');
  });

  it('getPluginIdForCapability resolves the owning plugin', () => {
    usePluginStore.setState({ plugins: [filePlugin, calcPlugin] });
    expect(usePluginStore.getState().getPluginIdForCapability('file.read')).toBe('file');
    expect(usePluginStore.getState().getPluginIdForCapability('calc.eval')).toBe('calc');
    expect(usePluginStore.getState().getPluginIdForCapability('nope.x')).toBeUndefined();
  });

  it('getPluginsByCategory filters by category', () => {
    usePluginStore.setState({ plugins: [filePlugin, calcPlugin, coderPlugin] });
    const ids = usePluginStore
      .getState()
      .getPluginsByCategory('productivity')
      .map((p) => p.id);
    expect(ids).toEqual(['calc']);
  });

  it('search and category filters are pure UI state', () => {
    const s = usePluginStore.getState();
    s.setSearchQuery('ca');
    expect(usePluginStore.getState().searchQuery).toBe('ca');
    s.setCategory('ai');
    expect(usePluginStore.getState().selectedCategory).toBe('ai');
  });
});
