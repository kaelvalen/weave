import { useEffect } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { usePluginStore } from '@/stores/usePluginStore';
import { TopNav } from '@/components/layout/TopNav';
import { Workspace } from '@/components/layout/Workspace';
import { CommandPalette } from '@/components/ui/CommandPalette';
import { invoke } from '@tauri-apps/api/core';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ThemeProvider } from '@/components/layout/ThemeProvider';

function App() {
  const { setReady, setVersion } = useAppStore();

  useEffect(() => {

    invoke<string>('system_get_version')
      .then((v) => setVersion(v))
      .catch(console.error);

    usePluginStore.getState().discoverPlugins();

    setReady(true);
  }, [setReady, setVersion]);

  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={200}>
        <div className="h-screen w-screen flex flex-col bg-transparent text-foreground overflow-hidden">
          <TopNav />
          <Workspace />
          <CommandPalette />
          <Toaster position="bottom-right" />
        </div>
      </TooltipProvider>
    </ThemeProvider>
  );
}

export default App;
