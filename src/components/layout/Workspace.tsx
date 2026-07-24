import { useAppStore } from '@/stores/useAppStore';
import { ChatCommandCenter } from '@/components/chat/ChatCommandCenter';
import { PluginMarket } from '@/components/plugins/PluginMarket';
import { SettingsPanel } from '@/components/settings/SettingsPanel';
import { NotesManager } from '@/components/notes/NotesManager';
import { FileManager } from '@/components/files/FileManager';
import { StatusBar } from '@/components/layout/StatusBar';
import { LocalModels } from '@/components/models/LocalModels';
import { ProfilePanel } from '@/components/profile/ProfilePanel';
import { ExecutionView } from '@/components/execution/ExecutionView';
import { CapabilitiesView } from '@/components/capabilities/CapabilitiesView';
import { ArtifactsView } from '@/components/artifacts/ArtifactsView';
import { MemoryView } from '@/components/memory/MemoryView';
import { useEffect } from 'react';

export function Workspace() {
  const { activeView } = useAppStore();

  const renderView = () => {
    switch (activeView) {
      case 'chat':
        return <ChatCommandCenter />;
      case 'execution':
        return <ExecutionView />;
      case 'artifacts':
        return <ArtifactsView />;
      case 'memory':
        return <MemoryView />;
      case 'capabilities':
        return <CapabilitiesView />;
      case 'plugins':
        return <PluginMarket />;
      case 'settings':
        return <SettingsPanel />;
      case 'profile':
        return <ProfilePanel />;
      case 'files':
        return <FileManager />;
      case 'notes':
        return <NotesManager />;
      case 'models':
        return <LocalModels />;
      default:
        return <FileManager />;
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        useAppStore.getState().toggleChat();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <main className="flex-1 flex flex-col min-w-0 bg-background overflow-hidden relative">
      {/* View Area */}
      <div className="flex-1 min-h-0 overflow-hidden relative view-transition">{renderView()}</div>

      {/* StatusBar */}
      <StatusBar />
    </main>
  );
}
