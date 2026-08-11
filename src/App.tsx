import { useEffect } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { usePluginStore } from '@/stores/usePluginStore';
import { useApprovalModeStore } from '@/stores/useApprovalModeStore';
import { useRuntimeEvents } from '@/hooks/useRuntimeEvents';
import { maybeWarnAboutBypassedGate } from '@/lib/approvalReminder';
import { TopNav } from '@/components/layout/TopNav';
import { Workspace } from '@/components/layout/Workspace';
import { WorkspaceSidebar } from '@/components/layout/WorkspaceSidebar';
import { CommandPalette } from '@/components/ui/CommandPalette';
import { invoke } from '@tauri-apps/api/core';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ThemeProvider } from '@/components/layout/ThemeProvider';

function App() {
  const { setReady, setVersion } = useAppStore();
  const isLeftSidebarOpen = useAppStore((s) => s.isLeftSidebarOpen);

  // Accumulate structured runtime events from app start.
  useRuntimeEvents();

  useEffect(() => {
    invoke<string>('system_get_version')
      .then((v) => setVersion(v))
      .catch(console.error);

    usePluginStore.getState().discoverPlugins();

    // Persisted approval mode from a previous session: the gate is silently
    // off — surface it once, prominently, with an action to switch back.
    maybeWarnAboutBypassedGate(
      () => useApprovalModeStore.getState().mode,
      (mode) => useApprovalModeStore.getState().setMode(mode)
    );

    setReady(true);
  }, [setReady, setVersion]);

  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={200}>
        <div className="app-shell h-screen w-screen flex flex-col bg-transparent text-foreground overflow-hidden">
          <TopNav />
          <div className="flex-1 flex min-h-0">
            {isLeftSidebarOpen && <WorkspaceSidebar />}
            <Workspace />
          </div>
          <CommandPalette />
          <Toaster position="bottom-right" />
        </div>
      </TooltipProvider>
    </ThemeProvider>
  );
}

export default App;
