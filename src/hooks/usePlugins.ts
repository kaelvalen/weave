import { useEffect, useCallback } from 'react';
import { usePluginStore } from '@/stores/usePluginStore';

export function usePlugins() {
  const { plugins, loadedPlugins, isLoading, discoverPlugins, loadPlugin, unloadPlugin } = usePluginStore();

  useEffect(() => {
    discoverPlugins();
  }, [discoverPlugins]);

  const togglePlugin = useCallback(async (id: string) => {
    if (loadedPlugins.includes(id)) {
      await unloadPlugin(id);
    } else {
      await loadPlugin(id);
    }
  }, [loadedPlugins, loadPlugin, unloadPlugin]);

  return {
    plugins,
    loadedPlugins,
    isLoading,
    togglePlugin,
    refresh: discoverPlugins,
  };
}
