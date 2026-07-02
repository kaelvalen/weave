import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import type { ChatMessage } from '@/types/chat';
import { usePluginStore } from './usePluginStore';
import { useAppStore } from './useAppStore';
import { extractError } from '@/lib/errors';

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  selectedModel: string;
  selectedProvider: string;
  error: string | null;
  conversationId: string;
  conversationTitle: string;
  sessions: { id: string; title: string; updated_at: number; pinned?: boolean; folder?: string }[];

  sendMessage: (content: string, images?: string[]) => Promise<void>;
  editAndResend: (messageId: string, newContent: string) => Promise<void>;
  regenerateResponse: (messageId: string) => Promise<void>;
  appendChunk: (chunk: string, messageId: string) => void;
  finalizeMessage: (messageId: string) => void;
  executeToolCall: (messageId: string, capName: string, isApproved: boolean) => Promise<void>;
  clearChat: () => void;
  setModel: (model: string, provider?: string) => void;
  setError: (error: string | null) => void;
  loadHistory: () => Promise<void>;

  // Session methods
  listSessions: () => Promise<void>;
  loadSession: (id: string) => Promise<void>;
  startNewSession: () => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  updateSessionMeta: (id: string, updates: { title?: string, pinned?: boolean, folder?: string }) => Promise<void>;
}

const generateId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

interface ParsedToolCall {
  capName: string;
  params: Record<string, unknown>;
  raw: string;
}

interface ToolParseFailure {
  raw: string;
  reason: string;
}

/** Find JSON objects by matching balanced braces so we don't greedily
 *  swallow unrelated text. Handles multi-line JSON and escaped quotes. */
function findBalancedJson(content: string): string[] {
  const results: string[] = [];
  for (let i = 0; i < content.length; i++) {
    if (content[i] !== '{') continue;

    let depth = 0;
    let inString = false;
    let escape = false;
    let j = i;

    for (; j < content.length; j++) {
      const c = content[j];
      if (escape) {
        escape = false;
        continue;
      }
      if (c === '\\') {
        escape = true;
        continue;
      }
      if (c === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          results.push(content.slice(i, j + 1));
          i = j;
          break;
        }
      }
    }
  }
  return results;
}

/** Best-effort heuristic that maps a JSON object to a capability name. */
function inferCapabilityFromJson(json: string): string | null {
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed.url === 'string') return 'web.fetch';
    if (typeof parsed.title === 'string' && typeof parsed.content === 'string') return 'note.create';
    if (typeof parsed.expression === 'string') return 'calc.eval';
    if (typeof parsed.command === 'string') return 'shell.exec';
    if (typeof parsed.query === 'string' && parsed.query.toLowerCase().startsWith('select')) return 'db.query';
    if (typeof parsed.directory === 'string' && typeof parsed.pattern === 'string') return 'file.search';
    if (typeof parsed.directory === 'string') return 'file.list';
    if (typeof parsed.path === 'string') return parsed.content ? 'file.write' : 'file.read';
  } catch {
    // ignore
  }
  return null;
}

/** Parse the parameter payload for a tool call, tolerating fenced code blocks. */
function parseToolParams(paramsStr: string, capName: string): Record<string, unknown> | null {
  try {
    let clean = (paramsStr || '{}').trim();
    if (clean.startsWith('```json')) {
      clean = clean.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
    } else if (clean.startsWith('```')) {
      clean = clean.replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
    }
    if (!clean) return {};
    return JSON.parse(clean);
  } catch (e) {
    console.warn(`Failed to parse tool params for ${capName}:`, e, paramsStr);
    return null;
  }
}

/** Extract tool calls from an assistant message.
 *  Supports `<call plugin="...">...</call>` (with or without a closing tag)
 *  and raw JSON fallback for models that don't use XML tags.
 *  Malformed calls are returned as failures so callers can log them. */
function parseToolCalls(content: string): { calls: ParsedToolCall[]; failures: ToolParseFailure[] } {
  const calls: ParsedToolCall[] = [];
  const failures: ToolParseFailure[] = [];

  // Parse XML-style <call plugin="...">...</call> tags. Also tolerates a missing
  // closing tag by stopping at the next opening tag or end of string.
  const openRegex = /<call\s+plugin=["']([^"']+)["']\s*>/g;
  let match: RegExpExecArray | null;

  while ((match = openRegex.exec(content)) !== null) {
    const tagStart = match.index;
    const tagEnd = match.index + match[0].length;
    const capName = match[1];
    const rest = content.slice(tagEnd);

    const closeIdx = rest.indexOf('</call>');
    const nextOpenIdx = rest.search(/<call\s+plugin=/);
    const endIdx = closeIdx !== -1
      ? closeIdx
      : (nextOpenIdx !== -1 ? nextOpenIdx : rest.length);
    const rawEnd = closeIdx !== -1
      ? tagEnd + closeIdx + 7
      : tagEnd + endIdx;

    const paramsStr = rest.slice(0, endIdx);
    const raw = content.slice(tagStart, rawEnd);
    const params = parseToolParams(paramsStr, capName);

    if (params === null) {
      failures.push({ raw, reason: `Failed to parse parameters for ${capName}` });
    } else {
      calls.push({ capName, params, raw });
    }

    openRegex.lastIndex = rawEnd;
  }

  // Fallback: if no XML calls found, look for raw JSON objects.
  if (calls.length === 0) {
    for (const json of findBalancedJson(content)) {
      const capName = inferCapabilityFromJson(json);
      if (!capName) continue;

      const params = parseToolParams(json, capName);
      if (params === null) {
        failures.push({ raw: json, reason: `Failed to parse inferred JSON params for ${capName}` });
      } else {
        calls.push({ capName, params, raw: json });
      }
    }
  }

  return { calls, failures };
}

export const useChatStore = create<ChatState>()(
  immer((set, get) => ({
    messages: [],
    isStreaming: false,
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

      let uiContext = useAppStore.getState().activeView as string;
      if (uiContext === 'files') {
        const rootDir = localStorage.getItem('weave_file_manager_root') || '.';
        uiContext = `Files View (Directory: ${rootDir})`;
      }

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
          const title = store.conversationTitle === 'New Chat' && store.messages.length <= 2
            ? content.slice(0, 30) + '...'
            : store.conversationTitle;

          set((s) => { s.conversationTitle = title; });

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
      }
    },

    editAndResend: async (messageId: string, newContent: string) => {
      const state = get();
      if (state.isStreaming || !newContent.trim()) return;

      const msgIndex = state.messages.findIndex(m => m.id === messageId);
      if (msgIndex === -1) return;

      const editedMessage = { ...state.messages[msgIndex], content: newContent.trim(), timestamp: Date.now() };

      const removedMessages = state.messages.slice(msgIndex);

      // Auto-rollback coder changes
      for (const msg of removedMessages) {
        if (msg.role === 'assistant' && msg.metadata?.plugin_calls) {
          for (const call of msg.metadata.plugin_calls) {
            if (['coder.write_file', 'coder.apply_diff'].includes(call.capability) && call.status === 'success' && call.params.path) {
              usePluginStore.getState().executeCapability(call.plugin_id, 'coder.revert_file', { path: call.params.path })
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

        let uiContext = useAppStore.getState().activeView as string;
        if (uiContext === 'files') {
          const rootDir = localStorage.getItem('weave_file_manager_root') || '.';
          uiContext = `Files View (Directory: ${rootDir})`;
        }

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
      }
    },

    regenerateResponse: async (messageId: string) => {
      const state = get();
      if (state.isStreaming) return;

      const msgIndex = state.messages.findIndex(m => m.id === messageId);
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
            if (['coder.write_file', 'coder.apply_diff'].includes(call.capability) && call.status === 'success' && call.params.path) {
              usePluginStore.getState().executeCapability(call.plugin_id, 'coder.revert_file', { path: call.params.path })
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

        let uiContext = useAppStore.getState().activeView as string;
        if (uiContext === 'files') {
          const rootDir = localStorage.getItem('weave_file_manager_root') || '.';
          uiContext = `Files View (Directory: ${rootDir})`;
        }

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
      }
    },

    appendChunk: (chunk: string, messageId: string) => {
      set((state) => {
        const existing = state.messages.find((m) => m.id === messageId);
        if (existing) {
          existing.content += chunk;
        } else {
          state.messages.push({
            id: messageId,
            role: 'assistant',
            content: chunk,
            timestamp: Date.now(),
          });
        }
      });
    },

    finalizeMessage: async (messageId: string) => {
      set((state) => {
        state.isStreaming = false;
      });

      const saveSession = () => {
        const store = get();
        if (store.messages.length > 0) {
          invoke('chat_save_session', {
            id: store.conversationId,
            title: store.conversationTitle,
            messages: store.messages,
          }).catch((err) => toast.error(extractError(err)));
        }
      };

      // AI Function Calling Interception
      const msg = get().messages.find(m => m.id === messageId);
      if (!msg || msg.role !== 'assistant') {
        saveSession();
        return;
      }

      const { calls, failures } = parseToolCalls(msg.content);

      // Keep a log of raw text that failed to parse for debugging.
      for (const failure of failures) {
        console.warn('Malformed tool call skipped:', failure.reason, failure.raw);
        set((state) => {
          state.messages.push({
            id: generateId(),
            role: 'system',
            content: `Malformed tool call skipped: ${failure.reason}`,
            timestamp: Date.now(),
            metadata: { plugin_calls: [], isHidden: true }
          });
        });
      }

      const firstCall = calls[0];
      if (!firstCall) {
        // No tool call, just save the final message
        saveSession();
        return;
      }

      const { capName, params, raw: matchedText } = firstCall;
      const pluginStore = usePluginStore.getState();
      const pluginId = pluginStore.getPluginIdForCapability(capName);

      if (!pluginId) {
        toast.error(`No plugin found providing capability: ${capName}`);
        set((state) => {
          state.messages.push({
            id: generateId(),
            role: 'system',
            content: `Tool ${capName} not found.`,
            timestamp: Date.now(),
            metadata: { plugin_calls: [], isHidden: true }
          });
        });
        get().sendMessage(`System error: Tool ${capName} is not available. Please tell the user you cannot perform this action.`);
        saveSession();
        return;
      }

      // Remove the matched tool call from the assistant's message so it doesn't show in UI as raw text
      set((state) => {
        const assistantMsg = state.messages.find(m => m.id === messageId);
        if (assistantMsg) {
          assistantMsg.content = assistantMsg.content.replace(matchedText, '').trim();
        }
      });

      // Require approval for destructive operations
      const requiresApproval = ['coder.write_file', 'coder.apply_diff'].includes(capName);

      // Attach tool call to assistant message
      set((state) => {
        const assistantMsg = state.messages.find(m => m.id === messageId);
        if (assistantMsg) {
          if (!assistantMsg.metadata) assistantMsg.metadata = { plugin_calls: [] };
          assistantMsg.metadata.plugin_calls.push({
            plugin_id: pluginId,
            capability: capName,
            params,
            status: requiresApproval ? 'pending_approval' : 'pending'
          });
        }
      });

      saveSession();

      if (requiresApproval) {
        return; // Stop execution, wait for user to call executeToolCall
      }

      // Execute the tool
      usePluginStore.getState().executeCapability(pluginId, capName, params)
        .then(res => {
          const resultStr = typeof res === 'string' ? res : JSON.stringify(res, null, 2);

          set((state) => {
            const assistantMsg = state.messages.find(m => m.id === messageId);
            if (assistantMsg && assistantMsg.metadata) {
              const call = assistantMsg.metadata.plugin_calls.find(c => c.capability === capName);
              if (call) {
                call.status = 'success';
                call.result = typeof res === 'object' ? res as Record<string, unknown> : { value: res };
              }
            }
          });

          saveSession();

          // Feed it back to the AI quietly
          const quietUserMsg: ChatMessage = {
            id: generateId(),
            role: 'user',
            content: `Tool ${capName} returned:\n${resultStr}\n\nPlease continue your answer based on this result.`,
            timestamp: Date.now(),
            metadata: { plugin_calls: [], isHidden: true }
          };
          set((state) => { state.messages.push(quietUserMsg); state.isStreaming = true; });

          invoke('chat_send_message', {
            message: quietUserMsg.content,
            model: get().selectedModel,
            provider: get().selectedProvider,
          }).then(() => set((state) => { state.isStreaming = false; }))
            .catch(err => {
              const errorStr = extractError(err);
              toast.error(errorStr);
              set((state) => { state.isStreaming = false; state.error = errorStr; });
            });
        })
        .catch(err => {
          const errorStr = extractError(err);
          toast.error(errorStr);
          set((state) => {
            const assistantMsg = state.messages.find(m => m.id === messageId);
            if (assistantMsg && assistantMsg.metadata) {
              const call = assistantMsg.metadata.plugin_calls.find(c => c.capability === capName);
              if (call) {
                call.status = 'error';
                call.result = { error: errorStr };
              }
            }
          });

          saveSession();

          const quietUserMsg: ChatMessage = {
            id: generateId(),
            role: 'user',
            content: `Tool ${capName} failed with error:\n${errorStr}\n\nPlease apologize and continue.`,
            timestamp: Date.now(),
            metadata: { plugin_calls: [], isHidden: true }
          };
          set((state) => { state.messages.push(quietUserMsg); state.isStreaming = true; });

          invoke('chat_send_message', {
            message: quietUserMsg.content,
            model: get().selectedModel,
          }).then(() => set((state) => { state.isStreaming = false; }))
            .catch(err => {
              const errorStr = extractError(err);
              toast.error(errorStr);
              set((state) => { state.isStreaming = false; state.error = errorStr; });
            });
        });
    },

    executeToolCall: async (messageId: string, capName: string, isApproved: boolean) => {
      const state = get();
      const assistantMsg = state.messages.find(m => m.id === messageId);
      if (!assistantMsg || !assistantMsg.metadata) return;

      const call = assistantMsg.metadata.plugin_calls.find(c => c.capability === capName);
      if (!call || call.status !== 'pending_approval') return;

      const saveSession = () => {
        const store = get();
        if (store.messages.length > 0) {
          invoke('chat_save_session', {
            id: store.conversationId,
            title: store.conversationTitle,
            messages: store.messages,
          }).catch((err) => toast.error(extractError(err)));
        }
      };

      if (!isApproved) {
        set((s) => {
          const msg = s.messages.find(m => m.id === messageId);
          if (msg && msg.metadata) {
            const c = msg.metadata.plugin_calls.find(pc => pc.capability === capName);
            if (c) {
              c.status = 'error';
              c.result = { error: 'User rejected the operation.' };
            }
          }
        });
        saveSession();

        const quietUserMsg: ChatMessage = {
          id: generateId(),
          role: 'user',
          content: `Tool ${capName} was rejected by the user. Please reconsider your approach or ask the user for clarification.`,
          timestamp: Date.now(),
          metadata: { plugin_calls: [], isHidden: true }
        };
        set((s) => { s.messages.push(quietUserMsg); s.isStreaming = true; });

        invoke('chat_send_message', {
          message: quietUserMsg.content,
          model: get().selectedModel,
        }).then(() => set((s) => { s.isStreaming = false; }))
          .catch(err => {
            const errorStr = extractError(err);
            toast.error(errorStr);
            set((s) => { s.isStreaming = false; s.error = errorStr; });
          });
        return;
      }

      // Approved! Set to pending and execute
      set((s) => {
        const msg = s.messages.find(m => m.id === messageId);
        if (msg && msg.metadata) {
          const c = msg.metadata.plugin_calls.find(pc => pc.capability === capName);
          if (c) c.status = 'pending';
        }
      });
      saveSession();

      usePluginStore.getState().executeCapability(call.plugin_id, capName, call.params)
        .then(res => {
          const resultStr = typeof res === 'string' ? res : JSON.stringify(res, null, 2);

          set((s) => {
            const msg = s.messages.find(m => m.id === messageId);
            if (msg && msg.metadata) {
              const c = msg.metadata.plugin_calls.find(pc => pc.capability === capName);
              if (c) {
                c.status = 'success';
                c.result = typeof res === 'object' ? res as Record<string, unknown> : { value: res };
              }
            }
          });
          saveSession();

          const quietUserMsg: ChatMessage = {
            id: generateId(),
            role: 'user',
            content: `Tool ${capName} returned:\n${resultStr}\n\nPlease continue your answer based on this result.`,
            timestamp: Date.now(),
            metadata: { plugin_calls: [], isHidden: true }
          };
          set((s) => { s.messages.push(quietUserMsg); s.isStreaming = true; });

          invoke('chat_send_message', {
            message: quietUserMsg.content,
            model: get().selectedModel,
            provider: get().selectedProvider,
          }).then(() => set((s) => { s.isStreaming = false; }))
            .catch(err => {
              const errorStr = extractError(err);
              toast.error(errorStr);
              set((s) => { s.isStreaming = false; s.error = errorStr; });
            });
        })
        .catch(err => {
          const errorStr = extractError(err);
          toast.error(errorStr);
          set((s) => {
            const msg = s.messages.find(m => m.id === messageId);
            if (msg && msg.metadata) {
              const c = msg.metadata.plugin_calls.find(pc => pc.capability === capName);
              if (c) {
                c.status = 'error';
                c.result = { error: errorStr };
              }
            }
          });
          saveSession();

          const quietUserMsg: ChatMessage = {
            id: generateId(),
            role: 'user',
            content: `Tool ${capName} failed with error:\n${errorStr}\n\nPlease apologize and continue.`,
            timestamp: Date.now(),
            metadata: { plugin_calls: [], isHidden: true }
          };
          set((s) => { s.messages.push(quietUserMsg); s.isStreaming = true; });

          invoke('chat_send_message', {
            message: quietUserMsg.content,
            model: get().selectedModel,
          }).then(() => set((s) => { s.isStreaming = false; }))
            .catch(err => {
              const errorStr = extractError(err);
              toast.error(errorStr);
              set((s) => { s.isStreaming = false; s.error = errorStr; });
            });
        });
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

    setModel: (model: string, provider?: string) => set((state) => {
      state.selectedModel = model;
      if (provider) {
        state.selectedProvider = provider;
      }
    }),

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
            state.messages = history;
          });
        }
      } catch (err) {
        toast.error(extractError(err));
      }
    },

    listSessions: async () => {
      try {
        const sessions = await invoke('chat_list_sessions') as { id: string; title: string; updated_at: number; pinned?: boolean; folder?: string }[];
        set((state) => { state.sessions = sessions; });
      } catch (err) {
        toast.error(extractError(err));
      }
    },

    loadSession: async (id: string) => {
      try {
        const session = await invoke('chat_load_session', { id }) as { id: string; title: string; messages: ChatMessage[] };
        set((state) => {
          state.conversationId = session.id;
          state.conversationTitle = session.title;
          state.messages = session.messages;
          state.error = null;
        });
        // Restore backend history to match session
        await invoke('chat_set_history', { history: session.messages });
      } catch (err) {
        const errorStr = extractError(err);
        toast.error(errorStr);
        set((state) => { state.error = `Failed to load session: ${errorStr}`; });
      }
    },

    startNewSession: async () => {
      try {
        await invoke('chat_clear_history');
      } catch (err) {
        toast.error(extractError(err));
      }
      set((state) => {
        state.conversationId = generateId();
        state.conversationTitle = 'New Chat';
        state.messages = [];
        state.error = null;
      });
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

    updateSessionMeta: async (id: string, updates: { title?: string, pinned?: boolean, folder?: string }) => {
      try {
        await invoke('chat_update_session_meta', {
          id,
          title: updates.title,
          pinned: updates.pinned,
          folder: updates.folder
        });

        // Optimistically update current session title if it's the active one
        if (get().conversationId === id && updates.title !== undefined) {
          set((state) => { state.conversationTitle = updates.title!; });
        }

        await get().listSessions();
      } catch (err) {
        toast.error(extractError(err));
      }
    },
  }))
);
