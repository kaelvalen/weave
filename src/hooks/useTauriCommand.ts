import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

type InvokeArgs = Record<string, unknown>;

export function useTauriCommand<T>(command: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async (args?: InvokeArgs) => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<T>(command, args || {});
      setData(result);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [command]);

  return { data, loading, error, execute };
}
