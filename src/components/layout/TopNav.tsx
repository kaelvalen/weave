import { useState, useRef, useEffect } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { useWorkflowStore } from '@/stores/useWorkflowStore';
import { usePluginStore } from '@/stores/usePluginStore';
import {
  MessageCircle,
  Package,
  FolderOpen,
  Settings,
  FileText,
  Database,
  Cpu,
  GitBranch,
  PenTool,
  User,
  Slash,
  Pin,
  PinOff,
  ExternalLink,
  Play,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import type { View } from '@/types/app';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

const defaultNavItems: { view: View; label: string; icon: typeof MessageCircle; category: string }[] = [
  { view: 'chat', label: 'Chat', icon: MessageCircle, category: 'AI Command Center' },
  { view: 'files', label: 'Files', icon: FolderOpen, category: 'Workspace Files' },
  { view: 'notes', label: 'Notes', icon: FileText, category: 'Notes Manager' },
  { view: 'knowledge', label: 'Knowledge', icon: Database, category: 'Knowledge Base (RAG)' },
  { view: 'models', label: 'Models', icon: Cpu, category: 'Local Models' },
  { view: 'workflows', label: 'Workflows', icon: GitBranch, category: 'AI Workflows' },
  { view: 'canvas', label: 'Canvas', icon: PenTool, category: 'Infinite Canvas' },
  { view: 'plugins', label: 'Plugins', icon: Package, category: 'Plugin Ecosystem' },
];

export function TopNav() {
  const activeView = useAppStore((s) => s.activeView);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const isChatExpanded = useAppStore((s) => s.isChatExpanded);
  const toggleChat = useAppStore((s) => s.toggleChat);

  // Real-time store metrics for previews
  const workflowNodesCount = useWorkflowStore((s) => s.nodes.length);
  const pluginsCount = usePluginStore((s) => s.plugins.length);
  const loadedPluginsCount = usePluginStore((s) => s.loadedPlugins.length);

  // Pinning state persisted in localStorage
  const [pinnedViews, setPinnedViews] = useState<View[]>(() => {
    try {
      const saved = localStorage.getItem('weave_dock_pinned');
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return defaultNavItems.map((item) => item.view);
  });

  useEffect(() => {
    try {
      localStorage.setItem('weave_dock_pinned', JSON.stringify(pinnedViews));
    } catch {
      // ignore
    }
  }, [pinnedViews]);

  const [hoveredView, setHoveredView] = useState<string | null>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const chatClickTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = (id: string) => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredView(id);
    }, 120);
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredView(null);
    }, 180);
  };

  // Right-click context menu state
  const [contextMenu, setContextMenu] = useState<{
    open: boolean;
    view: View | string;
    label: string;
    x: number;
    y: number;
  }>({
    open: false,
    view: 'chat',
    label: 'Chat',
    x: 0,
    y: 0,
  });

  const handleContextMenu = (e: React.MouseEvent, view: View | string, label: string) => {
    e.preventDefault();
    setContextMenu({
      open: true,
      view,
      label,
      x: e.clientX,
      y: e.clientY,
    });
  };

  const togglePin = (view: View) => {
    setPinnedViews((prev) =>
      prev.includes(view) ? prev.filter((v) => v !== view) : [...prev, view]
    );
  };

  const handleSlashCommand = () => {
    window.dispatchEvent(new CustomEvent('open-command-palette'));
  };

  const renderPreviewContent = (id: string) => {
    switch (id) {
      case 'knowledge':
        return (
          <div className="space-y-2.5 w-64">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-primary" /> Knowledge Base
              </span>
              <span className="text-[10px] font-mono bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                RAG Active
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-tight">
              32 indexed files • 1022 vector chunks • Local search engine ready.
            </p>
            <div className="flex items-center gap-1.5 pt-1">
              <button
                onClick={() => {
                  setActiveView('knowledge');
                  setHoveredView(null);
                }}
                className="flex-1 px-2 py-1 bg-primary text-primary-foreground hover:bg-primary/90 text-[11px] font-medium rounded transition-colors flex items-center justify-center gap-1"
              >
                <span>Open</span>
                <ArrowRight className="w-3 h-3" />
              </button>
              <button
                onClick={() => {
                  setActiveView('knowledge');
                  setHoveredView(null);
                }}
                className="flex-1 px-2 py-1 bg-muted hover:bg-muted/80 text-foreground text-[11px] font-medium rounded transition-colors"
              >
                Upload
              </button>
            </div>
          </div>
        );
      case 'workflows':
        return (
          <div className="space-y-2.5 w-64">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <GitBranch className="w-3.5 h-3.5 text-primary" /> AI Workflows
              </span>
              <span className="text-[10px] font-mono bg-green-500/10 text-green-500 px-1.5 py-0.5 rounded">
                Ready
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-tight">
              Automation studio active with {workflowNodesCount} configured nodes and triggers.
            </p>
            <div className="flex items-center gap-1.5 pt-1">
              <button
                onClick={() => {
                  setActiveView('workflows');
                  setHoveredView(null);
                }}
                className="flex-1 px-2 py-1 bg-primary text-primary-foreground hover:bg-primary/90 text-[11px] font-medium rounded transition-colors flex items-center justify-center gap-1"
              >
                <span>Studio</span>
                <ArrowRight className="w-3 h-3" />
              </button>
              <button
                onClick={() => {
                  setActiveView('workflows');
                  setHoveredView(null);
                }}
                className="flex-1 px-2 py-1 bg-muted hover:bg-muted/80 text-foreground text-[11px] font-medium rounded transition-colors flex items-center justify-center gap-1"
              >
                <Play className="w-3 h-3 text-green-500" /> Execute
              </button>
            </div>
          </div>
        );
      case 'plugins':
        return (
          <div className="space-y-2.5 w-60">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Package className="w-3.5 h-3.5 text-primary" /> Plugin Ecosystem
              </span>
              <span className="text-[10px] font-mono bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                {loadedPluginsCount} / {pluginsCount} Loaded
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-tight">
              Discover capabilities, tools, and custom .wpk integrations.
            </p>
            <div className="flex items-center gap-1.5 pt-1">
              <button
                onClick={() => {
                  setActiveView('plugins');
                  setHoveredView(null);
                }}
                className="w-full px-2 py-1 bg-primary text-primary-foreground hover:bg-primary/90 text-[11px] font-medium rounded transition-colors flex items-center justify-center gap-1"
              >
                <span>Explore Marketplace</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        );
      case 'chat':
        return (
          <div className="space-y-2.5 w-60">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <MessageCircle className="w-3.5 h-3.5 text-primary" /> AI Command Center
              </span>
              <span className="text-[10px] font-mono bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                Central
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-tight">
              Full-screen intelligent workspace with live context binding.
            </p>
            <div className="flex items-center gap-1.5 pt-1">
              <button
                onClick={() => {
                  setActiveView('chat');
                  setHoveredView(null);
                }}
                className="flex-1 px-2 py-1 bg-primary text-primary-foreground hover:bg-primary/90 text-[11px] font-medium rounded transition-colors flex items-center justify-center gap-1"
              >
                <span>Full Center</span>
                <ArrowRight className="w-3 h-3" />
              </button>
              <button
                onClick={() => {
                  toggleChat(true);
                  setHoveredView(null);
                }}
                className="flex-1 px-2 py-1 bg-muted hover:bg-muted/80 text-foreground text-[11px] font-medium rounded transition-colors"
              >
                Scratchpad
              </button>
            </div>
          </div>
        );
      case 'files':
        return (
          <div className="space-y-2.5 w-56">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <FolderOpen className="w-3.5 h-3.5 text-primary" /> Workspace Files
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-tight">
              3-column IDE layout with built-in editor and AI context.
            </p>
            <div className="pt-1">
              <button
                onClick={() => {
                  setActiveView('files');
                  setHoveredView(null);
                }}
                className="w-full px-2 py-1 bg-primary text-primary-foreground hover:bg-primary/90 text-[11px] font-medium rounded transition-colors flex items-center justify-center gap-1"
              >
                <span>Open IDE Workspace</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        );
      case 'notes':
        return (
          <div className="space-y-2 w-56">
            <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-primary" /> Notes Manager
            </span>
            <p className="text-[11px] text-muted-foreground leading-tight">
              Structured markdown editor with side-by-side AI notes assistant.
            </p>
          </div>
        );
      case 'canvas':
        return (
          <div className="space-y-2 w-56">
            <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <PenTool className="w-3.5 h-3.5 text-primary" /> Infinite Canvas
            </span>
            <p className="text-[11px] text-muted-foreground leading-tight">
              Visual diagramming, architecture boards, and sticky notes.
            </p>
          </div>
        );
      case 'models':
        return (
          <div className="space-y-2 w-56">
            <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-primary" /> Local Models
            </span>
            <p className="text-[11px] text-muted-foreground leading-tight">
              Ollama & GGUF local inference runtime management.
            </p>
          </div>
        );
      case 'profile':
        return (
          <div className="space-y-1.5 w-52">
            <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-primary" /> Profile & AI Memory
            </span>
            <p className="text-[11px] text-muted-foreground leading-tight">
              Manage personal identity and AI learning signals.
            </p>
          </div>
        );
      case 'settings':
        return (
          <div className="space-y-1.5 w-48">
            <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Settings className="w-3.5 h-3.5 text-primary" /> System Settings
            </span>
            <p className="text-[11px] text-muted-foreground leading-tight">
              Preferences, API keys, and system configuration.
            </p>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <>
      <header
        className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex items-center justify-between gap-3 h-12 px-3 select-none rounded-full bg-card/90 border border-border/80 backdrop-blur-xl shadow-lg hover:shadow-xl transition-all duration-300 group/dock"
        data-tauri-drag-region
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* ── Slash Command Surface Trigger ── */}
        <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            type="button"
            onClick={handleSlashCommand}
            title="Open Command Palette (Cmd+K or /)"
            className="relative flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Slash className="w-3.5 h-3.5 font-bold" />
          </button>
        </div>

        <div className="w-px h-4 bg-border/60" />

        {/* ── Nav Links ── */}
        <nav
          className="flex items-center gap-1 relative"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {defaultNavItems.map((item) => {
            const isChatButton = item.view === 'chat';
            const isActive = isChatButton ? activeView === 'chat' || isChatExpanded : activeView === item.view;
            const isPinned = pinnedViews.includes(item.view);
            const Icon = item.icon;

            return (
              <div
                key={item.view}
                className="relative flex items-center"
                onMouseEnter={() => handleMouseEnter(item.view)}
                onMouseLeave={handleMouseLeave}
                onContextMenu={(e) => handleContextMenu(e, item.view, item.label)}
              >
                <button
                  type="button"
                  onDoubleClick={() => {
                    if (isChatButton) {
                      if (chatClickTimeoutRef.current) {
                        clearTimeout(chatClickTimeoutRef.current);
                        chatClickTimeoutRef.current = null;
                      }
                      setActiveView('chat');
                    }
                  }}
                  onClick={(e) => {
                    if (isChatButton) {
                      if (e.detail > 1) {
                        if (chatClickTimeoutRef.current) {
                          clearTimeout(chatClickTimeoutRef.current);
                          chatClickTimeoutRef.current = null;
                        }
                        setActiveView('chat');
                      } else {
                        if (chatClickTimeoutRef.current) {
                          clearTimeout(chatClickTimeoutRef.current);
                        }
                        chatClickTimeoutRef.current = setTimeout(() => {
                          chatClickTimeoutRef.current = null;
                          if (activeView !== 'chat') {
                            toggleChat();
                          }
                        }, 220);
                      }
                    } else {
                      setActiveView(item.view);
                    }
                  }}
                  className={[
                    'relative flex items-center justify-center w-8 h-8 rounded-full',
                    'transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isActive
                      ? 'bg-foreground text-background font-semibold shadow-md scale-105'
                      : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground hover:scale-105',
                    !isPinned ? 'opacity-60 hover:opacity-100' : '',
                  ].join(' ')}
                >
                  <Icon className="w-4 h-4" />
                  {isActive && (
                    <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary animate-pulse" />
                  )}
                </button>

                {/* Hover Card Popover */}
                {hoveredView === item.view && (
                  <div className="absolute top-11 left-1/2 -translate-x-1/2 z-50 p-3 bg-card/95 backdrop-blur-xl border border-border shadow-2xl rounded-xl animate-in fade-in-0 zoom-in-95 duration-150 pointer-events-auto">
                    {renderPreviewContent(item.view)}
                  </div>
                )}
              </div>
            );
          })}

          <div className="w-px h-4 bg-border/60 mx-1" />

          {/* Profile Button */}
          <div
            className="relative flex items-center"
            onMouseEnter={() => handleMouseEnter('profile')}
            onMouseLeave={handleMouseLeave}
            onContextMenu={(e) => handleContextMenu(e, 'profile', 'Profile')}
          >
            <button
              type="button"
              onClick={() => setActiveView('profile')}
              className={[
                'relative flex items-center justify-center w-8 h-8 rounded-full',
                'transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                activeView === 'profile'
                  ? 'bg-foreground text-background shadow-md scale-105'
                  : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground hover:scale-105',
              ].join(' ')}
            >
              <User className="w-4 h-4" />
            </button>
            {hoveredView === 'profile' && (
              <div className="absolute top-11 right-0 z-50 p-3 bg-card/95 backdrop-blur-xl border border-border shadow-2xl rounded-xl animate-in fade-in-0 zoom-in-95 duration-150">
                {renderPreviewContent('profile')}
              </div>
            )}
          </div>

          {/* Settings Button */}
          <div
            className="relative flex items-center"
            onMouseEnter={() => handleMouseEnter('settings')}
            onMouseLeave={handleMouseLeave}
            onContextMenu={(e) => handleContextMenu(e, 'settings', 'Settings')}
          >
            <button
              type="button"
              onClick={() => setActiveView('settings')}
              className={[
                'relative flex items-center justify-center w-8 h-8 rounded-full',
                'transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                activeView === 'settings'
                  ? 'bg-foreground text-background shadow-md scale-105'
                  : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground hover:scale-105',
              ].join(' ')}
            >
              <Settings className="w-4 h-4" />
            </button>
            {hoveredView === 'settings' && (
              <div className="absolute top-11 right-0 z-50 p-3 bg-card/95 backdrop-blur-xl border border-border shadow-2xl rounded-xl animate-in fade-in-0 zoom-in-95 duration-150">
                {renderPreviewContent('settings')}
              </div>
            )}
          </div>
        </nav>
      </header>

      {/* ── Right-Click Context Menu ── */}
      <DropdownMenu
        open={contextMenu.open}
        onOpenChange={(open) => !open && setContextMenu((prev) => ({ ...prev, open: false }))}
      >
        <DropdownMenuContent
          className="w-48 bg-card/95 backdrop-blur-xl border-border/80 shadow-2xl rounded-xl p-1"
          style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y }}
        >
          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground border-b border-border/40 mb-1 flex items-center justify-between">
            <span>{contextMenu.label}</span>
            <Sparkles className="w-3 h-3 text-primary" />
          </div>
          <DropdownMenuItem
            onClick={() => {
              if (contextMenu.view === 'chat') {
                setActiveView('chat');
              } else if (contextMenu.view !== 'profile' && contextMenu.view !== 'settings') {
                setActiveView(contextMenu.view as View);
              }
              setContextMenu((prev) => ({ ...prev, open: false }));
            }}
            className="gap-2 cursor-pointer rounded-lg text-xs"
          >
            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
            <span>Open in Workspace</span>
          </DropdownMenuItem>
          {contextMenu.view !== 'profile' && contextMenu.view !== 'settings' && (
            <>
              <DropdownMenuSeparator className="my-1 bg-border/40" />
              <DropdownMenuItem
                onClick={() => {
                  togglePin(contextMenu.view as View);
                  setContextMenu((prev) => ({ ...prev, open: false }));
                }}
                className="gap-2 cursor-pointer rounded-lg text-xs"
              >
                {pinnedViews.includes(contextMenu.view as View) ? (
                  <>
                    <PinOff className="w-3.5 h-3.5 text-amber-500" />
                    <span>Unpin from Dock</span>
                  </>
                ) : (
                  <>
                    <Pin className="w-3.5 h-3.5 text-primary" />
                    <span>Pin to Dock</span>
                  </>
                )}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
