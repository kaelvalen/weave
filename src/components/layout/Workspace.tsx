import { useAppStore } from '@/stores/useAppStore';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { PluginMarket } from '@/components/plugins/PluginMarket';
import { SettingsPanel } from '@/components/settings/SettingsPanel';
import { NotesManager } from '@/components/notes/NotesManager';
import { FileManager } from '@/components/files/FileManager';
import { StatusBar } from '@/components/layout/StatusBar';

export function Workspace() {
  const { activeView } = useAppStore();

  const renderView = () => {
    switch (activeView) {
      case 'chat':
        return <ChatPanel />;
      case 'plugins':
        return <PluginMarket />;
      case 'settings':
        return <SettingsPanel />;
      case 'files':
        return <FileManager />;
      case 'notes':
        return <NotesManager />;
      default:
        return <ChatPanel />;
    }
  };

  return (
    <main className="flex-1 flex flex-col min-w-0 bg-background overflow-hidden relative pt-16">
      {/* Dynamic View Area */}
      <div className="flex-1 min-h-0 overflow-hidden relative view-transition">
        {renderView()}
      </div>
      
      {/* StatusBar sits at the bottom of the workspace area */}
      <StatusBar />
    </main>
  );
}
