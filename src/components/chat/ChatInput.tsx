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
import {
  ArrowUp,
  FileText,
  Calculator,
  StickyNote,
  Search,
  ChevronDown,
  Paperclip,
  X,
  Square,
  Sparkles,
  Cpu,
  Code2,
  FolderOpen,
  Star,
} from 'lucide-react';
import { useModelPreferenceStore } from '@/stores/useModelPreferenceStore';
import { toast } from 'sonner';

type ModelOption = { value: string; label: string; provider: Provider };

/** Extensions that are always safe to attach as inline text. */
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'jsonl', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
  'py', 'rs', 'go', 'java', 'c', 'h', 'cpp', 'hpp', 'cs', 'rb', 'php', 'swift', 'kt',
  'html', 'htm', 'css', 'scss', 'less', 'xml', 'svg', 'yaml', 'yml', 'toml', 'ini',
  'cfg', 'conf', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'sql', 'graphql', 'lua', 'r',
  'vue', 'svelte', 'astro', 'tex', 'csv', 'log', 'diff', 'patch', 'gitignore',
  'dockerfile', 'makefile', 'cmake', 'gradle', 'lock', 'env', 'editorconfig',
]);

/** Per-file cap so an attachment can't blow up the model context. */
const MAX_FILE_CHARS = 200_000;

/** Image extensions — Linux pickers/drag-drop often return an empty MIME type.
    (`svg` deliberately excluded: it is XML, far more useful to the model as text.) */
const IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'ico', 'tif', 'tiff',
]);

function isProbablyText(file: File): boolean {
  if (file.type.startsWith('text/')) return true;
  if (
    ['application/json', 'application/xml', 'application/javascript', 'application/x-yaml'].includes(
      file.type
    )
  ) {
    return true;
  }
  const name = file.name.toLowerCase();
  const ext = name.includes('.') ? (name.split('.').pop() ?? '') : name;
  return TEXT_EXTENSIONS.has(ext);
}

const FALLBACK_MODELS: ModelOption[] = [
  { value: 'gpt-4o', label: 'GPT-4o', provider: 'openai' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini', provider: 'openai' },
  { value: 'claude-3-5-sonnet-20240620', label: 'Claude 3.5 Sonnet', provider: 'anthropic' },
  {
    value: 'opencode-go/qwen3.6-plus',
    label: 'OpenCode Go (Qwen 3.6 Plus)',
    provider: 'opencode',
  },
  {
    value: 'opencode-go/kimi-k2.7-code',
    label: 'OpenCode Go (Kimi K2.7 Code)',
    provider: 'opencode',
  },
  {
    value: 'zen/claude-3-7-sonnet',
    label: 'OpenCode Zen (Claude 3.7 Sonnet)',
    provider: 'opencode',
  },
  { value: 'zen/gpt-4o', label: 'OpenCode Zen (GPT-4o)', provider: 'opencode' },
  { value: 'llama3.1', label: 'Llama 3.1 (Local)', provider: 'local' },
];

const SLASH_COMMANDS = [
  {
    command: '/calc',
    title: 'Calculator',
    desc: 'Evaluate high-precision math & unit conversions',
    icon: Calculator,
    template: '/calc ',
  },
  {
    command: '/file',
    title: 'File Manager',
    desc: 'Read, write, list, or search workspace files',
    icon: FileText,
    template: '/file ',
  },
  {
    command: '/note',
    title: 'Notes',
    desc: 'Create or update ideas in your scratch notes',
    icon: StickyNote,
    template: '/note ',
  },
  {
    command: '/code',
    title: 'Code Coder',
    desc: 'Refactor, debug, or write code files',
    icon: Code2,
    template: '/code ',
  },
  {
    command: '/web',
    title: 'Web Fetch',
    desc: 'Fetch and summarize content from a URL',
    icon: Sparkles,
    template: '/web ',
  },
  {
    command: '/search',
    title: 'File Search',
    desc: 'Search content across workspace files',
    icon: FolderOpen,
    template: '/search ',
  },
  {
    command: '/sys',
    title: 'System',
    desc: 'Learn about Weave AI and its built-in plugins',
    icon: Cpu,
    template: '/sys ',
  },
];

export function ChatInput() {
  const [input, setInput] = useState('');
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const [images, setImages] = useState<string[]>([]);
  const [files, setFiles] = useState<{ name: string; content: string }[]>([]);
  const [models, setModels] = useState<ModelOption[]>(FALLBACK_MODELS);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('weave_favorite_models');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const toggleFavorite = (val: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavorites((prev) => {
      const next = prev.includes(val) ? prev.filter((item) => item !== val) : [...prev, val];
      localStorage.setItem('weave_favorite_models', JSON.stringify(next));
      return next;
    });
  };
  const {
    sendMessage,
    isStreaming,
    isSwitchingModel,
    selectedModel,
    setModel,
  } = useChatStore();
  const { lastConfigUpdate } = useAppStore();
  const { addRecentModel } = useModelPreferenceStore();
  const { plugins: externalPlugins } = usePluginStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;

    invoke<AppConfig>('system_get_config')
      .then(async () => {
        if (!cancelled) setModelsLoading(true);
        const providers: Provider[] = ['openai', 'anthropic', 'opencode', 'local'];

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
      .catch(() => {
        if (!cancelled) setModels(FALLBACK_MODELS);
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [lastConfigUpdate]);

  useEffect(() => {
    if (models.length > 0 && !selectedModel) {
      void setModel(models[0].value, models[0].provider);
    }
  }, [models, selectedModel, setModel]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if ((!trimmed && images.length === 0 && files.length === 0) || isStreaming) return;
    setInput('');
    const currentImages = [...images];
    setImages([]);
    // Attached text files travel inline so every model (vision or not) sees them.
    const fileBlocks = files
      .map((f) => `\n\n<file name="${f.name}">\n${f.content}\n</file>`)
      .join('');
    setFiles([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    if (selectedModel) addRecentModel(selectedModel);
    await sendMessage(trimmed + fileBlocks, currentImages);
  }, [input, images, files, isStreaming, sendMessage, selectedModel, addRecentModel]);

  const handleStop = useCallback(() => {
    useChatStore.getState().stopStreaming();
  }, []);

  const query = input.trimStart();
  const isSlashCommandActive = query.startsWith('/') && !query.slice(1).includes(' ');
  const slashSearch = isSlashCommandActive ? query.toLowerCase() : '';
  const allSlashCommands = useMemo(() => {
    const externalCmds = externalPlugins.map((p) => {
      const shortId = p.id.split('.').pop() || p.id;
      const cmdName = `/${shortId.toLowerCase()}`;
      return {
        command: cmdName,
        title: p.name,
        desc: p.description || `Execute ${p.name} capability`,
        icon: Cpu,
        template: `${cmdName} `,
        isExternal: !p.is_builtin,
      };
    });

    const existingCmds = new Set(SLASH_COMMANDS.map((c) => c.command.toLowerCase()));
    const uniqueExternal = externalCmds.filter((c) => !existingCmds.has(c.command.toLowerCase()));

    return [...SLASH_COMMANDS, ...uniqueExternal];
  }, [externalPlugins]);

  const filteredSlashCommands = useMemo(() => {
    return isSlashCommandActive
      ? allSlashCommands.filter(
          (cmd) =>
            cmd.command.toLowerCase().startsWith(slashSearch) ||
            cmd.title.toLowerCase().includes(slashSearch.slice(1)) ||
            cmd.desc.toLowerCase().includes(slashSearch.slice(1))
        )
      : [];
  }, [isSlashCommandActive, slashSearch, allSlashCommands]);

  const selectSlashCommand = useCallback((cmd: (typeof SLASH_COMMANDS)[0]) => {
    setInput(cmd.template);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (isSlashCommandActive && filteredSlashCommands.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSlashSelectedIndex((prev) => (prev + 1) % filteredSlashCommands.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSlashSelectedIndex(
            (prev) => (prev - 1 + filteredSlashCommands.length) % filteredSlashCommands.length
          );
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
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [
      handleSend,
      isSlashCommandActive,
      filteredSlashCommands,
      slashSelectedIndex,
      selectSlashCommand,
    ]
  );

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    setSlashSelectedIndex(0);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, []);

  const processFile = (file: File) => {
    // Images keep the vision pipeline (compressed data-URL previews).
    // MIME can be empty on Linux — fall back to the extension.
    const ext = file.name.toLowerCase().split('.').pop() ?? '';
    if (file.type.startsWith('image/') || IMAGE_EXTENSIONS.has(ext)) {
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
            setImages((prev) => [...prev, dataUrl]);
          };
          img.src = result;
        }
      };
      reader.readAsDataURL(file);
      return;
    }

    // Everything else: attach as inline text so any model can see it.
    if (!isProbablyText(file)) {
      toast.error(`"${file.name}" looks binary — only text files and images can be attached.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      let text = (e.target?.result as string) ?? '';
      // NUL bytes in the head mean the "text" guess was wrong (compiled/binary format).
      if (text.slice(0, 2048).includes('\u0000')) {
        toast.error(`"${file.name}" looks binary — skipped.`);
        return;
      }
      if (text.length > MAX_FILE_CHARS) {
        text = `${text.slice(0, MAX_FILE_CHARS)}\n… (truncated)`;
      }
      setFiles((prev) => [...prev, { name: file.name, content: text }]);
    };
    reader.readAsText(file);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') {
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
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const canSend =
    (!!input.trim() || images.length > 0 || files.length > 0) && !isStreaming && !isSwitchingModel;

  return (
    <div className="flex-shrink-0 px-4 pb-4 pt-2 max-w-4xl mx-auto w-full">
      {/* Slash Command Autocomplete Menu */}
      {isSlashCommandActive && filteredSlashCommands.length > 0 && (
        <div className="mb-2 w-full max-h-60 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg p-1 animate-in fade-in duration-150 z-50">
          <div className="px-2 py-1 text-[10px] font-mono text-muted-foreground border-b border-border/50 mb-1">
            Available Slash Commands
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
                className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded text-left font-mono text-xs transition-colors cursor-pointer ${
                  isSelected ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="font-semibold">{cmd.command}</span>
                  <span className="text-[11px] font-sans truncate">{cmd.title}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Tonal composer — the one floating object; focus makes it glow */}
      <div className="composer elevate rounded-xl bg-surface-1 border border-transparent focus-within:bg-surface-2 p-2 flex flex-col gap-2">
        {/* Attached image previews */}
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2 px-1 pt-1">
            {images.map((img, idx) => (
              <div key={idx} className="relative group rounded border border-border overflow-hidden w-12 h-12">
                <img src={img} alt="attachment" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeImage(idx)}
                  className="absolute top-0.5 right-0.5 bg-background/80 rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Attached text-file chips — content rides inline with the message */}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-1 pt-1">
            {files.map((f, idx) => (
              <div
                key={idx}
                className="flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 font-mono text-[11px] text-muted-foreground"
              >
                <FileText className="w-3 h-3 shrink-0" />
                <span className="max-w-[160px] truncate text-foreground">{f.name}</span>
                <span>{Math.max(1, Math.round(f.content.length / 1000))}k</span>
                <button
                  type="button"
                  onClick={() => removeFile(idx)}
                  className="hover:text-foreground transition-colors"
                  title="Remove attachment"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Text area */}
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onDrop={handleDrop}
          placeholder="Ask anything or use / command..."
          rows={1}
          className="w-full resize-none bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 p-1 text-sm font-sans placeholder:text-muted-foreground min-h-[36px] max-h-[160px]"
        />

        {/* Action Row */}
        <div className="flex items-center justify-between pt-1 font-mono text-xs">
          <div className="flex items-center gap-2">
            {/* Model Selector */}
            <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
              <DropdownMenuTrigger
                disabled={modelsLoading || isStreaming || isSwitchingModel}
                className="h-7 text-xs bg-surface-2 hover:bg-surface-3 px-2.5 rounded-md gap-1.5 flex items-center outline-none transition-colors text-muted-foreground hover:text-foreground"
              >
                <span className="truncate max-w-[120px] font-medium">
                  {modelsLoading || isSwitchingModel
                    ? 'Loading...'
                    : models.find((m) => m.value === selectedModel)?.label || 'Model'}
                </span>
                <ChevronDown className="w-3 h-3 opacity-60" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-64 rounded-md bg-popover border border-border p-1 shadow-lg" sideOffset={6}>
                <div className="flex items-center px-2 py-1 border-b border-border/50 mb-1">
                  <Search className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search model..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground font-mono"
                  />
                </div>
                <div className="max-h-56 overflow-y-auto font-mono text-xs">
                  {models
                    .filter((m) => m.label.toLowerCase().includes(searchQuery.toLowerCase()) || m.provider.toLowerCase().includes(searchQuery.toLowerCase()))
                    .sort((a, b) => {
                      const isFavA = favorites.includes(a.value);
                      const isFavB = favorites.includes(b.value);
                      if (isFavA && !isFavB) return -1;
                      if (!isFavA && isFavB) return 1;
                      return a.label.localeCompare(b.label);
                    })
                    .map((m) => {
                      const isFav = favorites.includes(m.value);
                      return (
                        <DropdownMenuItem
                          key={m.value}
                          onClick={() => {
                            void setModel(m.value, m.provider);
                            setDropdownOpen(false);
                          }}
                          className={`px-2 py-1.5 rounded text-xs cursor-pointer flex items-center justify-between group ${
                            m.value === selectedModel ? 'bg-muted text-foreground font-semibold' : 'text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          <span className="truncate">{m.label}</span>
                          <button
                            type="button"
                            onClick={(e) => toggleFavorite(m.value, e)}
                            title={isFav ? 'Remove favorite' : 'Add to favorites'}
                            className="p-0.5 rounded hover:bg-background/80 transition-colors"
                          >
                            <Star className={`w-3.5 h-3.5 ${isFav ? 'fill-foreground text-foreground' : 'text-muted-foreground/40 group-hover:text-muted-foreground'}`} />
                          </button>
                        </DropdownMenuItem>
                      );
                    })}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Paperclip Attach — every file type is visible; text rides inline, images use vision */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Attach file (text or image)"
            >
              <Paperclip className="w-3.5 h-3.5" />
            </button>
            <input
              type="file"
              ref={fileInputRef}
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) Array.from(e.target.files).forEach(processFile);
                e.target.value = '';
              }}
            />
          </div>

          {/* Send / Stop Button */}
          {isStreaming ? (
            <button
              type="button"
              onClick={handleStop}
              className="flex items-center gap-1.5 px-3 py-1 bg-destructive text-destructive-foreground font-semibold rounded text-xs hover:bg-destructive/90 transition-colors"
            >
              <Square className="w-3 h-3 fill-current" />
              <span>Stop</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend}
              className="flex items-center gap-1 px-3 py-1 bg-brand text-brand-foreground font-semibold rounded-md text-xs hover:bg-brand/90 disabled:opacity-40 transition-all cursor-pointer"
            >
              <span>Send</span>
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
