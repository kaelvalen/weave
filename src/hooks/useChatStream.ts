import { useEffect, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useChatStore } from '@/stores/useChatStore';
import type { ToolCallDetected, QuestionsAskedPayload } from '@/types/chat';

interface StreamChunk {
  chunk: string;
  message_id: string;
  done: boolean;
}

interface ReasoningChunk {
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
        const unlistenTools = await listen<ToolCallDetected>('chat-tool-call-detected', (event) => {
          if (!mounted) return;
          useChatStore.getState().handleToolCallEvent(event.payload);
        });

        // Reasoning/thinking trace from reasoning families (DeepSeek,
        // Qwen3, Kimi, thinking-enabled Claude) — streamed before content.
        const unlistenReasoning = await listen<ReasoningChunk>('chat-reasoning-chunk', (event) => {
          if (!mounted) return;
          const { chunk, message_id, done } = event.payload;
          useChatStore.getState().handleReasoningChunk(chunk, message_id, done);
        });

        // Human-in-the-loop clarifying questions — the loop paused its turn
        // until the user answers (chat_submit_answers).
        const unlistenQuestions = await listen<QuestionsAskedPayload>(
          'chat-questions-asked',
          (event) => {
            if (!mounted) return;
            useChatStore.getState().handleQuestionsAsked(event.payload);
          }
        );

        unlistenRef.current = () => {
          unlistenChunks();
          unlistenTools();
          unlistenReasoning();
          unlistenQuestions();
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
