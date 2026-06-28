import { useState, useEffect, useRef } from 'react';
import { Database, UploadCloud, FileText, Trash2, Search, HardDrive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';

interface KnowledgeFile {
  id: string;
  filename: string;
  size_bytes: number;
  created_at: number;
}

export function KnowledgeBase() {
  const [files, setFiles] = useState<KnowledgeFile[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchFiles = async () => {
    try {
      const data = await invoke<KnowledgeFile[]>('list_knowledge_files');
      setFiles(data);
    } catch (e) {
      toast.error(String(e));
    }
  };

  useEffect(() => {
    fetchFiles();
  }, []);

  const handleFileUpload = async (uploadFiles: FileList | File[]) => {
    for (let i = 0; i < uploadFiles.length; i++) {
      const file = uploadFiles[i];
      try {
        const buffer = await file.arrayBuffer();
        await invoke('upload_knowledge_file', {
          filename: file.name,
          content: Array.from(new Uint8Array(buffer)),
        });
        toast.success(`${file.name} uploaded to Knowledge Base.`);
      } catch (e) {
        toast.error(`Failed to upload ${file.name}: ${e}`);
      }
    }
    fetchFiles();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files);
    }
  };

  const handleDelete = async (filename: string) => {
    try {
      await invoke('delete_knowledge_file', { filename });
      toast.success('File deleted.');
      fetchFiles();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const filteredFiles = files.filter(f => f.filename.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="flex flex-col h-full w-full bg-background pt-16">
      <div className="flex flex-col h-full max-w-6xl mx-auto w-full px-6">
        
        {/* Header */}
        <div className="flex items-center justify-between py-8 flex-shrink-0">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <Database className="w-6 h-6 text-primary" />
              Knowledge Base (RAG)
            </h2>
            <p className="text-sm text-muted-foreground mt-1">Upload files to form the AI's permanent memory.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input 
                placeholder="Search files..." 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-64 pl-9"
              />
            </div>
            <Button className="gap-2" onClick={() => fileInputRef.current?.click()}>
              <UploadCloud className="w-4 h-4" /> Upload Files
            </Button>
            <input 
              type="file" 
              multiple 
              className="hidden" 
              ref={fileInputRef} 
              onChange={e => e.target.files && handleFileUpload(e.target.files)} 
            />
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 grid grid-cols-3 gap-6 mb-12 min-h-0">
          
          {/* Main List */}
          <div className="col-span-2 border rounded-xl bg-card overflow-hidden flex flex-col">
            <div className="border-b px-6 py-4 bg-muted/20 flex justify-between items-center">
              <h3 className="font-semibold">Your Documents</h3>
              <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full">{filteredFiles.length} Files</span>
            </div>
            
            <div 
              className={`flex-1 overflow-y-auto p-4 space-y-2 transition-colors ${isDragging ? 'bg-primary/5' : ''}`}
              onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              
              {isDragging && (
                <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-10 flex items-center justify-center border-2 border-dashed border-primary m-4 rounded-xl">
                  <div className="text-center flex flex-col items-center">
                    <UploadCloud className="w-12 h-12 text-primary animate-bounce mb-4" />
                    <h3 className="text-xl font-bold text-primary">Drop files to upload</h3>
                  </div>
                </div>
              )}

              {filteredFiles.length === 0 && !isDragging ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <HardDrive className="w-12 h-12 text-muted-foreground/30 mb-4" />
                  <h4 className="text-lg font-medium">No files found</h4>
                  <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                    Drag and drop PDF, TXT, or Markdown files here to add them to your knowledge base.
                  </p>
                </div>
              ) : (
                filteredFiles.map(f => (
                  <div key={f.id} className="flex justify-between items-center p-4 border rounded-lg hover:bg-muted/30 transition-colors bg-background">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded bg-secondary flex items-center justify-center flex-shrink-0">
                        <FileText className="w-5 h-5 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <h4 className="font-medium text-sm truncate max-w-sm">{f.filename}</h4>
                        <p className="text-xs text-muted-foreground">{formatBytes(f.size_bytes)} • {new Date(f.created_at).toLocaleDateString()}</p>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-600 hover:bg-red-500/10 flex-shrink-0" onClick={() => handleDelete(f.filename)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Stats Panel */}
          <div className="border rounded-xl bg-card overflow-hidden flex flex-col">
            <div className="border-b px-6 py-4 bg-muted/20">
              <h3 className="font-semibold">Storage</h3>
            </div>
            <div className="p-6 space-y-6">
              
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-muted-foreground font-medium">Used Space</span>
                  <span className="font-mono text-xs">
                    {formatBytes(files.reduce((acc, f) => acc + f.size_bytes, 0))}
                  </span>
                </div>
                <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-primary/80 transition-all"
                    style={{ width: `${Math.min(100, (files.reduce((acc, f) => acc + f.size_bytes, 0) / 100000000) * 100)}%` }}
                  ></div>
                </div>
              </div>

              <div className="pt-6 border-t">
                <h4 className="text-sm font-semibold mb-2">Vector Database</h4>
                <p className="text-xs text-muted-foreground">
                  Embedding models will process your files and index them into a local vector database for instant AI retrieval.
                </p>
                <div className="mt-4 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/20 p-3 rounded-lg text-xs font-medium text-center">
                  Indexing is paused.
                </div>
              </div>

            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
