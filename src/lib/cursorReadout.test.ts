import { describe, expect, it } from 'vitest';
import { cursorReadout } from './cursorReadout';

describe('cursorReadout (Phase-7 #6)', () => {
  it('shows the real cursor position while it is visible', () => {
    expect(cursorReadout({ line: 1, col: 1 }, { from: 1, to: 40 })).toBe('Ln 1, Col 1');
    expect(cursorReadout({ line: 3, col: 5 }, { from: 1, to: 40 })).toBe('Ln 3, Col 5');
  });

  it('includes boundary lines of the viewport', () => {
    expect(cursorReadout({ line: 1, col: 1 }, { from: 1, to: 1 })).toBe('Ln 1, Col 1');
    expect(cursorReadout({ line: 40, col: 1 }, { from: 1, to: 40 })).toBe('Ln 40, Col 1');
  });

  it('reflects the first visible line when the cursor scrolled out of view', () => {
    // Cursor never moved (still 1,1), but the viewport now starts at line 64.
    expect(cursorReadout({ line: 1, col: 1 }, { from: 64, to: 104 })).toBe('Ln 64 · view');
    // Cursor below the viewport.
    expect(cursorReadout({ line: 200, col: 1 }, { from: 1, to: 40 })).toBe('Ln 1 · view');
  });
});
