export type ThemeMode = 'system' | 'light' | 'dark';

export type View =
  | 'chat'
  | 'knowledge'
  | 'plugins'
  | 'files'
  | 'settings';

export interface ProviderConfig {
  api_key: string;
  model: string;
  api_url?: string;
  temperature: number;
  max_tokens: number;
}

export interface LocalConfig {
  enabled: boolean;
  model_path: string;
  model_alias: string;
  context_length: number;
  temperature: number;
  api_url?: string;
  use_native_tools?: boolean;
  /** Per llama-swap model-id native tool-calling probe results (spec §3). */
  use_native_tools_per_model?: Record<string, boolean>;
}

export interface LlamaSwapStatus {
  active: boolean;
  model_count: number;
  models: string[];
  last_error?: string | null;
}

import type { Provider } from './chat';

export interface AiConfig {
  default_provider: Provider;
  openai: ProviderConfig;
  anthropic: ProviderConfig;
  kimi: ProviderConfig;
  opencode: ProviderConfig;
  local: LocalConfig;
}

export interface PluginConfig {
  directory: string;
  auto_discover: boolean;
  sandbox_default: 'strict' | 'relaxed';
}

export interface UiConfig {
  theme: ThemeMode;
  sidebar_collapsed: boolean;
  font_size: number;
}

export interface AppConfig {
  ai: AiConfig;
  plugins: PluginConfig;
  ui: UiConfig;
  version: string;
}
