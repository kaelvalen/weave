import { useEffect } from 'react';
import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { refreshObservability } from '@/hooks/useRuntimeEvents';
import type { ModelStats } from '@/types/runtime';

/** Mirrors `SystemStats` in src-tauri/src/commands/models.rs (RAM in bytes). */
export interface SystemStats {
  cpu_usage: number;
  ram_usage: number;
  ram_total: number;
}

interface PulseState {
  sysStats: SystemStats | null;
  modelStats: ModelStats | null;
  refresh: () => void;
}

export const usePulseStore = create<PulseState>((set) => ({
  sysStats: null,
  modelStats: null,
  // Best-effort: on failure keep the previous values.
  refresh: () => {
    refreshObservability();
    invoke<SystemStats>('get_system_stats')
      .then((sysStats) => set({ sysStats }))
      .catch(() => {});
    invoke<ModelStats>('runtime_get_model_stats')
      .then((modelStats) => set({ modelStats }))
      .catch(() => {});
  },
}));

let pulseStarted = false;

/**
 * Shared system pulse: one app-lifetime 15s poll for system + model stats,
 * consumed by the TopNav ambient indicator and the StatusBar.
 */
export function useSystemPulse() {
  useEffect(() => {
    if (pulseStarted) return;
    pulseStarted = true;
    usePulseStore.getState().refresh();
    setInterval(() => usePulseStore.getState().refresh(), 15000);
  }, []);

  return usePulseStore();
}
