import { invoke } from '@tauri-apps/api/core';
import type { ChatMessage } from '@/types/chat';
import type { Plugin } from '@/types/plugin';
import type { AppConfig } from '@/types/app';

// Chat Commands
export const ipc = {
  chatSendMessage: (message: string, model?: string): Promise<string> =>
    invoke('chat_send_message', { message, model: model || null }),

  chatGetHistory: (): Promise<ChatMessage[]> =>
    invoke('chat_get_history'),

  chatClearHistory: (): Promise<void> =>
    invoke('chat_clear_history'),

  chatGetMessage: (messageId: string): Promise<ChatMessage | null> =>
    invoke('chat_get_message', { messageId }),

  // Plugin Commands
  pluginDiscover: (): Promise<Plugin[]> =>
    invoke('plugin_discover'),

  pluginLoad: (pluginId: string): Promise<Plugin> =>
    invoke('plugin_load', { pluginId }),

  pluginUnload: (pluginId: string): Promise<void> =>
    invoke('plugin_unload', { pluginId }),

  pluginExecute: (pluginId: string, capability: string, params: Record<string, unknown>): Promise<unknown> =>
    invoke('plugin_execute', { pluginId, capability, params }),

  pluginGetAll: (): Promise<Plugin[]> =>
    invoke('plugin_get_all'),

  pluginGetLoaded: (): Promise<Plugin[]> =>
    invoke('plugin_get_loaded'),

  pluginGetById: (pluginId: string): Promise<Plugin | null> =>
    invoke('plugin_get_by_id', { pluginId }),

  // System Commands
  systemGetConfig: (): Promise<AppConfig> =>
    invoke('system_get_config'),

  systemSetConfig: (config: AppConfig): Promise<void> =>
    invoke('system_set_config', { config }),

  systemGetPluginDir: (): Promise<string> =>
    invoke('system_get_plugin_dir'),

  systemGetVersion: (): Promise<string> =>
    invoke('system_get_version'),

  systemOpenPluginDir: (): Promise<void> =>
    invoke('system_open_plugin_dir'),
} as const;
