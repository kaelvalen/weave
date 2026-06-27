export type RuntimeType = 'builtin' | 'wasm' | 'python' | 'nodejs';

export type SandboxLevel = 'strict' | 'relaxed';

export type PluginState = 'discovered' | 'loaded' | 'active' | 'unloaded' | string;

export type PluginCategory = 'system' | 'productivity' | 'development' | 'ai';

export type UiType = 'native' | 'webview' | 'none';

export interface Capabilities {
  read: string[];
  write: string[];
  provide: string[];
  schemas: Record<string, string>;
  descriptions: Record<string, string>;
}

export interface RuntimeConfig {
  runtime_type: RuntimeType;
  entry: string;
  sandbox: SandboxLevel;
}

export interface PluginUiConfig {
  ui_type: UiType;
  entry: string;
}

export interface Plugin {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  capabilities: Capabilities;
  runtime: RuntimeConfig;
  ui: PluginUiConfig;
  state: PluginState;
  path?: string;
  is_builtin: boolean;
  category: PluginCategory;
}

export interface WorkflowStep {
  id: string;
  plugin_id: string;
  capability: string;
  params: Record<string, unknown>;
  input_from?: string;
  timeout_ms?: number;
  continue_on_error?: boolean;
}

export interface StepResult {
  step_id: string;
  success: boolean;
  output?: Record<string, unknown>;
  error?: string;
  execution_time_ms: number;
}

export interface WorkflowResult {
  workflow_id: string;
  steps: StepResult[];
  overall_success: boolean;
  total_execution_time_ms: number;
}
