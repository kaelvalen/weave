import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import type { ChatMessage, PluginCall, ToolCallDetected } from '@/types/chat';
import { usePluginStore } from './usePluginStore';
import { useAppStore } from './useAppStore';
import { extractError } from '@/lib/errors';

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  isSwitchingModel: boolean;
  selectedModel: string;
  selectedProvider: string;
  error: string | null;
  conversationId: string;
  conversationTitle: string;
  sessions: { id: string; title: string; updated_at: number; pinned?: boolean; folder?: string }[];

  sendMessage: (content: string, images?: string[]) => Promise<void>;
  editAndResend: (messageId: string, newContent: string) => Promise<void>;
  regenerateResponse: (messageId: string) => Promise<void>;
  stopStreaming: () => void;
  appendChunk: (chunk: string, messageId: string) => void;
  finalizeMessage: () => void;
  executeToolCall: (messageId: string, capName: string, isApproved: boolean) => Promise<void>;
  /** Backend-driven tool-call lifecycle events (chat-tool-call-detected). */
  handleToolCallEvent: (payload: ToolCallDetected) => void;
  clearChat: () => void;
  setModel: (model: string, provider?: string) => Promise<void>;
  setError: (error: string | null) => void;
  loadHistory: () => Promise<void>;

  // Session methods
  listSessions: () => Promise<void>;
  loadSession: (id: string) => Promise<void>;
  startNewSession: () => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  updateSessionMeta: (
    id: string,
    updates: { title?: string; pinned?: boolean; folder?: string }
  ) => Promise<void>;
}

const generateId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const getUiContext = () => {
  let uiContext = useAppStore.getState().activeView as string;
  if (uiContext === 'files') {
    const rootDir = localStorage.getItem('weave_file_manager_root') || '.';
    uiContext = `Files View (Directory: ${rootDir})`;
  }
  return uiContext;
};

function hydrateMessageMetadata(messages: ChatMessage[]): ChatMessage[] {
  // Tool calls are now native and persisted as metadata by the backend —
  // nothing to reconstruct from free text.
  return messages || [];
}

export const useChatStore = create<ChatState>()(
  immer((set, get) => ({
    messages: [],
    isStreaming: false,
    isSwitchingModel: false,
    selectedModel: 'gpt-4o-mini',
    selectedProvider: 'openai',
    error: null,
    conversationId: generateId(),
    conversationTitle: 'New Chat',
    sessions: [],

    sendMessage: async (content: string, images?: string[]) => {
      const state = get();
      if (state.isStreaming || (!content.trim() && (!images || images.length === 0))) return;

      const userMessage: ChatMessage = {
        id: generateId(),
        role: 'user',
        content: content.trim(),
        timestamp: Date.now(),
        images,
      };

      set((state) => {
        state.messages.push(userMessage);
        state.isStreaming = true;
        state.error = null;
      });

      const uiContext = getUiContext();

      try {
        await invoke('chat_send_message', {
          message: content.trim(),
          model: get().selectedModel,
          provider: get().selectedProvider,
          ui_context: uiContext,
          images: images || [],
        });

        // Auto-save session
        const store = get();
        if (store.messages.length > 0) {
          const title =
            store.conversationTitle === 'New Chat' && store.messages.length <= 2
              ? content.slice(0, 30) + '...'
              : store.conversationTitle;

          set((s) => {
            s.conversationTitle = title;
          });

          await invoke('chat_save_session', {
            id: store.conversationId,
            title,
            messages: store.messages,
          }).catch((err) => toast.error(extractError(err)));

          store.listSessions();
        }
      } catch (err) {
        const errorMsg = extractError(err);
        toast.error(errorMsg);
        set((state) => {
          state.isStreaming = false;
          state.error = errorMsg;
          state.messages.push({
            id: generateId(),
            role: 'assistant',
            content: `**Error:** ${errorMsg}`,
            timestamp: Date.now(),
          });
        });
      } finally {
        const state = get();
        const lastMsg = state.messages[state.messages.length - 1];
        const hasPendingTools = lastMsg?.metadata?.plugin_calls?.some(
          (c) => c.status === 'pending' || c.status === 'pending_approval'
        );
        if (!hasPendingTools) {
          set((s) => {
            s.isStreaming = false;
          });
        }
      }
    },

    stopStreaming: () => {
      set((state) => {
        state.isStreaming = false;
      });
      invoke('chat_abort_generation').catch(() => {});
    },

    editAndResend: async (messageId: string, newContent: string) => {
      const state = get();
      if (state.isStreaming || !newContent.trim()) return;

      const msgIndex = state.messages.findIndex((m) => m.id === messageId);
      if (msgIndex === -1) return;

      const editedMessage = {
        ...state.messages[msgIndex],
        content: newContent.trim(),
        timestamp: Date.now(),
      };

      const removedMessages = state.messages.slice(msgIndex);

      // Auto-rollback coder changes
      for (const msg of removedMessages) {
        if (msg.role === 'assistant' && msg.metadata?.plugin_calls) {
          for (const call of msg.metadata.plugin_calls) {
            if (
              ['coder.write_file', 'coder.apply_diff'].includes(call.capability) &&
              call.status === 'success' &&
              call.params.path
            ) {
              usePluginStore
                .getState()
                .executeCapability(call.plugin_id, 'coder.revert_file', { path: call.params.path })
                .then(() => {
                  window.dispatchEvent(
                    new CustomEvent('weave:file-modified', {
                      detail: { path: call.params.path, capability: 'coder.revert_file' },
                    })
                  );
                  window.dispatchEvent(new Event('weave-fs-refresh'));
                })
                .catch((err) => toast.error(extractError(err)));
            }
          }
        }
      }

      // Truncate history and replace the edited message
      set((s) => {
        s.messages = s.messages.slice(0, msgIndex);
        s.messages.push(editedMessage);
        s.isStreaming = true;
        s.error = null;
      });

      // We need to tell the backend about the new truncated history
      // The easiest way is to save the session first so backend has it, then send the message.
      // Wait, `chat_send_message` in backend reads from `SESSION_STATE`.
      // We must first update the backend state before sending a new message.
      // We can use `chat_set_history`!

      const store = get();
      try {
        await invoke('chat_set_history', { history: store.messages.slice(0, -1) }); // set history without the new message

        const uiContext = getUiContext();

        await invoke('chat_send_message', {
          message: newContent.trim(),
          model: store.selectedModel,
          provider: store.selectedProvider,
          ui_context: uiContext,
          images: editedMessage.images || [],
        });

        // Auto-save session
        if (store.messages.length > 0) {
          await invoke('chat_save_session', {
            id: store.conversationId,
            title: store.conversationTitle,
            messages: store.messages,
          }).catch((err) => toast.error(extractError(err)));
        }
      } catch (err) {
        const errorMsg = extractError(err);
        toast.error(errorMsg);
        set((state) => {
          state.isStreaming = false;
          state.error = errorMsg;
          state.messages.push({
            id: generateId(),
            role: 'assistant',
            content: `**Error:** ${errorMsg}`,
            timestamp: Date.now(),
          });
        });
      } finally {
        const state = get();
        const lastMsg = state.messages[state.messages.length - 1];
        const hasPendingTools = lastMsg?.metadata?.plugin_calls?.some(
          (c) => c.status === 'pending' || c.status === 'pending_approval'
        );
        if (!hasPendingTools) {
          set((s) => {
            s.isStreaming = false;
          });
        }
      }
    },

    regenerateResponse: async (messageId: string) => {
      const state = get();
      if (state.isStreaming) return;

      const msgIndex = state.messages.findIndex((m) => m.id === messageId);
      if (msgIndex === -1) return;

      // Ensure the message to regenerate is an assistant message
      if (state.messages[msgIndex].role !== 'assistant') return;

      // Find the last user message before this assistant message
      let lastUserIndex = msgIndex - 1;
      while (lastUserIndex >= 0 && state.messages[lastUserIndex].role !== 'user') {
        lastUserIndex--;
      }

      if (lastUserIndex === -1) return; // No user message found to regenerate from

      const lastUserMsg = state.messages[lastUserIndex];

      const removedMessages = state.messages.slice(lastUserIndex + 1);

      // Auto-rollback coder changes
      for (const msg of removedMessages) {
        if (msg.role === 'assistant' && msg.metadata?.plugin_calls) {
          for (const call of msg.metadata.plugin_calls) {
            if (
              ['coder.write_file', 'coder.apply_diff'].includes(call.capability) &&
              call.status === 'success' &&
              call.params.path
            ) {
              usePluginStore
                .getState()
                .executeCapability(call.plugin_id, 'coder.revert_file', { path: call.params.path })
                .catch((err) => toast.error(extractError(err)));
            }
          }
        }
      }

      // Truncate history up to the last user message (inclusive)
      set((s) => {
        s.messages = s.messages.slice(0, lastUserIndex + 1);
        s.isStreaming = true;
        s.error = null;
      });

      const store = get();
      try {
        await invoke('chat_set_history', { history: store.messages }); // update backend history

        const uiContext = getUiContext();

        await invoke('chat_send_message', {
          message: lastUserMsg.content,
          model: store.selectedModel,
          provider: store.selectedProvider,
          ui_context: uiContext,
          images: lastUserMsg.images || [],
        });

        if (store.messages.length > 0) {
          await invoke('chat_save_session', {
            id: store.conversationId,
            title: store.conversationTitle,
            messages: store.messages,
          }).catch((err) => toast.error(extractError(err)));
        }
      } catch (err) {
        const errorMsg = extractError(err);
        toast.error(errorMsg);
        set((state) => {
          state.isStreaming = false;
          state.error = errorMsg;
          state.messages.push({
            id: generateId(),
            role: 'assistant',
            content: `**Error:** ${errorMsg}`,
            timestamp: Date.now(),
          });
        });
      } finally {
        const state = get();
        const lastMsg = state.messages[state.messages.length - 1];
        const hasPendingTools = lastMsg?.metadata?.plugin_calls?.some(
          (c) => c.status === 'pending' || c.status === 'pending_approval'
        );
        if (!hasPendingTools) {
          set((s) => {
            s.isStreaming = false;
          });
        }
      }
    },

    appendChunk: (chunk: string, messageId: string) => {
      set((state) => {
        const targetMsg = state.messages.find((m) => m.id === messageId);
        if (targetMsg) {
          targetMsg.content += chunk;
          // Record the text slice in the stream-order timeline so the UI
          // can interleave text with tool calls at their true positions.
          if (!targetMsg.metadata) targetMsg.metadata = { plugin_calls: [] };
          const segments = targetMsg.metadata.segments ?? (targetMsg.metadata.segments = []);
          const last = segments[segments.length - 1];
          if (last && last.t === 'text') {
            last.len += chunk.length;
          } else {
            segments.push({ t: 'text', len: chunk.length });
          }
        } else {
          state.messages.push({
            id: messageId,
            role: 'assistant',
            content: chunk,
            timestamp: Date.now(),
            metadata: { plugin_calls: [], segments: [{ t: 'text', len: chunk.length }] },
          });
        }
      });
    },

    finalizeMessage: async () => {
      const saveSession = () => {
        const store = get();
        if (store.messages.length > 0) {
          invoke('chat_save_session', {
            id: store.conversationId,
            title: store.conversationTitle,
            messages: store.messages,
          }).catch((err) => toast.error(extractError(err)));
          localStorage.setItem('weave_active_session_id', store.conversationId);
        }
      };

      // Phase 2: the backend agent loop owns the turn end-to-end (native
      // tool-calling, approval gate, execution, completion rule). The
      // frontend only stops streaming and persists the session here.
      set((state) => {
        state.isStreaming = false;
      });
      saveSession();
    },

    /** Backend-driven tool-call lifecycle (chat-tool-call-detected). */
    handleToolCallEvent: (payload: ToolCallDetected) => {
      const call: PluginCall = {
        call_id: payload.call_id,
        plugin_id: payload.plugin_id,
        capability: payload.capability,
        params: (payload.params as Record<string, unknown>) || {},
        result: payload.result as PluginCall['result'],
        status: payload.status as PluginCall['status'],
      };
      set((state) => {
        let msg = state.messages.find((m) => m.id === payload.message_id);
        if (!msg) {
          // A pure tool-call turn (e.g. MCP get_me) streams no text chunk,
          // so appendChunk never created the assistant message. Create it
          // here or the pending approval is silently dropped and the
          // backend loop waits forever — the "frozen chat" bug.
          msg = {
            id: payload.message_id,
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
          };
          state.messages.push(msg);
        }
        if (!msg.metadata) msg.metadata = { plugin_calls: [] };
        const calls = msg.metadata.plugin_calls;
        // Match by call_id first so repeated capabilities (e.g. several
        // pull_request_read calls) stay separate entries instead of merging
        // into one. Only fall back to capability matching when the event
        // carries no call_id at all.
        const existing = payload.call_id
          ? calls.find((c) => c.call_id === payload.call_id)
          : calls.find((c) => c.capability === payload.capability && !c.call_id);
        if (existing) {
          existing.call_id = payload.call_id ?? existing.call_id;
          existing.params = { ...existing.params, ...call.params };
          existing.status = call.status;
          if (call.result !== undefined) existing.result = call.result;
        } else {
          calls.push(call);
        }
        // Record the tool call in the stream-order timeline at the position
        // it actually happened (between text slices).
        if (payload.call_id) {
          const segments = msg.metadata.segments ?? (msg.metadata.segments = []);
          const last = segments[segments.length - 1];
          if (last && last.t === 'tools' && !last.calls.includes(payload.call_id)) {
            last.calls.push(payload.call_id);
          } else if (!last || last.t !== 'tools') {
            segments.push({ t: 'tools', calls: [payload.call_id] });
          }
        }
      });
    },

    executeToolCall: async (messageId: string, capName: string, isApproved: boolean) => {
      // Phase 2: approval decisions are relayed to the backend agent loop,
      // which halts its turn until every pending call is resolved.
      const state = get();
      const assistantMsg = state.messages.find((m) => m.id === messageId);
      const call = assistantMsg?.metadata?.plugin_calls.find(
        (c) => c.capability === capName && c.status === 'pending_approval'
      );
      if (!call?.call_id) {
        toast.error(`No pending approval found for ${capName}`);
        return;
      }

      // Optimistic status flip; the backend emits the definitive result via
      // chat-tool-call-detected once the call executes.
      set((s) => {
        const msg = s.messages.find((m) => m.id === messageId);
        const c = msg?.metadata?.plugin_calls.find((pc) => pc.capability === capName);
        if (c) {
          c.status = isApproved ? 'pending' : 'error';
          if (!isApproved) {
            c.result = { error: 'User rejected the operation.' };
          }
        }
      });

      try {
        await invoke('chat_approve_tool_call', { callId: call.call_id, approved: isApproved });
      } catch (err) {
        const errorStr = extractError(err);
        toast.error(`Approval failed: ${errorStr}`);
        set((s) => {
          const msg = s.messages.find((m) => m.id === messageId);
          const c = msg?.metadata?.plugin_calls.find((pc) => pc.capability === capName);
          if (c) c.status = 'pending_approval';
        });
      }
    },

    clearChat: async () => {
      try {
        await invoke('chat_clear_history');
        set((state) => {
          state.messages = [];
          state.conversationId = generateId();
          state.error = null;
        });
      } catch (err) {
        const errorStr = extractError(err);
        toast.error(errorStr);
        set((state) => {
          state.messages = [];
          state.conversationId = generateId();
        });
      }
    },

    setModel: async (model: string, provider?: string) => {
      if (get().isSwitchingModel) return;

      const state = get();
      const prevModel = state.selectedModel;
      const prevProvider = state.selectedProvider;
      const nextProvider = provider ?? prevProvider;

      const sameModelAndProvider = prevModel === model && prevProvider === nextProvider;
      if (sameModelAndProvider) return;

      const prevIsOllamaLocal = prevProvider === 'local' && !prevModel.endsWith('.gguf');
      const nextIsOllamaLocal = nextProvider === 'local' && !model.endsWith('.gguf');
      const needsLocalLifecycleSwitch = prevIsOllamaLocal || nextIsOllamaLocal;

      if (needsLocalLifecycleSwitch) {
        set((s) => {
          s.isSwitchingModel = true;
        });

        try {
          await invoke('local_model_switch', {
            previousModel: prevIsOllamaLocal ? prevModel : null,
            nextModel: nextIsOllamaLocal ? model : null,
          });
        } catch (err) {
          const errorMsg = extractError(err);
          toast.error(`Local model switch failed: ${errorMsg}`);
          set((s) => {
            s.error = errorMsg;
          });
          return;
        } finally {
          set((s) => {
            s.isSwitchingModel = false;
          });
        }
      }

      set((s) => {
        s.selectedModel = model;
        if (provider) {
          s.selectedProvider = provider;
        }
      });
    },

    setError: (error: string | null) => {
      set((state) => {
        state.error = error;
      });
    },

    loadHistory: async () => {
      try {
        const history: ChatMessage[] = await invoke('chat_get_history');
        if (history && history.length > 0) {
          set((state) => {
            state.messages = hydrateMessageMetadata(history);
          });
          return;
        }
        // The backend history is in-memory: after an app restart it is
        // empty and the conversation would silently vanish. Restore the
        // active (or most recent) saved session from disk instead — it
        // carries the same messages including plugin-call metadata.
        const activeId = localStorage.getItem('weave_active_session_id');
        const sessions = (await invoke('chat_list_sessions')) as {
          id: string;
          updated_at: number;
        }[];
        const sorted = [...sessions].sort((a, b) => b.updated_at - a.updated_at);
        const target = sorted.find((s) => s.id === activeId) ?? sorted[0];
        if (target) {
          await get().loadSession(target.id);
        }
      } catch (err) {
        toast.error(extractError(err));
      }
    },

    listSessions: async () => {
      try {
        const sessions = (await invoke('chat_list_sessions')) as {
          id: string;
          title: string;
          updated_at: number;
          pinned?: boolean;
          folder?: string;
        }[];
        set((state) => {
          state.sessions = sessions;
        });

        // Auto-restore last active session on page refresh/mount if no messages loaded yet
        if (get().messages.length === 0 && sessions.length > 0) {
          const savedId = localStorage.getItem('weave_active_session_id');
          const targetSession = sessions.find((s) => s.id === savedId) || sessions[0];
          if (targetSession) {
            get().loadSession(targetSession.id);
          }
        }
      } catch (err) {
        toast.error(extractError(err));
      }
    },

    loadSession: async (id: string) => {
      try {
        const session = (await invoke('chat_load_session', { id })) as {
          id: string;
          title: string;
          messages: ChatMessage[];
        };
        const hydratedMessages = hydrateMessageMetadata(session.messages);
        set((state) => {
          state.conversationId = session.id;
          state.conversationTitle = session.title;
          state.messages = hydratedMessages;
          state.error = null;
        });
        localStorage.setItem('weave_active_session_id', session.id);
        // Restore backend history to match session
        await invoke('chat_set_history', { history: hydratedMessages });
      } catch (err) {
        const errorStr = extractError(err);
        toast.error(errorStr);
        set((state) => {
          state.error = `Failed to load session: ${errorStr}`;
        });
      }
    },

    startNewSession: async () => {
      try {
        await invoke('chat_clear_history');
      } catch (err) {
        toast.error(extractError(err));
      }
      const newId = generateId();
      set((state) => {
        state.conversationId = newId;
        state.conversationTitle = 'New Chat';
        state.messages = [];
        state.error = null;
      });
      localStorage.setItem('weave_active_session_id', newId);
    },

    deleteSession: async (id: string) => {
      try {
        await invoke('chat_delete_session', { id });
        get().listSessions();
        if (get().conversationId === id) {
          get().startNewSession();
        }
      } catch (err) {
        toast.error(extractError(err));
      }
    },

    updateSessionMeta: async (
      id: string,
      updates: { title?: string; pinned?: boolean; folder?: string }
    ) => {
      try {
        await invoke('chat_update_session_meta', {
          id,
          title: updates.title,
          pinned: updates.pinned,
          folder: updates.folder,
        });

        // Optimistically update current session title if it's the active one
        if (get().conversationId === id && updates.title !== undefined) {
          set((state) => {
            state.conversationTitle = updates.title!;
          });
        }

        await get().listSessions();
      } catch (err) {
        toast.error(extractError(err));
      }
    },
  }))
);
