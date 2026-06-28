export type ChatRole = 'user' | 'assistant' | 'system';

export type CallStatus = 'pending' | 'pending_approval' | 'success' | 'error';

export type Provider = 'openai' | 'anthropic' | 'local';

export interface PluginCall {
  plugin_id: string;
  capability: string;
  params: Record<string, unknown>;
  result?: Record<string, unknown>;
  status: CallStatus;
}

export interface IntentResult {
  intent: string;
  confidence: number;
  plugins: string[];
  params: Record<string, unknown>;
}

export interface MessageMetadata {
  model?: string;
  tokens_used?: number;
  plugin_calls: PluginCall[];
  intent?: IntentResult;
  isHidden?: boolean;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: number;
  metadata?: MessageMetadata;
  images?: string[];
}

export interface ModelConfig {
  provider: Provider;
  model: string;
  api_key?: string;
  api_url?: string;
  temperature: number;
  max_tokens: number;
}

export interface StreamChunk {
  chunk: string;
  message_id: string;
  done: boolean;
}
