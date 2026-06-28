import { useEffect, ReactNode } from 'react';
import { useThemeStore } from '@/stores/useThemeStore';
import { hexToHslString } from '@/lib/utils';

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const { mode, lightThemeId, darkThemeId, themes, deleteTheme } = useThemeStore();
  
  // Resolve actual mode (system to light/dark)
  const isSystemDark = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)').matches : false;
  const isDark = mode === 'system' ? isSystemDark : mode === 'dark';
  const activeThemeId = isDark ? darkThemeId : lightThemeId;
  const activeTheme = themes.find((t) => t.id === activeThemeId) || themes[0];

  // Purge legacy ocean-dark theme
  useEffect(() => {
    if (themes.some((t) => t.id === 'ocean-dark')) {
      deleteTheme('ocean-dark');
    }
  }, [themes, deleteTheme]);

  useEffect(() => {
    const root = document.documentElement;

    const applyMode = (dark: boolean) => {
      if (dark) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
    };

    if (mode === 'system') {
      applyMode(window.matchMedia('(prefers-color-scheme: dark)').matches);

      const handleChange = (e: MediaQueryListEvent) => {
        if (useThemeStore.getState().mode === 'system') {
          applyMode(e.matches);
        }
      };
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    } else {
      applyMode(mode === 'dark');
    }
  }, [mode]);

  // Inject Custom Colors
  useEffect(() => {
    const root = document.documentElement;
    if (activeTheme) {
      Object.entries(activeTheme.colors).forEach(([key, hexValue]) => {
        const hslValue = hexToHslString(hexValue);
        root.style.setProperty(`--${key}`, hslValue);
      });
      
      // Inject structural variables (with fallbacks for legacy themes)
      root.style.setProperty('--radius', activeTheme.borderRadius || '0.5rem');
      root.style.setProperty('--border-width', activeTheme.borderWidth || '1px');
      root.style.setProperty('--font-family', activeTheme.fontFamily || 'Inter');
    }
  }, [activeTheme]);

  return (
    <>
      {/* Background layer */}
      <div 
        className="fixed inset-0 -z-50 transition-colors duration-300"
        style={{
          backgroundColor: `hsl(var(--background))`,
          backgroundImage: activeTheme?.backgroundImage ? `url(${activeTheme.backgroundImage})` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      />
      {/* Main app content */}
      {children}
    </>
  );
}
