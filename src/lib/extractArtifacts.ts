import type { PluginCall } from '@/types/chat';

/** A tool call whose result produced a note/file artifact. */
export interface ExtractedArtifact {
  type: 'note' | 'file';
  title: string;
  content: string;
  path?: string;
  capability: string;
}

/**
 * Single source of truth for deriving artifacts from tool-call metadata.
 * Previously duplicated in AgentActivityAccordion and ArtifactsView with
 * only a mirroring comment linking them; capability detection and
 * title/content derivation now live here only.
 */
export function extractArtifactsFromCalls(calls: PluginCall[]): ExtractedArtifact[] {
  const artifacts: ExtractedArtifact[] = [];

  for (const call of calls) {
    if (call.status !== 'success') continue;
    const cap = call.capability;
    const params = (call.params || {}) as Record<string, unknown>;
    const result = (call.result || {}) as Record<string, unknown>;

    if (cap.includes('note.create') || cap.includes('note.update') || cap.includes('note.get')) {
      const title = (params.title as string) || (result.title as string) || 'Note';
      const content =
        (params.content as string) ||
        (result.content as string) ||
        (typeof call.result === 'string' ? call.result : '');
      if (content || title) {
        artifacts.push({ title, type: 'note', content, capability: cap });
      }
    } else if (
      cap.includes('write_file') ||
      cap.includes('file.write') ||
      cap.includes('apply_diff')
    ) {
      const path = (params.path as string) || (result.path as string) || 'file.txt';
      const title = path.split('/').pop() || path;
      const content =
        (params.content as string) ||
        (params.new_str as string) ||
        (typeof call.result === 'string' ? call.result : '');
      artifacts.push({ title, type: 'file', content, path, capability: cap });
    }
  }

  // Deduplicate by title & type to prevent card flooding.
  const unique: ExtractedArtifact[] = [];
  for (const art of artifacts) {
    if (!unique.some((a) => a.title === art.title && a.type === art.type)) {
      unique.push(art);
    }
  }
  return unique;
}
