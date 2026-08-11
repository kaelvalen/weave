export interface CursorPos {
  line: number;
  col: number;
}

/** Visible line range, 1-based (from CM6 viewport.from/to + 1). */
export interface ViewportRange {
  from: number;
  to: number;
}

/**
 * Status-bar readout (Phase-7 #6): the cursor tracks the real selection and
 * is never moved by scrolling; when the cursor has scrolled out of the
 * visible viewport, the bar shows the first visible line instead — so the
 * readout never contradicts what the user actually sees.
 */
export function cursorReadout(cursor: CursorPos, viewport: ViewportRange): string {
  const cursorVisible = cursor.line >= viewport.from && cursor.line <= viewport.to;
  if (cursorVisible) {
    return `Ln ${cursor.line}, Col ${cursor.col}`;
  }
  return `Ln ${viewport.from} · view`;
}
