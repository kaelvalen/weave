import React, { useState, useRef, useCallback, useEffect, useMemo, KeyboardEvent } from 'react';
import { useChatStore } from '@/stores/useChatStore';
import { useAppStore } from '@/stores/useAppStore';
import { usePluginStore } from '@/stores/usePluginStore';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { invoke } from '@tauri-apps/api/core';
import type { AppConfig } from '@/types/app';
import type { Provider } from '@/types/chat';
import { ArrowUp, FileText, Calculator, StickyNote, RefreshCw, Search, ChevronDown, Star, Paperclip, X, Square, Sparkles, Zap, LayoutGrid, Workflow, Cpu, Code2, FolderOpen } from 'lucide-react';
import { useModelPreferenceStore } from '@/stores/useModelPreferenceStore';

import openaiIcon from '@/assets/ChatGPT_logo.svg.webp';
import anthropicIcon from '@/assets/anthropic.svg';
import kimiIcon from '@/assets/kimi-ai-icon.svg';
import opencodeLightIcon from '@/assets/opencodelightmode.png';
import opencodeDarkIcon from '@/assets/opencodedarkmode.png';

type ModelOption = { value: string; label: string; provider: Provider };

const FALLBACK_MODELS: ModelOption[] = [
  { value: 'gpt-4o',                  label: 'GPT-4o',              provider: 'openai' },
  { value: 'gpt-4o-mini',             label: 'GPT-4o Mini',         provider: 'openai' },
  { value: 'claude-3-5-sonnet-20240620', label: 'Claude 3.5 Sonnet',provider: 'anthropic' },
  { value: 'kimi-k2-0711-preview',    label: 'Kimi K2',             provider: 'kimi' },
  { value: 'opencode-gpt-4o',         label: 'OpenCode GPT-4o',     provider: 'opencode' },
  { value: 'llama3.1',                label: 'Llama 3.1 (Local)',   provider: 'local' },
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

const QUICK_ACTIONS = [
  { label: '@File', prefix: 'Read file ', icon: FileText, color: 'text-muted-foreground bg-muted/60 border-border/60 hover:bg-muted hover:text-foreground' },
  { label: '/calc', prefix: 'Calculate ', icon: Calculator, color: 'text-muted-foreground bg-muted/60 border-border/60 hover:bg-muted hover:text-foreground' },
  { label: '+Note', prefix: 'Create a note about ', icon: StickyNote, color: 'text-muted-foreground bg-muted/60 border-border/60 hover:bg-muted hover:text-foreground' },
  { label: 'Canvas', prefix: 'Create a canvas layout with ', icon: LayoutGrid, color: 'text-muted-foreground bg-muted/60 border-border/60 hover:bg-muted hover:text-foreground' },
];

const SLASH_COMMANDS = [
  { command: '/calc', title: 'Calculator', desc: 'Evaluate high-precision math & unit conversions', icon: Calculator, template: '/calc ' },
  { command: '/file', title: 'File Manager', desc: 'Read, write, list, or search workspace files', icon: FileText, template: '/file ' },
  { command: '/note', title: 'Notes', desc: 'Create or update ideas in your scratch notes', icon: StickyNote, template: '/note ' },
  { command: '/canvas', title: 'AI Canvas', desc: 'Autonomously build visual diagram nodes', icon: LayoutGrid, template: '/canvas ' },
  { command: '/workflow', title: 'Workflows', desc: 'Execute automated AI pipelines', icon: Workflow, template: '/workflow ' },
  { command: '/code', title: 'Code Coder', desc: 'Refactor, debug, or write code files', icon: Code2, template: '/code ' },
  { command: '/web', title: 'Web Fetch', desc: 'Fetch and summarize content from a URL', icon: Sparkles, template: '/web ' },
  { command: '/search', title: 'File Search', desc: 'Search content across workspace files', icon: FolderOpen, template: '/search ' },
  { command: '/sys', title: 'System', desc: 'Learn about Weave AI and its built-in plugins', icon: Cpu, template: '/sys ' },
];

export function ChatInput() {
  const [input, setInput] = useState('');
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const [images, setImages] = useState<string[]>([]);
  const [models, setModels] = useState<ModelOption[]>(FALLBACK_MODELS);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const { sendMessage, isStreaming, selectedModel, setModel } = useChatStore();
  const { lastConfigUpdate, isChatExpanded, toggleChat } = useAppStore();
  const { recentModels, favoriteModels, addRecentModel, toggleFavoriteModel } = useModelPreferenceStore();
  const { plugins: externalPlugins, loadedPlugins } = usePluginStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [forceRefresh, setForceRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // Standard data-fetch pattern: loading state for async model list refresh.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setModelsLoading(true);

    invoke<AppConfig>('system_get_config')
      .then(async () => {
        const providers = Object.keys(PROVIDER_META) as Provider[];

        if (providers.length === 0) { if (!cancelled) setModels([]); return; }

        const results = await Promise.allSettled(
          providers.map((key) => invoke<string[]>('list_provider_models', { provider: key }))
        );
        const merged: ModelOption[] = [];
        results.forEach((res, idx) => {
          const key = providers[idx];
          if (res.status === 'fulfilled' && res.value.length > 0) {
            res.value.forEach((id) => merged.push({ value: id, label: id, provider: key }));
          } else if (res.status === 'rejected') {
            FALLBACK_MODELS.filter((m) => m.provider === key).forEach((m) => merged.push(m));
          }
        });
        if (!cancelled) setModels(merged);
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

  const query = input.trimStart();
  const isSlashCommandActive = query.startsWith('/') && !query.slice(1).includes(' ');
  const slashSearch = isSlashCommandActive ? query.toLowerCase() : '';
  const filteredSlashCommands = useMemo(() => {
    return isSlashCommandActive
      ? SLASH_COMMANDS.filter(cmd =>
          cmd.command.toLowerCase().startsWith(slashSearch) ||
          cmd.title.toLowerCase().includes(slashSearch.slice(1)) ||
          cmd.desc.toLowerCase().includes(slashSearch.slice(1))
        )
      : [];
  }, [isSlashCommandActive, slashSearch]);

  const selectSlashCommand = useCallback((cmd: (typeof SLASH_COMMANDS)[0]) => {
    setInput(cmd.template);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isSlashCommandActive && filteredSlashCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashSelectedIndex((prev) => (prev + 1) % filteredSlashCommands.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashSelectedIndex((prev) => (prev - 1 + filteredSlashCommands.length) % filteredSlashCommands.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const selected = filteredSlashCommands[slashSelectedIndex] || filteredSlashCommands[0];
        if (selected) {
          selectSlashCommand(selected);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setInput('');
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend, isSlashCommandActive, filteredSlashCommands, slashSelectedIndex, selectSlashCommand]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    setSlashSelectedIndex(0);
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

  const hints = useMemo(() => {
    const inputLow = input.toLowerCase().trim();
    if (!inputLow) return [];

    const matched: { label: string; icon: React.ElementType; isExternal?: boolean }[] = [];
    const seen = new Set<string>();

    // 1. Check external / discovered / loaded plugins from usePluginStore
    for (const p of externalPlugins) {
      if (
        (inputLow.includes(p.name.toLowerCase()) ||
         inputLow.includes(p.id.toLowerCase()) ||
         loadedPlugins.includes(p.id)) &&
        !seen.has(p.name)
      ) {
        seen.add(p.name);
        matched.push({ label: p.name, icon: Cpu, isExternal: !p.is_builtin });
      }
    }

    // 2. Check SLASH_COMMANDS
    for (const sc of SLASH_COMMANDS) {
      const cmdWord = sc.command.replace('/', '').toLowerCase();
      if ((inputLow.includes(sc.command.toLowerCase()) || inputLow.includes(cmdWord)) && !seen.has(sc.title)) {
        seen.add(sc.title);
        matched.push({ label: sc.title, icon: sc.icon });
      }
    }

    // 3. Check builtin keyword PLUGIN_HINTS
    for (const h of PLUGIN_HINTS) {
      if (inputLow.includes(h.keyword) && !seen.has(h.label)) {
        seen.add(h.label);
        matched.push({ label: h.label, icon: h.icon });
      }
    }

    return matched;
  }, [input, externalPlugins, loadedPlugins]);
  const currentProvider = models.find((m) => m.value === selectedModel)?.provider ?? 'openai';
  const pm = PROVIDER_META[currentProvider] ?? PROVIDER_META.openai;
  const canSend = (!!input.trim() || images.length > 0) && !isStreaming;

  return (
    <div className="flex-shrink-0 px-4 pb-6 pt-2 max-w-4xl mx-auto w-full">
      {/* Quick Action Pills above chat bar when input is empty */}
      {!input && images.length === 0 && !isStreaming && (
        <div className="flex items-center gap-1.5 mb-2.5 px-1 overflow-x-auto hide-scrollbar animate-in fade-in slide-in-from-bottom-2 duration-300">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1 mr-1 flex-shrink-0">
            <Sparkles className="w-3 h-3 text-amber-500 animate-pulse" />
            Quick Actions:
          </span>
          {QUICK_ACTIONS.map((qa, i) => {
            const Icon = qa.icon;
            return (
              <button
                key={i}
                type="button"
                onClick={() => {
                  setInput(qa.prefix);
                  if (textareaRef.current) {
                    textareaRef.current.focus();
                  }
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all duration-200 flex-shrink-0 shadow-sm hover:scale-105 active:scale-95 ${qa.color}`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{qa.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Slash Command Autocomplete Menu */}
      {isSlashCommandActive && filteredSlashCommands.length > 0 && (
        <div className="mb-2 w-full max-h-60 overflow-y-auto rounded-2xl border border-border/80 bg-popover/95 backdrop-blur-xl shadow-2xl p-1.5 animate-in fade-in slide-in-from-bottom-2 duration-200 z-50">
          <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border/40 mb-1 flex items-center justify-between">
            <span>Available Capabilities</span>
            <span>↑↓ to navigate, Enter to select</span>
          </div>
          {filteredSlashCommands.map((cmd, idx) => {
            const Icon = cmd.icon;
            const isSelected = idx === slashSelectedIndex;
            return (
              <button
                key={cmd.command}
                type="button"
                onClick={() => selectSlashCommand(cmd)}
                onMouseEnter={() => setSlashSelectedIndex(idx)}
                className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-xl text-left transition-all duration-150 cursor-pointer ${
                  isSelected
                    ? 'bg-primary/15 text-primary shadow-sm scale-[1.005]'
                    : 'hover:bg-muted/60 text-foreground'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={`p-1.5 rounded-lg ${isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted/80 text-muted-foreground'}`}>
                    <Icon className="w-4 h-4 stroke-[2]" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold font-mono">{cmd.command}</span>
                      <span className="text-xs font-semibold">{cmd.title}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground line-clamp-1">{cmd.desc}</p>
                  </div>
                </div>
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${isSelected ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border/60 bg-muted/40 text-muted-foreground'}`}>
                  Plugin
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Main Glassmorphism Chat Input Box */}
      <div className="glow-effect rounded-[28px] overflow-hidden border border-border/80 bg-card/90 backdrop-blur-2xl shadow-xl transition-all duration-300 focus-within:shadow-2xl focus-within:border-primary/50">
        {/* Plugin hint strip */}
        {hints.length > 0 && (
          <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border/60 bg-primary/5 backdrop-blur-md animate-in fade-in duration-200">
            <span className="text-[10px] font-bold uppercase tracking-widest text-primary flex items-center gap-1 flex-shrink-0">
              <Zap className="w-3 h-3 text-amber-500 fill-current animate-pulse" />
              Active Plugins
            </span>
            <div className="flex items-center gap-1.5 overflow-x-auto hide-scrollbar">
              {hints.map((h, i) => {
                const Icon = h.icon;
                return (
                  <span
                    key={i}
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold border shadow-sm flex-shrink-0 transition-all duration-200 ${
                      h.isExternal
                        ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30'
                        : 'bg-background text-foreground border-border/80'
                    }`}
                  >
                    <Icon className="w-3 h-3 text-primary" />
                    {h.label}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Main input row */}
        <div className="flex items-end gap-2.5 p-3">
          {/* Model selector */}
          <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
            <DropdownMenuTrigger
              disabled={modelsLoading || isStreaming}
              className="h-9 text-xs flex-shrink-0 bg-muted/60 hover:bg-muted border border-border/60 shadow-sm rounded-full px-3 gap-2 overflow-hidden flex items-center outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
              title="Select AI Model"
            >
              {pm.icon ? (
                <>
                  <img src={pm.icon} alt={currentProvider} className="w-4 h-4 object-contain flex-shrink-0 dark:hidden" />
                  {pm.iconDark && <img src={pm.iconDark} alt={currentProvider} className="w-4 h-4 object-contain flex-shrink-0 hidden dark:block" />}
                </>
              ) : (
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 shadow-sm" style={{ background: pm.color }} />
              )}
              <span className="truncate max-w-[80px] sm:max-w-[130px] font-medium text-left">
                {modelsLoading
                  ? 'Loading...'
                  : (models.find(m => m.value === selectedModel)?.label ||
                     (models.length === 0 ? 'No models' : 'Model'))}
              </span>
              <ChevronDown className="w-3.5 h-3.5 opacity-60 flex-shrink-0" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-[220px] rounded-2xl shadow-xl backdrop-blur-xl bg-popover/95 border-border/80 p-1" sideOffset={8}>
              <div className="flex items-center px-2.5 py-2 border-b mb-1">
                <Search className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search models..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="flex-1 bg-transparent text-xs outline-none min-w-0 placeholder:text-muted-foreground"
                />
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setForceRefresh(f => f + 1); }}
                  className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted ml-1"
                  disabled={modelsLoading}
                  title="Refresh models"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${modelsLoading ? 'animate-spin text-primary' : ''}`} />
                </button>
              </div>
              <div className="max-h-[220px] overflow-y-auto hide-scrollbar px-1">
                {models.length === 0 ? (
                  <div className="px-2 py-4 text-xs text-muted-foreground text-center">
                    No models configured
                  </div>
                ) : (() => {
                  const filtered = models.filter(m => m.label.toLowerCase().includes(searchQuery.toLowerCase()) || m.value.toLowerCase().includes(searchQuery.toLowerCase()));

                  const favs = filtered.filter(m => favoriteModels.includes(m.value));
                  const recents = filtered.filter(m => recentModels.includes(m.value) && !favoriteModels.includes(m.value));
                  const rest = filtered.filter(m => !favoriteModels.includes(m.value) && !recentModels.includes(m.value));

                  const renderModelItem = (m: ModelOption) => {
                    const meta = PROVIDER_META[m.provider] ?? PROVIDER_META.openai;
                    const isFav = favoriteModels.includes(m.value);
                    const isSelected = m.value === selectedModel;
                    return (
                      <DropdownMenuItem
                        key={m.value}
                        onClick={() => { setModel(m.value, m.provider); setDropdownOpen(false); }}
                        className={`text-xs py-2 px-2.5 rounded-xl cursor-pointer flex items-center justify-between group transition-colors mb-0.5 ${isSelected ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted/80'}`}
                      >
                        <div className="flex items-center gap-2.5 truncate min-w-0 flex-1 pr-2">
                          {meta.icon ? (
                            <>
                              <img src={meta.icon} alt={m.provider} className="w-4 h-4 object-contain flex-shrink-0 dark:hidden" />
                              {meta.iconDark && <img src={meta.iconDark} alt={m.provider} className="w-4 h-4 object-contain flex-shrink-0 hidden dark:block" />}
                            </>
                          ) : (
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 shadow-sm" style={{ background: meta.color }} />
                          )}
                          <span className="truncate">{m.label}</span>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); toggleFavoriteModel(m.value); }}
                          className={`flex-shrink-0 p-1 rounded-md hover:bg-background transition-opacity ${isFav ? 'text-yellow-500 opacity-100' : 'text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100'}`}
                          title={isFav ? "Remove from favorites" : "Add to favorites"}
                        >
                          <Star className="w-3.5 h-3.5" fill={isFav ? "currentColor" : "none"} />
                        </button>
                      </DropdownMenuItem>
                    );
                  };

                  return (
                    <>
                      {favs.length > 0 && (
                        <div className="mb-2">
                          <div className="px-2 py-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Favorites</div>
                          {favs.map(renderModelItem)}
                        </div>
                      )}
                      {recents.length > 0 && (
                        <div className="mb-2">
                          <div className="px-2 py-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Recent</div>
                          {recents.map(renderModelItem)}
                        </div>
                      )}
                      <div>
                        <div className="px-2 py-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">All Models</div>
                        {rest.map(renderModelItem)}
                      </div>
                    </>
                  );
                })()}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="h-5 w-px bg-border/60 flex-shrink-0 mb-2" />

          {/* Attach Button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-all duration-200 mb-0.5 relative group"
            title="Attach image"
          >
            <Paperclip className="w-4 h-4 group-hover:scale-110 transition-transform" />
            {images.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-primary text-primary-foreground text-[10px] font-bold rounded-full flex items-center justify-center shadow-sm animate-pulse">
                {images.length}
              </span>
            )}
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
              <div className="flex items-center gap-2.5 px-1 pb-2 overflow-x-auto hide-scrollbar">
                {images.map((img, idx) => (
                  <div key={idx} className="relative group w-14 h-14 flex-shrink-0 rounded-xl overflow-hidden border border-border/80 shadow-md bg-background transition-transform hover:scale-105">
                    <img src={img} alt="attachment" className="w-full h-full object-cover" />
                    <button 
                      onClick={() => removeImage(idx)}
                      className="absolute top-1 right-1 w-5 h-5 bg-black/70 hover:bg-black text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow-sm"
                      title="Remove image"
                    >
                      <X className="w-3 h-3" />
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
              placeholder="Ask anything, attach images, or trigger tools..."
              disabled={isStreaming}
              rows={1}
              className={[
                'flex-1 min-h-[36px] max-h-[180px] py-2 px-1 text-sm leading-relaxed resize-none font-sans',
                'bg-transparent border-0 shadow-none',
                'focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:shadow-none',
                'placeholder:text-muted-foreground/70',
              ].join(' ')}
            />
          </div>

          {/* Shortcut hint & Send / Stop button */}
          <div className="flex items-center gap-2 flex-shrink-0 mb-0.5">
            <span className="text-[10px] text-muted-foreground/50 font-mono hidden xl:inline select-none">
              ↵ Send
            </span>
            {isStreaming ? (
              <button
                type="button"
                onClick={handleStop}
                aria-label="Stop generation"
                className="w-9 h-9 rounded-full flex items-center justify-center transition-all duration-200 bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-md hover:scale-105 active:scale-95 animate-pulse"
                title="Stop generation"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                disabled={!canSend}
                onClick={handleSend}
                aria-label="Send"
                title={canSend ? "Send message (Enter)" : "Type a message to send"}
                className={[
                  'w-9 h-9 rounded-full flex items-center justify-center transition-all duration-300 shadow-md',
                  'disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none',
                  canSend ? 'bg-primary text-primary-foreground hover:bg-primary/90 hover:shadow-lg hover:scale-105 active:scale-95' : 'bg-muted text-muted-foreground'
                ].join(' ')}
              >
                <ArrowUp className="w-4 h-4 stroke-[2.5]" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
