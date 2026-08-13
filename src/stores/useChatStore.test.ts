import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(''),
}));
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import type { ToolCallDetected } from '@/types/chat';
import { useChatStore } from '@/stores/useChatStore';

/**
 * Frontend half of the Phase 2 tool-call path: backend events
 * (chat-tool-call-detected) are mirrored into message metadata so the UI
 * renders the approval state machine. The backend owns execution + gating;
 * this only verifies the event → store contract.
 */

function seedAssistantMessage(): string {
  const state = useChatStore.getState();
  state.messages.push({
    id: 'assistant-1',
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    metadata: { plugin_calls: [] },
  });
  return 'assistant-1';
}

function pendingApprovalEvent(messageId: string): ToolCallDetected {
  return {
    call_id: 'call_1',
    message_id: messageId,
    plugin_id: 'com.weave.builtin.file',
    capability: 'file.read',
    params: { path: 'src/main.rs' },
    status: 'pending_approval',
  };
}

describe('handleToolCallEvent (backend-driven approval flow)', () => {
  beforeEach(() => {
    useChatStore.setState({ messages: [], conversationId: 'test' });
  });

  it('adds a pending_approval call to the message metadata', () => {
    const messageId = seedAssistantMessage();
    useChatStore.getState().handleToolCallEvent(pendingApprovalEvent(messageId));

    const calls = useChatStore.getState().messages[0].metadata!.plugin_calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      call_id: 'call_1',
      capability: 'file.read',
      plugin_id: 'com.weave.builtin.file',
      params: { path: 'src/main.rs' },
      status: 'pending_approval',
    });
  });

  it('updates an existing call when the backend reports the result', () => {
    const messageId = seedAssistantMessage();
    const store = useChatStore.getState();
    store.handleToolCallEvent(pendingApprovalEvent(messageId));

    store.handleToolCallEvent({
      call_id: 'call_1',
      message_id: messageId,
      plugin_id: 'com.weave.builtin.file',
      capability: 'file.read',
      params: { path: 'src/main.rs' },
      status: 'success',
      result: { content: 'fn main() {}', success: true },
    });

    const calls = useChatStore.getState().messages[0].metadata!.plugin_calls;
    expect(calls).toHaveLength(1);
    expect(calls[0].status).toBe('success');
    expect(calls[0].result).toEqual({ content: 'fn main() {}', success: true });
  });

  it('creates the assistant message for pure tool-call turns', () => {
    // A pure native tool-call turn (e.g. MCP get_me) streams no text chunk,
    // so no assistant message exists when the pending approval arrives.
    // Dropping the event here leaves the backend loop awaiting forever —
    // the "frozen chat" bug. The message must be created.
    const store = useChatStore.getState();
    store.handleToolCallEvent(pendingApprovalEvent('assistant-1'));

    const messages = useChatStore.getState().messages;
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe('assistant-1');
    expect(messages[0].role).toBe('assistant');
    expect(messages[0].metadata!.plugin_calls).toHaveLength(1);
    expect(messages[0].metadata!.plugin_calls[0].status).toBe('pending_approval');
    expect(messages[0].metadata!.plugin_calls[0].call_id).toBe('call_1');
  });
});
