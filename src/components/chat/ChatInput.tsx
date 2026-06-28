import { useState, useRef, useCallback, useEffect, KeyboardEvent } from 'react';
import { useChatStore } from '@/stores/useChatStore';
import { useAppStore } from '@/stores/useAppStore';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { invoke } from '@tauri-apps/api/core';
import type { AppConfig } from '@/types/app';
import { ArrowUp, FileText, Calculator, StickyNote, RefreshCw, Search, ChevronDown, Star, Paperclip, X, Square } from 'lucide-react';
import { useModelPreferenceStore } from '@/stores/useModelPreferenceStore';

import openaiIcon from '@/assets/ChatGPT_logo.svg.webp';
import anthropicIcon from '@/assets/anthropic.svg';
import kimiIcon from '@/assets/kimi-ai-icon.svg';
import opencodeLightIcon from '@/assets/opencodelightmode.png';
import opencodeDarkIcon from '@/assets/opencodedarkmode.png';

type ModelOption = { value: string; label: string; provider: string };

const FALLBACK_MODELS: ModelOption[] = [
  { value: 'gpt-5.6-sol',          label: 'GPT-5.6 Sol',      provider: 'openai' },
  { value: 'gpt-5.5-pro',          label: 'GPT-5.5 Pro',      provider: 'openai' },
  { value: 'gpt-5.4-mini',         label: 'GPT-5.4 Mini',     provider: 'openai' },
  { value: 'claude-fable-5',        label: 'Claude Fable 5',   provider: 'anthropic' },
  { value: 'claude-opus-4-8',       label: 'Claude Opus 4.8',  provider: 'anthropic' },
  { value: 'claude-sonnet-4-6',     label: 'Claude Sonnet 4.6',provider: 'anthropic' },
  { value: 'claude-haiku-4-5',      label: 'Claude Haiku 4.5', provider: 'anthropic' },
  { value: 'kimi-k2.6',             label: 'Kimi K2.6',        provider: 'kimi' },
  { value: 'kimi-k2.7-code',        label: 'Kimi K2.7 Code',   provider: 'kimi' },
  { value: 'llama3',                label: 'Llama 3 (Local)',   provider: 'local' },
  { value: 'mistral',               label: 'Mistral (Local)',   provider: 'local' },
];

const PROVIDER_META: Record<string, { color: string, icon?: string, iconDark?: string }> = {
  openai:    { color: '#10a37f', icon: openaiIcon, iconDark: openaiIcon },
  anthropic: { color: '#d97757', icon: anthropicIcon, iconDark: anthropicIcon },
  kimi:      { color: '#555555', icon: kimiIcon, iconDark: kimiIcon },
  opencode:  { color: '#e67e22', icon: opencodeLightIcon, iconDark: opencodeDarkIcon },
  local:     { color: '#9b59b6' },
};

const PLUGIN_HINTS = [
  { keyword: 'file',    icon: FileText,   label: 'File' },
  { keyword: 'read',    icon: FileText,   label: 'File' },
  { keyword: 'list',    icon: FileText,   label: 'File' },
  { keyword: 'calc',    icon: Calculator, label: 'Calc' },
  { keyword: 'math',    icon: Calculator, label: 'Calc' },
  { keyword: 'note',    icon: StickyNote, label: 'Note' },
  { keyword: 'convert', icon: Calculator, label: 'Calc' },
];

export function ChatInput() {
  const [input, setInput] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [models, setModels] = useState<ModelOption[]>(FALLBACK_MODELS);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const { sendMessage, isStreaming, selectedModel, setModel } = useChatStore();
  const { lastConfigUpdate, isChatExpanded, toggleChat } = useAppStore();
  const { recentModels, favoriteModels, addRecentModel, toggleFavoriteModel } = useModelPreferenceStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [forceRefresh, setForceRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setModelsLoading(true);

    invoke<AppConfig>('system_get_config')
      .then(async (_config) => {
        const providers = Object.keys(PROVIDER_META);

        if (providers.length === 0) { if (!cancelled) setModels(FALLBACK_MODELS); return; }

        const results = await Promise.allSettled(
          providers.map((key) => invoke<string[]>('list_provider_models', { provider: key }))
        );
        const merged: ModelOption[] = [];
        results.forEach((res, idx) => {
          const key = providers[idx];
          if (res.status === 'fulfilled' && res.value.length > 0) {
            res.value.forEach((id) => merged.push({ value: id, label: id, provider: key }));
          } else {
            FALLBACK_MODELS.filter((m) => m.provider === key).forEach((m) => merged.push(m));
          }
        });
        if (!cancelled) setModels(merged.length > 0 ? merged : FALLBACK_MODELS);
      })
      .catch(() => { if (!cancelled) setModels(FALLBACK_MODELS); })
      .finally(() => { if (!cancelled) setModelsLoading(false); });

    return () => { cancelled = true; };
  }, [lastConfigUpdate, forceRefresh]);

  useEffect(() => {
    if (models.length > 0 && !selectedModel) {
      setModel(models[0].value, models[0].provider);
    }
  }, [models, selectedModel, setModel]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if ((!trimmed && images.length === 0) || isStreaming) return;
    setInput('');
    const currentImages = [...images];
    setImages([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    if (selectedModel) addRecentModel(selectedModel);
    await sendMessage(trimmed, currentImages);
  }, [input, images, isStreaming, sendMessage, selectedModel, addRecentModel]);

  const handleStop = useCallback(async () => {
    try {
      await invoke('chat_abort_generation');
    } catch (err) {
      console.error('Failed to abort generation', err);
    }
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, []);

  const processFile = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      if (result) {
        // Compress image using canvas
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 1200;
          const MAX_HEIGHT = 1200;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
          setImages(prev => [...prev, dataUrl]);
        };
        img.src = result;
      }
    };
    reader.readAsDataURL(file);
  };

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          processFile(file);
          e.preventDefault();
        }
      }
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        processFile(e.dataTransfer.files[i]);
      }
    }
  }, []);

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  };

  const hints = PLUGIN_HINTS.filter((h) => input.toLowerCase().includes(h.keyword));
  const currentProvider = models.find((m) => m.value === selectedModel)?.provider ?? 'openai';
  const pm = PROVIDER_META[currentProvider] ?? PROVIDER_META.openai;
  const canSend = (!!input.trim() || images.length > 0) && !isStreaming;

  return (
    <div className="flex-shrink-0 px-4 pb-4 pt-1 max-w-4xl mx-auto w-full">
      <div className="rounded-xl overflow-hidden border bg-card shadow-sm transition-shadow focus-within:shadow-md">
        {/* Plugin hint strip */}
        {hints.length > 0 && input.length > 3 && (
          <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/50">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Plugins
            </span>
            {hints.map((h, i) => {
              const Icon = h.icon;
              return (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-background border"
                >
                  <Icon className="w-3 h-3" />
                  {h.label}
                </span>
              );
            })}
          </div>
        )}

        {/* Main input row */}
        <div className="flex items-end gap-2 px-2 py-2">
          {/* Model selector */}
          <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
            <DropdownMenuTrigger
              disabled={modelsLoading || isStreaming}
              className="w-[150px] h-8 text-xs flex-shrink-0 bg-transparent border-0 hover:bg-muted focus:shadow-none rounded-md px-2 gap-1.5 overflow-hidden flex items-center outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {pm.icon ? (
                <>
                  <img src={pm.icon} alt={currentProvider} className="w-3.5 h-3.5 object-contain flex-shrink-0 dark:hidden" />
                  {pm.iconDark && <img src={pm.iconDark} alt={currentProvider} className="w-3.5 h-3.5 object-contain flex-shrink-0 hidden dark:block" />}
                </>
              ) : (
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: pm.color }} />
              )}
              <span className="truncate flex-1 text-left">
                {modelsLoading ? '…' : (models.find(m => m.value === selectedModel)?.label || 'Model')}
              </span>
              <ChevronDown className="w-3 h-3 opacity-50 flex-shrink-0" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-[200px]" sideOffset={4}>
              <div className="flex items-center px-2 py-1.5 border-b mb-1">
                <Search className="w-3 h-3 mr-2 opacity-50" />
                <input
                  type="text"
                  placeholder="Search models..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="flex-1 bg-transparent text-xs outline-none min-w-0"
                />
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setForceRefresh(f => f + 1); }}
                  className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted ml-2"
                  disabled={modelsLoading}
                  title="Refresh models"
                >
                  <RefreshCw className={`w-3 h-3 ${modelsLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
              <div className="max-h-[200px] overflow-y-auto">
                {(() => {
                  const filtered = models.filter(m => m.label.toLowerCase().includes(searchQuery.toLowerCase()) || m.value.toLowerCase().includes(searchQuery.toLowerCase()));
                  
                  const favs = filtered.filter(m => favoriteModels.includes(m.value));
                  const recents = filtered.filter(m => recentModels.includes(m.value) && !favoriteModels.includes(m.value));
                  const rest = filtered.filter(m => !favoriteModels.includes(m.value) && !recentModels.includes(m.value));

                  const renderModelItem = (m: ModelOption) => {
                    const meta = PROVIDER_META[m.provider] ?? PROVIDER_META.openai;
                    const isFav = favoriteModels.includes(m.value);
                    return (
                      <DropdownMenuItem
                        key={m.value}
                        onClick={() => { setModel(m.value, m.provider); setDropdownOpen(false); }}
                        className="text-xs py-1.5 cursor-pointer flex items-center justify-between group"
                      >
                        <div className="flex items-center gap-2 truncate min-w-0 flex-1 pr-2">
                          {meta.icon ? (
                            <>
                              <img src={meta.icon} alt={m.provider} className="w-3.5 h-3.5 object-contain flex-shrink-0 dark:hidden" />
                              {meta.iconDark && <img src={meta.iconDark} alt={m.provider} className="w-3.5 h-3.5 object-contain flex-shrink-0 hidden dark:block" />}
                            </>
                          ) : (
                            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: meta.color }} />
                          )}
                          <span className="truncate">{m.label}</span>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); toggleFavoriteModel(m.value); }}
                          className={`flex-shrink-0 p-1 rounded hover:bg-muted ${isFav ? 'text-yellow-500' : 'text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100'}`}
                          title={isFav ? "Remove from favorites" : "Add to favorites"}
                        >
                          <Star className="w-3 h-3" fill={isFav ? "currentColor" : "none"} />
                        </button>
                      </DropdownMenuItem>
                    );
                  };

                  return (
                    <>
                      {favs.length > 0 && (
                        <div className="mb-2">
                          <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Favorites</div>
                          {favs.map(renderModelItem)}
                        </div>
                      )}
                      {recents.length > 0 && (
                        <div className="mb-2">
                          <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Recent</div>
                          {recents.map(renderModelItem)}
                        </div>
                      )}
                      <div>
                        <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">All Models</div>
                        {rest.map(renderModelItem)}
                      </div>
                    </>
                  );
                })()}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="h-4 w-px bg-border flex-shrink-0 mb-2" />

          {/* Attach Button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors mb-0.5"
            title="Attach image"
          >
            <Paperclip className="w-4 h-4" />
          </button>
          <input 
            type="file" 
            ref={fileInputRef} 
            accept="image/*" 
            multiple 
            className="hidden" 
            onChange={(e) => {
              if (e.target.files) {
                Array.from(e.target.files).forEach(processFile);
              }
              e.target.value = ''; // reset
            }} 
          />

          <div className="flex-1 flex flex-col min-w-0">
            {images.length > 0 && (
              <div className="flex items-center gap-2 px-1 pb-2 overflow-x-auto">
                {images.map((img, idx) => (
                  <div key={idx} className="relative group w-12 h-12 flex-shrink-0 rounded-md overflow-hidden border">
                    <img src={img} alt="attachment" className="w-full h-full object-cover" />
                    <button 
                      onClick={() => removeImage(idx)}
                      className="absolute top-0.5 right-0.5 w-4 h-4 bg-background/80 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3 h-3 text-foreground" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {/* Textarea */}
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onFocus={() => {
                if (!isChatExpanded) toggleChat(true);
              }}
              placeholder="Ask anything..."
            disabled={isStreaming}
            rows={1}
            className={[
              'flex-1 min-h-[32px] max-h-[160px] py-1.5 px-1 text-sm resize-none',
              'bg-transparent border-0 shadow-none',
              'focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:shadow-none',
              'placeholder:text-muted-foreground',
            ].join(' ')}
          />
        </div>

        {/* Send / Stop button */}
        {isStreaming ? (
          <button
            type="button"
            onClick={handleStop}
            aria-label="Stop generation"
            className="flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center transition-colors mb-0.5 bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            <Square className="w-3 h-3 fill-current" />
          </button>
        ) : (
          <button
            type="button"
            disabled={!canSend}
            onClick={handleSend}
            aria-label="Send"
            className={[
              'flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center transition-colors mb-0.5',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              canSend ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-muted text-muted-foreground'
            ].join(' ')}
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        )}
        </div>
      </div>
    </div>
  );
}
