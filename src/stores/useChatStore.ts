import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { invoke } from '@tauri-apps/api/core';
import type { ChatMessage } from '@/types/chat';
import { usePluginStore } from './usePluginStore';

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  selectedModel: string;
  selectedProvider: string;
  error: string | null;
  conversationId: string;
  conversationTitle: string;
  sessions: { id: string; title: string; updated_at: number }[];

  sendMessage: (content: string) => Promise<void>;
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

    sendMessage: async (content: string) => {
      const state = get();
      if (state.isStreaming || !content.trim()) return;

      const userMessage: ChatMessage = {
        id: generateId(),
        role: 'user',
        content: content.trim(),
        timestamp: Date.now(),
      };

      set((state) => {
        state.messages.push(userMessage);
        state.isStreaming = true;
        state.error = null;
      });

      try {
        await invoke('chat_send_message', {
          message: content.trim(),
          model: get().selectedModel,
          provider: get().selectedProvider,
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
                set((state) => { state.isStreaming = false; state.error = String(err); });
              });
            })
            .catch(err => {
              const errorStr = String(err);
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
        await invoke('chat_clear_history');
        // A smarter backend would accept history replacement, but for now we just use the store
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
  }))
);
