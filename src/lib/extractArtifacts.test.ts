import { describe, expect, it } from 'vitest';
import { extractArtifactsFromCalls } from '@/lib/extractArtifacts';
import type { PluginCall } from '@/types/chat';

function call(partial: Partial<PluginCall>): PluginCall {
  return {
    plugin_id: 'com.weave.builtin.note',
    capability: 'note.create',
    params: {},
    status: 'success',
    ...partial,
  };
}

describe('extractArtifactsFromCalls (shared by accordion + artifacts view)', () => {
  it('extracts note artifacts from note.* capabilities', () => {
    const artifacts = extractArtifactsFromCalls([
      call({ capability: 'note.create', params: { title: 'T', content: 'hello' } }),
    ]);
    expect(artifacts).toEqual([
      { title: 'T', type: 'note', content: 'hello', capability: 'note.create' },
    ]);
  });

  it('extracts file artifacts from write_file/file.write/apply_diff', () => {
    const artifacts = extractArtifactsFromCalls([
      call({
        capability: 'file.write',
        params: { path: 'src/a/b.rs', content: 'fn main() {}' },
      }),
    ]);
    expect(artifacts).toEqual([
      {
        title: 'b.rs',
        type: 'file',
        content: 'fn main() {}',
        path: 'src/a/b.rs',
        capability: 'file.write',
      },
    ]);
  });

  it('skips non-success calls and unrelated capabilities', () => {
    const artifacts = extractArtifactsFromCalls([
      call({ capability: 'note.create', status: 'error', params: { title: 'X' } }),
      call({ capability: 'file.read', params: { path: 'x' } }),
    ]);
    expect(artifacts).toEqual([]);
  });

  it('deduplicates by title + type', () => {
    const artifacts = extractArtifactsFromCalls([
      call({ capability: 'note.create', params: { title: 'same', content: 'a' } }),
      call({ capability: 'note.update', params: { title: 'same', content: 'b' } }),
    ]);
    expect(artifacts).toHaveLength(1);
  });
});
