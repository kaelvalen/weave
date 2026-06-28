import { useAppStore } from '@/stores/useAppStore';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { PluginMarket } from '@/components/plugins/PluginMarket';
import { SettingsPanel } from '@/components/settings/SettingsPanel';
import { NotesManager } from '@/components/notes/NotesManager';
import { FileManager } from '@/components/files/FileManager';
import { StatusBar } from '@/components/layout/StatusBar';
import { useEffect } from 'react';

export function Workspace() {
  const { activeView } = useAppStore();
  const isChatExpanded = useAppStore((s) => s.isChatExpanded);

  const renderView = () => {
    switch (activeView) {
      case 'plugins':
        return <PluginMarket />;
      case 'settings':
        return <SettingsPanel />;
      case 'files':
        return <FileManager />;
      case 'notes':
        return <NotesManager />;
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
    <main className="flex-1 flex flex-col min-w-0 bg-transparent overflow-hidden relative">
      {/* Dynamic View Area */}
      <div className="flex-1 min-h-0 overflow-hidden relative view-transition">
        {renderView()}
      </div>

      {/* Floating AI Chat Container */}
      <div 
        className={`absolute left-1/2 -translate-x-1/2 z-40 transition-all duration-400 flex flex-col pointer-events-none ${
          isChatExpanded
            ? 'w-[768px] max-w-[95vw] h-[80vh] bottom-6 opacity-100 shadow-2xl' 
            : 'w-[540px] max-w-[90vw] h-14 bottom-10 opacity-95 hover:opacity-100 shadow-xl translate-y-0'
        }`}
      >
        <div 
          className="w-full h-full overflow-hidden pointer-events-auto border border-border/40 bg-card flex flex-col rounded-[20px] shadow-inner"
        >
          <ChatPanel isFloating={true} />
        </div>
      </div>
      
      {/* StatusBar sits at the bottom of the workspace area */}
      <StatusBar />
    </main>
  );
}
