import { useEffect } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { usePluginStore } from '@/stores/usePluginStore';
import { TopNav } from '@/components/layout/TopNav';
import { Workspace } from '@/components/layout/Workspace';
import { CommandPalette } from '@/components/ui/CommandPalette';
import { invoke } from '@tauri-apps/api/core';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

function App() {
  const { theme, setReady, setVersion } = useAppStore();

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else if (theme === 'light') {
      root.classList.remove('dark');
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (prefersDark) {
        root.classList.add('dark');
      }
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      if (useAppStore.getState().theme === 'system') {
        if (e.matches) {
          root.classList.add('dark');
        } else {
          root.classList.remove('dark');
        }
      }
    };
    mediaQuery.addEventListener('change', handleChange);

    invoke<string>('system_get_version')
      .then((v) => setVersion(v))
      .catch(console.error);

    usePluginStore.getState().discoverPlugins();

    setReady(true);

    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, [theme, setReady, setVersion]);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="h-screen w-screen flex flex-col bg-background text-foreground overflow-hidden">
        <TopNav />
        <Workspace />
        <CommandPalette />
        <Toaster position="bottom-right" />
      </div>
    </TooltipProvider>
  );
}

export default App;
