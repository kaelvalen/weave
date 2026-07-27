import { useAppStore, ActiveArtifact } from '@/stores/useAppStore';
import { FileText, Code2, ArrowRight } from 'lucide-react';

interface ArtifactCardProps {
  artifact: ActiveArtifact;
}

export function ArtifactCard({ artifact }: ArtifactCardProps) {
  const openArtifact = useAppStore((s) => s.openArtifact);

  return (
    <div
      onClick={() => openArtifact(artifact)}
      className="artifact-enter my-2.5 p-3 rounded-lg bg-surface-1 hover:bg-surface-2 cursor-pointer transition-colors flex items-center justify-between font-mono text-xs select-none group"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded-md bg-surface-3 flex items-center justify-center shrink-0">
          {artifact.type === 'code' ? (
            <Code2 className="w-4 h-4 text-foreground" />
          ) : (
            <FileText className="w-4 h-4 text-foreground" />
          )}
        </div>
        <div className="min-w-0 font-sans">
          <div className="font-medium text-foreground truncate text-xs group-hover:underline">
            {artifact.title || 'Untitled Artifact'}
          </div>
          <div className="text-[11px] text-muted-foreground font-mono">
            {artifact.type === 'note' ? 'Note' : 'File'} • Click to open split view
          </div>
        </div>
      </div>

      <ArrowRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-brand group-hover:translate-x-0.5 transition-all shrink-0 ml-2" />
    </div>
  );
}
