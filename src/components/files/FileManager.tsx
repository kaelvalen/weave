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
  Bug,
  Code2,
  Copy,
  Check,
  X,
  HelpCircle,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { usePluginStore } from '@/stores/usePluginStore';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { FileEditor } from './FileEditor';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { toast } from 'sonner';
import { extractError } from '@/lib/errors';

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
  
  // AI Context & Git Status panel state
  const [aiPanelOpen, setAiPanelOpen] = useState(true);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [isCopiedPath, setIsCopiedPath] = useState(false);

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
    if (editorDirty && selectedFile && item.path !== selectedFile.path) {
      setPendingSelect(item);
      setConfirmSwitchOpen(true);
      return;
    }
    setSelectedFile(item);
  };

  const handleAiCodeAction = async (actionType: 'explain' | 'bugs' | 'refactor') => {
    if (!selectedFile || selectedFile.type === 'directory') {
      toast.error('Please select a code file first.');
      return;
    }
    setAiLoading(true);
    setAiResponse(null);
    try {
      let prompt = '';
      if (actionType === 'explain') prompt = `Explain the architecture, purpose, and key logic of the file at path "${selectedFile.path}" concisely in bullet points.`;
      else if (actionType === 'bugs') prompt = `Analyze the code in "${selectedFile.path}" for potential bugs, security vulnerabilities, edge cases, or performance bottlenecks.`;
      else if (actionType === 'refactor') prompt = `Suggest clean refactorings, TypeScript/Rust best practices, or generate boilerplate unit tests for "${selectedFile.path}".`;

      const res = await executeCapability('com.weave.builtin.chat', 'chat.send', {
        message: prompt,
        model: 'gpt-4o-mini',
      }) as string | { content?: string; response?: string };

      const reply = typeof res === 'string' ? res : (res?.content || res?.response || JSON.stringify(res));
      setAiResponse(reply);
    } catch (e) {
      toast.error(`AI analysis failed: ${extractError(e)}`);
      setAiResponse('Could not complete AI code analysis. Please check your AI provider.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleCustomAiCodeQuery = async () => {
    if (!selectedFile || !aiPrompt.trim()) return;
    setAiLoading(true);
    setAiResponse(null);
    try {
      const prompt = `Regarding the file "${selectedFile.path}":\n\nUser Question: ${aiPrompt}`;
      const res = await executeCapability('com.weave.builtin.chat', 'chat.send', {
        message: prompt,
        model: 'gpt-4o-mini',
      }) as string | { content?: string; response?: string };

      const reply = typeof res === 'string' ? res : (res?.content || res?.response || JSON.stringify(res));
      setAiResponse(reply);
      setAiPrompt('');
    } catch (e) {
      toast.error(`AI query failed: ${extractError(e)}`);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="flex h-full w-full bg-transparent pt-16">
      {/* ── Column 1: File Tree Sidebar ── */}
      <div className="w-[260px] flex-shrink-0 flex flex-col h-full border-r border-border/80 bg-card/50 backdrop-blur-md">
        <div className="h-14 px-4 flex items-center justify-between border-b border-border/60 flex-shrink-0 bg-muted/20">
          <div className="flex items-center gap-2 overflow-hidden mr-2">
            <HardDrive className="w-4 h-4 text-primary flex-shrink-0" />
            <h3
              className="text-xs font-bold tracking-wide truncate uppercase text-foreground"
              title={currentRoot === '.' ? 'Local Files' : currentRoot}
            >
              {currentRoot === '.' ? 'Workspace Tree' : currentRoot.split('/').pop() || currentRoot}
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
              {searchQuery.trim() ? 'No files match your search.' : 'No files in this directory.'}
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

      {/* ── Main Area (Columns 2 & 3) ── */}
      <div className="flex-1 flex h-full min-w-0">
        {/* ── Column 2: File Editor / Code View ── */}
        <div className="flex-1 flex flex-col min-w-0 bg-background/90 backdrop-blur-md relative">
          {selectedFile ? (
            <div className="flex flex-col h-full w-full">
              <div className="h-14 flex items-center justify-between border-b border-border/60 px-4 gap-2 flex-shrink-0 bg-card/80">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-background border border-border/60 rounded-xl shadow-sm">
                  {selectedFile.type === 'directory' ? (
                    <FolderOpen className="w-3.5 h-3.5 text-primary" />
                  ) : (
                    createElement(getFileIcon(selectedFile.name), {
                      className: 'w-3.5 h-3.5 text-primary',
                    })
                  )}
                  <span className="text-xs font-bold text-foreground">{selectedFile.name}</span>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant={aiPanelOpen ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => setAiPanelOpen(!aiPanelOpen)}
                    className={`h-8 px-3 text-xs gap-1.5 rounded-xl border ${aiPanelOpen ? 'border-primary/50 text-primary bg-primary/10' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                    title="Toggle AI Context & Git Panel"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">AI Context & Git</span>
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
                Select a file from the workspace tree on the left to inspect, edit, or analyze with AI.
              </p>
            </div>
          )}
        </div>

        {/* ── Column 3: AI Context & Git Status Panel ── */}
        {aiPanelOpen && (
          <div className="w-[280px] border-l border-border/80 bg-card/40 backdrop-blur-md flex flex-col h-full shrink-0 shadow-lg z-10 animate-in slide-in-from-right duration-200">
            <div className="h-14 px-4 flex items-center justify-between border-b border-border/60 bg-muted/20">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                <h3 className="text-xs font-bold tracking-wide uppercase text-foreground">AI Context & Git</h3>
              </div>
              <Button variant="ghost" size="icon" className="w-6 h-6" onClick={() => setAiPanelOpen(false)}>
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              {/* Git Status / Workspace Info */}
              <div className="border border-border/60 rounded-xl p-3 bg-background/80 space-y-2.5 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <GitBranch className="w-3.5 h-3.5 text-primary" /> Workspace Status
                  </span>
                  <span className="text-[10px] font-mono bg-green-500/10 text-green-500 px-2 py-0.5 rounded-full">
                    Clean / Active
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground space-y-1 font-mono">
                  <p className="truncate" title={currentRoot}>Root: {currentRoot}</p>
                  <p className="truncate">Active: {selectedFile?.name || 'None'}</p>
                </div>
                {selectedFile && (
                  <div className="flex items-center gap-1.5 pt-1 border-t border-border/40">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[10px] flex-1 gap-1 rounded-lg"
                      onClick={() => {
                        navigator.clipboard.writeText(selectedFile.path);
                        setIsCopiedPath(true);
                        setTimeout(() => setIsCopiedPath(false), 2000);
                        toast.success('Copied file path to clipboard');
                      }}
                    >
                      {isCopiedPath ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                      <span>Copy Path</span>
                    </Button>
                  </div>
                )}
              </div>

              {/* AI Code Intelligence */}
              <div className="space-y-2">
                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Code Intelligence</span>
                <div className="grid grid-cols-1 gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleAiCodeAction('explain')}
                    disabled={aiLoading || !selectedFile || selectedFile.type === 'directory'}
                    className="justify-start text-xs h-8 gap-2 bg-background/80 hover:bg-primary/10 hover:text-primary hover:border-primary/40 transition-all rounded-xl"
                  >
                    <HelpCircle className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                    <span>Explain Code Logic</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleAiCodeAction('bugs')}
                    disabled={aiLoading || !selectedFile || selectedFile.type === 'directory'}
                    className="justify-start text-xs h-8 gap-2 bg-background/80 hover:bg-primary/10 hover:text-primary hover:border-primary/40 transition-all rounded-xl"
                  >
                    <Bug className="w-3.5 h-3.5 text-red-500 shrink-0" />
                    <span>Find Bugs & Security</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleAiCodeAction('refactor')}
                    disabled={aiLoading || !selectedFile || selectedFile.type === 'directory'}
                    className="justify-start text-xs h-8 gap-2 bg-background/80 hover:bg-primary/10 hover:text-primary hover:border-primary/40 transition-all rounded-xl"
                  >
                    <Code2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                    <span>Suggest Refactor / Tests</span>
                  </Button>
                </div>
              </div>

              {/* Custom AI Query */}
              <div className="space-y-2 pt-2 border-t border-border/40">
                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Ask AI About File</span>
                <div className="space-y-2">
                  <Input
                    placeholder="Ask anything about this code..."
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCustomAiCodeQuery()}
                    className="text-xs h-8 bg-background/80 border-border/80 rounded-xl"
                  />
                  <Button
                    size="sm"
                    onClick={handleCustomAiCodeQuery}
                    disabled={aiLoading || !aiPrompt.trim() || !selectedFile}
                    className="w-full h-8 text-xs font-medium gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl shadow-sm"
                  >
                    {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    <span>Analyze with AI</span>
                  </Button>
                </div>
              </div>

              {/* AI Output Box */}
              {(aiResponse || aiLoading) && (
                <div className="p-3 bg-muted/40 border border-border/60 rounded-xl space-y-2 animate-in fade-in-0 shadow-inner">
                  <span className="text-[11px] font-bold text-primary flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> AI Output:
                  </span>
                  {aiLoading ? (
                    <div className="flex items-center justify-center py-4 text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      <span className="text-xs font-mono">Analyzing codebase...</span>
                    </div>
                  ) : (
                    <div className="text-xs text-foreground/90 leading-relaxed font-sans bg-background/80 p-2.5 rounded-lg border border-border/30 max-h-60 overflow-y-auto whitespace-pre-wrap font-mono">
                      {aiResponse}
                    </div>
                  )}
                </div>
              )}
            </div>
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
