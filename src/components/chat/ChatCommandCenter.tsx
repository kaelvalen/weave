import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '@/stores/useChatStore';
import { useApprovalModeStore } from '@/stores/useApprovalModeStore';
import { useAppStore } from '@/stores/useAppStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { useChatStream } from '@/hooks/useChatStream';
import { ArtifactPanel } from './ArtifactPanel';
import { ArtifactsListPanel } from './ArtifactsListPanel';
import {
  PlusCircle,
  FolderOpen,
  Calculator,
  FileText,
  LayoutGrid,
  Workflow,
  Cpu,
  Loader2,
  ArrowDown,
  Check,
  MessageSquare,
  Trash2,
  Pin,
  PinOff,
  Edit2,
  FolderPlus,
  X,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

const SUGGESTED_PROMPTS = [
  {
    category: 'Filesystem',
    text: 'List files in current directory',
    icon: FolderOpen,
    desc: 'Browse workspace files & folders',
    badge: 'bg-muted/80 text-muted-foreground border-border/60',
  },
  {
    category: 'Math & Calc',
    text: 'Calculate sqrt(144) + 42 * 18',
    icon: Calculator,
    desc: 'High precision calculations & conversions',
    badge: 'bg-muted/80 text-muted-foreground border-border/60',
  },
  {
    category: 'Workspace',
    text: 'Create a note summarizing my current ideas',
    icon: FileText,
    desc: 'Save ideas directly into your notes',
    badge: 'bg-muted/80 text-muted-foreground border-border/60',
  },
  {
    category: 'AI Canvas',
    text: 'Create a canvas node with architectural diagram',
    icon: LayoutGrid,
    desc: 'Autonomously build visual layouts',
    badge: 'bg-muted/80 text-muted-foreground border-border/60',
  },
  {
    category: 'Workflow',
    text: 'List available automated workflows',
    icon: Workflow,
    desc: 'Execute multi-step AI pipelines',
    badge: 'bg-muted/80 text-muted-foreground border-border/60',
  },
  {
    category: 'System',
    text: 'What is Weave and how do I use plugins?',
    icon: Cpu,
    desc: 'Learn about your agentic assistant',
    badge: 'bg-muted/80 text-muted-foreground border-border/60',
  },
];



export function ChatCommandCenter() {
  const {
    sessions,
    listSessions,
    loadSession,
    startNewSession,
    deleteSession,
    conversationId,
    updateSessionMeta,
    messages,
    isStreaming,
  } = useChatStore();
  
  const approvalMode = useApprovalModeStore((s) => s.mode);
  const setApprovalMode = useApprovalModeStore((s) => s.setMode);

  const activeArtifact = useAppStore((s) => s.activeArtifact);
  const isLeftSidebarOpen = useAppStore((s) => s.isLeftSidebarOpen);
  const isRightPanelOpen = useAppStore((s) => s.isRightPanelOpen);

  // Sessions Column State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [folderDialogSession, setFolderDialogSession] = useState<(typeof sessions)[0] | null>(null);
  const [folderDialogValue, setFolderDialogValue] = useState('');
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [folderRenameDialog, setFolderRenameDialog] = useState<{
    oldName: string;
    newName: string;
  } | null>(null);
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);

  // Main Stream Column State
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);

  useChatStream();

  useEffect(() => {
    listSessions();
    useChatStore.getState().loadHistory();
  }, [listSessions]);



  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setIsPinnedToBottom(distanceFromBottom < 80);
  };

  useEffect(() => {
    if (bottomRef.current && isPinnedToBottom) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isStreaming, isPinnedToBottom]);

  const scrollToBottom = () => {
    setIsPinnedToBottom(true);
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // Sessions renaming & folders
  const handleRenameSubmit = (id: string) => {
    if (editTitle.trim()) {
      updateSessionMeta(id, { title: editTitle.trim() });
    }
    setEditingId(null);
  };

  const handleFolderPrompt = (session: (typeof sessions)[0]) => {
    setFolderDialogSession(session);
    setFolderDialogValue(session.folder || '');
  };

  const handleFolderSubmit = () => {
    if (folderDialogSession) {
      updateSessionMeta(folderDialogSession.id, { folder: folderDialogValue.trim() });
      setFolderDialogSession(null);
    }
  };

  const toggleFolder = (folderName: string) => {
    setCollapsedFolders((prev) => ({ ...prev, [folderName]: !prev[folderName] }));
  };

  const handleFolderRenameSubmit = async () => {
    if (folderRenameDialog && folderRenameDialog.newName.trim()) {
      const oldName = folderRenameDialog.oldName;
      const newName = folderRenameDialog.newName.trim();
      const sessionsToRename = sessions.filter((s) => s.folder === oldName);
      for (const s of sessionsToRename) {
        await updateSessionMeta(s.id, { folder: newName });
      }
      setFolderRenameDialog(null);
    }
  };

  const pinnedSessions = sessions.filter((s) => s.pinned);
  const unpinnedSessions = sessions.filter((s) => !s.pinned);
  const folderGroups = unpinnedSessions.reduce(
    (acc, session) => {
      if (session.folder) {
        if (!acc[session.folder]) acc[session.folder] = [];
        acc[session.folder].push(session);
      }
      return acc;
    },
    {} as Record<string, typeof sessions>
  );
  const recentSessions = unpinnedSessions.filter((s) => !s.folder);

  const activeSessionObj = sessions.find((s) => s.id === conversationId);
  const hasMessages = messages.length > 0;

  const renderSessionItem = (session: (typeof sessions)[0]) => {
    const isEditing = editingId === session.id;
    const isSelected = conversationId === session.id;

    return (
      <div
        key={session.id}
        className={`group relative flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer transition-all text-xs border ${
          isSelected
            ? 'bg-primary/15 text-primary font-bold border-primary/40 shadow-sm'
            : 'bg-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground border-transparent hover:border-border/40'
        }`}
        onClick={() => {
          if (isEditing) return;
          loadSession(session.id);
        }}
      >
        <div className="flex items-center gap-2 overflow-hidden flex-1">
          {session.pinned ? (
            <Pin className="w-3.5 h-3.5 flex-shrink-0 fill-current text-amber-500" />
          ) : (
            <MessageSquare className="w-3.5 h-3.5 flex-shrink-0" />
          )}

          {isEditing ? (
            <div className="flex items-center gap-1 w-full" onClick={(e) => e.stopPropagation()}>
              <Input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenameSubmit(session.id);
                  if (e.key === 'Escape') setEditingId(null);
                }}
                className="h-6 text-xs px-1.5 py-0 w-full"
                autoFocus
              />
              <Check
                className="w-3.5 h-3.5 text-green-500 cursor-pointer shrink-0"
                onClick={() => handleRenameSubmit(session.id)}
              />
              <X
                className="w-3.5 h-3.5 text-destructive cursor-pointer shrink-0"
                onClick={() => setEditingId(null)}
              />
            </div>
          ) : (
            <span className="truncate">{session.title || 'Untitled Session'}</span>
          )}
        </div>

        {!isEditing && (
          <div
            className={`absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5 flex-shrink-0 bg-background/95 backdrop-blur shadow-sm rounded-md border border-border/60 px-0.5 py-0.5 transition-opacity duration-200 ${
              isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 hover:bg-muted text-muted-foreground hover:text-foreground"
              onClick={() => updateSessionMeta(session.id, { pinned: !session.pinned })}
              title={session.pinned ? 'Unpin thread' : 'Pin thread'}
            >
              {session.pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 hover:bg-muted text-muted-foreground hover:text-foreground"
              onClick={() => {
                setEditingId(session.id);
                setEditTitle(session.title);
              }}
              title="Rename thread"
            >
              <Edit2 className="w-3 h-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 hover:bg-muted text-muted-foreground hover:text-foreground"
              onClick={() => handleFolderPrompt(session)}
              title="Move to folder"
            >
              <FolderPlus className="w-3 h-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
              onClick={() => setSessionToDelete(session.id)}
              title="Delete thread"
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full w-full bg-background overflow-hidden">
      {/* ── Column 1: Threads Sidebar ── */}
      {isLeftSidebarOpen && (
        <div className="w-60 flex-shrink-0 flex flex-col h-full border-r border-border bg-card">
        <div className="h-10 px-3 flex items-center justify-between border-b border-border flex-shrink-0 font-mono text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">Threads ({sessions.length})</span>
          <Button
            variant="ghost"
            size="icon"
            className="w-6 h-6 text-muted-foreground hover:text-foreground"
            onClick={startNewSession}
            title="New Thread"
          >
            <PlusCircle className="w-3.5 h-3.5" />
          </Button>
        </div>

        <ScrollArea className="flex-1 p-2">
          <div className="flex flex-col gap-1 font-mono text-xs">
            {sessions.length === 0 ? (
              <div className="text-xs text-muted-foreground text-center py-8">
                No threads
              </div>
            ) : (
              <>
                {pinnedSessions.length > 0 && (
                  <div className="flex flex-col gap-0.5">
                    <div className="text-[10px] font-bold text-muted-foreground uppercase px-2 py-1">
                      Pinned
                    </div>
                    {pinnedSessions.map(renderSessionItem)}
                  </div>
                )}

                {Object.entries(folderGroups).map(([folder, folderSessions]) => {
                  const isCollapsed = collapsedFolders[folder];
                  return (
                    <div key={folder} className="flex flex-col gap-0.5">
                      <div
                        className="flex items-center justify-between text-[10px] text-muted-foreground uppercase px-2 py-1 cursor-pointer hover:text-foreground"
                        onClick={() => toggleFolder(folder)}
                      >
                        <div className="flex items-center gap-1">
                          {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          <span className="truncate">{folder}</span>
                        </div>
                      </div>
                      {!isCollapsed && folderSessions.map(renderSessionItem)}
                    </div>
                  );
                })}

                {recentSessions.length > 0 && (
                  <div className="flex flex-col gap-0.5">
                    <div className="text-[10px] font-bold text-muted-foreground uppercase px-2 py-1">
                      Recent
                    </div>
                    {recentSessions.map(renderSessionItem)}
                  </div>
                )}
              </>
            )}
          </div>
        </ScrollArea>
      </div>
      )}

      {/* ── Column 2: Main Conversation Stream ── */}
      <div className="flex-1 flex flex-col min-w-0 bg-background relative">
        {/* Top Header Bar */}
        <div className="h-10 flex items-center justify-between border-b border-border px-4 flex-shrink-0 bg-card gap-4 font-mono text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-semibold text-foreground truncate">
              {activeSessionObj?.title || 'New Thread'}
            </span>
          </div>

          <div className="flex items-center gap-3 flex-shrink-0">
            {/* Approval Mode Switcher */}
            <div className="flex items-center bg-muted/50 rounded p-0.5 border border-border">
              <button
                type="button"
                onClick={() => setApprovalMode('ask')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  approvalMode === 'ask'
                    ? 'bg-foreground text-background font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Ask
              </button>
              <button
                type="button"
                onClick={() => setApprovalMode('accept-edits')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  approvalMode === 'accept-edits'
                    ? 'bg-foreground text-background font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Auto-Approve
              </button>
            </div>

            {isStreaming && (
              <div className="flex items-center gap-1.5 text-xs text-foreground font-mono">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Thinking...
              </div>
            )}
          </div>
        </div>

        {/* Messages Scroll Area */}
        <ScrollArea className="flex-1 min-h-0">
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="flex flex-col max-w-4xl mx-auto w-full min-w-0 p-4 sm:p-6"
          >
            {!hasMessages ? (
              <div className="flex flex-col items-center justify-center min-h-0 my-auto py-16 text-center max-w-md mx-auto">
                <h2 className="text-xl font-bold mb-2 text-foreground tracking-tight">
                  Weave AI
                </h2>
                <p className="text-xs text-muted-foreground leading-relaxed mb-6 font-mono">
                  Autonomous agent workspace. Type a prompt or use slash commands to execute tasks.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full text-left">
                  {SUGGESTED_PROMPTS.slice(0, 4).map((p, i) => (
                    <button
                      key={i}
                      type="button"
                      className="p-3 rounded border border-border bg-card hover:bg-muted/50 transition-colors text-xs font-mono text-muted-foreground hover:text-foreground"
                      onClick={() => useChatStore.getState().sendMessage(p.text)}
                    >
                      <div className="font-semibold text-foreground mb-1">{p.text}</div>
                      <div className="text-[11px] text-muted-foreground line-clamp-1">{p.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="py-2 space-y-4">
                {messages
                  .filter((m) => !m.metadata?.isHidden)
                  .map((msg, index, arr) => (
                    <ChatMessage
                      key={msg.id}
                      message={msg}
                      isLast={index === arr.length - 1}
                    />
                  ))}
                <div ref={bottomRef} className="h-4" />
              </div>
            )}
          </div>
        </ScrollArea>

        {!isPinnedToBottom && (
          <div className="relative">
            <button
              type="button"
              onClick={scrollToBottom}
              className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center justify-center w-7 h-7 rounded-full bg-card border border-border text-foreground hover:bg-muted transition-colors"
            >
              <ArrowDown className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Input Box */}
        <div className="flex-shrink-0">
          <ChatInput />
        </div>
      </div>

      {/* ── Column 3: Split View Artifact Panel OR Artifacts List ── */}
      {isRightPanelOpen && (
        <div className="w-[480px] flex-shrink-0 flex flex-col h-full border-l border-border bg-background">
          {activeArtifact ? <ArtifactPanel /> : <ArtifactsListPanel />}
        </div>
      )}

      {/* Dialogs */}
      <Dialog
        open={!!folderDialogSession}
        onOpenChange={(open) => !open && setFolderDialogSession(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Move Thread to Folder</DialogTitle>
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
            <Button variant="outline" onClick={() => setFolderDialogSession(null)}>
              Cancel
            </Button>
            <Button onClick={handleFolderSubmit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!folderRenameDialog}
        onOpenChange={(open) => !open && setFolderRenameDialog(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename Folder</DialogTitle>
          </DialogHeader>
          <div className="flex items-center space-x-2 py-4">
            <Input
              value={folderRenameDialog?.newName || ''}
              onChange={(e) =>
                setFolderRenameDialog((prev) =>
                  prev ? { ...prev, newName: e.target.value } : null
                )
              }
              placeholder="New folder name"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleFolderRenameSubmit();
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFolderRenameDialog(null)}>
              Cancel
            </Button>
            <Button onClick={handleFolderRenameSubmit}>Rename</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!sessionToDelete}
        onOpenChange={(open) => !open && setSessionToDelete(null)}
        title="Delete thread?"
        description="This conversation will be permanently removed. This action cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (sessionToDelete) deleteSession(sessionToDelete);
        }}
      />
    </div>
  );
}
