import { useEffect, useRef, useCallback } from 'react';
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

    const setupListener = async () => {
      try {
        const unlisten = await listen<StreamChunk>('chat-stream-chunk', (event) => {
          if (!mounted) return;
          const { chunk, message_id, done } = event.payload;
          
          if (!done) {
            useChatStore.getState().appendChunk(chunk, message_id);
          } else {
            useChatStore.getState().finalizeMessage(message_id);
          }
        });

        unlistenRef.current = unlisten;
      } catch (err) {
        console.warn('Failed to setup stream listener:', err);
      }
    };

    setupListener();

    return () => {
      mounted = false;
      if (unlistenRef.current) {
        unlistenRef.current();
      }
    };
  }, []);
}
