import { useEffect } from 'react';
import { useChatStore } from '@/stores/useChatStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { MessageSquare, Trash2, Plus, History } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function ChatHistorySidebar({ onClose }: { onClose?: () => void }) {
  const { sessions, listSessions, loadSession, startNewSession, deleteSession, conversationId } = useChatStore();

  useEffect(() => {
    listSessions();
  }, [listSessions]);

  return (
    <div className="w-64 h-full border-r bg-muted/30 flex flex-col flex-shrink-0">
      <div className="p-3 flex items-center justify-between border-b">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <History className="w-4 h-4" />
          Chat History
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={startNewSession}>
              <Plus className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent><p>New Chat</p></TooltipContent>
        </Tooltip>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 flex flex-col gap-1">
          {sessions.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-8">
              No previous chats
            </div>
          ) : (
            sessions.map((session) => (
              <div
                key={session.id}
                className={`group flex items-center justify-between px-3 py-2 rounded-md cursor-pointer transition-colors text-sm ${
                  conversationId === session.id
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
                onClick={() => {
                  loadSession(session.id);
                  if (onClose && window.innerWidth < 768) {
                    onClose();
                  }
                }}
              >
                <div className="flex items-center gap-2 overflow-hidden">
                  <MessageSquare className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate">{session.title}</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteSession(session.id);
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                </Button>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
