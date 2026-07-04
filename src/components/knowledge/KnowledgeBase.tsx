import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import {
  Database,
  UploadCloud,
  FileText,
  Trash2,
  HardDrive,
  Search,
  Loader2,
  Sparkles,
  CheckCircle2,
  BookOpen,
  ArrowRight,
  X,
  FileCode,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { extractError } from '@/lib/errors';

interface KnowledgeFile {
  id: string;
  filename: string;
  size_bytes: number;
  created_at: string;
}

interface IndexProgress {
  filename: string;
  processed: number;
  total: number;
  done: boolean;
  error?: string | null;
}

interface IndexStatus {
  file_count: number;
  built_at: number;
}

interface SearchResult {
  filename: string;
  snippet: string;
  score: number;
}

export function KnowledgeBase() {
  const [files, setFiles] = useState<KnowledgeFile[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFile, setSelectedFile] = useState<KnowledgeFile | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<string | null>(null);

  // Keyword Index State
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState<IndexProgress | null>(null);

  // RAG Search State
  const [ragQuery, setRagQuery] = useState('');
  const [ragSearching, setRagSearching] = useState(false);
  const [ragResults, setRagResults] = useState<SearchResult[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchFiles = async () => {
    try {
      const res = await invoke<KnowledgeFile[]>('list_knowledge_files');
      setFiles(res);
      if (res.length > 0 && !selectedFile) {
        setSelectedFile(res[0]);
      }
    } catch (e) {
      toast.error(`Failed to load knowledge files: ${extractError(e)}`);
    }
  };

  const fetchIndexStatus = async () => {
    try {
      const res = await invoke<IndexStatus>('get_knowledge_index_status');
      setIndexStatus(res);
    } catch (e) {
      console.error('Failed to fetch keyword index status:', e);
    }
  };

  useEffect(() => {
    fetchFiles();
    fetchIndexStatus();

    const unlisten = listen<IndexProgress>('knowledge-index-progress', (event) => {
      setIndexProgress(event.payload);
      if (event.payload.done) {
        setIndexing(false);
        if (event.payload.error) {
          toast.error(`Indexing failed: ${event.payload.error}`);
        } else {
          toast.success('Knowledge base indexed successfully.');
        }
        setTimeout(() => setIndexProgress(null), 1500);
        fetchIndexStatus();
      }
    });

    return () => {
      unlisten.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleIndex = async () => {
    setIndexing(true);
    setIndexProgress({ filename: '', processed: 0, total: files.length, done: false, error: null });
    try {
      await invoke('index_knowledge_files');
    } catch (e) {
      setIndexing(false);
      setIndexProgress(null);
      toast.error(`Indexing failed: ${extractError(e)}`);
    }
  };

  const handleRagSearch = async () => {
    const q = ragQuery.trim() || searchQuery.trim();
    if (!q) {
      setRagResults([]);
      return;
    }
    setRagSearching(true);
    try {
      const results = await invoke<SearchResult[]>('search_knowledge', { query: q, limit: 12 });
      setRagResults(results);
      if (results.length === 0) {
        toast.info('No matching snippets found. Try building the keyword index first.');
      }
    } catch (e) {
      toast.error(`Search failed: ${extractError(e)}`);
    } finally {
      setRagSearching(false);
    }
  };

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
        toast.error(`Failed to upload ${file.name}: ${extractError(e)}`);
      }
    }
    fetchFiles();
    fetchIndexStatus();
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
      if (selectedFile?.filename === filename) {
        setSelectedFile(null);
      }
      fetchFiles();
      fetchIndexStatus();
    } catch (e) {
      toast.error(extractError(e));
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const filteredFiles = files.filter((f) =>
    f.filename.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full w-full bg-background pt-16">
      <div className="flex flex-col h-full max-w-7xl mx-auto w-full px-6">
        {/* ── Top Search Engine Bar ── */}
        <div className="py-4 flex-shrink-0">
          <div className="max-w-3xl mx-auto flex items-center gap-3 bg-card border border-border/80 shadow-md rounded-2xl p-2 px-4 focus-within:ring-2 focus-within:ring-primary focus-within:border-transparent transition-all">
            <Search className="w-5 h-5 text-muted-foreground shrink-0" />
            <input
              type="text"
              placeholder="Search vector chunks, documentation, or filenames..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setRagQuery(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRagSearch();
              }}
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none border-none h-8"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setRagQuery('');
                  setRagResults([]);
                }}
                className="text-muted-foreground hover:text-foreground px-1"
              >
                <X className="w-4 h-4" />
              </button>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={handleRagSearch}
              disabled={ragSearching || (!searchQuery.trim() && !ragQuery.trim())}
              className="h-8 px-4 text-xs font-medium rounded-xl shrink-0 shadow-sm"
            >
              {ragSearching ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
              <span>Search RAG</span>
            </Button>
            <div className="w-px h-5 bg-border/60 mx-1 shrink-0" />
            <Button
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="h-8 px-3 text-xs font-medium rounded-xl shrink-0 gap-1.5 shadow-sm"
            >
              <UploadCloud className="w-3.5 h-3.5" />
              <span>Upload</span>
            </Button>
            <input
              type="file"
              multiple
              className="hidden"
              ref={fileInputRef}
              onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
            />
          </div>
        </div>

        {/* ── 3-Column Workspace ── */}
        <div className="flex-1 grid grid-cols-12 gap-6 pb-6 min-h-0">
          {/* Column 1: Sources */}
          <div className="col-span-3 border border-border/80 rounded-2xl bg-card/60 backdrop-blur-md overflow-hidden flex flex-col shadow-sm">
            <div className="border-b border-border/60 px-4 py-3 bg-muted/30 flex justify-between items-center">
              <span className="font-semibold text-xs text-foreground flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-primary" /> Sources ({files.length})
              </span>
              <span className="text-[10px] font-mono bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                {formatBytes(files.reduce((acc, f) => acc + f.size_bytes, 0))}
              </span>
            </div>

            <div
              className={`flex-1 overflow-y-auto p-3 space-y-1.5 transition-colors ${isDragging ? 'bg-primary/10 border-2 border-dashed border-primary m-2 rounded-xl' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              {isDragging ? (
                <div className="flex flex-col items-center justify-center h-full text-center p-4">
                  <UploadCloud className="w-10 h-10 text-primary animate-bounce mb-2" />
                  <span className="text-sm font-bold text-primary">Drop files here</span>
                </div>
              ) : filteredFiles.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center p-4 text-muted-foreground">
                  <HardDrive className="w-8 h-8 text-muted-foreground/30 mb-2" />
                  <span className="text-xs font-medium">No sources found</span>
                  <p className="text-[10px] mt-1">Upload PDF, JSON, or TXT files to begin.</p>
                </div>
              ) : (
                filteredFiles.map((f) => {
                  const isSelected = selectedFile?.filename === f.filename;
                  return (
                    <div
                      key={f.id}
                      onClick={() => setSelectedFile(f)}
                      className={`group flex justify-between items-center p-2.5 rounded-xl cursor-pointer transition-all border ${
                        isSelected
                          ? 'bg-primary/15 text-foreground border-primary/50 shadow-sm'
                          : 'bg-background/80 hover:bg-muted/60 border-border/40 text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FileText
                          className={`w-4 h-4 shrink-0 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`}
                        />
                        <div className="min-w-0">
                          <h4 className="font-medium text-xs truncate">{f.filename}</h4>
                          <p className="text-[10px] text-muted-foreground">
                            {formatBytes(f.size_bytes)}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setFileToDelete(f.filename);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 text-red-500 hover:text-red-600 hover:bg-red-500/10 rounded transition-opacity shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Column 2: Preview / Chunks */}
          <div className="col-span-5 border border-border/80 rounded-2xl bg-card/60 backdrop-blur-md overflow-hidden flex flex-col shadow-sm">
            <div className="border-b border-border/60 px-4 py-3 bg-muted/30 flex justify-between items-center">
              <span className="font-semibold text-xs text-foreground flex items-center gap-2">
                <FileCode className="w-4 h-4 text-primary" /> Preview & Vector Chunks
              </span>
              {ragResults.length > 0 && (
                <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-mono">
                  {ragResults.length} matches
                </span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {ragResults.length > 0 ? (
                <div className="space-y-3">
                  <div className="text-xs font-semibold text-muted-foreground flex items-center justify-between pb-1 border-b border-border/40">
                    <span>Search Results for "{ragQuery || searchQuery}"</span>
                    <button
                      onClick={() => setRagResults([])}
                      className="text-[10px] text-primary hover:underline"
                    >
                      Clear search
                    </button>
                  </div>
                  {ragResults.map((r, i) => (
                    <div
                      key={i}
                      className="border border-border/60 rounded-xl p-3 bg-background/90 shadow-sm space-y-1.5 hover:border-primary/40 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5 text-primary" />
                          {r.filename}
                        </span>
                        <span className="text-[10px] bg-primary/10 text-primary font-mono px-1.5 py-0.5 rounded">
                          Score: {r.score.toFixed(2)}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed font-mono bg-muted/40 p-2 rounded-lg border border-border/30">
                        "{r.snippet}"
                      </p>
                    </div>
                  ))}
                </div>
              ) : selectedFile ? (
                <div className="space-y-4">
                  <div className="border border-border/60 rounded-xl p-4 bg-background/80 space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold text-sm text-foreground flex items-center gap-2">
                        <FileText className="w-4 h-4 text-primary" />
                        {selectedFile.filename}
                      </h3>
                      <span className="text-xs font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                        {formatBytes(selectedFile.size_bytes)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Added on {new Date(selectedFile.created_at).toLocaleString()}
                    </p>
                  </div>

                  <div className="border border-border/40 rounded-xl p-4 bg-muted/20 space-y-2 text-center">
                    <Sparkles className="w-6 h-6 text-primary mx-auto opacity-70" />
                    <h4 className="text-xs font-semibold text-foreground">Vector Index Ready</h4>
                    <p className="text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">
                      This document is integrated into Weave's local vector embedding space. Use the
                      search bar above or AI Query on the right to test semantic retrieval.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground p-6">
                  <BookOpen className="w-10 h-10 text-muted-foreground/30 mb-3" />
                  <span className="text-sm font-medium text-foreground">No Preview Active</span>
                  <p className="text-xs mt-1 max-w-xs">
                    Select a file from the Sources list or run a search query above to inspect vector
                    chunks.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Column 3: AI Query & RAG Test */}
          <div className="col-span-4 border border-border/80 rounded-2xl bg-card/60 backdrop-blur-md overflow-hidden flex flex-col shadow-sm">
            <div className="border-b border-border/60 px-4 py-3 bg-muted/30">
              <span className="font-semibold text-xs text-foreground flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" /> AI Query / RAG Test Bench
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              {/* Index Status Card */}
              <div className="border border-border/60 rounded-xl p-4 bg-background/80 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5 text-primary" /> Keyword & Vector Index
                  </span>
                  {indexStatus && indexStatus.built_at > 0 ? (
                    <span className="text-[10px] bg-green-500/10 text-green-500 font-mono px-2 py-0.5 rounded-full flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Ready
                    </span>
                  ) : (
                    <span className="text-[10px] bg-amber-500/10 text-amber-500 font-mono px-2 py-0.5 rounded-full">
                      Needs Indexing
                    </span>
                  )}
                </div>

                {indexStatus && indexStatus.built_at > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    {indexStatus.file_count} file{indexStatus.file_count !== 1 ? 's' : ''} indexed •
                    Last built: {new Date(indexStatus.built_at).toLocaleTimeString()}
                  </p>
                )}

                {indexing && indexProgress && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-muted-foreground">
                      <span className="truncate mr-2">
                        {indexProgress.filename || 'Indexing…'}
                      </span>
                      <span className="font-mono shrink-0">
                        {indexProgress.processed}/{indexProgress.total}
                      </span>
                    </div>
                    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all duration-300"
                        style={{
                          width: `${
                            indexProgress.total > 0
                              ? (indexProgress.processed / indexProgress.total) * 100
                              : 5
                          }%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                <Button
                  size="sm"
                  className="w-full gap-2 text-xs h-8 rounded-xl"
                  onClick={handleIndex}
                  disabled={indexing || files.length === 0}
                >
                  {indexing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  <span>{indexing ? 'Building Embeddings…' : 'Rebuild Index'}</span>
                </Button>
              </div>

              {/* RAG Tester Card */}
              <div className="space-y-3 pt-2 border-t border-border/40">
                <Label className="text-xs font-semibold text-foreground">
                  Test Retrieval Against Selected Source
                </Label>
                <div className="space-y-2">
                  <Input
                    placeholder="Q: What are the key concepts in this document?"
                    value={ragQuery}
                    onChange={(e) => setRagQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRagSearch();
                    }}
                    className="text-xs h-9 bg-background/80 rounded-xl border-border/80"
                  />
                  <Button
                    size="sm"
                    onClick={handleRagSearch}
                    disabled={ragSearching || !ragQuery.trim()}
                    className="w-full h-8 text-xs font-medium rounded-xl gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    {ragSearching ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ArrowRight className="w-3.5 h-3.5" />
                    )}
                    <span>Test Retrieval Pipeline</span>
                  </Button>
                </div>

                {ragResults.length > 0 && (
                  <div className="p-3 bg-muted/30 border border-border/50 rounded-xl space-y-1.5">
                    <span className="text-[11px] font-semibold text-primary">
                      AI Retrieval Summary:
                    </span>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Retrieved {ragResults.length} highly relevant chunks with peak semantic similarity
                      of {ragResults[0]?.score.toFixed(2)}. Chunks are ready for AI prompt injection.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!fileToDelete}
        onOpenChange={(open) => !open && setFileToDelete(null)}
        title="Delete file?"
        description="This file will be permanently removed from your knowledge base. This action cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (fileToDelete) handleDelete(fileToDelete);
        }}
      />
    </div>
  );
}
