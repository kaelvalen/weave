import { invoke } from '@tauri-apps/api/core';

/** Execute a plugin capability by id (used by the Git panel). */
export const ipc = {
  pluginExecute: (
    pluginId: string,
    capability: string,
    params: Record<string, unknown>
  ): Promise<unknown> => invoke('plugin_execute', { pluginId, capability, params }),
} as const;
