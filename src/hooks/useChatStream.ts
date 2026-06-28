import { useEffect, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useChatStore } from '@/stores/useChatStore';

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
        const unlisten = await listen<StreamChunk>('chat-stream-chunk', (event) => {
          if (!mounted) return;
          const { chunk, message_id, done } = event.payload;
          
          if (!done) {
            chunkBuffer += chunk;
            lastMessageId = message_id;
          } else {
            flush();
            useChatStore.getState().finalizeMessage(message_id);
          }
        });

        unlistenRef.current = unlisten;
        
        // Flush buffer every 60ms to optimize React re-renders (approx 16fps)
        flushInterval = setInterval(flush, 60);
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
