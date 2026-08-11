import { beforeEach, describe, expect, it } from 'vitest';
import { defaultThemes, useThemeStore, type CustomTheme } from './useThemeStore';

/**
 * Phase-7 #10 regression: deleting a custom theme must not leave the app
 * pointing at a removed theme — the store falls back to defaults, and the
 * Settings panel now confirms the delete before calling it.
 */

function customTheme(id: string, name: string): CustomTheme {
  return {
    id,
    name,
    colors: {
      background: '#ffffff',
      foreground: '#111111',
      primary: '#6d28d9',
      card: '#ffffff',
      border: '#e5e7eb',
    },
    backgroundImage: null,
    borderRadius: '0.5rem',
    borderWidth: '1px',
    fontFamily: 'Inter',
  };
}

describe('deleteTheme (Phase-7 #10)', () => {
  beforeEach(() => {
    useThemeStore.setState({
      mode: 'system',
      themes: defaultThemes,
      lightThemeId: 'default-light',
      darkThemeId: 'default-dark',
    });
  });

  it('removes the theme and falls back to defaults when it was active', () => {
    const custom = customTheme('custom-test', 'Custom Test');
    useThemeStore.getState().addTheme(custom);
    useThemeStore.getState().setLightThemeId(custom.id);

    expect(useThemeStore.getState().lightThemeId).toBe(custom.id);

    useThemeStore.getState().deleteTheme(custom.id);

    const after = useThemeStore.getState();
    expect(after.themes.find((t) => t.id === custom.id)).toBeUndefined();
    expect(after.lightThemeId).toBe('default-light');
  });

  it('leaves a different active theme untouched', () => {
    const custom = customTheme('custom-other', 'Custom Other');
    useThemeStore.getState().addTheme(custom);
    useThemeStore.getState().setDarkThemeId(custom.id);

    useThemeStore.getState().deleteTheme(custom.id);

    expect(useThemeStore.getState().darkThemeId).toBe('default-dark');
  });
});
