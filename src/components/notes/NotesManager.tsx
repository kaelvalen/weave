import { useState, useEffect, useCallback } from 'react';
import { usePluginStore } from '@/stores/usePluginStore';
import { 
  FileText, Plus, Search, Loader2, Save, Trash2, Calendar 
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

// CodeMirror imports
import CodeMirror from '@uiw/react-codemirror';
import { ViewUpdate } from '@codemirror/view';
import { useThemeStore } from '@/stores/useThemeStore';
import { getWeaveTheme } from '@/lib/editorTheme';
import { markdown } from '@codemirror/lang-markdown';

interface Note {
  id: string;
  title: string;
  content: string;
  created_at: number;
  updated_at: number;
  tags: string[];
}

export function NotesManager() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  
  const { executeCapability } = usePluginStore();
  const { mode } = useThemeStore();

  const isSystemDark = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)').matches : false;
  const isDark = mode === 'system' ? isSystemDark : mode === 'dark';

  const loadNotes = useCallback(async () => {
    try {
      const res = await executeCapability('com.weave.builtin.note', 'note.list', {}) as any;
      if (res && res.success) {
        setNotes(res.notes);
      }
    } catch (err) {
      toast.error('Failed to load notes');
    } finally {
      setLoading(false);
    }
  }, [executeCapability]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  const handleCreate = async () => {
    try {
      const res = await executeCapability('com.weave.builtin.note', 'note.create', { 
        title: 'Untitled Note',
        content: ''
      }) as any;
      
      if (res && res.success) {
        await loadNotes();
        setSelectedNote(res.note);
      }
    } catch (err) {
      toast.error('Failed to create note');
    }
  };

  const handleSave = async () => {
    if (!selectedNote) return;
    setSaving(true);
    try {
      const res = await executeCapability('com.weave.builtin.note', 'note.update', {
        id: selectedNote.id,
        title: selectedNote.title,
        content: selectedNote.content
      }) as any;
      
      if (res && res.success) {
        toast.success('Note saved');
        await loadNotes();
      }
    } catch (err) {
      toast.error('Failed to save note');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedNote) return;
    if (!confirm('Are you sure you want to delete this note?')) return;
    
    try {
      const res = await executeCapability('com.weave.builtin.note', 'note.delete', {
        id: selectedNote.id
      }) as any;
      
      if (res && res.success) {
        setSelectedNote(null);
        await loadNotes();
        toast.success('Note deleted');
      }
    } catch (err) {
      toast.error('Failed to delete note');
    }
  };

  const filteredNotes = notes.filter(n => 
    n.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
    n.content.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleEditorUpdate = useCallback((vu: ViewUpdate) => {
    if (vu.selectionSet || vu.docChanged) {
      const state = vu.state;
      const pos = state.selection.main.head;
      const line = state.doc.lineAt(pos);
      setCursor({ line: line.number, col: pos - line.from + 1 });
    }
  }, []);

  const wordCount = selectedNote?.content ? selectedNote.content.trim().split(/\s+/).filter(Boolean).length : 0;

  return (
    <div className="flex h-full w-full bg-transparent pt-16">
      {/* ── Sidebar ── */}
      <div className="w-[280px] flex-shrink-0 flex flex-col h-full border-r bg-card/50">
        <div className="h-14 px-4 flex items-center justify-between border-b flex-shrink-0 bg-muted/20">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-xs font-semibold tracking-wide uppercase">Notes</h3>
          </div>
          <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground" onClick={handleCreate}>
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>

        <div className="px-3 py-3 border-b flex-shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input 
              placeholder="Search notes..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 text-xs bg-background"
            />
          </div>
        </div>

        <ScrollArea className="flex-1 p-2 pb-32">
          {loading ? (
            <div className="flex items-center justify-center p-4 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            </div>
          ) : filteredNotes.length === 0 ? (
            <div className="text-center p-4 text-xs text-muted-foreground">No notes found.</div>
          ) : (
            <div className="space-y-1">
              {filteredNotes.map((note) => (
                <div
                  key={note.id}
                  onClick={() => setSelectedNote(note)}
                  className={`p-3 rounded-md cursor-pointer transition-colors border ${
                    selectedNote?.id === note.id 
                      ? 'bg-muted border-border' 
                      : 'bg-transparent border-transparent hover:bg-muted/50'
                  }`}
                >
                  <h4 className="text-sm font-medium truncate mb-1">{note.title}</h4>
                  <p className="text-xs text-muted-foreground truncate opacity-70">
                    {note.content || 'Empty note...'}
                  </p>
                  <div className="flex items-center gap-1 mt-2 text-[10px] text-muted-foreground">
                    <Calendar className="w-3 h-3" />
                    {new Date(note.updated_at * 1000).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* ── Main Area ── */}
      <div className="flex-1 flex flex-col min-w-0 bg-background/90 backdrop-blur-md relative">
        {selectedNote ? (
          <div className="flex flex-col h-full">
            <div className="h-14 flex items-center justify-between border-b px-6 flex-shrink-0 bg-card">
              <input
                value={selectedNote.title}
                onChange={(e) => setSelectedNote({ ...selectedNote, title: e.target.value })}
                className="bg-transparent border-none outline-none font-semibold text-lg w-full max-w-md"
                placeholder="Note Title"
              />
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={handleDelete} className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 px-2">
                  <Trash2 className="w-4 h-4" />
                </Button>
                <Button size="sm" onClick={handleSave} disabled={saving} className="gap-2 h-8 text-xs">
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Save
                </Button>
              </div>
            </div>
            
            <div className="flex-1 w-full relative overflow-hidden bg-transparent">
              <CodeMirror
                value={selectedNote.content}
                height="100%"
                theme={getWeaveTheme(isDark)}
                extensions={[markdown()]}
                onChange={(val) => setSelectedNote({ ...selectedNote, content: val })}
                onUpdate={handleEditorUpdate}
                className="h-full w-full absolute inset-0 [&>.cm-editor]:h-full [&>.cm-editor]:outline-none [&_.cm-scroller]:font-sans [&_.cm-content]:pb-32"
                basicSetup={{
                  lineNumbers: false,
                  highlightActiveLineGutter: false,
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
            
            {/* ── Status Bar ── */}
            <div className="h-7 border-t bg-card/90 backdrop-blur text-[10px] text-muted-foreground flex items-center justify-between px-3 flex-shrink-0 select-none z-10 font-mono tracking-tight">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1.5 hover:text-foreground transition-colors cursor-pointer" title="Cursor Position">
                  Ln {cursor.line}, Col {cursor.col}
                </span>
                <span className="opacity-40">|</span>
                <span className="flex items-center gap-1.5 hover:text-foreground transition-colors cursor-pointer" title="Word Count">
                  {wordCount} words
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span className="hover:text-foreground transition-colors cursor-pointer uppercase tracking-wider font-semibold" title="Language Mode">
                  MARKDOWN
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground bg-transparent">
            <div className="w-16 h-16 rounded border bg-muted flex items-center justify-center mb-4">
              <FileText className="w-6 h-6 opacity-40" />
            </div>
            <p className="text-sm">Select a note or create a new one</p>
          </div>
        )}
      </div>
    </div>
  );
}
