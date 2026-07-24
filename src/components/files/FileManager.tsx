import { useState, useEffect, useCallback, useMemo, createElement } from 'react';
import {
  FolderOpen,
  FileText,
  ChevronRight,
  ChevronDown,
  Search,
  HardDrive,
  File as FileIcon,
  FileCode,
  FileImage,
  FileJson,
  Loader2,
  FileVideo,
  RefreshCw,
  Sparkles,
  GitBranch,
  X,
  Terminal,
  Files as FilesIcon,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { GitPanel } from './GitPanel';
import { WorkspaceSearch } from './WorkspaceSearch';
import { IdeBottomDrawer } from './IdeBottomDrawer';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { usePluginStore } from '@/stores/usePluginStore';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { FileEditor } from './FileEditor';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { toast } from 'sonner';
import { extractError } from '@/lib/errors';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { useChatStore } from '@/stores/useChatStore';
import { useAppStore } from '@/stores/useAppStore';

// Helper to pick icon
function getFileIcon(name: string) {
  const lower = name.toLowerCase();
  if (
    lower.endsWith('.ts') ||
    lower.endsWith('.tsx') ||
    lower.endsWith('.js') ||
    lower.endsWith('.rs') ||
    lower.endsWith('.css') ||
    lower.endsWith('.html')
  )
    return FileCode;
  if (
    lower.endsWith('.svg') ||
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.gif') ||
    lower.endsWith('.webp') ||
    lower.endsWith('.ico')
  )
    return FileImage;
  if (
    lower.endsWith('.mp4') ||
    lower.endsWith('.webm') ||
    lower.endsWith('.ogg') ||
    lower.endsWith('.mov') ||
    lower.endsWith('.avi') ||
    lower.endsWith('.mkv')
  )
    return FileVideo;
  if (lower.endsWith('.json')) return FileJson;
  return FileText;
}

// Tree node interface
interface FSNode {
  name: string;
  path: string;
  type: 'directory' | 'file' | 'symlink' | 'unknown';
  size?: number;
  modified?: number;
  children?: FSNode[];
  isOpen?: boolean;
  isLoading?: boolean;
}

function FileTreeItem({
  item,
  depth = 0,
  selectedPath,
  onSelect,
  onToggle,
  query,
}: {
  item: FSNode;
  depth?: number;
  selectedPath?: string;
  onSelect: (item: FSNode) => void;
  onToggle: (item: FSNode) => void;
  query: string;
}) {
  const isSelected = selectedPath === item.path;
  const isFolder = item.type === 'directory';

  const visibleChildren = useMemo(() => {
    if (!query.trim()) return item.children;
    const q = query.toLowerCase();
    return item.children?.filter((child) => child.name.toLowerCase().includes(q));
  }, [item.children, query]);

  return (
    <div>
      <div
        onClick={() => {
          if (isFolder) onToggle(item);
          onSelect(item);
        }}
        className={`group flex items-center gap-2 py-1 px-2 rounded cursor-pointer transition-colors ${
          isSelected
            ? 'bg-muted text-foreground font-medium'
            : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        <span
          className={`w-4 h-4 flex items-center justify-center transition-transform ${isFolder ? 'opacity-70 hover:opacity-100' : 'opacity-0'}`}
        >
          {isFolder &&
            (item.isLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : item.isOpen ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            ))}
        </span>

        {isFolder ? (
          <FolderOpen
            className={`w-4 h-4 flex-shrink-0 ${isSelected ? 'text-foreground' : 'opacity-70'}`}
          />
        ) : (
          createElement(getFileIcon(item.name), {
            className: `w-4 h-4 flex-shrink-0 ${isSelected ? 'text-foreground' : 'opacity-70'}`,
          })
        )}
        <span className="text-sm truncate select-none">{item.name}</span>
      </div>

      {isFolder && item.isOpen && visibleChildren && visibleChildren.length > 0 && (
        <div>
          {visibleChildren.map((child) => (
            <FileTreeItem
              key={child.path}
              item={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
              onToggle={onToggle}
              query={query}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileManager() {
  const [rootNodes, setRootNodes] = useState<FSNode[]>([]);
  const [currentRoot, setCurrentRoot] = useState<string>(() => {
    return localStorage.getItem('weave_file_manager_root') || '.';
  });
  const [selectedFile, setSelectedFile] = useState<FSNode | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [editorDirty, setEditorDirty] = useState(false);
  const [pendingSelect, setPendingSelect] = useState<FSNode | null>(null);
  const [confirmSwitchOpen, setConfirmSwitchOpen] = useState(false);

  // IDE Architecture State
  const [sidebarTab, setSidebarTab] = useState<'explorer' | 'git' | 'search'>('explorer');
  const [openedTabs, setOpenedTabs] = useState<FSNode[]>([]);
  const [bottomDrawerOpen, setBottomDrawerOpen] = useState(false);
  const [bottomTab, setBottomTab] = useState<'terminal' | 'output' | 'diagnostics'>('terminal');
  const [aiDiagnostics, setAiDiagnostics] = useState<string | null>(null);

  // AI Agent & Right Sidebar state (Docked Antigravity style)
  const isChatExpanded = useAppStore((s) => s.isChatExpanded);
  const toggleChat = useAppStore((s) => s.toggleChat);
  const [aiLoading, setAiLoading] = useState(false);

  const { executeCapability } = usePluginStore();

  const loadDirectory = useCallback(
    async (dirPath: string): Promise<FSNode[]> => {
      try {
        const res = (await executeCapability('com.weave.builtin.file', 'file.list', {
          directory: dirPath,
        })) as
          | {
              success: true;
              entries: Array<{
                name: string;
                path: string;
                type: FSNode['type'];
                size?: number;
                modified?: number;
              }>;
            }
          | undefined;
        if (res?.success) {
          return res.entries.map((e) => ({
            name: e.name,
            path: e.path,
            type: e.type,
            size: e.size,
            modified: e.modified,
            isOpen: false,
            children: undefined,
          }));
        }
      } catch (err) {
        console.error('Failed to list dir', err);
      }
      return [];
    },
    [executeCapability]
  );

  // Load root on mount
  useEffect(() => {
    loadDirectory(currentRoot).then((nodes) => {
      setRootNodes(nodes);
      setIsLoading(false);
    });
  }, [loadDirectory, currentRoot]);

  // Synchronize backend agent's working directory with UI
  useEffect(() => {
    if (currentRoot) {
      invoke('system_set_cwd', { path: currentRoot }).catch(console.error);
    }
  }, [currentRoot]);

  // Listen for auto-refresh events (e.g. from Coder Plugin)
  useEffect(() => {
    const handleRefresh = () => {
      loadDirectory(currentRoot).then((nodes) => setRootNodes(nodes));
    };
    window.addEventListener('weave-fs-refresh', handleRefresh);
    return () => window.removeEventListener('weave-fs-refresh', handleRefresh);
  }, [currentRoot, loadDirectory]);

  // Listen for live AI code modification events to auto-switch to file editor and open tab
  useEffect(() => {
    const handleFileModified = (e: Event) => {
      const customEvent = e as CustomEvent<{ path: string; capability: string }>;
      if (customEvent.detail && customEvent.detail.path) {
        const filePath = customEvent.detail.path;
        const fileName = filePath.split(/[/\\]/).pop() || filePath;
        const node: FSNode = { name: fileName, path: filePath, type: 'file' };
        const appStore = useAppStore.getState();
        appStore.setActiveView('files');
        if (!appStore.isChatExpanded) {
          appStore.toggleChat(true);
        }
        setSelectedFile(node);
        setOpenedTabs((prev) => {
          if (prev.some((t) => t.path === filePath)) return prev;
          return [...prev, node];
        });
      }
    };
    window.addEventListener('weave:file-modified', handleFileModified);
    return () => window.removeEventListener('weave:file-modified', handleFileModified);
  }, []);

  // Consume one-shot reveal requests (e.g. "Open in Files" from Artifacts).
  // Selects the file and opens an editor tab; deep tree expansion is skipped
  // because directories load lazily — same trade-off as the handler above.
  const pendingFileReveal = useAppStore((s) => s.pendingFileReveal);
  const setPendingFileReveal = useAppStore((s) => s.setPendingFileReveal);
  useEffect(() => {
    if (!pendingFileReveal) return;
    setPendingFileReveal(null);
    const fileName = pendingFileReveal.split(/[/\\]/).pop() || pendingFileReveal;
    const node: FSNode = { name: fileName, path: pendingFileReveal, type: 'file' };
    setSelectedFile(node);
    setOpenedTabs((prev) => {
      if (prev.some((t) => t.path === node.path)) return prev;
      return [...prev, node];
    });
  }, [pendingFileReveal, setPendingFileReveal]);

  const handleManualRefresh = async () => {
    setIsLoading(true);
    const nodes = await loadDirectory(currentRoot);
    setRootNodes(nodes);
    setIsLoading(false);
  };

  const handleOpenFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected && typeof selected === 'string') {
        setIsLoading(true);
        setCurrentRoot(selected);
        localStorage.setItem('weave_file_manager_root', selected);
      }
    } catch (err) {
      console.error('Failed to open folder dialog:', err);
    }
  };

  // Handle nested toggle
  const handleToggle = async (node: FSNode) => {
    if (node.type !== 'directory') return;

    // Toggle close
    if (node.isOpen) {
      const updateTree = (nodes: FSNode[]): FSNode[] =>
        nodes.map((n) =>
          n.path === node.path
            ? { ...n, isOpen: false }
            : { ...n, children: n.children ? updateTree(n.children) : undefined }
        );
      setRootNodes((prev) => updateTree(prev));
      return;
    }

    // Toggle open & load if needed
    if (!node.children) {
      // Set loading
      const setLoad = (nodes: FSNode[]): FSNode[] =>
        nodes.map((n) =>
          n.path === node.path
            ? { ...n, isLoading: true }
            : { ...n, children: n.children ? setLoad(n.children) : undefined }
        );
      setRootNodes((prev) => setLoad(prev));

      const children = await loadDirectory(node.path);

      const setChildren = (nodes: FSNode[]): FSNode[] =>
        nodes.map((n) =>
          n.path === node.path
            ? { ...n, isLoading: false, isOpen: true, children }
            : { ...n, children: n.children ? setChildren(n.children) : undefined }
        );
      setRootNodes((prev) => setChildren(prev));
    } else {
      // Just toggle
      const setOpen = (nodes: FSNode[]): FSNode[] =>
        nodes.map((n) =>
          n.path === node.path
            ? { ...n, isOpen: true }
            : { ...n, children: n.children ? setOpen(n.children) : undefined }
        );
      setRootNodes((prev) => setOpen(prev));
    }
  };

  const filteredRootNodes = useMemo(() => {
    if (!searchQuery.trim()) return rootNodes;
    const q = searchQuery.toLowerCase();
    return rootNodes.filter((node) => node.name.toLowerCase().includes(q));
  }, [rootNodes, searchQuery]);

  const handleSelect = (item: FSNode) => {
    if (item.type === 'directory') return;
    if (editorDirty && selectedFile && item.path !== selectedFile.path) {
      setPendingSelect(item);
      setConfirmSwitchOpen(true);
      return;
    }
    setSelectedFile(item);
    setOpenedTabs((prev) => {
      if (prev.some((t) => t.path === item.path)) return prev;
      return [...prev, item];
    });
  };

  const handleCloseTab = (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    setOpenedTabs((prev) => {
      const filtered = prev.filter((t) => t.path !== path);
      if (selectedFile?.path === path) {
        setSelectedFile(filtered.length > 0 ? filtered[filtered.length - 1] : null);
      }
      return filtered;
    });
  };

  const handleSelectFromAux = (filePath: string, fileName: string) => {
    const node: FSNode = { name: fileName, path: filePath, type: 'file' };
    handleSelect(node);
  };

  const handleAiCodeAction = async (actionType: 'explain' | 'bugs' | 'refactor') => {
    if (!selectedFile || selectedFile.type === 'directory') {
      toast.error('Please select a code file first.');
      return;
    }
    setAiLoading(true);
    try {
      let prompt = '';
      if (actionType === 'explain')
        prompt = `Explain the architecture, purpose, and key logic of the file at path "${selectedFile.path}" concisely in bullet points.`;
      else if (actionType === 'bugs')
        prompt = `Analyze the code in "${selectedFile.path}" for potential bugs, security vulnerabilities, edge cases, or performance bottlenecks.`;
      else if (actionType === 'refactor')
        prompt = `Suggest clean refactorings, TypeScript/Rust best practices, or generate boilerplate unit tests for "${selectedFile.path}".`;

      if (!isChatExpanded) toggleChat(true);
      await useChatStore.getState().sendMessage(prompt);
      if (actionType === 'bugs') {
        setAiDiagnostics(
          'Bug & security analysis sent to Weave Agent. Check the right sidebar for detailed findings.'
        );
        setBottomDrawerOpen(true);
        setBottomTab('diagnostics');
      }
      toast.success('Sent code analysis request to Weave Agent');
    } catch (e) {
      toast.error(`AI analysis failed: ${extractError(e)}`);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="flex h-full w-full bg-transparent pt-16 select-none">
      {/* ── IDE Activity Bar ── */}
      <div className="w-12 border-r border-border/80 bg-card/80 backdrop-blur-md flex flex-col items-center py-3 gap-3 shrink-0 z-10">
        <button
          type="button"
          onClick={() => setSidebarTab('explorer')}
          className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all ${
            sidebarTab === 'explorer'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
          }`}
          title="File Explorer"
        >
          <FilesIcon className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => setSidebarTab('git')}
          className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all ${
            sidebarTab === 'git'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
          }`}
          title="Source Control (Git)"
        >
          <GitBranch className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => setSidebarTab('search')}
          className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all ${
            sidebarTab === 'search'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
          }`}
          title="Workspace Search"
        >
          <Search className="w-4 h-4" />
        </button>
      </div>

      {/* ── Column 1: Active Sidebar Tab Content ── */}
      <div className="w-[260px] flex-shrink-0 flex flex-col h-full border-r border-border/80 bg-card/50 backdrop-blur-md">
        {sidebarTab === 'explorer' && (
          <div className="flex flex-col h-full">
            <div className="h-14 px-4 flex items-center justify-between border-b border-border/60 flex-shrink-0 bg-muted/20">
              <div className="flex items-center gap-2 overflow-hidden mr-2">
                <HardDrive className="w-4 h-4 text-primary flex-shrink-0" />
                <h3
                  className="text-xs font-bold tracking-wide truncate uppercase text-foreground"
                  title={currentRoot === '.' ? 'Local Files' : currentRoot}
                >
                  {currentRoot === '.'
                    ? 'Workspace Tree'
                    : currentRoot.split('/').pop() || currentRoot}
                </h3>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-7 h-7 text-muted-foreground hover:text-foreground"
                  onClick={handleManualRefresh}
                  title="Refresh Directory"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-7 h-7 text-muted-foreground hover:text-foreground"
                  onClick={handleOpenFolder}
                  title="Open Folder"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            <div className="px-3 py-3 border-b border-border/60 flex-shrink-0">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search files..."
                  className="pl-8 h-8 text-xs bg-background"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            <ScrollArea className="flex-1 p-2 pb-32">
              {isLoading ? (
                <div className="flex items-center justify-center p-4 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading...
                </div>
              ) : filteredRootNodes.length === 0 ? (
                <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                  {searchQuery.trim()
                    ? 'No files match your search.'
                    : 'No files in this directory.'}
                </div>
              ) : (
                filteredRootNodes.map((item) => (
                  <FileTreeItem
                    key={item.path}
                    item={item}
                    selectedPath={selectedFile?.path}
                    onSelect={handleSelect}
                    onToggle={handleToggle}
                    query={searchQuery}
                  />
                ))
              )}
            </ScrollArea>
          </div>
        )}

        {sidebarTab === 'git' && (
          <GitPanel currentRoot={currentRoot} onSelectFile={handleSelectFromAux} />
        )}

        {sidebarTab === 'search' && (
          <WorkspaceSearch currentRoot={currentRoot} onSelectFile={handleSelectFromAux} />
        )}
      </div>

      {/* ── Main Area (Columns 2 & 3) ── */}
      <div className="flex-1 flex h-full min-w-0">
        {/* ── Column 2: File Editor / Code View ── */}
        <div className="flex-1 flex flex-col min-w-0 bg-background/90 backdrop-blur-md relative">
          {/* Tabbed Editor Header Bar */}
          {openedTabs.length > 0 && (
            <div className="h-9 border-b border-border/60 bg-muted/30 flex items-center overflow-x-auto shrink-0 px-1 gap-1">
              {openedTabs.map((tab) => {
                const isSelected = selectedFile?.path === tab.path;
                return (
                  <div
                    key={tab.path}
                    onClick={() => handleSelect(tab)}
                    className={`h-7 px-3 rounded-lg flex items-center gap-2 text-xs font-mono cursor-pointer transition-all shrink-0 border ${
                      isSelected
                        ? 'bg-background text-foreground border-border/80 shadow-sm font-semibold'
                        : 'bg-transparent text-muted-foreground border-transparent hover:bg-muted/50 hover:text-foreground'
                    }`}
                  >
                    {createElement(getFileIcon(tab.name), {
                      className: `w-3.5 h-3.5 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`,
                    })}
                    <span className="truncate max-w-[140px]">{tab.name}</span>
                    {isSelected && editorDirty && (
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"
                        title="Unsaved changes"
                      />
                    )}
                    <button
                      type="button"
                      onClick={(e) => handleCloseTab(e, tab.path)}
                      className="w-4 h-4 rounded hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground ml-1"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {selectedFile ? (
            <div className="flex flex-col flex-1 min-h-0 w-full">
              <div className="h-12 flex items-center justify-between border-b border-border/60 px-4 gap-2 flex-shrink-0 bg-card/80">
                <div className="flex items-center gap-2 px-3 py-1 bg-background border border-border/60 rounded-xl shadow-sm">
                  {selectedFile.type === 'directory' ? (
                    <FolderOpen className="w-3.5 h-3.5 text-primary" />
                  ) : (
                    createElement(getFileIcon(selectedFile.name), {
                      className: 'w-3.5 h-3.5 text-primary',
                    })
                  )}
                  <span className="text-xs font-bold text-foreground">{selectedFile.name}</span>
                  {editorDirty && (
                    <span className="text-[10px] text-amber-500 font-mono font-bold">(Dirty)</span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant={isChatExpanded ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => toggleChat(!isChatExpanded)}
                    className={`h-7 px-3 text-xs gap-1.5 rounded-xl border ${isChatExpanded ? 'border-primary/50 text-primary bg-primary/10' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                    title="Toggle Weave Agent Sidebar (Ctrl+J)"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-primary animate-pulse" />
                    <span className="hidden sm:inline font-bold">Weave Agent</span>
                  </Button>
                </div>
              </div>

              <div className="flex-1 flex flex-col min-h-0 bg-transparent">
                {selectedFile.type === 'directory' ? (
                  <div className="flex-1 p-8 flex flex-col items-center justify-center text-center">
                    <div className="w-20 h-20 rounded-2xl border border-border bg-muted flex items-center justify-center mb-6 shadow-sm">
                      <FolderOpen className="w-8 h-8 text-primary" />
                    </div>
                    <h3 className="text-lg font-bold mb-1 text-foreground">{selectedFile.name}</h3>
                    <p className="text-xs text-muted-foreground font-mono max-w-sm mb-6 bg-muted/50 p-2 rounded border border-border/40">
                      Path: {selectedFile.path}
                    </p>
                  </div>
                ) : (
                  <div className="flex-1 w-full flex flex-col min-h-0 relative">
                    <FileEditor path={selectedFile.path} onDirtyChange={setEditorDirty} />
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground bg-transparent p-8">
              <div className="w-16 h-16 rounded-2xl border border-border bg-card shadow-sm flex items-center justify-center mb-4">
                <FileIcon className="w-8 h-8 text-primary/60" />
              </div>
              <h3 className="text-base font-bold text-foreground mb-1">No File Selected</h3>
              <p className="text-xs text-muted-foreground max-w-sm text-center">
                Select a file from the workspace tree on the left to inspect, edit, or analyze with
                AI.
              </p>
            </div>
          )}

          {/* Integrated Bottom Terminal Drawer */}
          {bottomDrawerOpen ? (
            <IdeBottomDrawer
              currentRoot={currentRoot}
              onClose={() => setBottomDrawerOpen(false)}
              activeTab={bottomTab}
              onTabChange={setBottomTab}
              aiDiagnostics={aiDiagnostics}
              onRunDiagnostics={() => handleAiCodeAction('bugs')}
              isRunningDiagnostics={aiLoading}
            />
          ) : (
            <div className="h-7 border-t border-border/60 bg-card/80 px-3 flex items-center justify-between text-[11px] font-mono text-muted-foreground shrink-0 select-none">
              <div className="flex items-center gap-3">
                <span className="truncate max-w-xs" title={currentRoot}>
                  Root: {currentRoot}
                </span>
                {editorDirty && (
                  <span className="text-amber-500 font-bold flex items-center gap-1">
                    • Unsaved Changes
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setBottomDrawerOpen(true)}
                className="flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-muted/60 text-foreground transition-colors"
                title="Open Terminal Console"
              >
                <Terminal className="w-3.5 h-3.5 text-primary" />
                <span className="font-sans font-semibold">Open Terminal</span>
              </button>
            </div>
          )}
        </div>

        {/* ── Column 3: AI Agent Right Sidebar (Docked Antigravity style) ── */}
        {isChatExpanded && (
          <div className="w-[360px] sm:w-[400px] lg:w-[440px] border-l border-border/80 bg-card/95 backdrop-blur-xl flex flex-col h-full shrink-0 shadow-2xl z-10 animate-in slide-in-from-right duration-200">
            <ChatPanel
              isDocked={true}
              isAgentVariant={true}
              selectedFile={selectedFile}
              onCodeAction={handleAiCodeAction}
            />
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmSwitchOpen}
        onOpenChange={setConfirmSwitchOpen}
        title="Discard unsaved changes?"
        description="The current file has unsaved edits. Switching files will discard those changes."
        confirmLabel="Discard & switch"
        destructive
        onConfirm={() => {
          if (pendingSelect) setSelectedFile(pendingSelect);
          setPendingSelect(null);
        }}
      />
    </div>
  );
}
