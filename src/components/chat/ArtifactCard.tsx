import { useAppStore, ActiveArtifact } from '@/stores/useAppStore';
import { FileText, Code2, ExternalLink } from 'lucide-react';

interface ArtifactCardProps {
  artifact: ActiveArtifact;
}

export function ArtifactCard({ artifact }: ArtifactCardProps) {
  const openArtifact = useAppStore((s) => s.openArtifact);

  return (
    <div
      onClick={() => openArtifact(artifact)}
      className="my-2.5 p-3 rounded-lg border border-border bg-card hover:bg-muted/40 cursor-pointer transition-all flex items-center justify-between font-mono text-xs select-none shadow-xs group"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded border border-border bg-background flex items-center justify-center shrink-0">
          {artifact.type === 'code' ? (
            <Code2 className="w-4 h-4 text-foreground" />
          ) : (
            <FileText className="w-4 h-4 text-foreground" />
          )}
        </div>
        <div className="min-w-0 font-sans">
          <div className="font-bold text-foreground truncate text-xs group-hover:underline">
            {artifact.title || 'Untitled Artifact'}
          </div>
          <div className="text-[11px] text-muted-foreground font-mono">
            {artifact.type === 'note' ? 'Note' : 'File'} • Click to open split view
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          openArtifact(artifact);
        }}
        className="flex items-center gap-1 px-3 py-1 bg-foreground text-background font-semibold rounded text-xs hover:opacity-90 transition-opacity shrink-0 cursor-pointer font-mono"
      >
        <span>Open</span>
        <ExternalLink className="w-3 h-3" />
      </button>
    </div>
  );
}
