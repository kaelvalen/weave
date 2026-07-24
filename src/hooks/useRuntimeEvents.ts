import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useRuntimeStore } from '@/stores/useRuntimeStore';
import type { ObservabilitySnapshot, RuntimeEvent } from '@/types/runtime';

/** Fetch the observability snapshot on demand and store it. */
export async function refreshObservability() {
  try {
    const snapshot = await invoke<ObservabilitySnapshot>('runtime_get_observability');
    useRuntimeStore.getState().setObservability(snapshot);
  } catch (err) {
    console.warn('Failed to fetch observability snapshot:', err);
  }
}

/**
 * Subscribes to backend `runtime-event` emissions and accumulates them in
 * the runtime store. Mount once at app root.
 */
export function useRuntimeEvents() {
  const pushEvent = useRuntimeStore((s) => s.pushEvent);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    listen<RuntimeEvent>('runtime-event', (event) => {
      pushEvent(event.payload);
    })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch((err) => {
        console.warn('Failed to setup runtime-event listener:', err);
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [pushEvent]);
}
