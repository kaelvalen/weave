import { useState, useEffect, useCallback, useRef } from 'react';
import { usePluginStore } from '@/stores/usePluginStore';
import {
  FileText, Plus, Search, Loader2, Save, Trash2, Calendar,
  Star, Tag, X, Eye, Edit3, Columns, Copy, Check, Download,
  Bold, Italic, Strikethrough, Heading1, Heading2, Code, Link as LinkIcon,
  ListTodo, Table as TableIcon, Quote, MoreVertical
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

// CodeMirror imports
import CodeMirror from '@uiw/react-codemirror';
import { ViewUpdate, EditorView } from '@codemirror/view';
import { useThemeStore } from '@/stores/useThemeStore';
import { getWeaveTheme } from '@/lib/editorTheme';
import { markdown } from '@codemirror/lang-markdown';

// Markdown rendering
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';

SyntaxHighlighter.registerLanguage('tsx', tsx);
SyntaxHighlighter.registerLanguage('typescript', typescript);
SyntaxHighlighter.registerLanguage('rust', rust);
SyntaxHighlighter.registerLanguage('json', json);
SyntaxHighlighter.registerLanguage('bash', bash);
SyntaxHighlighter.registerLanguage('python', python);

interface Note {
  id: string;
  title: string;
  content: string;
  created_at: number;
  updated_at: number;
  tags: string[];
  pinned?: boolean;
}

interface CodeBlockProps extends React.HTMLAttributes<HTMLElement> {
  node?: unknown;
  inline?: boolean;
}

const MarkdownCodeBlock = ({ inline, className, children, ...props }: CodeBlockProps) => {
  const [isCopied, setIsCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || '');
  const lang = match ? match[1] : 'text';
  const isBlock = !inline || Boolean(match) || String(children).includes('\n') || Boolean(className?.includes('language-'));

  const handleCopy = () => {
    navigator.clipboard.writeText(String(children).replace(/\n$/, ''));
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  if (isBlock) {
    return (
      <div className="relative group rounded-md overflow-hidden my-4 border border-border bg-card">
        <div className="flex items-center justify-between px-4 py-1.5 bg-muted/50 border-b border-border">
          <span className="text-xs font-mono text-muted-foreground">{lang}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground transition-opacity opacity-0 group-hover:opacity-100"
            onClick={handleCopy}
            title="Copy Code"
          >
            {isCopied ? (
              <Check className="w-3.5 h-3.5 text-green-500" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </Button>
        </div>
        <SyntaxHighlighter
          {...props}
          style={vscDarkPlus}
          language={lang}
          PreTag="div"
          customStyle={{
            margin: 0,
            padding: '1rem',
            background: 'transparent',
            fontSize: '13px',
            overflowX: 'auto',
          }}
          wrapLines={true}
        >
          {String(children).replace(/\n$/, '')}
        </SyntaxHighlighter>
      </div>
    );
  }

  return (
    <code
      {...props}
      className={`${className || ''} bg-muted text-foreground px-1.5 py-0.5 rounded text-xs font-mono border border-border/50 break-all whitespace-pre-wrap`}
    >
      {children}
    </code>
  );
};

export function NotesManager() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTagFilter, setSelectedTagFilter] = useState<string | null>(null);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'edit' | 'preview' | 'split'>(() => {
    return (localStorage.getItem('weave_notes_view_mode') as 'edit' | 'preview' | 'split') || 'split';
  });
  
  const handleSetViewMode = (mode: 'edit' | 'preview' | 'split') => {
    setViewMode(mode);
    localStorage.setItem('weave_notes_view_mode', mode);
  };
  
  // Tagging state
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [newTagInput, setNewTagInput] = useState('');

  const editorViewRef = useRef<EditorView | null>(null);
  const { executeCapability } = usePluginStore();
  const { mode } = useThemeStore();

  const isSystemDark =
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false;
  const isDark = mode === 'system' ? isSystemDark : mode === 'dark';

  const loadNotes = useCallback(async () => {
    try {
      const res = (await executeCapability('com.weave.builtin.note', 'note.list', {})) as {
        success: boolean;
        notes: Note[];
      };
      if (res && res.success) {
        setNotes(res.notes);
        if (selectedNote) {
          const updated = res.notes.find((n) => n.id === selectedNote.id);
          if (updated) setSelectedNote(updated);
        }
      }
    } catch {
      toast.error('Failed to load notes');
    } finally {
      setLoading(false);
    }
  }, [executeCapability, selectedNote]);

  useEffect(() => {
    loadNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async () => {
    try {
      const res = (await executeCapability('com.weave.builtin.note', 'note.create', {
        title: 'Untitled Note',
        content: '# New Note\n\nStart typing your Markdown content here...\n',
        tags: [],
      })) as { success: boolean; note: Note };

      if (res && res.success) {
        await loadNotes();
        setSelectedNote(res.note);
        handleSetViewMode('split');
      }
    } catch {
      toast.error('Failed to create note');
    }
  };

  const handleSave = async (overrideNote?: Note) => {
    const target = overrideNote || selectedNote;
    if (!target) return;
    setSaving(true);
    try {
      const res = (await executeCapability('com.weave.builtin.note', 'note.update', {
        id: target.id,
        title: target.title,
        content: target.content,
        tags: target.tags || [],
        pinned: target.pinned || false,
      })) as { success: boolean };

      if (res && res.success) {
        toast.success('Note saved');
        await loadNotes();
      }
    } catch {
      toast.error('Failed to save note');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedNote) return;

    try {
      const res = (await executeCapability('com.weave.builtin.note', 'note.delete', {
        id: selectedNote.id,
      })) as { success: boolean };

      if (res && res.success) {
        setSelectedNote(null);
        await loadNotes();
        toast.success('Note deleted');
      }
    } catch {
      toast.error('Failed to delete note');
    }
  };

  const handleTogglePin = async (note: Note, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      const res = (await executeCapability('com.weave.builtin.note', 'note.toggle_pin', {
        id: note.id,
      })) as { success: boolean; note: Note };

      if (res && res.success) {
        await loadNotes();
        if (selectedNote?.id === note.id) {
          setSelectedNote(res.note);
        }
        toast.success(res.note.pinned ? 'Note pinned' : 'Note unpinned');
      }
    } catch {
      toast.error('Failed to toggle pin');
    }
  };

  // Ctrl/Cmd+S to save
  useEffect(() => {
    if (!selectedNote) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNote]);

  const allTags = Array.from(new Set(notes.flatMap((n) => n.tags || []))).sort();

  const filteredNotes = notes.filter((n) => {
    const matchesSearch =
      n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      n.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      n.tags?.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesTag = !selectedTagFilter || n.tags?.includes(selectedTagFilter);
    return matchesSearch && matchesTag;
  });

  const handleEditorUpdate = useCallback((vu: ViewUpdate) => {
    editorViewRef.current = vu.view;
    if (vu.selectionSet || vu.docChanged) {
      const state = vu.state;
      const pos = state.selection.main.head;
      const line = state.doc.lineAt(pos);
      setCursor({ line: line.number, col: pos - line.from + 1 });
    }
  }, []);

  const insertFormat = (before: string, after = '') => {
    const view = editorViewRef.current;
    if (view) {
      const selection = view.state.selection.main;
      const selectedText = view.state.sliceDoc(selection.from, selection.to);
      const replacement = `${before}${selectedText || 'text'}${after}`;
      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert: replacement },
        selection: {
          anchor: selection.from + before.length,
          head: selection.from + before.length + (selectedText || 'text').length,
        },
      });
      view.focus();
    } else if (selectedNote) {
      setSelectedNote({
        ...selectedNote,
        content: selectedNote.content + `\n${before}text${after}`,
      });
    }
  };

  const handleAddTag = async () => {
    if (!selectedNote || !newTagInput.trim()) return;
    const tag = newTagInput.trim().toLowerCase();
    if (selectedNote.tags?.includes(tag)) {
      setNewTagInput('');
      setIsAddingTag(false);
      return;
    }
    const updatedTags = [...(selectedNote.tags || []), tag];
    const updatedNote = { ...selectedNote, tags: updatedTags };
    setSelectedNote(updatedNote);
    setNewTagInput('');
    setIsAddingTag(false);
    await handleSave(updatedNote);
  };

  const handleRemoveTag = async (tagToRemove: string) => {
    if (!selectedNote) return;
    const updatedTags = (selectedNote.tags || []).filter((t) => t !== tagToRemove);
    const updatedNote = { ...selectedNote, tags: updatedTags };
    setSelectedNote(updatedNote);
    await handleSave(updatedNote);
  };

  const handleExport = (type: 'md' | 'html' | 'copy') => {
    if (!selectedNote) return;
    if (type === 'copy') {
      navigator.clipboard.writeText(selectedNote.content);
      toast.success('Copied Markdown to clipboard');
      return;
    }

    let content = selectedNote.content;
    let filename = `${selectedNote.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.md`;
    let mime = 'text/markdown';

    if (type === 'html') {
      filename = `${selectedNote.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.html`;
      mime = 'text/html';
      content = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${selectedNote.title}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #333; }
  pre { background: #f4f4f4; padding: 16px; border-radius: 8px; overflow-x: auto; font-family: monospace; }
  code { background: #f4f4f4; padding: 2px 6px; border-radius: 4px; font-family: monospace; }
  table { border-collapse: collapse; width: 100%; margin: 20px 0; }
  th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
  th { background: #f8f9fa; }
  blockquote { border-left: 4px solid #007bff; margin: 0; padding-left: 16px; color: #555; font-style: italic; }
</style>
</head>
<body>
<h1>${selectedNote.title}</h1>
<hr />
<!-- Note rendered from Markdown -->
<pre>${selectedNote.content}</pre>
</body>
</html>`;
    }

    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported as .${type}`);
  };

  const wordCount = selectedNote?.content
    ? selectedNote.content.trim().split(/\s+/).filter(Boolean).length
    : 0;
  const readingTime = Math.max(1, Math.ceil(wordCount / 200));

  return (
    <div className="flex h-full w-full bg-transparent pt-16">
      {/* ── Sidebar ── */}
      <div className="w-[280px] flex-shrink-0 flex flex-col h-full border-r bg-card/50">
        <div className="h-14 px-4 flex items-center justify-between border-b flex-shrink-0 bg-muted/20">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            <h3 className="text-xs font-bold tracking-wide uppercase">Notes Workspace</h3>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="w-7 h-7 text-muted-foreground hover:text-foreground"
            onClick={handleCreate}
            title="Create Note"
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>

        <div className="px-3 py-3 border-b flex-shrink-0 space-y-2.5">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Search notes or tags..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 text-xs bg-background"
            />
          </div>

          {allTags.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
              <Badge
                variant={selectedTagFilter === null ? 'default' : 'outline'}
                className="cursor-pointer text-[10px] px-2 py-0 h-5 flex-shrink-0"
                onClick={() => setSelectedTagFilter(null)}
              >
                All
              </Badge>
              {allTags.map((tag) => (
                <Badge
                  key={tag}
                  variant={selectedTagFilter === tag ? 'default' : 'outline'}
                  className="cursor-pointer text-[10px] px-2 py-0 h-5 flex-shrink-0 gap-1"
                  onClick={() =>
                    setSelectedTagFilter(selectedTagFilter === tag ? null : tag)
                  }
                >
                  <Tag className="w-2.5 h-2.5" />
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>

        <ScrollArea className="flex-1 p-2 pb-32">
          {loading ? (
            <div className="flex items-center justify-center p-8 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              <span className="text-xs">Loading notes...</span>
            </div>
          ) : filteredNotes.length === 0 ? (
            <div className="text-center p-8 text-xs text-muted-foreground space-y-2">
              <p>No notes found.</p>
              <Button size="sm" variant="outline" onClick={handleCreate} className="h-7 text-xs">
                <Plus className="w-3 h-3 mr-1" /> New Note
              </Button>
            </div>
          ) : (
            <div className="space-y-1.5">
              {filteredNotes.map((note) => (
                <div
                  key={note.id}
                  onClick={() => setSelectedNote(note)}
                  className={`group p-3 rounded-lg cursor-pointer transition-all border relative ${
                    selectedNote?.id === note.id
                      ? 'bg-muted/80 border-primary/40 shadow-sm'
                      : 'bg-transparent border-transparent hover:bg-muted/40 hover:border-border/50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <h4 className="text-xs font-semibold truncate flex-1 text-foreground">
                      {note.title || 'Untitled'}
                    </h4>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={`h-5 w-5 rounded-full p-0 flex-shrink-0 transition-opacity ${
                        note.pinned ? 'text-amber-500 opacity-100' : 'text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-amber-500'
                      }`}
                      onClick={(e) => handleTogglePin(note, e)}
                      title={note.pinned ? 'Unpin note' : 'Pin note'}
                    >
                      <Star className={`w-3.5 h-3.5 ${note.pinned ? 'fill-amber-500' : ''}`} />
                    </Button>
                  </div>

                  <p className="text-[11px] text-muted-foreground line-clamp-2 opacity-80 mb-2 leading-relaxed font-sans">
                    {note.content.replace(/^#+\s+/gm, '').trim() || 'Empty note...'}
                  </p>

                  <div className="flex items-center justify-between mt-2 pt-1 border-t border-border/30 text-[10px] text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Calendar className="w-2.5 h-2.5" />
                      {new Date(note.updated_at * 1000).toLocaleDateString([], {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </div>
                    {note.tags && note.tags.length > 0 && (
                      <div className="flex items-center gap-1 overflow-hidden max-w-[120px]">
                        <Tag className="w-2.5 h-2.5 flex-shrink-0 text-primary/70" />
                        <span className="truncate text-[9px] opacity-80">
                          {note.tags.join(', ')}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* ── Main Area ── */}
      <div className="flex-1 flex flex-col min-w-0 bg-background/95 backdrop-blur-md relative">
        {selectedNote ? (
          <div className="flex flex-col h-full">
            {/* Top Header */}
            <div className="h-14 flex items-center justify-between border-b px-6 flex-shrink-0 bg-card/80 gap-4">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => handleTogglePin(selectedNote, e)}
                  className={`h-8 w-8 flex-shrink-0 ${selectedNote.pinned ? 'text-amber-500' : 'text-muted-foreground hover:text-amber-500'}`}
                  title={selectedNote.pinned ? 'Unpin Note' : 'Pin Note'}
                >
                  <Star className={`w-4 h-4 ${selectedNote.pinned ? 'fill-amber-500' : ''}`} />
                </Button>
                <input
                  value={selectedNote.title}
                  onChange={(e) => setSelectedNote({ ...selectedNote, title: e.target.value })}
                  className="bg-transparent border-none outline-none font-bold text-base md:text-lg w-full text-foreground placeholder:text-muted-foreground truncate"
                  placeholder="Note Title..."
                />
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {/* View Mode Switcher */}
                <div className="flex items-center bg-muted/60 p-0.5 rounded-md border border-border/50 mr-2">
                  <Button
                    variant={viewMode === 'edit' ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => handleSetViewMode('edit')}
                    className="h-7 px-2.5 text-xs gap-1 shadow-none"
                    title="Edit Markdown"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Edit</span>
                  </Button>
                  <Button
                    variant={viewMode === 'split' ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => handleSetViewMode('split')}
                    className="h-7 px-2.5 text-xs gap-1 shadow-none"
                    title="Split View"
                  >
                    <Columns className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Split</span>
                  </Button>
                  <Button
                    variant={viewMode === 'preview' ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => handleSetViewMode('preview')}
                    className="h-7 px-2.5 text-xs gap-1 shadow-none"
                    title="Preview Rendered Markdown"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Preview</span>
                  </Button>
                </div>

                {/* Save Button */}
                <Button
                  size="sm"
                  onClick={() => handleSave()}
                  disabled={saving}
                  className="gap-1.5 h-8 text-xs shadow-sm px-3"
                >
                  {saving ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  Save
                </Button>

                {/* More Actions Menu */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" className="h-8 w-8">
                      <MoreVertical className="w-4 h-4 text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48 text-xs">
                    <DropdownMenuItem onClick={() => handleExport('copy')} className="gap-2">
                      <Copy className="w-3.5 h-3.5 text-muted-foreground" /> Copy Markdown
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleExport('md')} className="gap-2">
                      <Download className="w-3.5 h-3.5 text-muted-foreground" /> Export as .md
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleExport('html')} className="gap-2">
                      <Download className="w-3.5 h-3.5 text-muted-foreground" /> Export as .html
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setConfirmDeleteOpen(true)}
                      className="gap-2 text-destructive focus:text-destructive"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete Note
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Sub-header: Tags & Formatting Toolbar */}
            <div className="min-h-[40px] px-6 py-1.5 border-b bg-muted/20 flex flex-wrap items-center justify-between gap-3 flex-shrink-0 select-none">
              {/* Tags Section */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <Tag className="w-3.5 h-3.5 text-muted-foreground mr-1" />
                {selectedNote.tags?.map((tag) => (
                  <Badge
                    key={tag}
                    variant="secondary"
                    className="text-[10px] h-5 px-2 gap-1 bg-secondary/80 hover:bg-secondary"
                  >
                    {tag}
                    <X
                      className="w-2.5 h-2.5 cursor-pointer hover:text-destructive transition-colors ml-0.5"
                      onClick={() => handleRemoveTag(tag)}
                    />
                  </Badge>
                ))}
                {isAddingTag ? (
                  <div className="flex items-center gap-1">
                    <Input
                      value={newTagInput}
                      onChange={(e) => setNewTagInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
                      placeholder="Tag name..."
                      className="h-6 w-24 text-[10px] px-2 py-0"
                      autoFocus
                    />
                    <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={handleAddTag}>
                      Add
                    </Button>
                    <X
                      className="w-3.5 h-3.5 cursor-pointer text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setIsAddingTag(false);
                        setNewTagInput('');
                      }}
                    />
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 px-2 text-[10px] text-muted-foreground hover:text-foreground gap-1 border border-dashed border-border rounded-full"
                    onClick={() => setIsAddingTag(true)}
                  >
                    <Plus className="w-2.5 h-2.5" /> Tag
                  </Button>
                )}
              </div>

              {/* Formatting Toolbar (only enabled in edit/split view) */}
              {(viewMode === 'edit' || viewMode === 'split') && (
                <div className="flex items-center gap-0.5 bg-background border border-border/60 rounded-md px-1 py-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={() => insertFormat('**', '**')}
                    title="Bold (**)"
                  >
                    <Bold className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={() => insertFormat('*', '*')}
                    title="Italic (*)"
                  >
                    <Italic className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={() => insertFormat('~~', '~~')}
                    title="Strikethrough (~~)"
                  >
                    <Strikethrough className="w-3.5 h-3.5" />
                  </Button>
                  <div className="w-[1px] h-4 bg-border/60 mx-0.5" />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={() => insertFormat('# ')}
                    title="Heading 1 (#)"
                  >
                    <Heading1 className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={() => insertFormat('## ')}
                    title="Heading 2 (##)"
                  >
                    <Heading2 className="w-3.5 h-3.5" />
                  </Button>
                  <div className="w-[1px] h-4 bg-border/60 mx-0.5" />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={() => insertFormat('`', '`')}
                    title="Inline Code (`)"
                  >
                    <Code className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={() => insertFormat('```text\n', '\n```')}
                    title="Code Block (```)"
                  >
                    <span className="font-mono text-[10px] font-bold">```</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={() => insertFormat('[', '](https://)')}
                    title="Link ([]())"
                  >
                    <LinkIcon className="w-3.5 h-3.5" />
                  </Button>
                  <div className="w-[1px] h-4 bg-border/60 mx-0.5" />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={() => insertFormat('- [ ] ')}
                    title="Task Checklist (- [ ])"
                  >
                    <ListTodo className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={() => insertFormat('> ')}
                    title="Blockquote (>)"
                  >
                    <Quote className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={() => insertFormat('\n| Column 1 | Column 2 |\n| :--- | :--- |\n| Value 1 | Value 2 |\n')}
                    title="Insert Table"
                  >
                    <TableIcon className="w-3.5 h-3.5" />
                  </Button>
                </div>
              )}
            </div>

            {/* Editor & Preview Workspace */}
            <div className="flex-1 w-full relative overflow-hidden bg-transparent flex">
              {/* CodeMirror Editor Panel */}
              {(viewMode === 'edit' || viewMode === 'split') && (
                <div className={`h-full relative overflow-hidden ${viewMode === 'split' ? 'w-1/2 border-r border-border/50' : 'w-full'}`}>
                  <CodeMirror
                    value={selectedNote.content}
                    height="100%"
                    theme={getWeaveTheme(isDark)}
                    extensions={[markdown(), EditorView.lineWrapping]}
                    onChange={(val) => setSelectedNote({ ...selectedNote, content: val })}
                    onUpdate={handleEditorUpdate}
                    className="h-full w-full absolute inset-0 [&>.cm-editor]:h-full [&>.cm-editor]:outline-none [&_.cm-scroller]:font-sans [&_.cm-content]:pb-32 [&_.cm-line]:leading-relaxed"
                    basicSetup={{
                      lineNumbers: viewMode === 'edit',
                      highlightActiveLineGutter: viewMode === 'edit',
                      highlightSpecialChars: true,
                      history: true,
                      foldGutter: false,
                      drawSelection: true,
                      dropCursor: true,
                      allowMultipleSelections: true,
                      indentOnInput: true,
                      syntaxHighlighting: true,
                      bracketMatching: true,
                      closeBrackets: true,
                      autocompletion: true,
                      rectangularSelection: true,
                      crosshairCursor: true,
                      highlightActiveLine: false,
                      highlightSelectionMatches: true,
                      closeBracketsKeymap: true,
                      defaultKeymap: true,
                      searchKeymap: true,
                      historyKeymap: true,
                      foldKeymap: true,
                      completionKeymap: true,
                      lintKeymap: true,
                    }}
                  />
                </div>
              )}

              {/* Rendered Markdown Preview Panel */}
              {(viewMode === 'preview' || viewMode === 'split') && (
                <div className={`h-full relative overflow-hidden bg-background/50 ${viewMode === 'split' ? 'w-1/2' : 'w-full'}`}>
                  <ScrollArea className="h-full w-full p-6 md:p-8 pb-32">
                    <div className="max-w-3xl mx-auto text-sm leading-relaxed text-foreground space-y-4">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkMath]}
                        rehypePlugins={[rehypeKatex]}
                        components={{
                          h1: ({ children }) => <h1 className="text-2xl font-bold border-b border-border pb-2 mb-4 mt-6 text-foreground tracking-tight first:mt-0">{children}</h1>,
                          h2: ({ children }) => <h2 className="text-xl font-semibold border-b border-border/60 pb-1.5 mb-3 mt-5 text-foreground">{children}</h2>,
                          h3: ({ children }) => <h3 className="text-lg font-semibold mb-2 mt-4 text-foreground">{children}</h3>,
                          h4: ({ children }) => <h4 className="text-base font-semibold mb-2 mt-3 text-foreground">{children}</h4>,
                          p: ({ children }) => <p className="text-sm leading-relaxed text-foreground/90 mb-3">{children}</p>,
                          ul: ({ children }) => <ul className="list-disc list-inside space-y-1 my-3 text-sm text-foreground/90 pl-2">{children}</ul>,
                          ol: ({ children }) => <ol className="list-decimal list-inside space-y-1 my-3 text-sm text-foreground/90 pl-2">{children}</ol>,
                          li: ({ children }) => <li className="leading-normal">{children}</li>,
                          blockquote: ({ children }) => <blockquote className="border-l-4 border-primary/60 pl-4 py-1.5 my-3 bg-muted/40 italic text-muted-foreground rounded-r">{children}</blockquote>,
                          table: ({ children }) => <div className="overflow-x-auto my-4 rounded-lg border border-border"><table className="w-full border-collapse text-sm">{children}</table></div>,
                          thead: ({ children }) => <thead className="bg-muted/70 text-left">{children}</thead>,
                          th: ({ children }) => <th className="border-b border-border px-3 py-2 font-semibold text-foreground">{children}</th>,
                          td: ({ children }) => <td className="border-b border-border/50 px-3 py-2 text-foreground/80">{children}</td>,
                          a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline hover:text-primary/80 font-medium">{children}</a>,
                          hr: () => <hr className="my-6 border-border" />,
                          strong: ({ children }) => <strong className="font-bold text-foreground">{children}</strong>,
                          em: ({ children }) => <em className="italic text-foreground/90">{children}</em>,
                          del: ({ children }) => <del className="line-through text-muted-foreground">{children}</del>,
                          img: ({ src, alt }) => <img src={src} alt={alt} className="rounded-lg max-w-full h-auto my-3 border border-border shadow-sm" />,
                          input: ({ type, checked, ...props }) => {
                            if (type === 'checkbox') {
                              return <input type="checkbox" checked={checked} readOnly className="mr-2 rounded border-border text-primary focus:ring-primary h-3.5 w-3.5 accent-primary cursor-default inline-block align-middle" {...props} />;
                            }
                            return <input type={type} {...props} />;
                          },
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          code: MarkdownCodeBlock as any,
                        }}
                      >
                        {selectedNote.content || '*Empty note...*'}
                      </ReactMarkdown>
                    </div>
                  </ScrollArea>
                </div>
              )}
            </div>

            {/* ── Status Bar ── */}
            <div className="h-7 border-t bg-card/90 backdrop-blur text-[10px] text-muted-foreground flex items-center justify-between px-4 flex-shrink-0 select-none z-10 font-mono tracking-tight">
              <div className="flex items-center gap-4">
                {(viewMode === 'edit' || viewMode === 'split') && (
                  <>
                    <span className="flex items-center gap-1 hover:text-foreground transition-colors">
                      Ln {cursor.line}, Col {cursor.col}
                    </span>
                    <span className="opacity-40">|</span>
                  </>
                )}
                <span className="flex items-center gap-1 hover:text-foreground transition-colors" title="Word Count">
                  {wordCount} {wordCount === 1 ? 'word' : 'words'}
                </span>
                <span className="opacity-40">|</span>
                <span className="flex items-center gap-1 hover:text-foreground transition-colors" title="Estimated Reading Time">
                  ~{readingTime} min read
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-amber-500/90 font-semibold uppercase tracking-wider">
                  {viewMode === 'split' ? 'SPLIT MODE' : viewMode === 'preview' ? 'PREVIEW MODE' : 'EDIT MODE'}
                </span>
                <span className="opacity-40">|</span>
                <span className="hover:text-foreground transition-colors uppercase tracking-wider font-semibold">
                  GFM MARKDOWN
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground bg-transparent p-8">
            <div className="w-16 h-16 rounded-xl border border-border bg-card shadow-sm flex items-center justify-center mb-4">
              <FileText className="w-8 h-8 text-primary/60" />
            </div>
            <h3 className="text-base font-semibold text-foreground mb-1">No Note Selected</h3>
            <p className="text-xs text-muted-foreground max-w-sm text-center mb-6">
              Select a note from the sidebar to view or edit, or create a new note to start capturing ideas.
            </p>
            <Button onClick={handleCreate} size="sm" className="gap-2 text-xs h-8">
              <Plus className="w-3.5 h-3.5" /> Create New Note
            </Button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title="Delete note?"
        description="This note will be permanently removed from your disk. This action cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
      />
    </div>
  );
}
