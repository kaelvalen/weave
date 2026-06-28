import { useState, useEffect, useCallback } from 'react';
import { 
  FolderOpen, FileText, ChevronRight, ChevronDown, 
  Search, HardDrive, File as FileIcon, FileCode, FileImage, FileJson, Loader2, FileVideo, RefreshCw
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { usePluginStore } from '@/stores/usePluginStore';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { FileEditor } from './FileEditor';

// Helper to pick icon
function getFileIcon(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith('.ts') || lower.endsWith('.tsx') || lower.endsWith('.js') || lower.endsWith('.rs') || lower.endsWith('.css') || lower.endsWith('.html')) return FileCode;
  if (lower.endsWith('.svg') || lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.gif') || lower.endsWith('.webp') || lower.endsWith('.ico')) return FileImage;
  if (lower.endsWith('.mp4') || lower.endsWith('.webm') || lower.endsWith('.ogg') || lower.endsWith('.mov') || lower.endsWith('.avi') || lower.endsWith('.mkv')) return FileVideo;
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

function FileTreeItem({ item, depth = 0, selectedPath, onSelect, onToggle }: any) {
  const isSelected = selectedPath === item.path;
  const isFolder = item.type === 'directory';
  const Icon = isFolder ? FolderOpen : getFileIcon(item.name);

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
        <span className={`w-4 h-4 flex items-center justify-center transition-transform ${isFolder ? 'opacity-70 hover:opacity-100' : 'opacity-0'}`}>
          {isFolder && (
            item.isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
            item.isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />
          )}
        </span>
        
        <Icon className={`w-4 h-4 flex-shrink-0 ${isSelected ? 'text-foreground' : 'opacity-70'}`} />
        <span className="text-sm truncate select-none">{item.name}</span>
      </div>
      
      {isFolder && item.isOpen && item.children && (
        <div>
          {item.children.map((child: any) => (
            <FileTreeItem 
              key={child.path} 
              item={child} 
              depth={depth + 1} 
              selectedPath={selectedPath} 
              onSelect={onSelect} 
              onToggle={onToggle}
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
  const { executeCapability } = usePluginStore();

  const loadDirectory = useCallback(async (dirPath: string): Promise<FSNode[]> => {
    try {
      const res = await executeCapability('com.weave.builtin.file', 'file.list', { directory: dirPath }) as any;
      if (res && res.success) {
        return res.entries.map((e: any) => ({
          name: e.name,
          path: e.path,
          type: e.type,
          size: e.size,
          modified: e.modified,
          isOpen: false,
          children: undefined
        }));
      }
    } catch (err) {
      console.error('Failed to list dir', err);
    }
    return [];
  }, [executeCapability]);

  // Load root on mount
  useEffect(() => {
    loadDirectory(currentRoot).then(nodes => {
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
      loadDirectory(currentRoot).then(nodes => setRootNodes(nodes));
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
      const updateTree = (nodes: FSNode[]): FSNode[] => nodes.map(n => 
        n.path === node.path ? { ...n, isOpen: false } : { ...n, children: n.children ? updateTree(n.children) : undefined }
      );
      setRootNodes(prev => updateTree(prev));
      return;
    }

    // Toggle open & load if needed
    if (!node.children) {
      // Set loading
      const setLoad = (nodes: FSNode[]): FSNode[] => nodes.map(n => 
        n.path === node.path ? { ...n, isLoading: true } : { ...n, children: n.children ? setLoad(n.children) : undefined }
      );
      setRootNodes(prev => setLoad(prev));

      const children = await loadDirectory(node.path);

      const setChildren = (nodes: FSNode[]): FSNode[] => nodes.map(n => 
        n.path === node.path ? { ...n, isLoading: false, isOpen: true, children } : { ...n, children: n.children ? setChildren(n.children) : undefined }
      );
      setRootNodes(prev => setChildren(prev));
    } else {
      // Just toggle
      const setOpen = (nodes: FSNode[]): FSNode[] => nodes.map(n => 
        n.path === node.path ? { ...n, isOpen: true } : { ...n, children: n.children ? setOpen(n.children) : undefined }
      );
      setRootNodes(prev => setOpen(prev));
    }
  };

  const SelectedIcon = selectedFile ? (selectedFile.type === 'directory' ? FolderOpen : getFileIcon(selectedFile.name)) : FileIcon;

  return (
    <div className="flex h-full w-full bg-transparent pt-16">
      {/* ── Sidebar: File Tree ── */}
      <div className="w-[260px] flex-shrink-0 flex flex-col h-full border-r bg-card/50">
        <div className="h-14 px-4 flex items-center justify-between border-b flex-shrink-0 bg-muted/20">
          <div className="flex items-center gap-2 overflow-hidden mr-2">
            <HardDrive className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <h3 className="text-xs font-semibold tracking-wide truncate" title={currentRoot === '.' ? 'Local Files' : currentRoot}>
              {currentRoot === '.' ? 'Local Files' : currentRoot.split('/').pop() || currentRoot}
            </h3>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground" onClick={handleManualRefresh} title="Refresh Directory">
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground" onClick={handleOpenFolder} title="Open Folder">
              <FolderOpen className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        <div className="px-3 py-3 border-b flex-shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input 
              placeholder="Search files..." 
              className="pl-8 h-8 text-xs bg-background"
            />
          </div>
        </div>

        <ScrollArea className="flex-1 p-2 pb-32">
          {isLoading ? (
            <div className="flex items-center justify-center p-4 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading...
            </div>
          ) : rootNodes.map((item) => (
            <FileTreeItem 
              key={item.path} 
              item={item} 
              selectedPath={selectedFile?.path} 
              onSelect={setSelectedFile} 
              onToggle={handleToggle}
            />
          ))}
        </ScrollArea>
      </div>

      {/* ── Main Area: File Preview ── */}
      <div className="flex-1 flex flex-col min-w-0 bg-background/90 backdrop-blur-md relative">
        {selectedFile ? (
          <div className="flex flex-col h-full w-full">
            <div className="h-14 flex items-center border-b px-2 gap-1 flex-shrink-0 bg-card">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-background border rounded-md shadow-sm ml-2">
                <SelectedIcon className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-medium">{selectedFile.name}</span>
              </div>
            </div>
            
            <div className="flex-1 flex flex-col min-h-0 bg-transparent">
              {selectedFile.type === 'directory' ? (
                <div className="flex-1 p-8 flex flex-col items-center justify-center text-center">
                  <div className="w-20 h-20 rounded border bg-muted flex items-center justify-center mb-6">
                    <FolderOpen className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <h3 className="text-lg font-medium mb-2">{selectedFile.name}</h3>
                  <p className="text-sm text-muted-foreground max-w-sm mb-6">
                    Path: {selectedFile.path}
                  </p>
                </div>
              ) : (
                <div className="flex-1 w-full flex flex-col min-h-0 relative">
                  <FileEditor path={selectedFile.path} />
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground bg-transparent">
            <div className="w-16 h-16 rounded border bg-muted flex items-center justify-center mb-4">
              <FileIcon className="w-6 h-6 opacity-40" />
            </div>
            <p className="text-sm">Select a file from your workspace</p>
          </div>
        )}
      </div>
    </div>
  );
}
