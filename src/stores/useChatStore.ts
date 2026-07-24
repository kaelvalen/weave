import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import type { ChatMessage } from '@/types/chat';
import { usePluginStore } from './usePluginStore';
import { useAppStore } from './useAppStore';
import { extractError } from '@/lib/errors';
import { isDestructiveCapability } from '@/lib/capabilities';
import { useApprovalModeStore } from './useApprovalModeStore';

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
  appendChunk: (chunk: string, messageId: string) => void;
  finalizeMessage: (messageId: string) => void;
  executeToolCall: (messageId: string, capName: string, isApproved: boolean) => Promise<void>;
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
    if (typeof parsed.title === 'string' && typeof parsed.content === 'string')
      return 'note.create';
    if (typeof parsed.expression === 'string') return 'calc.eval';
    if (typeof parsed.command === 'string') return 'shell.exec';
    if (typeof parsed.query === 'string' && parsed.query.toLowerCase().startsWith('select'))
      return 'db.query';
    if (typeof parsed.directory === 'string' && typeof parsed.pattern === 'string')
      return 'file.search';
    if (typeof parsed.directory === 'string') return 'file.list';
    if (typeof parsed.path === 'string') return parsed.content ? 'file.write' : 'file.read';
  } catch {
    // ignore
  }
  return null;
}

/** Parse the parameter payload for a tool call, tolerating fenced code blocks and unclosed tags. */
function parseToolParams(
  paramsStr: string,
  capName: string,
  isStreaming = false
): Record<string, unknown> | null {
  try {
    let clean = (paramsStr || '{}').trim();
    if (clean.startsWith('```json')) {
      clean = clean
        .replace(/^```json\s*/, '')
        .replace(/\s*```$/, '')
        .trim();
    } else if (clean.startsWith('```')) {
      clean = clean
        .replace(/^```\s*/, '')
        .replace(/\s*```$/, '')
        .trim();
    }
    if (!clean) return {};
    try {
      return JSON.parse(clean);
    } catch {
      // Fallback: if JSON.parse fails, find balanced JSON
      const balanced = findBalancedJson(clean);
      if (balanced.length > 0) {
        return JSON.parse(balanced[0]);
      }

      // If streaming, attempt partial repair
      if (isStreaming) {
        const completions = ['"', '"}', '}', '"]}', '"}]}', '}}'];
        for (const end of completions) {
          try {
            return JSON.parse(clean + end);
          } catch {
            // continue
          }
        }
        const obj: Record<string, unknown> = {};
        const kvRegex = /"([^"]+)"\s*:\s*(?:"([^"]*)"|(\d+)|(true|false)|null)/g;
        let match: RegExpExecArray | null;
        while ((match = kvRegex.exec(clean)) !== null) {
          const key = match[1];
          if (match[2] !== undefined) obj[key] = match[2];
          else if (match[3] !== undefined) obj[key] = Number(match[3]);
          else if (match[4] !== undefined) obj[key] = match[4] === 'true';
        }
        return obj;
      }

      throw new Error('No balanced JSON found');
    }
  } catch (e) {
    if (!isStreaming) {
      console.warn(`Failed to parse tool params for ${capName}:`, e, paramsStr);
    }
    return isStreaming ? {} : null;
  }
}

/** Extract tool calls from an assistant message.
 *  Supports `<call plugin="...">...</call>` (with or without a closing tag)
 *  and raw JSON fallback for models that don't use XML tags.
 *  Malformed calls are returned as failures so callers can log them. */
function parseToolCalls(
  content: string,
  isStreaming = false
): {
  calls: ParsedToolCall[];
  failures: ToolParseFailure[];
} {
  const calls: ParsedToolCall[] = [];
  const failures: ToolParseFailure[] = [];

  // Parse XML-style <call plugin="...">...</call> tags. Also tolerates a missing
  // closing tag by stopping at the next opening tag or end of string, and allows unquoted attributes.
  const openRegex = /<\s*call\s+plugin\s*=\s*(?:["']([^"']+)["']|([^\s>]+))[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = openRegex.exec(content)) !== null) {
    const tagStart = match.index;
    const tagEnd = match.index + match[0].length;
    const capName = match[1] || match[2];
    const rest = content.slice(tagEnd);

    const closeIdx = rest.search(/<\/\s*call\s*>/i);
    const nextOpenIdx = rest.search(/<\s*call\s+plugin\s*=/i);

    let endIdx: number;
    let rawEnd: number;

    if (closeIdx !== -1 && (nextOpenIdx === -1 || closeIdx < nextOpenIdx)) {
      const matchClose = rest.match(/<\/\s*call\s*>/i);
      const closeTagLen = matchClose ? matchClose[0].length : 7;
      endIdx = closeIdx;
      rawEnd = tagEnd + closeIdx + closeTagLen;
    } else if (nextOpenIdx !== -1) {
      endIdx = nextOpenIdx;
      rawEnd = tagEnd + nextOpenIdx;
    } else {
      endIdx = rest.length;
      rawEnd = tagEnd + rest.length;
    }

    const paramsStr = rest.slice(0, endIdx);
    const raw = content.slice(tagStart, rawEnd);
    const params = parseToolParams(paramsStr, capName, isStreaming);

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

      const params = parseToolParams(json, capName, isStreaming);
      if (params === null) {
        failures.push({ raw: json, reason: `Failed to parse inferred JSON params for ${capName}` });
      } else {
        calls.push({ capName, params, raw: json });
      }
    }
  }

  return { calls, failures };
}

function hydrateMessageMetadata(messages: ChatMessage[]): ChatMessage[] {
  if (!messages) return [];
  return messages.map((msg) => {
    if (msg.role === 'assistant' && msg.content && msg.content.includes('<call')) {
      const parsed = parseToolCalls(msg.content);
      if (parsed.calls.length > 0) {
        const existingCalls = msg.metadata?.plugin_calls || [];
        const reconstructed = parsed.calls.map((c) => {
          const matched = existingCalls.find((ec) => ec.capability === c.capName);
          return (
            matched || {
              plugin_id: c.capName,
              capability: c.capName,
              params: c.params,
              status: 'success' as const,
              result: c.params,
            }
          );
        });
        return {
          ...msg,
          metadata: {
            ...msg.metadata,
            plugin_calls: reconstructed,
          },
        };
      }
    }
    return msg;
  });
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
      }
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
      }
    },

    appendChunk: (chunk: string, messageId: string) => {
      set((state) => {
        let targetMsg = state.messages.find((m) => m.id === messageId);
        if (targetMsg) {
          targetMsg.content += chunk;
        } else {
          targetMsg = {
            id: messageId,
            role: 'assistant',
            content: chunk,
            timestamp: Date.now(),
          };
          state.messages.push(targetMsg);
        }

        // Real-time instant tool call extraction during streaming
        if (targetMsg.role === 'assistant' && targetMsg.content.includes('<call')) {
          const { calls } = parseToolCalls(targetMsg.content, true);
          if (calls.length > 0) {
            if (!targetMsg.metadata) targetMsg.metadata = { plugin_calls: [] };
            const existingCalls = targetMsg.metadata.plugin_calls || [];
            const pluginStore = usePluginStore.getState();

            const updatedCalls = calls.map((c) => {
              const pluginId = pluginStore.getPluginIdForCapability(c.capName) || c.capName;
              const matched = existingCalls.find((ec) => ec.capability === c.capName);
              return (
                matched || {
                  plugin_id: pluginId,
                  capability: c.capName,
                  params: c.params,
                  status: 'pending' as const,
                }
              );
            });

            // Keep parameters updated live as they stream in
            for (const c of calls) {
              const matched = updatedCalls.find((ec) => ec.capability === c.capName);
              if (matched && Object.keys(c.params).length > 0) {
                matched.params = { ...matched.params, ...c.params };
              }
            }

            targetMsg.metadata.plugin_calls = updatedCalls;
          }
        }
      });
    },

    finalizeMessage: async (messageId: string) => {
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
      const msg = get().messages.find((m) => m.id === messageId);
      if (!msg || msg.role !== 'assistant') {
        set((state) => {
          state.isStreaming = false;
        });
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
            metadata: { plugin_calls: [], isHidden: true },
          });
        });
      }

      if (calls.length === 0) {
        // No tool call, just stop streaming and save the final message
        set((state) => {
          state.isStreaming = false;
        });
        saveSession();
        return;
      }

      const pluginStore = usePluginStore.getState();
      const validCalls: {
        capName: string;
        params: Record<string, unknown>;
        raw: string;
        pluginId: string;
      }[] = [];

      for (const call of calls) {
        const pluginId = pluginStore.getPluginIdForCapability(call.capName);
        if (!pluginId) {
          toast.error(`No plugin found providing capability: ${call.capName}`);
          set((state) => {
            state.messages.push({
              id: generateId(),
              role: 'system',
              content: `Tool ${call.capName} not found.`,
              timestamp: Date.now(),
              metadata: { plugin_calls: [], isHidden: true },
            });
          });
        } else {
          validCalls.push({ ...call, pluginId });
        }
      }

      if (validCalls.length === 0) {
        set((state) => {
          state.isStreaming = false;
        });
        get().sendMessage(
          `System error: Requested tools are not available. Please tell the user you cannot perform this action.`
        );
        saveSession();
        return;
      }

      // Remove all matched tool calls from the assistant's message so they don't show in UI as raw text
      set((state) => {
        const assistantMsg = state.messages.find((m) => m.id === messageId);
        if (assistantMsg) {
          for (const call of validCalls) {
            assistantMsg.content = assistantMsg.content.replace(call.raw, '').trim();
          }
        }
      });

      // File/system-modifying capabilities require explicit user approval before running.
      // Non-destructive tools (read, list, calc, search, etc.) execute autonomously.
      // In `accept-edits` mode the user has pre-approved all destructive calls for the session,
      // so we skip the per-call prompt (behaves like other coders' "Accept Edits").
      const hasDestructive = validCalls.some((c) => isDestructiveCapability(c.capName));
      const approvalMode = useApprovalModeStore.getState().mode;
      const requiresApproval = hasDestructive && approvalMode === 'ask';

      // Attach tool calls to assistant message
      set((state) => {
        const assistantMsg = state.messages.find((m) => m.id === messageId);
        if (assistantMsg) {
          if (!assistantMsg.metadata) assistantMsg.metadata = { plugin_calls: [] };
          for (const call of validCalls) {
            assistantMsg.metadata.plugin_calls.push({
              plugin_id: call.pluginId,
              capability: call.capName,
              params: call.params,
              status: requiresApproval ? 'pending_approval' : 'pending',
            });
          }
        }
      });

      saveSession();

      if (requiresApproval) {
        set((state) => {
          state.isStreaming = false;
        });
        return; // Stop execution, wait for user to call executeToolCall
      }

      // Execute all valid tools in parallel (isStreaming stays true for continuous execution and continuation)
      Promise.all(
        validCalls.map(async (call) => {
          try {
            const res = await usePluginStore
              .getState()
              .executeCapability(call.pluginId, call.capName, call.params, messageId);
            const resultStr = typeof res === 'string' ? res : JSON.stringify(res, null, 2);
            set((state) => {
              const assistantMsg = state.messages.find((m) => m.id === messageId);
              if (assistantMsg && assistantMsg.metadata) {
                const c = assistantMsg.metadata.plugin_calls.find(
                  (pc) => pc.capability === call.capName && pc.status === 'pending'
                );
                if (c) {
                  c.status = 'success';
                  c.result =
                    typeof res === 'object' ? (res as Record<string, unknown>) : { value: res };
                }
              }
            });
            if (
              [
                'coder.write_file',
                'coder.apply_diff',
                'coder.apply_patch',
                'coder.revert_file',
                'file.write',
              ].includes(call.capName) &&
              call.params &&
              typeof call.params.path === 'string'
            ) {
              window.dispatchEvent(
                new CustomEvent('weave:file-modified', {
                  detail: { path: call.params.path, capability: call.capName },
                })
              );
              window.dispatchEvent(new Event('weave-fs-refresh'));
            }
            return `Tool ${call.capName} returned:\n${resultStr}`;
          } catch (err) {
            const errorStr = extractError(err);
            toast.error(`Tool ${call.capName} failed: ${errorStr}`);
            set((state) => {
              const assistantMsg = state.messages.find((m) => m.id === messageId);
              if (assistantMsg && assistantMsg.metadata) {
                const c = assistantMsg.metadata.plugin_calls.find(
                  (pc) => pc.capability === call.capName && pc.status === 'pending'
                );
                if (c) {
                  c.status = 'error';
                  c.result = { error: errorStr };
                }
              }
            });
            return `Tool ${call.capName} failed with error:\n${errorStr}`;
          }
        })
      ).then((results) => {
        saveSession();

        const combinedResults = results.join('\n\n');
        const quietUserMsg: ChatMessage = {
          id: generateId(),
          role: 'user',
          content: `${combinedResults}\n\nPlease continue your answer based on these results.`,
          timestamp: Date.now(),
          metadata: { plugin_calls: [], isHidden: true },
        };

        set((state) => {
          state.messages.push(quietUserMsg);
          state.isStreaming = true;
        });

        invoke('chat_send_message', {
          message: quietUserMsg.content,
          model: get().selectedModel,
          provider: get().selectedProvider,
          ui_context: getUiContext(),
          images: [],
        }).catch((err) => {
          const errorStr = extractError(err);
          toast.error(errorStr);
          set((state) => {
            state.isStreaming = false;
            state.error = errorStr;
          });
        });
      });
    },

    executeToolCall: async (messageId: string, capName: string, isApproved: boolean) => {
      const state = get();
      const assistantMsg = state.messages.find((m) => m.id === messageId);
      if (!assistantMsg || !assistantMsg.metadata) return;

      const call = assistantMsg.metadata.plugin_calls.find((c) => c.capability === capName);
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
          const msg = s.messages.find((m) => m.id === messageId);
          if (msg && msg.metadata) {
            const c = msg.metadata.plugin_calls.find((pc) => pc.capability === capName);
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
          metadata: { plugin_calls: [], isHidden: true },
        };
        set((s) => {
          s.messages.push(quietUserMsg);
          s.isStreaming = true;
        });

        invoke('chat_send_message', {
          message: quietUserMsg.content,
          model: get().selectedModel,
          provider: get().selectedProvider,
          ui_context: getUiContext(),
          images: [],
        }).catch((err) => {
          const errorStr = extractError(err);
          toast.error(errorStr);
          set((s) => {
            s.isStreaming = false;
            s.error = errorStr;
          });
        });
        return;
      }

      // Approved! Set to pending and execute
      set((s) => {
        const msg = s.messages.find((m) => m.id === messageId);
        if (msg && msg.metadata) {
          const c = msg.metadata.plugin_calls.find((pc) => pc.capability === capName);
          if (c) c.status = 'pending';
        }
      });
      saveSession();

      usePluginStore
        .getState()
        .executeCapability(call.plugin_id, capName, call.params, messageId)
        .then((res) => {
          const resultStr = typeof res === 'string' ? res : JSON.stringify(res, null, 2);

          set((s) => {
            const msg = s.messages.find((m) => m.id === messageId);
            if (msg && msg.metadata) {
              const c = msg.metadata.plugin_calls.find((pc) => pc.capability === capName);
              if (c) {
                c.status = 'success';
                c.result =
                  typeof res === 'object' ? (res as Record<string, unknown>) : { value: res };
              }
            }
          });
          saveSession();
          if (
            [
              'coder.write_file',
              'coder.apply_diff',
              'coder.apply_patch',
              'coder.revert_file',
              'file.write',
            ].includes(capName) &&
            call.params &&
            typeof call.params.path === 'string'
          ) {
            window.dispatchEvent(
              new CustomEvent('weave:file-modified', {
                detail: { path: call.params.path, capability: capName },
              })
            );
            window.dispatchEvent(new Event('weave-fs-refresh'));
          }

          const quietUserMsg: ChatMessage = {
            id: generateId(),
            role: 'user',
            content: `Tool ${capName} returned:\n${resultStr}\n\nPlease continue your answer based on this result.`,
            timestamp: Date.now(),
            metadata: { plugin_calls: [], isHidden: true },
          };
          set((s) => {
            s.messages.push(quietUserMsg);
            s.isStreaming = true;
          });

          invoke('chat_send_message', {
            message: quietUserMsg.content,
            model: get().selectedModel,
            provider: get().selectedProvider,
            ui_context: getUiContext(),
            images: [],
          }).catch((err) => {
            const errorStr = extractError(err);
            toast.error(errorStr);
            set((s) => {
              s.isStreaming = false;
              s.error = errorStr;
            });
          });
        })
        .catch((err) => {
          const errorStr = extractError(err);
          toast.error(errorStr);
          set((s) => {
            const msg = s.messages.find((m) => m.id === messageId);
            if (msg && msg.metadata) {
              const c = msg.metadata.plugin_calls.find((pc) => pc.capability === capName);
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
            metadata: { plugin_calls: [], isHidden: true },
          };
          set((s) => {
            s.messages.push(quietUserMsg);
            s.isStreaming = true;
          });

          invoke('chat_send_message', {
            message: quietUserMsg.content,
            model: get().selectedModel,
            provider: get().selectedProvider,
            ui_context: getUiContext(),
            images: [],
          }).catch((err) => {
            const errorStr = extractError(err);
            toast.error(errorStr);
            set((s) => {
              s.isStreaming = false;
              s.error = errorStr;
            });
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
