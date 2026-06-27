import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { invoke } from '@tauri-apps/api/core';
import type { ChatMessage } from '@/types/chat';
import { usePluginStore } from './usePluginStore';
import { useAppStore } from './useAppStore';

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
          }).catch(console.error);
          
          store.listSessions();
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
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
      // We must first update the session backend state before sending a new message.
      // Wait! `chat_send_message` appends to whatever is in `SESSION_STATE`.
      // If we truncate frontend, we MUST tell the backend to truncate too.
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
          }).catch(console.error);
        }
      } catch (err) {
        let errorMsg = String(err);
        if (typeof err === 'object' && err !== null && !(err instanceof Error)) {
          const key = Object.keys(err)[0];
          if (key && typeof (err as any)[key] === 'string') errorMsg = `${key}: ${(err as any)[key]}`;
          else errorMsg = JSON.stringify(err);
        } else if (err instanceof Error) {
          errorMsg = err.message;
        }
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
          }).catch(console.error);
        }
      } catch (err) {
        let errorMsg = String(err);
        if (typeof err === 'object' && err !== null && !(err instanceof Error)) {
          const key = Object.keys(err)[0];
          if (key && typeof (err as any)[key] === 'string') errorMsg = `${key}: ${(err as any)[key]}`;
          else errorMsg = JSON.stringify(err);
        } else if (err instanceof Error) {
          errorMsg = err.message;
        }
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
      
      // AI Function Calling Interception
      const msg = get().messages.find(m => m.id === messageId);
      if (msg && msg.role === 'assistant') {
        let capName: string | null = null;
        let paramsStr = '';
        let matchedText = '';

        // 1. Try to match <call> tag
        const xmlMatch = msg.content.match(/<call plugin="([^"]+)">([\s\S]*?)<\/call>/);
        if (xmlMatch) {
          capName = xmlMatch[1];
          paramsStr = xmlMatch[2];
          matchedText = xmlMatch[0];
        } else {
          // 2. Fallback: Check if the AI outputted raw JSON that looks like a tool call
          // Some models (like opencode ones) might output pure JSON instead of the <call> tag.
          const jsonMatch = msg.content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              const parsed = JSON.parse(jsonMatch[0]);
              // Heuristic to detect which tool it is
              if (typeof parsed.url === 'string') {
                capName = 'web.fetch';
                paramsStr = jsonMatch[0];
                matchedText = jsonMatch[0];
              } else if (typeof parsed.title === 'string' && typeof parsed.content === 'string') {
                capName = 'note.create';
                paramsStr = jsonMatch[0];
                matchedText = jsonMatch[0];
              } else if (typeof parsed.expression === 'string') {
                capName = 'calc.eval';
                paramsStr = jsonMatch[0];
                matchedText = jsonMatch[0];
              } else if (typeof parsed.command === 'string') {
                capName = 'shell.exec';
                paramsStr = jsonMatch[0];
                matchedText = jsonMatch[0];
              } else if (typeof parsed.query === 'string' && parsed.query.toLowerCase().startsWith('select')) {
                capName = 'db.query';
                paramsStr = jsonMatch[0];
                matchedText = jsonMatch[0];
              } else if (typeof parsed.directory === 'string' && typeof parsed.pattern === 'string') {
                capName = 'file.search';
                paramsStr = jsonMatch[0];
                matchedText = jsonMatch[0];
              } else if (typeof parsed.directory === 'string') {
                capName = 'file.list';
                paramsStr = jsonMatch[0];
                matchedText = jsonMatch[0];
              } else if (typeof parsed.path === 'string') {
                capName = parsed.content ? 'file.write' : 'file.read';
                paramsStr = jsonMatch[0];
                matchedText = jsonMatch[0];
              }
            } catch (e) {
              // Not a valid JSON, ignore
            }
          }
        }

        if (capName) {
          const pluginStore = usePluginStore.getState();
          const pluginId = pluginStore.getPluginIdForCapability(capName);
          
          if (!pluginId) {
            console.error(`No plugin found providing capability: ${capName}`);
            // Fallback to error message
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
            return;
          }
          
          let params = {};
          try {
            let cleanParamsStr = (paramsStr || '{}').trim();
            if (cleanParamsStr.startsWith('```json')) {
              cleanParamsStr = cleanParamsStr.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
            } else if (cleanParamsStr.startsWith('```')) {
              cleanParamsStr = cleanParamsStr.replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
            }
            params = JSON.parse(cleanParamsStr);
          } catch (e) {
            console.error('Failed to parse plugin params', e);
          }
          
          // Remove the matched tool call from the assistant's message so it doesn't show in UI as raw text
          set((state) => {
            const assistantMsg = state.messages.find(m => m.id === messageId);
            if (assistantMsg) {
              assistantMsg.content = assistantMsg.content.replace(matchedText, '').trim();
            }
          });
          
          // Attach tool call to assistant message
          set((state) => {
            const assistantMsg = state.messages.find(m => m.id === messageId);
            if (assistantMsg) {
              if (!assistantMsg.metadata) assistantMsg.metadata = { plugin_calls: [] };
              assistantMsg.metadata.plugin_calls.push({
                plugin_id: pluginId,
                capability: capName!,
                params: params as Record<string, unknown>,
                status: 'pending'
              });
            }
          });
          
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
                let errorStr = String(err);
                if (typeof err === 'object' && err !== null) {
                  const key = Object.keys(err)[0];
                  if (key && typeof (err as any)[key] === 'string') errorStr = `${key}: ${(err as any)[key]}`;
                  else errorStr = JSON.stringify(err);
                }
                set((state) => { state.isStreaming = false; state.error = errorStr; });
              });
            })
            .catch(err => {
              let errorStr = String(err);
              if (typeof err === 'object' && err !== null) {
                const key = Object.keys(err)[0];
                if (key && typeof (err as any)[key] === 'string') errorStr = `${key}: ${(err as any)[key]}`;
                else errorStr = JSON.stringify(err);
              }
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
                set((state) => { state.isStreaming = false; state.error = String(err); });
              });
            });
        }
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
        console.error('Failed to clear chat:', err);
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
        console.warn('Failed to load chat history:', err);
      }
    },
    
    listSessions: async () => {
      try {
        const sessions: any[] = await invoke('chat_list_sessions');
        set((state) => { state.sessions = sessions; });
      } catch (err) {
        console.error('Failed to list sessions', err);
      }
    },
    
    loadSession: async (id: string) => {
      try {
        const session: any = await invoke('chat_load_session', { id });
        set((state) => {
          state.conversationId = session.id;
          state.conversationTitle = session.title;
          state.messages = session.messages;
          state.error = null;
        });
        // Restore backend history to match session
        await invoke('chat_set_history', { history: session.messages });
      } catch (err) {
        console.error('Failed to load session', err);
        set((state) => { state.error = `Failed to load session: ${err}`; });
      }
    },
    
    startNewSession: async () => {
      await invoke('chat_clear_history').catch(console.error);
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
        console.error('Failed to delete session', err);
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
        console.error('Failed to update session metadata:', err);
      }
    },
  }))
);
