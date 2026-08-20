import { lazy, Suspense, useEffect } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { ChatCommandCenter } from '@/components/chat/ChatCommandCenter';
import { StatusBar } from '@/components/layout/StatusBar';

// Heavier views are code-split so the initial chat bundle stays small — these
// only cost a network+parse hit when the user actually opens that view.
const KnowledgeView = lazy(() =>
  import('@/components/workspace/KnowledgeView').then((m) => ({ default: m.KnowledgeView }))
);
const PluginMarket = lazy(() =>
  import('@/components/plugins/PluginMarket').then((m) => ({ default: m.PluginMarket }))
);
const SettingsPanel = lazy(() =>
  import('@/components/settings/SettingsPanel').then((m) => ({ default: m.SettingsPanel }))
);
const FileManager = lazy(() =>
  import('@/components/files/FileManager').then((m) => ({ default: m.FileManager }))
);

function ViewFallback() {
  // Keeps the layout stable while a lazy view chunk loads.
  return <div className="flex h-full items-center justify-center text-muted-foreground" />;
}

export function Workspace() {
  const { activeView } = useAppStore();

  const renderView = () => {
    let view: React.ReactNode;
    switch (activeView) {
      case 'chat':
        return <ChatCommandCenter />;
      case 'knowledge':
        view = <KnowledgeView />;
        break;
      case 'plugins':
        view = <PluginMarket />;
        break;
      case 'settings':
        view = <SettingsPanel />;
        break;
      case 'files':
      default:
        view = <FileManager />;
        break;
    }
    return <Suspense fallback={<ViewFallback />}>{view}</Suspense>;
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
