import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ToolCallCard } from './ToolCallCard';
import type { PluginCall } from '@/types/chat';

function makeCall(overrides: Partial<PluginCall> = {}): PluginCall {
  return {
    call_id: 'c1',
    plugin_id: 'com.weave.builtin.file',
    capability: 'file.read',
    params: { path: 'src/main.rs' },
    status: 'success',
    ...overrides,
  };
}

function renderCard(call: PluginCall) {
  return render(<ToolCallCard call={call} messageId="m1" />);
}

/** DOM test of the tool-trace row: verb + target + status + expandable
 *  result. The store->event contract is covered in useChatStore.test.ts. */
describe('ToolCallCard', () => {
  afterEach(() => cleanup());

  it('renders the verb, target, and a success check for file.read', () => {
    renderCard(makeCall());
    expect(screen.getByText('Read')).toBeInTheDocument();
    expect(screen.getByText('src/main.rs')).toBeInTheDocument();
    expect(screen.queryByText('Error')).not.toBeInTheDocument();
  });

  it('shows an Error badge for a failed call', () => {
    renderCard(makeCall({ status: 'error', result: { error: 'no such file' } }));
    expect(screen.getByText('Error')).toBeInTheDocument();
  });

  it('expands to reveal the params and result payload', () => {
    const result = { n: 1 };
    renderCard(makeCall({ capability: 'calc.eval', result }));
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Params')).toBeInTheDocument();
    expect(screen.getByText('Result')).toBeInTheDocument();
    expect(screen.getByText(/"n": 1/)).toBeInTheDocument();
  });

  it('renders web.search sources as an expandable search trace', () => {
    renderCard(
      makeCall({
        capability: 'web.search',
        params: { query: 'weave docs' },
        result: { query: 'weave docs', results: [{ title: 'Weave', url: 'https://example.com' }] },
      })
    );
    // Search variant renders the query + source title directly (no verb row).
    expect(screen.getByText('weave docs')).toBeInTheDocument();
    expect(screen.getByText('Weave')).toBeInTheDocument();
  });
});
