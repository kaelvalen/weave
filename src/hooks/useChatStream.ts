import { useEffect, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useChatStore } from '@/stores/useChatStore';
import type { ToolCallDetected } from '@/types/chat';

interface StreamChunk {
  chunk: string;
  message_id: string;
  done: boolean;
}

export function useChatStream() {
  const unlistenRef = useRef<UnlistenFn | null>(null);

  useEffect(() => {
    let mounted = true;
    let chunkBuffer = '';
    let lastMessageId = '';
    let flushInterval: ReturnType<typeof setInterval>;

    const flush = () => {
      if (chunkBuffer && lastMessageId) {
        useChatStore.getState().appendChunk(chunkBuffer, lastMessageId);
        chunkBuffer = '';
      }
    };

    const setupListener = async () => {
      try {
        const unlistenChunks = await listen<StreamChunk>('chat-stream-chunk', (event) => {
          if (!mounted) return;
          const { chunk, message_id, done } = event.payload;

          if (chunk) {
            chunkBuffer += chunk;
            lastMessageId = message_id;
          }
          if (done) {
            flush();
            useChatStore.getState().finalizeMessage();
          }
        });

        // Backend agent-loop tool-call lifecycle (native tool-calling).
        // The backend owns execution + the approval gate; the store only
        // mirrors events for rendering.
        const unlistenTools = await listen<ToolCallDetected>(
          'chat-tool-call-detected',
          (event) => {
            if (!mounted) return;
            useChatStore.getState().handleToolCallEvent(event.payload);
          }
        );

        unlistenRef.current = () => {
          unlistenChunks();
          unlistenTools();
        };

        // Flush buffer every 35ms (~30fps) for silky smooth typing animations
        flushInterval = setInterval(flush, 35);
      } catch (err) {
        console.warn('Failed to setup stream listener:', err);
      }
    };

    setupListener();

    return () => {
      mounted = false;
      clearInterval(flushInterval);
      if (unlistenRef.current) {
        unlistenRef.current();
      }
    };
  }, []);
}
