import { EditorView } from '@codemirror/view';
import { vscodeDark, vscodeLight } from '@uiw/codemirror-theme-vscode';

export const weaveEditorTheme = EditorView.theme({
  "&": {
    color: "hsl(var(--foreground))",
    backgroundColor: "transparent",
    height: "100%",
  },
  ".cm-content": {
    caretColor: "hsl(var(--foreground))",
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  },
  "&.cm-focused .cm-cursor": {
    borderLeftColor: "hsl(var(--foreground))",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "hsl(var(--muted))",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "hsl(var(--muted-foreground))",
    borderRight: "1px solid transparent",
  },
  ".cm-activeLine": {
    backgroundColor: "hsl(var(--muted) / 0.5)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "hsl(var(--foreground))",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "transparent",
    border: "none",
    color: "hsl(var(--muted-foreground))"
  },
  ".cm-tooltip": {
    border: "1px solid hsl(var(--border))",
    backgroundColor: "hsl(var(--card))",
    color: "hsl(var(--foreground))",
  },
  ".cm-tooltip-autocomplete": {
    "& > ul > li[aria-selected]": {
      backgroundColor: "hsl(var(--muted))",
      color: "hsl(var(--foreground))"
    }
  }
});

// We combine the base VSCode dark/light syntax highlighting with our custom structural overrides
export const getWeaveTheme = (isDark: boolean) => {
  // Use the appropriate base theme for syntax highlighting tokens,
  // and our custom weaveEditorTheme to override backgrounds/gutters/selection to match Weave precisely.
  return [isDark ? vscodeDark : vscodeLight, weaveEditorTheme];
};
