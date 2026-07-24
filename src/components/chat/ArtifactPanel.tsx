import { useState } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { Copy, Check, Download, X, FileText, Code2, ChevronLeft } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { toast } from 'sonner';

export function ArtifactPanel() {
  const activeArtifact = useAppStore((s) => s.activeArtifact);
  const closeArtifact = useAppStore((s) => s.closeArtifact);
  const setRightPanelOpen = useAppStore((s) => s.setRightPanelOpen);
  const [copied, setCopied] = useState(false);

  if (!activeArtifact) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(activeArtifact.content);
    setCopied(true);
    toast.success('Content copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([activeArtifact.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeArtifact.title || 'artifact.txt';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Downloaded artifact file');
  };

  const isCode = activeArtifact.type === 'code' || activeArtifact.language;

  return (
    <div className="flex-1 flex flex-col h-full bg-background border-l border-border font-mono text-xs overflow-hidden">
      {/* Header Bar */}
      <div className="h-10 px-3 flex items-center justify-between border-b border-border flex-shrink-0 bg-card select-none">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={closeArtifact}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground text-xs font-mono pr-2 border-r border-border/60 transition-colors"
            title="Back to artifacts list"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>Artifacts</span>
          </button>
          {isCode ? <Code2 className="w-4 h-4 text-foreground shrink-0" /> : <FileText className="w-4 h-4 text-foreground shrink-0" />}
          <span className="font-bold text-foreground text-xs truncate">
            {activeArtifact.title || 'Untitled Artifact'}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleCopy}
            title="Copy content"
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-foreground" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            title="Download file"
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          <div className="h-4 w-px bg-border/60 mx-1" />
          <button
            type="button"
            onClick={() => setRightPanelOpen(false)}
            title="Close side panel"
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content Viewer Body */}
      <div className="flex-1 overflow-hidden font-sans leading-relaxed relative">
        {isCode ? (
          <div className="p-6 h-full overflow-y-auto">
            <SyntaxHighlighter
              language={activeArtifact.language || 'text'}
              style={vscDarkPlus}
              customStyle={{
                margin: 0,
                padding: '1.25rem',
                borderRadius: '0.5rem',
                fontSize: '0.8rem',
                backgroundColor: 'hsl(var(--muted) / 0.4)',
                border: '1px solid hsl(var(--border))',
              }}
            >
              {activeArtifact.content}
            </SyntaxHighlighter>
          </div>
        ) : (
          <div className="p-6 h-full overflow-y-auto prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-headings:font-bold prose-code:font-mono prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
            >
              {activeArtifact.content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
