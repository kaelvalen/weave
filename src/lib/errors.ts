/**
 * Extract a human-readable error message from an unknown thrown value.
 * Handles strings, Error instances, Tauri error objects, and plain objects
 * with a string `error` or `message` property.
 */
export function extractError(
  err: unknown,
  fallback = 'An unexpected error occurred'
): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;

  if (typeof err === 'object' && err !== null) {
    const e = err as Record<string, unknown>;

    if (typeof e.message === 'string') return e.message;
    if (typeof e.error === 'string') return e.error;

    // Tauri sometimes serializes Rust enums as { Variant: "msg" }
    // or { Variant: { message | error | reason: "..." } }.
    const keys = Object.keys(e);
    if (keys.length === 1) {
      const val = e[keys[0]];
      if (typeof val === 'string') return val;
      if (typeof val === 'object' && val !== null) {
        const v = val as Record<string, unknown>;
        if (typeof v.message === 'string') return v.message;
        if (typeof v.error === 'string') return v.error;
        if (typeof v.reason === 'string') return v.reason;
      }
    }
  }

  return fallback;
}
