import { describe, expect, it } from 'vitest';
import {
  DESTRUCTIVE_CAPS,
  SENSITIVE_CAPS,
  isDestructiveCapability,
  isSensitiveCapability,
  requiresApproval,
} from './capabilities';

/**
 * Frontend mirror semantics — the classification here is display-only
 * (backend capability_policy.rs is the source of truth; a CI test in
 * capability_policy.rs keeps the two in lockstep), but the badge/filter
 * behavior must stay correct.
 */

describe('requiresApproval (mirror of capability_policy.rs)', () => {
  it('gates destructive capabilities', () => {
    for (const cap of ['file.write', 'file.delete', 'shell.exec', 'coder.apply_diff']) {
      expect(requiresApproval(cap), cap).toBe(true);
      expect(isDestructiveCapability(cap), cap).toBe(true);
    }
  });

  it('gates sensitive capabilities', () => {
    for (const cap of ['file.read', 'web.fetch', 'db.query', 'coder.read_file']) {
      expect(requiresApproval(cap), cap).toBe(true);
      expect(isSensitiveCapability(cap), cap).toBe(true);
    }
  });

  it('does not gate benign capabilities', () => {
    for (const cap of ['calc.eval', 'sys.time', 'note.create']) {
      expect(requiresApproval(cap), cap).toBe(false);
    }
  });

  it('does not gate unknown capabilities', () => {
    expect(requiresApproval('totally.made_up')).toBe(false);
  });

  it('has no overlap between the destructive and sensitive sets', () => {
    for (const cap of DESTRUCTIVE_CAPS) {
      expect(SENSITIVE_CAPS.has(cap), cap).toBe(false);
    }
  });
});
