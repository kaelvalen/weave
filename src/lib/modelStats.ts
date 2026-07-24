import type { ModelStats } from '@/types/runtime';

/**
 * Normalize a model identifier for tolerant matching across sources:
 * local files ("llama3-8b.Q4_K_M.gguf"), Ollama tags ("llama3:latest"),
 * and user-facing aliases ("llama3").
 */
export function normalizeModelName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\.gguf$/, '')
    .replace(/:latest$/, '');
}

/** Tolerant equality: exact after normalization, or one side contains the other. */
export function modelNamesMatch(a: string, b: string): boolean {
  const na = normalizeModelName(a);
  const nb = normalizeModelName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/** Find the loaded-model entry (from `runtime_get_model_stats`) matching a model name. */
export function findLoadedModel(
  stats: ModelStats | null,
  name: string
): { name: string; vram_bytes: number | null } | undefined {
  return stats?.loaded_models.find((m) => modelNamesMatch(m.name, name));
}

/** Whether the given name is the runtime's currently active model. */
export function isActiveModel(stats: ModelStats | null, name: string): boolean {
  return stats?.active_model != null && modelNamesMatch(stats.active_model, name);
}

/** Prefer the session average rate; fall back to the last measured one. */
export function effectiveTps(stats: ModelStats | null): number | null {
  if (!stats) return null;
  return stats.avg_tps ?? stats.last_tps;
}

/** 12345 → "12.3k", 999 → "999". */
export function formatTokensCompact(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

/** 41.37 → "41", 7.42 → "7.4". */
export function formatTps(tps: number): string {
  return tps >= 10 ? String(Math.round(tps)) : tps.toFixed(1);
}

/** Context lengths render in decimal k: 65536 → "65k". */
export function formatContextLength(contextLength: number): string {
  if (contextLength >= 1000) return `${Math.floor(contextLength / 1000)}k`;
  return String(contextLength);
}

/** Bytes → "7.3GB". */
export function formatVram(bytes: number): string {
  return `${(bytes / 1_073_741_824).toFixed(1)}GB`;
}
