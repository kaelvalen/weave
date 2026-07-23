import { useAppStore } from '@/stores/useAppStore';
import { ChatCommandCenter } from '@/components/chat/ChatCommandCenter';
import { PluginMarket } from '@/components/plugins/PluginMarket';
import { SettingsPanel } from '@/components/settings/SettingsPanel';
import { NotesManager } from '@/components/notes/NotesManager';
import { FileManager } from '@/components/files/FileManager';
import { StatusBar } from '@/components/layout/StatusBar';
import { KnowledgeBase } from '@/components/knowledge/KnowledgeBase';
import { LocalModels } from '@/components/models/LocalModels';
import { Workflows } from '@/components/workflows/Workflows';
import { Canvas } from '@/components/canvas/Canvas';
import { ProfilePanel } from '@/components/profile/ProfilePanel';
import { useEffect } from 'react';

export function Workspace() {
  const { activeView } = useAppStore();

  const renderView = () => {
    switch (activeView) {
      case 'chat':
        return <ChatCommandCenter />;
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
      case 'knowledge':
        return <KnowledgeBase />;
      case 'models':
        return <LocalModels />;
      case 'workflows':
        return <Workflows />;
      case 'canvas':
        return <Canvas />;
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
