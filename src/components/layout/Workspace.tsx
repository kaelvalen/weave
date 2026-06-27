import { useAppStore } from '@/stores/useAppStore';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { PluginMarket } from '@/components/plugins/PluginMarket';
import { SettingsPanel } from '@/components/settings/SettingsPanel';
import { FolderOpen } from 'lucide-react';

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
        return (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <FolderOpen className="w-16 h-16 mb-4 opacity-50" />
            <h3 className="text-lg font-medium text-foreground mb-1">File Manager</h3>
            <p className="text-sm">File browser coming soon. Use the chat to interact with files.</p>
            <p className="text-xs mt-2 opacity-60">Try: "List files in current directory"</p>
          </div>
        );
      default:
        return <ChatPanel />;
    }
  };

  return (
    <main className="flex-1 flex flex-col min-w-0 bg-background overflow-hidden">
      {renderView()}
    </main>
  );
}
