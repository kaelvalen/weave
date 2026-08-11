import { useState, useEffect, useCallback, useRef } from 'react';
import { usePluginStore } from '@/stores/usePluginStore';
import { Save, Loader2, AlertCircle, FileCode2, Sparkles, FileDiff, Code } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { FileDiffViewer } from './FileDiffViewer';
import { convertFileSrc } from '@tauri-apps/api/core';
import { readFile } from '@tauri-apps/plugin-fs';

// CodeMirror imports
import CodeMirror from '@uiw/react-codemirror';
import { ViewUpdate } from '@codemirror/view';
import { useThemeStore } from '@/stores/useThemeStore';
import { getWeaveTheme } from '@/lib/editorTheme';
import { cursorReadout } from '@/lib/cursorReadout';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { sql } from '@codemirror/lang-sql';

interface FileEditorProps {
  path: string;
  onDirtyChange?: (dirty: boolean) => void;
}

const getLanguageExtension = (path: string) => {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
      return javascript({ typescript: true });
    case 'js':
    case 'jsx':
      return javascript();
    case 'json':
      return json();
    case 'css':
      return css();
    case 'html':
      return html();
    case 'md':
      return markdown();
    case 'rs':
      return rust();
    case 'py':
      return python();
    case 'sql':
      return sql();
    default:
      return null;
  }
};

const getLanguageName = (path: string): string => {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'json':
      return 'json';
    case 'css':
      return 'css';
    case 'html':
      return 'html';
    case 'md':
      return 'markdown';
    case 'rs':
      return 'rust';
    case 'py':
      return 'python';
    case 'sql':
      return 'sql';
    default:
      return 'plaintext';
  }
};

export function FileEditor({ path, onDirtyChange }: FileEditorProps) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [liveUpdated, setLiveUpdated] = useState(false);
  const [prevContent, setPrevContent] = useState('');
  const [isDiffMode, setIsDiffMode] = useState(false);
  const { executeCapability } = usePluginStore();
  const { mode } = useThemeStore();
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [viewport, setViewport] = useState({ from: 1, to: 1 });
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;

  const isSystemDark =
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false;
  const isDark = mode === 'system' ? isSystemDark : mode === 'dark';

  // Notify parent whenever dirty state changes so it can prompt before switching files.
  useEffect(() => {
    onDirtyChangeRef.current?.(isDirty);
  }, [isDirty]);

  const languageExt = getLanguageExtension(path);
  const languageName = getLanguageName(path);
  const filename = path.split(/[/\\]/).pop() || path;
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext);
  const isVideo = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'].includes(ext);
  const isMedia = isImage || isVideo;

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    setIsDirty(false);

    if (isMedia) {
      readFile(path)
        .then((bytes) => {
          if (!mounted) return;
          let mimeType = isImage ? `image/${ext}` : `video/${ext}`;
          if (ext === 'svg') mimeType = 'image/svg+xml';
          else if (ext === 'jpg') mimeType = 'image/jpeg';

          const blob = new Blob([bytes], { type: mimeType });
          setMediaUrl(URL.createObjectURL(blob));
          setLoading(false);
        })
        .catch((err) => {
          if (!mounted) return;
          console.error('Failed to read media:', err);
          // Fallback to convertFileSrc
          setMediaUrl(convertFileSrc(path));
          setLoading(false);
        });
      return;
    }

    executeCapability('com.weave.builtin.file', 'file.read', { path })
      .then((res) => {
        if (!mounted) return;
        const result = res as { success: boolean; content: string };
        if (result && result.success) {
          setContent(result.content);
          setPrevContent(result.content);
        } else {
          setError('Failed to read file content.');
        }
      })
      .catch((err) => {
        if (!mounted) return;
        setError(String(err));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
      if (mediaUrl && mediaUrl.startsWith('blob:')) {
        URL.revokeObjectURL(mediaUrl);
      }
    };
    // mediaUrl is managed inside this effect; adding it would cause a fetch loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, executeCapability, isMedia, isImage, ext]);

  // Listen for live AI updates to this open file
  useEffect(() => {
    let mounted = true;
    const handleFileModified = (e: Event) => {
      const customEvent = e as CustomEvent<{ path: string; capability: string }>;
      if (customEvent.detail && customEvent.detail.path) {
        const modifiedPath = customEvent.detail.path;
        if (modifiedPath === path || modifiedPath.endsWith(filename)) {
          executeCapability('com.weave.builtin.file', 'file.read', { path })
            .then((res) => {
              if (!mounted) return;
              const result = res as { success: boolean; content: string };
              if (result && result.success) {
                setContent((currentVal) => {
                  setPrevContent(currentVal || result.content);
                  return result.content;
                });
                setIsDirty(false);
                setLiveUpdated(true);
                setIsDiffMode(true);
                setTimeout(() => {
                  if (mounted) setLiveUpdated(false);
                }, 4000);
                toast.success('⚡ Live code update', {
                  description: `${filename} updated live by Weave Agent`,
                });
              }
            })
            .catch(console.error);
        }
      }
    };
    window.addEventListener('weave:file-modified', handleFileModified);
    return () => {
      mounted = false;
      window.removeEventListener('weave:file-modified', handleFileModified);
    };
  }, [path, filename, executeCapability]);

  const handleSave = useCallback(
    async (currentContent: string) => {
      setSaving(true);
      try {
        const res = (await executeCapability('com.weave.builtin.file', 'file.write', {
          path,
          content: currentContent,
        })) as { success: boolean };

        if (res && res.success) {
          toast.success('File saved', { description: filename });
          setIsDirty(false);
        } else {
          toast.error('Failed to save file');
        }
      } catch (err) {
        toast.error('Error saving file', { description: String(err) });
      } finally {
        setSaving(false);
      }
    },
    [path, executeCapability, filename]
  );

  // Handle Ctrl+S / Cmd+S
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      handleSave(content);
    }
  };

  const handleEditorUpdate = useCallback((vu: ViewUpdate) => {
    // The cursor tracks the real selection and typing only — scrolling must
    // never move it (Phase-7 #6). viewportChanged only updates the visible
    // line range so the status bar can reflect where the user actually is.
    if (vu.selectionSet || vu.docChanged) {
      const state = vu.state;
      const pos = state.selection.main.head;
      const line = state.doc.lineAt(pos);
      setCursor({ line: line.number, col: pos - line.from + 1 });
    }
    if (vu.viewportChanged) {
      const vp = vu.view.viewport;
      setViewport({ from: vp.from + 1, to: vp.to + 1 });
    }
  }, []);

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center h-full bg-background">
        <Loader2 className="w-5 h-5 text-muted-foreground animate-spin mb-3" />
        <p className="text-xs text-muted-foreground">Reading {filename}...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center h-full text-destructive bg-background">
        <AlertCircle className="w-8 h-8 mb-2 opacity-80" />
        <p className="text-sm font-medium">{error}</p>
      </div>
    );
  }

  if (isMedia) {
    return (
      <div className="flex flex-col h-full w-full bg-background">
        <div className="flex items-center justify-between px-4 h-12 border-b bg-card flex-shrink-0 z-10">
          <div className="flex items-center gap-2 overflow-hidden">
            <FileCode2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <span className="text-sm font-medium truncate text-foreground/90">{filename}</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground ml-2 px-1.5 py-0.5 rounded-sm bg-muted/50 border border-border/50">
              {isImage ? 'Image' : 'Video'}
            </span>
          </div>
        </div>
        <div className="flex-1 p-4 flex items-center justify-center overflow-auto relative">
          <div
            className="absolute inset-0 bg-repeat bg-center"
            style={{
              backgroundImage: 'radial-gradient(#333 1px, transparent 1px)',
              backgroundSize: '16px 16px',
              opacity: 0.3,
            }}
          />
          {mediaUrl &&
            (isImage ? (
              <img
                src={mediaUrl}
                alt={filename}
                className="max-w-full max-h-full object-contain shadow-2xl rounded border border-border z-10"
              />
            ) : (
              <video
                src={mediaUrl}
                controls
                className="max-w-full max-h-full shadow-2xl rounded border border-border z-10"
              />
            ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col h-full w-full bg-background relative"
      onKeyDown={handleKeyDown}
      tabIndex={-1} // Allow div to receive keyboard events
    >
      {/* ── Toolbar / Breadcrumb ── */}
      <div className="flex items-center justify-between px-4 h-12 border-b bg-card flex-shrink-0 z-10 transition-colors">
        <div className="flex items-center gap-2 overflow-hidden">
          <FileCode2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <span className="text-sm font-medium truncate text-foreground/90">{filename}</span>
          {isDirty && (
            <span
              className="w-2 h-2 rounded-full bg-primary flex-shrink-0"
              aria-label="Unsaved changes"
              role="status"
            />
          )}
          {liveUpdated && (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-md animate-fade-in">
              <Sparkles className="w-3.5 h-3.5 text-primary animate-pulse" />
              AI Live Updated
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {prevContent && prevContent !== content && (
            <Button
              size="sm"
              variant={isDiffMode ? 'default' : 'outline'}
              onClick={() => setIsDiffMode(!isDiffMode)}
              className="gap-1.5 h-8 text-xs font-sans font-medium"
            >
              {isDiffMode ? (
                <>
                  <Code className="w-3.5 h-3.5" />
                  Code Editor
                </>
              ) : (
                <>
                  <FileDiff className="w-3.5 h-3.5 text-primary" />
                  Diff View
                </>
              )}
            </Button>
          )}

          <Button
            size="sm"
            onClick={() => handleSave(content)}
            disabled={saving || !isDirty}
            variant={isDirty ? 'default' : 'secondary'}
            className={`gap-2 h-8 text-xs transition-all ${isDirty ? 'shadow-sm' : 'opacity-70'}`}
          >
            {saving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>

      {/* ── CodeMirror Editor / Diff Viewer ── */}
      <div className="flex-1 relative w-full overflow-hidden text-sm bg-transparent">
        {isDiffMode ? (
          <FileDiffViewer oldContent={prevContent} newContent={content} filename={filename} />
        ) : (
          <CodeMirror
            value={content}
            height="100%"
            theme={getWeaveTheme(isDark)}
            extensions={languageExt ? [languageExt] : []}
            onChange={(val) => {
              setContent(val);
              if (!isDirty) setIsDirty(true);
            }}
            onUpdate={handleEditorUpdate}
            className="h-full w-full absolute inset-0 [&>.cm-editor]:h-full [&>.cm-editor]:outline-none [&_.cm-scroller]:font-mono [&_.cm-content]:pb-32"
            basicSetup={{
              lineNumbers: true,
              highlightActiveLineGutter: true,
              highlightSpecialChars: true,
              history: true,
              foldGutter: true,
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
              highlightActiveLine: true,
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
        )}
      </div>

      {/* ── Status Bar ── */}
      <div className="h-7 border-t bg-card text-[10px] text-muted-foreground flex items-center justify-between px-3 flex-shrink-0 select-none z-10 font-mono tracking-tight">
        <div className="flex items-center gap-4">
          <span
            className="flex items-center gap-1.5 hover:text-foreground transition-colors cursor-pointer"
            title="Cursor position; shows the first visible line while the cursor is scrolled out of view"
          >
            {cursorReadout(cursor, viewport)}
          </span>
          <span className="opacity-40">|</span>
          <span
            className="flex items-center gap-1.5 hover:text-foreground transition-colors cursor-pointer"
            title="File Size"
          >
            {(new Blob([content]).size / 1024).toFixed(1)} KB
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="hover:text-foreground transition-colors cursor-pointer" title="Encoding">
            UTF-8
          </span>
          <span className="opacity-40">|</span>
          <span
            className="hover:text-foreground transition-colors cursor-pointer uppercase tracking-wider font-semibold"
            title="Language Mode"
          >
            {languageName}
          </span>
        </div>
      </div>
    </div>
  );
}
