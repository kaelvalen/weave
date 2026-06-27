import { useState, useRef, useCallback, useEffect, KeyboardEvent } from 'react';
import { useChatStore } from '@/stores/useChatStore';
import { useAppStore } from '@/stores/useAppStore';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { invoke } from '@tauri-apps/api/core';
import type { AppConfig } from '@/types/app';
import { Send, Loader2, FileText, Calculator, StickyNote } from 'lucide-react';

type ModelOption = {
  value: string;
  label: string;
  provider: string;
};

const FALLBACK_MODELS: ModelOption[] = [
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini', provider: 'openai' },
  { value: 'gpt-4o', label: 'GPT-4o', provider: 'openai' },
  { value: 'claude-fable-5', label: 'Claude Fable 5', provider: 'anthropic' },
  { value: 'claude-mythos-5', label: 'Claude Mythos 5', provider: 'anthropic' },
  { value: 'claude-opus-4-8', label: 'Claude Opus 4.8', provider: 'anthropic' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'anthropic' },
  { value: 'kimi-k2-0711-preview', label: 'Kimi K2', provider: 'kimi' },
  { value: 'kimi-1.5-long', label: 'Kimi 1.5 Long', provider: 'kimi' },
  { value: 'llama3', label: 'Llama 3 (Local)', provider: 'local' },
  { value: 'mistral', label: 'Mistral (Local)', provider: 'local' },
];

const PROVIDER_META: Record<string, { label: string; color: string }> = {
  openai: { label: 'OpenAI', color: 'bg-emerald-500' },
  anthropic: { label: 'Anthropic', color: 'bg-amber-500' },
  kimi: { label: 'Kimi', color: 'bg-purple-500' },
  local: { label: 'Local', color: 'bg-blue-500' },
};

const PLUGIN_SUGGESTIONS = [
  { keyword: 'file', icon: FileText, label: 'File' },
  { keyword: 'read', icon: FileText, label: 'File' },
  { keyword: 'list', icon: FileText, label: 'File' },
  { keyword: 'calc', icon: Calculator, label: 'Calc' },
  { keyword: 'math', icon: Calculator, label: 'Calc' },
  { keyword: 'note', icon: StickyNote, label: 'Note' },
  { keyword: 'convert', icon: Calculator, label: 'Calc' },
];

export function ChatInput() {
  const [input, setInput] = useState('');
  const [models, setModels] = useState<ModelOption[]>(FALLBACK_MODELS);
  const [modelsLoading, setModelsLoading] = useState(false);
  const { sendMessage, isStreaming, selectedModel, setModel } = useChatStore();
  const { lastConfigUpdate } = useAppStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    setModelsLoading(true);

    invoke<AppConfig>('system_get_config')
      .then(async (config) => {
        const providers = Object.entries(PROVIDER_META).filter(([key]) => {
          if (key === 'local') return config.ai.local.enabled;
          const cfg = config.ai[key as keyof typeof config.ai] as { api_key?: string } | undefined;
          return cfg && typeof cfg === 'object' && 'api_key' in cfg && cfg.api_key && cfg.api_key.length > 0;
        });

        if (providers.length === 0) {
          if (!cancelled) setModels(FALLBACK_MODELS);
          return;
        }

        const results = await Promise.allSettled(
          providers.map(([key]) =>
            invoke<string[]>('list_provider_models', { provider: key })
          )
        );

        const merged: ModelOption[] = [];
        results.forEach((res, idx) => {
          const [key] = providers[idx];
          if (res.status === 'fulfilled' && res.value.length > 0) {
            res.value.forEach((modelId) => {
              merged.push({
                value: modelId,
                label: modelId,
                provider: key,
              });
            });
          } else {
            if (res.status === 'rejected') {
              console.warn(`Failed to load models for ${key}:`, res.reason);
            }
            FALLBACK_MODELS.filter((m) => m.provider === key).forEach((m) => merged.push(m));
          }
        });

        if (!cancelled) {
          setModels(merged.length > 0 ? merged : FALLBACK_MODELS);
        }
      })
      .catch((err) => {
        console.warn('Failed to load available models:', err);
        if (!cancelled) setModels(FALLBACK_MODELS);
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });

    return () => { cancelled = true; };
  }, [lastConfigUpdate]);

  useEffect(() => {
    if (models.length > 0 && !models.find((m) => m.value === selectedModel)) {
      setModel(models[0].value);
    }
  }, [models, selectedModel, setModel]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    
    await sendMessage(trimmed);
  }, [input, isStreaming, sendMessage]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);
    
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const newHeight = Math.min(textareaRef.current.scrollHeight, 160);
      textareaRef.current.style.height = `${newHeight}px`;
    }
  }, []);

  const suggestedPlugins = PLUGIN_SUGGESTIONS.filter((s) =>
    input.toLowerCase().includes(s.keyword)
  );

  return (
    <div className="px-4 pb-3 pt-1 flex-shrink-0">
      <div className="glass-input rounded-2xl p-3 shadow-lg">
        {/* Plugin Suggestion Chips */}
        {suggestedPlugins.length > 0 && input.length > 3 && (
          <div className="flex items-center gap-1.5 mb-2 px-1">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Detected:</span>
            {suggestedPlugins.map((s, i) => {
              const Icon = s.icon;
              return (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground"
                >
                  <Icon className="w-3 h-3" />
                  {s.label}
                </span>
              );
            })}
          </div>
        )}

        <div className="flex items-end gap-2">
          {/* Model Selector */}
          <Select value={selectedModel} onValueChange={setModel} disabled={modelsLoading || isStreaming}>
            <SelectTrigger className="w-[180px] h-9 text-xs flex-shrink-0">
              <SelectValue placeholder={modelsLoading ? 'Loading...' : 'Select model'} />
            </SelectTrigger>
            <SelectContent>
              {models.map((m) => {
                const meta = PROVIDER_META[m.provider] || { label: m.provider, color: 'bg-gray-500' };
                return (
                  <SelectItem key={m.value} value={m.value} className="text-xs">
                    <span className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full ${meta.color}`} />
                      <span className="truncate max-w-[120px]" title={m.value}>
                        {m.label}
                      </span>
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>

          {/* Textarea */}
          <div className="flex-1 relative">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything... (Shift+Enter for new line)"
              disabled={isStreaming}
              className="min-h-[36px] max-h-[160px] py-2 px-3 text-sm resize-none bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/50"
              rows={1}
            />
          </div>

          {/* Send Button */}
          <Button
            size="icon"
            className="h-9 w-9 flex-shrink-0"
            disabled={!input.trim() || isStreaming}
            onClick={handleSend}
          >
            {isStreaming ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>

        <div className="flex items-center justify-between mt-1.5 px-1">
          <p className="text-[10px] text-muted-foreground/60">
            Plugins: file, calc, note
          </p>
          <p className="text-[10px] text-muted-foreground/60">
            {input.length > 0 && `${input.length} chars`}
          </p>
        </div>
      </div>
    </div>
  );
}
