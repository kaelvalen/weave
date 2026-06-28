import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ThemeMode } from '@/types/app';

export type BorderRadius = '0rem' | '0.25rem' | '0.5rem' | '0.75rem' | '1rem' | '1.5rem';
export type BorderWidth = '0px' | '1px' | '2px';
export type FontFamily = 'Inter' | 'Roboto' | 'JetBrains Mono' | 'system-ui';

export interface ThemeColors {
  background: string; // HEX
  foreground: string;
  primary: string;
  card: string;
  border: string;
}

export interface CustomTheme {
  id: string;
  name: string;
  colors: ThemeColors;
  backgroundImage: string | null;
  borderRadius: BorderRadius;
  borderWidth: BorderWidth;
  fontFamily: FontFamily;
}

export const defaultThemes: CustomTheme[] = [
  {
    id: 'default-light',
    name: 'Default Light',
    colors: {
      background: '#ffffff',
      foreground: '#171717',
      primary: '#171717',
      card: '#ffffff',
      border: '#e5e5e5',
    },
    backgroundImage: null,
    borderRadius: '0.5rem',
    borderWidth: '1px',
    fontFamily: 'Inter',
  },
  {
    id: 'default-dark',
    name: 'Default Dark',
    colors: {
      background: '#0a0a0a',
      foreground: '#ededed',
      primary: '#ededed',
      card: '#0a0a0a',
      border: '#242424',
    },
    backgroundImage: null,
    borderRadius: '0.5rem',
    borderWidth: '1px',
    fontFamily: 'Inter',
  },
];

interface ThemeState {
  mode: ThemeMode;
  themes: CustomTheme[];
  lightThemeId: string;
  darkThemeId: string;

  setMode: (mode: ThemeMode) => void;
  addTheme: (theme: CustomTheme) => void;
  updateTheme: (id: string, theme: Partial<CustomTheme>) => void;
  deleteTheme: (id: string) => void;
  setLightThemeId: (id: string) => void;
  setDarkThemeId: (id: string) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      mode: 'system',
      themes: defaultThemes,
      lightThemeId: 'default-light',
      darkThemeId: 'default-dark',

      setMode: (mode) => set({ mode }),
      addTheme: (theme) => set((state) => ({ themes: [...state.themes, theme] })),
      updateTheme: (id, updates) => set((state) => ({
        themes: state.themes.map((t) => t.id === id ? { ...t, ...updates } : t)
      })),
      deleteTheme: (id) => set((state) => ({
        themes: state.themes.filter((t) => t.id !== id),
        lightThemeId: state.lightThemeId === id ? defaultThemes[0].id : state.lightThemeId,
        darkThemeId: state.darkThemeId === id ? defaultThemes[1].id : state.darkThemeId,
      })),
      setLightThemeId: (id) => set({ lightThemeId: id }),
      setDarkThemeId: (id) => set({ darkThemeId: id }),
    }),
    {
      name: 'weave-theme-settings',
    }
  )
);
