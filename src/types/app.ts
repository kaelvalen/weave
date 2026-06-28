export type ThemeMode = 'system' | 'light' | 'dark';

export type View = 'chat' | 'plugins' | 'files' | 'settings' | 'notes' | 'knowledge' | 'models' | 'workflows' | 'canvas';

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
}

export interface AiConfig {
  default_provider: 'openai' | 'anthropic' | 'kimi' | 'local';
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
