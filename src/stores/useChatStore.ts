import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { invoke } from '@tauri-apps/api/core';
import type { ChatMessage } from '@/types/chat';

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  selectedModel: string;
  error: string | null;
  conversationId: string;

  sendMessage: (content: string) => Promise<void>;
  appendChunk: (chunk: string, messageId: string) => void;
  finalizeMessage: (messageId: string) => void;
  clearChat: () => void;
  setModel: (model: string) => void;
  setError: (error: string | null) => void;
  loadHistory: () => Promise<void>;
}

const generateId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export const useChatStore = create<ChatState>()(
  immer((set, get) => ({
    messages: [],
    isStreaming: false,
    selectedModel: 'gpt-4o-mini',
    error: null,
    conversationId: generateId(),

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
        });

        set((state) => {
          state.isStreaming = false;
        });
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

    finalizeMessage: (_messageId: string) => {
      set((state) => {
        state.isStreaming = false;
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
        console.error('Failed to clear chat:', err);
        set((state) => {
          state.messages = [];
          state.conversationId = generateId();
        });
      }
    },

    setModel: (model: string) => {
      set((state) => {
        state.selectedModel = model;
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
            state.messages = history;
          });
        }
      } catch (err) {
        console.warn('Failed to load chat history:', err);
      }
    },
  }))
);
