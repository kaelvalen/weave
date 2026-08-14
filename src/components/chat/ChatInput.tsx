import React, { useState, useRef, useCallback, useEffect, useMemo, useLayoutEffect } from 'react';
import type { KeyboardEvent } from 'react';
import { useChatStore } from '@/stores/useChatStore';
import { useAppStore } from '@/stores/useAppStore';
import { usePluginStore } from '@/stores/usePluginStore';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
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
  Globe,
  Database,
  Plus,
  Mic,
  Check,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useModelPreferenceStore } from '@/stores/useModelPreferenceStore';
import { ApprovalModeToggle } from './ApprovalModeToggle';
import { toast } from 'sonner';

type ModelOption = { value: string; label: string; provider: Provider };

/** Extensions that are always safe to attach as inline text. */
const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'json',
  'jsonl',
  'js',
  'jsx',
  'ts',
  'tsx',
  'mjs',
  'cjs',
  'py',
  'rs',
  'go',
  'java',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'rb',
  'php',
  'swift',
  'kt',
  'html',
  'htm',
  'css',
  'scss',
  'less',
  'xml',
  'svg',
  'yaml',
  'yml',
  'toml',
  'ini',
  'cfg',
  'conf',
  'sh',
  'bash',
  'zsh',
  'ps1',
  'bat',
  'sql',
  'graphql',
  'lua',
  'r',
  'vue',
  'svelte',
  'astro',
  'tex',
  'csv',
  'log',
  'diff',
  'patch',
  'gitignore',
  'dockerfile',
  'makefile',
  'cmake',
  'gradle',
  'lock',
  'env',
  'editorconfig',
]);

/** Per-file cap so an attachment can't blow up the model context. */
const MAX_FILE_CHARS = 200_000;

/** Image extensions — Linux pickers/drag-drop often return an empty MIME type.
    (`svg` deliberately excluded: it is XML, far more useful to the model as text.) */
const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'avif',
  'ico',
  'tif',
  'tiff',
]);

function isProbablyText(file: File): boolean {
  if (file.type.startsWith('text/')) return true;
  if (
    [
      'application/json',
      'application/xml',
      'application/javascript',
      'application/x-yaml',
    ].includes(file.type)
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

/** @ sources — real capabilities, mentionable like the design's data sources.
    Selecting one inserts `@Name` into the draft; the attach row opens the picker. */
const SOURCES = [
  {
    key: 'attach',
    name: 'Add photos & files',
    desc: 'Upload from your computer',
    icon: Paperclip,
    attach: true,
  },
  { key: 'web', name: 'Web search', desc: 'Search the web and read sources', icon: Globe },
  { key: 'files', name: 'Workspace files', desc: 'Read, search, or write files', icon: FolderOpen },
  { key: 'note', name: 'Notes', desc: 'Create or update scratch notes', icon: StickyNote },
  { key: 'db', name: 'Database', desc: 'Query and inspect the database', icon: Database },
];

type MenuRow = { key: string; name: string; desc: string; icon: LucideIcon; attach?: boolean };

type DictationRecognition = {
  lang: string;
  interimResults: boolean;
  onresult:
    ((event: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

/* the last @word or /word being typed, if any */
function parseToken(draft: string): { kind: 'at' | 'slash'; query: string; start: number } | null {
  const match = /(^|\s)([@/])([\w-]*)$/.exec(draft);
  if (!match) return null;
  return {
    kind: match[2] === '@' ? 'at' : 'slash',
    query: match[3].toLowerCase(),
    start: match.index + match[1].length,
  };
}

export function ChatInput({ variant = 'Rounded' }: { variant?: 'Rounded' | 'Pill' } = {}) {
  const pill = variant === 'Pill';
  const [input, setInput] = useState('');
  const [active, setActive] = useState(0);
  const [engaged, setEngaged] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [rowBox, setRowBox] = useState<{ top: number; height: number } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [listening, setListening] = useState(false);
  const [dictationSupported] = useState(
    () => typeof window !== 'undefined' && 'webkitSpeechRecognition' in window
  );
  const [images, setImages] = useState<string[]>([]);
  const [files, setFiles] = useState<{ name: string; content: string }[]>([]);
  const [models, setModels] = useState<ModelOption[]>(FALLBACK_MODELS);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // llama-swap router reachability (spec §4): knowable before send, so the
  // picker shows it per model instead of discovering it via a failed request.
  const [llamaSwapActive, setLlamaSwapActive] = useState<boolean | null>(null);
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
  const { sendMessage, isStreaming, isSwitchingModel, selectedModel, setModel } = useChatStore();
  const { lastConfigUpdate } = useAppStore();
  const { addRecentModel } = useModelPreferenceStore();
  const { plugins: externalPlugins } = usePluginStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);
  const approvalRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const recognitionRef = useRef<DictationRecognition | null>(null);

  useEffect(() => {
    let cancelled = false;

    invoke<AppConfig>('system_get_config')
      .then(async () => {
        if (!cancelled) setModelsLoading(true);
        const providers: Provider[] = ['openai', 'anthropic', 'opencode', 'llama-swap', 'local'];

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
        void invoke<{ active: boolean }>('llama_swap_status')
          .then((s) => {
            if (!cancelled) setLlamaSwapActive(s.active);
          })
          .catch(() => {
            if (!cancelled) setLlamaSwapActive(null);
          });
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

  useEffect(() => {
    return () => recognitionRef.current?.stop();
  }, []);

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

  /* the last @word or /word being typed — @ opens the sources menu, / the commands */
  const token = dismissed ? null : parseToken(input);
  const menu: 'at' | 'slash' | null = plusOpen ? 'at' : (token?.kind ?? null);
  const query = plusOpen ? '' : (token?.query ?? '');

  const menuRows: MenuRow[] = useMemo(
    () =>
      menu === 'at'
        ? SOURCES.filter((s) => s.name.toLowerCase().includes(query))
        : menu === 'slash'
          ? allSlashCommands
              .filter(
                (c) =>
                  c.command.slice(1).startsWith(query) ||
                  c.title.toLowerCase().includes(query) ||
                  c.desc.toLowerCase().includes(query)
              )
              .map((c) => ({ key: c.command, name: c.command, desc: c.title, icon: c.icon }))
          : [],
    [menu, query, allSlashCommands]
  );

  /* a single highlight glides to the active row instead of each row
     toggling its own background */
  useLayoutEffect(() => {
    const target = rowRefs.current[active];
    if (target) setRowBox({ top: target.offsetTop, height: target.offsetHeight });
  }, [menu, query, active, menuRows.length]);

  const pick = useCallback(
    (row: MenuRow) => {
      if (row.attach) {
        fileInputRef.current?.click();
        if (token) setInput(input.slice(0, token.start));
      } else if (menu === 'at') {
        setInput(`${token ? input.slice(0, token.start) : input}@${row.name} `);
      } else {
        setInput(`${token ? input.slice(0, token.start) : input}${row.name} `);
      }
      setPlusOpen(false);
      setDismissed(false);
      textareaRef.current?.focus();
    },
    [menu, token, input]
  );

  /* Move wrapped text above the controls, then grow to a compact maximum. */
  useLayoutEffect(() => {
    const inputEl = textareaRef.current;
    const controls = controlsRef.current;
    const measure = measureRef.current;
    const modelButton = modelRef.current;
    const approval = approvalRef.current;
    if (!inputEl || !controls || !measure || !modelButton || !approval) return;

    const fixedControlsWidth = 28 + approval.offsetWidth + modelButton.offsetWidth + 28 + 28;
    const inlineGaps = 5 * 4;
    const inlineInputWidth = controls.clientWidth - fixedControlsWidth - inlineGaps;
    const needsFullWidth = input.includes('\n') || measure.offsetWidth + 8 > inlineInputWidth;
    if (needsFullWidth !== expanded) {
      // Layout-driven measurement: the row reshapes only after we know how
      // much inline width the text needs — state mirrors a DOM read here.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExpanded(needsFullWidth);
    }

    const minHeight = 28;
    const maxHeight = 100;
    inputEl.style.height = '0px';
    const contentHeight = inputEl.scrollHeight;
    inputEl.style.height = `${Math.min(Math.max(contentHeight, minHeight), maxHeight)}px`;
    inputEl.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden';
  }, [input, expanded]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (menu && menuRows.length > 0) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          setEngaged(true);
          setActive(
            (c) => (c + (e.key === 'ArrowDown' ? 1 : menuRows.length - 1)) % menuRows.length
          );
          return;
        }
        if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
          e.preventDefault();
          pick(menuRows[active] ?? menuRows[0]);
          return;
        }
      }
      if (e.key === 'Escape') {
        setDismissed(true);
        setPlusOpen(false);
        setDropdownOpen(false);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        void handleSend();
      }
    },
    [menu, menuRows, active, pick, handleSend]
  );

  const startDictation = useCallback(() => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const SR = (window as unknown as { webkitSpeechRecognition?: new () => DictationRecognition })
      .webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? '';
      if (transcript) setInput((prev) => (prev ? `${prev.trimEnd()} ${transcript}` : transcript));
      textareaRef.current?.focus();
    };
    rec.onerror = () => {
      setListening(false);
      toast.error('Dictation failed — please try again.');
    };
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  }, [listening]);

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

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
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

  const canSend =
    (!!input.trim() || images.length > 0 || files.length > 0) && !isStreaming && !isSwitchingModel;

  return (
    <div className="flex-shrink-0 px-4 pb-4 pt-2 max-w-4xl mx-auto w-full">
      <div className="relative">
        {/* ── @ sources / / commands menu — grows up from the composer's top edge ── */}
        {menu && (
          <div
            onMouseLeave={() => setEngaged(false)}
            className="absolute inset-x-0 bottom-full z-10 mb-2 rounded-[10px] bg-popover p-1 elevate"
            style={{
              animation: 'pop-in 180ms cubic-bezier(0.23,1,0.32,1) both',
              transformOrigin: 'bottom center',
            }}
          >
            {/* single gliding highlight — appears once a row is engaged */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-1 rounded-[6px] bg-muted"
              style={{
                top: rowBox?.top ?? 0,
                height: rowBox?.height ?? 0,
                opacity: rowBox && engaged && menuRows.length > 0 ? 1 : 0,
                transition:
                  'top 220ms cubic-bezier(0.23,1,0.32,1), height 220ms cubic-bezier(0.23,1,0.32,1), opacity 150ms ease',
              }}
            />
            {menuRows.map((row, i) => {
              const Icon = row.icon;
              return (
                <button
                  key={row.key}
                  type="button"
                  ref={(el) => {
                    rowRefs.current[i] = el;
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => {
                    setActive(i);
                    setEngaged(true);
                  }}
                  onClick={() => pick(row)}
                  className="relative z-10 flex h-9 w-full items-center gap-2.5 rounded-[6px] px-2 text-left"
                >
                  <span className="flex w-5 shrink-0 items-center justify-center text-muted-foreground">
                    <Icon size={15} strokeWidth={1.8} />
                  </span>
                  <span className="shrink-0 text-[12.5px] font-medium text-foreground">
                    {row.name}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground/70">
                    {row.desc}
                  </span>
                </button>
              );
            })}
            {menuRows.length === 0 && (
              <div className="flex h-9 items-center px-2 text-[12px] text-muted-foreground/70">
                No matches for “{query}”
              </div>
            )}
            <div className="mt-1 border-t border-border px-2 pt-1.5 pb-1 text-[11px] text-muted-foreground/70">
              {menu === 'at' ? 'Type to search sources & files' : 'Type to search commands'}
            </div>
          </div>
        )}

        {/* ── composer ── */}
        <div
          className={`composer elevate relative isolate flex flex-col gap-1.5 overflow-hidden border bg-surface-1 p-1.5 focus-within:border-border focus-within:bg-surface-2 ${
            pill
              ? files.length > 0 || images.length > 0 || expanded
                ? 'rounded-[24px]'
                : 'rounded-full'
              : 'rounded-[14px]'
          } border-border/50`}
        >
          <span
            ref={measureRef}
            aria-hidden="true"
            className="pointer-events-none absolute invisible whitespace-pre text-[13px] leading-[18px]"
          >
            {input}
          </span>

          {/* attached image previews */}
          {images.length > 0 && (
            <div className={`flex flex-wrap gap-1.5 pt-0.5 ${pill ? 'px-1' : 'px-0.5'}`}>
              {images.map((img, idx) => (
                <div
                  key={idx}
                  className="group relative h-9 w-9 overflow-hidden rounded-[8px] border border-border/60"
                >
                  <img src={img} alt="attachment" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    aria-label="Remove image"
                    onClick={() => removeImage(idx)}
                    className="absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded-[4px] bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <X size={10} strokeWidth={2.5} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* attached text-file chips — content rides inline with the message */}
          {files.length > 0 && (
            <div className={`flex flex-wrap gap-1.5 pt-0.5 ${pill ? 'px-1' : 'px-0.5'}`}>
              {files.map((f, idx) => (
                <span
                  key={idx}
                  className={`flex h-[26px] items-center gap-1.5 bg-surface-3 py-1 pr-1 pl-1.5 text-[11.5px] text-muted-foreground ${
                    pill ? 'rounded-full' : 'rounded-md'
                  }`}
                  style={{ animation: 'pop-in 200ms cubic-bezier(0.23,1,0.32,1) both' }}
                >
                  <FileText size={12} className="shrink-0" />
                  <span className="max-w-32 truncate text-foreground">{f.name}</span>
                  <span className="shrink-0">
                    {Math.max(1, Math.round(f.content.length / 1000))}k
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    onClick={() => removeFile(idx)}
                    className={`flex size-4 items-center justify-center text-muted-foreground/60 transition-colors duration-100 hover:bg-border/60 hover:text-foreground ${
                      pill ? 'rounded-full' : 'rounded-[4px]'
                    }`}
                  >
                    <X size={10} strokeWidth={2.5} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div
            ref={controlsRef}
            className="grid items-end gap-x-1 gap-y-1.5 grid-cols-[28px_minmax(0,1fr)_auto_auto_28px_28px]"
          >
            {/* attach & sources — opens the @ menu */}
            <button
              type="button"
              aria-label="Add attachments and sources"
              aria-expanded={plusOpen}
              onClick={() => {
                setDropdownOpen(false);
                setPlusOpen((current) => !current);
                setActive(0);
                setEngaged(false);
                textareaRef.current?.focus();
              }}
              className={`flex size-7 shrink-0 items-center justify-center justify-self-start text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-muted hover:text-foreground active:scale-[0.94] ${
                pill ? 'rounded-full' : 'rounded-[8px]'
              } ${plusOpen ? 'bg-muted text-foreground' : ''} ${
                expanded ? 'col-start-1 row-start-2' : 'col-start-1 row-start-1'
              }`}
            >
              <Plus size={16} strokeWidth={2} />
            </button>

            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                setDismissed(false);
                setPlusOpen(false);
                setActive(0);
                setEngaged(false);
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onDrop={handleDrop}
              placeholder={listening ? 'Listening…' : 'Ask anything or use / command…'}
              aria-label="Prompt"
              className={`min-h-7 min-w-0 w-full resize-none bg-transparent px-1 py-[5px] text-[13px] leading-[18px] text-foreground outline-none [overflow-wrap:anywhere] placeholder:text-muted-foreground/70 ${
                expanded ? 'col-span-full row-start-1' : 'col-start-2 row-start-1'
              }`}
            />

            {/* approval mode (Ask / Auto-Approve) */}
            <div
              ref={approvalRef}
              className={`flex h-7 shrink-0 items-center ${expanded ? 'col-start-2 row-start-2' : 'col-start-3 row-start-1'}`}
            >
              <ApprovalModeToggle />
            </div>

            {/* model picker */}
            <div
              ref={modelRef}
              className={`flex min-w-0 shrink-0 items-center ${expanded ? 'col-start-3 row-start-2' : 'col-start-4 row-start-1'}`}
            >
              <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
                <DropdownMenuTrigger
                  disabled={modelsLoading || isStreaming || isSwitchingModel}
                  className={`flex h-7 max-w-[180px] shrink-0 items-center gap-1 whitespace-nowrap px-1.5 text-[12px] font-medium text-muted-foreground outline-none transition-colors duration-150 hover:bg-muted hover:text-foreground ${
                    pill ? 'rounded-full' : 'rounded-[8px]'
                  }`}
                >
                  <span className="truncate">
                    {modelsLoading || isSwitchingModel
                      ? 'Loading...'
                      : models.find((m) => m.value === selectedModel)?.label || 'Model'}
                  </span>
                  <ChevronDown size={11} className="shrink-0 opacity-60" />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="top"
                  align="end"
                  sideOffset={6}
                  className="elevate w-64 rounded-[10px] border border-border bg-popover p-1"
                >
                  <div className="mb-1 flex items-center border-b border-border/50 px-2 py-1">
                    <Search size={14} className="mr-1.5 shrink-0 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Search model..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="flex-1 bg-transparent text-xs outline-none font-mono placeholder:text-muted-foreground"
                    />
                  </div>
                  <div className="max-h-56 overflow-y-auto">
                    {models
                      .filter(
                        (m) =>
                          m.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          m.provider.toLowerCase().includes(searchQuery.toLowerCase())
                      )
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
                            className={`flex cursor-pointer items-center justify-between rounded-[6px] px-2 py-1.5 text-xs group ${
                              m.value === selectedModel
                                ? 'bg-muted text-foreground font-semibold'
                                : 'text-muted-foreground hover:text-foreground'
                            }`}
                          >
                            <span className="flex min-w-0 items-center gap-1.5 truncate">
                              {m.provider === 'llama-swap' && (
                                <span
                                  title={
                                    llamaSwapActive
                                      ? 'llama-swap router aktif'
                                      : 'llama-swap router kapalı — seçilince otomatik başlar'
                                  }
                                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                    llamaSwapActive
                                      ? 'bg-emerald-500'
                                      : llamaSwapActive === null
                                        ? 'bg-muted-foreground/40'
                                        : 'bg-amber-500'
                                  }`}
                                />
                              )}
                              <span className="truncate">{m.label}</span>
                            </span>
                            <span className="flex shrink-0 items-center gap-1">
                              {m.value === selectedModel && (
                                <Check size={12} strokeWidth={2.5} className="text-foreground" />
                              )}
                              <button
                                type="button"
                                onClick={(e) => toggleFavorite(m.value, e)}
                                title={isFav ? 'Remove favorite' : 'Add to favorites'}
                                className="rounded p-0.5 transition-colors hover:bg-background/80"
                              >
                                <Star
                                  size={14}
                                  className={
                                    isFav
                                      ? 'fill-foreground text-foreground'
                                      : 'text-muted-foreground/40 group-hover:text-muted-foreground'
                                  }
                                />
                              </button>
                            </span>
                          </DropdownMenuItem>
                        );
                      })}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* dictation */}
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={listening ? 'Stop dictation' : 'Start dictation'}
                    aria-pressed={listening}
                    disabled={!dictationSupported}
                    onClick={startDictation}
                    className={`flex size-7 shrink-0 items-center justify-center transition-[background-color,color,transform] duration-150 active:scale-[0.94] ${
                      pill ? 'rounded-full' : 'rounded-[8px]'
                    } ${
                      listening
                        ? 'bg-brand/15 text-brand'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    } ${!dictationSupported ? 'cursor-not-allowed opacity-40' : ''} ${
                      expanded ? 'col-start-4 row-start-2' : 'col-start-5 row-start-1'
                    }`}
                  >
                    {listening ? (
                      <span className="flex h-3.5 items-center gap-[2.5px]">
                        {[0, 1, 2].map((i) => (
                          <span
                            key={i}
                            className="w-[2.5px] rounded-full bg-current"
                            style={{
                              height: '100%',
                              animation: `eq-bounce 900ms ease-in-out ${i * 150}ms infinite`,
                            }}
                          />
                        ))}
                      </span>
                    ) : (
                      <Mic size={15} strokeWidth={2} />
                    )}
                  </button>
                </TooltipTrigger>
                {!dictationSupported && (
                  <TooltipContent side="top">
                    Dictation isn&apos;t supported in this browser
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>

            {/* send / stop — tactile square (round in the pill variant) */}
            {isStreaming ? (
              <button
                type="button"
                aria-label="Stop generating"
                onClick={handleStop}
                className={`flex size-7 shrink-0 items-center justify-center bg-destructive text-destructive-foreground transition-transform active:scale-[0.94] ${
                  pill ? 'rounded-full' : 'rounded-[8px]'
                } ${expanded ? 'col-start-5 row-start-2' : 'col-start-6 row-start-1'}`}
              >
                <Square size={14} className="fill-current" />
              </button>
            ) : (
              <button
                type="button"
                aria-label="Send"
                disabled={!canSend}
                onClick={() => void handleSend()}
                className={`flex size-7 shrink-0 items-center justify-center transition-[background-color,color,transform] duration-200 enabled:active:scale-[0.94] ${
                  pill ? 'rounded-full' : 'rounded-[8px]'
                } ${expanded ? 'col-start-5 row-start-2' : 'col-start-6 row-start-1'}`}
                style={{
                  background: canSend ? 'hsl(var(--foreground))' : 'hsl(var(--surface-3))',
                  color: canSend ? 'hsl(var(--surface-1))' : 'hsl(var(--muted-foreground))',
                }}
              >
                <ArrowUp size={16} strokeWidth={2.4} />
              </button>
            )}
          </div>
        </div>
      </div>

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
  );
}
