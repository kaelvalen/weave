import { useEffect, useState } from 'react';
import { useChatStore } from '@/stores/useChatStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { MessageSquare, Trash2, Plus, History, Pin, PinOff, Edit2, FolderPlus, Check, X, FolderOpen, Folder, ChevronDown, ChevronRight, Edit3 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

export function ChatHistorySidebar({ onClose }: { onClose?: () => void }) {
  const { sessions, listSessions, loadSession, startNewSession, deleteSession, conversationId, updateSessionMeta } = useChatStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [folderDialogSession, setFolderDialogSession] = useState<typeof sessions[0] | null>(null);
  const [folderDialogValue, setFolderDialogValue] = useState('');
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [folderRenameDialog, setFolderRenameDialog] = useState<{ oldName: string, newName: string } | null>(null);

  useEffect(() => {
    listSessions();
  }, [listSessions]);

  const handleRenameSubmit = (id: string) => {
    if (editTitle.trim()) {
      updateSessionMeta(id, { title: editTitle.trim() });
    }
    setEditingId(null);
  };

  const handleFolderPrompt = (session: typeof sessions[0]) => {
    setFolderDialogSession(session);
    setFolderDialogValue(session.folder || "");
  };

  const handleFolderSubmit = () => {
    if (folderDialogSession) {
      updateSessionMeta(folderDialogSession.id, { folder: folderDialogValue.trim() });
      setFolderDialogSession(null);
    }
  };

  const toggleFolder = (folderName: string) => {
    setCollapsedFolders(prev => ({ ...prev, [folderName]: !prev[folderName] }));
  };

  const handleFolderRenameSubmit = async () => {
    if (folderRenameDialog && folderRenameDialog.newName.trim()) {
      const oldName = folderRenameDialog.oldName;
      const newName = folderRenameDialog.newName.trim();
      const sessionsToRename = sessions.filter(s => s.folder === oldName);
      
      // Update each session's folder sequentially
      for (const s of sessionsToRename) {
        await updateSessionMeta(s.id, { folder: newName });
      }
      
      setFolderRenameDialog(null);
    }
  };

  const pinnedSessions = sessions.filter(s => s.pinned);
  const unpinnedSessions = sessions.filter(s => !s.pinned);
  
  const folderGroups = unpinnedSessions.reduce((acc, session) => {
    if (session.folder) {
      if (!acc[session.folder]) acc[session.folder] = [];
      acc[session.folder].push(session);
    }
    return acc;
  }, {} as Record<string, typeof sessions>);
  
  const recentSessions = unpinnedSessions.filter(s => !s.folder);

  const renderSession = (session: typeof sessions[0]) => {
    const isEditing = editingId === session.id;

    return (
      <div
        key={session.id}
        className={`group relative flex items-center justify-between px-3 py-2 rounded-md cursor-pointer transition-colors text-sm ${
          conversationId === session.id
            ? 'bg-primary/10 text-primary font-medium'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        }`}
        onClick={() => {
          if (isEditing) return;
          loadSession(session.id);
          if (onClose && window.innerWidth < 768) {
            onClose();
          }
        }}
      >
        <div className="flex items-center gap-2 overflow-hidden flex-1">
          {session.pinned ? <Pin className="w-3.5 h-3.5 flex-shrink-0 fill-current" /> : <MessageSquare className="w-3.5 h-3.5 flex-shrink-0" />}
          
          {isEditing ? (
            <div className="flex items-center gap-1 w-full" onClick={e => e.stopPropagation()}>
              <Input 
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleRenameSubmit(session.id);
                  if (e.key === 'Escape') setEditingId(null);
                }}
                className="h-6 text-xs px-1 py-0 w-full"
                autoFocus
              />
              <Check className="w-3.5 h-3.5 text-green-500 cursor-pointer" onClick={() => handleRenameSubmit(session.id)} />
              <X className="w-3.5 h-3.5 text-destructive cursor-pointer" onClick={() => setEditingId(null)} />
            </div>
          ) : (
            <span className="truncate">{session.title}</span>
          )}
        </div>
        
        {!isEditing && (
          <div 
            className={`absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 flex-shrink-0 bg-background/95 backdrop-blur shadow-sm rounded-md border border-border/50 px-0.5 py-0.5 transition-opacity duration-200 ${
              conversationId === session.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
            onClick={e => e.stopPropagation()}
          >
            <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-muted-foreground/20 text-muted-foreground" onClick={() => updateSessionMeta(session.id, { pinned: !session.pinned })}>
              {session.pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-muted-foreground/20 text-muted-foreground" onClick={() => { setEditingId(session.id); setEditTitle(session.title); }}>
              <Edit2 className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-muted-foreground/20 text-muted-foreground" onClick={() => handleFolderPrompt(session)}>
              <FolderPlus className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-destructive/20 text-muted-foreground hover:text-destructive" onClick={() => deleteSession(session.id)}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-72 h-full border-r bg-muted/30 flex flex-col flex-shrink-0">
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
        <div className="p-2 flex flex-col gap-4">
          {sessions.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-8">
              No previous chats
            </div>
          ) : (
            <>
              {pinnedSessions.length > 0 && (
                <div className="flex flex-col gap-1">
                  <div className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase px-2 py-1">Pinned</div>
                  {pinnedSessions.map(renderSession)}
                </div>
              )}

              {Object.entries(folderGroups).map(([folder, folderSessions]) => {
                const isCollapsed = collapsedFolders[folder];
                return (
                  <div key={folder} className="flex flex-col gap-1">
                    <div 
                      className="group/folder flex items-center justify-between text-[10px] font-bold tracking-wider text-muted-foreground uppercase px-2 py-1 cursor-pointer hover:bg-muted/50 rounded-md transition-colors"
                      onClick={() => toggleFolder(folder)}
                    >
                      <div className="flex items-center gap-1.5 overflow-hidden">
                        {isCollapsed ? <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />}
                        {isCollapsed ? <Folder className="w-3 h-3 flex-shrink-0" /> : <FolderOpen className="w-3 h-3 flex-shrink-0" />}
                        <span className="truncate">{folder}</span>
                      </div>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-5 w-5 opacity-0 group-hover/folder:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFolderRenameDialog({ oldName: folder, newName: folder });
                        }}
                        title="Rename folder"
                      >
                        <Edit3 className="w-3 h-3" />
                      </Button>
                    </div>
                    {!isCollapsed && folderSessions.map(renderSession)}
                  </div>
                );
              })}

              {recentSessions.length > 0 && (
                <div className="flex flex-col gap-1">
                  <div className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase px-2 py-1">Recent</div>
                  {recentSessions.map(renderSession)}
                </div>
              )}
            </>
          )}
        </div>
      </ScrollArea>

      <Dialog open={!!folderDialogSession} onOpenChange={(open) => !open && setFolderDialogSession(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Move to Folder</DialogTitle>
          </DialogHeader>
          <div className="flex items-center space-x-2 py-4">
            <Input
              value={folderDialogValue}
              onChange={(e) => setFolderDialogValue(e.target.value)}
              placeholder="Folder name (leave empty to remove)"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleFolderSubmit();
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFolderDialogSession(null)}>Cancel</Button>
            <Button onClick={handleFolderSubmit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!folderRenameDialog} onOpenChange={(open) => !open && setFolderRenameDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename Folder</DialogTitle>
          </DialogHeader>
          <div className="flex items-center space-x-2 py-4">
            <Input
              value={folderRenameDialog?.newName || ''}
              onChange={(e) => setFolderRenameDialog(prev => prev ? { ...prev, newName: e.target.value } : null)}
              placeholder="New folder name"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleFolderRenameSubmit();
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFolderRenameDialog(null)}>Cancel</Button>
            <Button onClick={handleFolderRenameSubmit}>Rename</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
