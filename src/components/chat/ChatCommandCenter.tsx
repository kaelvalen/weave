import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '@/stores/useChatStore';
import { useApprovalModeStore } from '@/stores/useApprovalModeStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { useChatStream } from '@/hooks/useChatStream';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import {
  Bot,
  PlusCircle,
  FolderOpen,
  Calculator,
  FileText,
  LayoutGrid,
  Workflow,
  Cpu,
  Loader2,
  ArrowDown,
  ShieldCheck,
  ShieldQuestion,
  Check,
  MessageSquare,
  Trash2,
  Pin,
  PinOff,
  Edit2,
  FolderPlus,
  X,
  Folder,
  ChevronDown,
  ChevronRight,
  Edit3,
  PlayCircle,
  Database,
  Terminal,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import logoLight from '@/assets/weave-logo/light-mode.svg';
import logoDark from '@/assets/weave-logo/dark-mode.svg';

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

interface IndexStatus {
  file_count: number;
  built_at: number;
}

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

  // Active Tools & Memory Column State
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  const [reindexing, setReindexing] = useState(false);
  const [cwd, setCwd] = useState<string>('.');

  useChatStream();

  useEffect(() => {
    listSessions();
    useChatStore.getState().loadHistory();
    fetchIndexStatus();
    const storedRoot = localStorage.getItem('weave_file_manager_root') || '.';
    setCwd(storedRoot);
  }, [listSessions]);

  const fetchIndexStatus = async () => {
    try {
      const res = await invoke<IndexStatus>('get_knowledge_index_status');
      setIndexStatus(res);
    } catch (e) {
      console.error('Failed to fetch index status:', e);
    }
  };

  const handleReindex = async () => {
    setReindexing(true);
    try {
      await invoke('index_knowledge_files');
      toast.success('Knowledge base vector index updated.');
      fetchIndexStatus();
    } catch {
      toast.error('Failed to update knowledge index.');
    } finally {
      setReindexing(false);
    }
  };

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
    <div className="flex h-full w-full bg-background pt-16 overflow-hidden">
      {/* ── Column 1: Sessions & Threads Sidebar ── */}
      <div className="w-[260px] flex-shrink-0 flex flex-col h-full border-r border-border/80 bg-card/50 backdrop-blur-md">
        <div className="h-14 px-4 flex items-center justify-between border-b border-border/60 flex-shrink-0 bg-muted/20">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-primary" />
            <h3 className="text-xs font-bold tracking-wide uppercase text-foreground">Threads ({sessions.length})</h3>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="w-7 h-7 text-muted-foreground hover:text-foreground hover:bg-muted"
            onClick={startNewSession}
            title="Start New Thread"
          >
            <PlusCircle className="w-4 h-4 text-primary" />
          </Button>
        </div>

        <ScrollArea className="flex-1 p-2.5 pb-32">
          <div className="flex flex-col gap-3">
            {sessions.length === 0 ? (
              <div className="text-xs text-muted-foreground text-center py-12 flex flex-col items-center gap-2">
                <MessageSquare className="w-8 h-8 opacity-30" />
                <span>No conversation threads</span>
                <Button size="sm" variant="outline" className="h-7 text-xs mt-2" onClick={startNewSession}>
                  <PlusCircle className="w-3.5 h-3.5 mr-1.5 text-primary" /> New Thread
                </Button>
              </div>
            ) : (
              <>
                {pinnedSessions.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <div className="text-[10px] font-bold tracking-wider text-amber-500 uppercase px-2 py-0.5 flex items-center gap-1">
                      <Pin className="w-3 h-3 fill-amber-500" /> Pinned
                    </div>
                    {pinnedSessions.map(renderSessionItem)}
                  </div>
                )}

                {Object.entries(folderGroups).map(([folder, folderSessions]) => {
                  const isCollapsed = collapsedFolders[folder];
                  return (
                    <div key={folder} className="flex flex-col gap-1">
                      <div
                        className="group/folder flex items-center justify-between text-[10px] font-bold tracking-wider text-muted-foreground uppercase px-2 py-1 cursor-pointer hover:bg-muted/50 rounded-lg transition-colors"
                        onClick={() => toggleFolder(folder)}
                      >
                        <div className="flex items-center gap-1.5 overflow-hidden">
                          {isCollapsed ? <ChevronRight className="w-3.5 h-3.5 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 shrink-0" />}
                          {isCollapsed ? <Folder className="w-3 h-3 shrink-0 text-primary/70" /> : <FolderOpen className="w-3 h-3 shrink-0 text-primary" />}
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
                      {!isCollapsed && folderSessions.map(renderSessionItem)}
                    </div>
                  );
                })}

                {recentSessions.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <div className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase px-2 py-0.5">
                      Recent Threads
                    </div>
                    {recentSessions.map(renderSessionItem)}
                  </div>
                )}
              </>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* ── Column 2: Main Conversation Stream ── */}
      <div className="flex-1 flex flex-col min-w-0 bg-background/95 backdrop-blur-md relative">
        {/* Top Header Bar */}
        <div className="h-14 flex items-center justify-between border-b border-border/60 px-6 flex-shrink-0 bg-card/80 gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
              <Bot className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-foreground truncate">
                {activeSessionObj?.title || 'New AI Command Thread'}
              </h2>
              <p className="text-[10px] text-muted-foreground font-mono">
                Model: <span className="text-primary font-semibold">gpt-4o-mini</span> • Stream: Active
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-shrink-0">
            {/* Approval Mode Switcher */}
            <div
              role="group"
              aria-label="Edit approval mode"
              className="flex items-center bg-muted/60 rounded-full p-0.5 border border-border/60"
            >
              <button
                type="button"
                onClick={() => setApprovalMode('ask')}
                title="Ask mode — confirm each file-changing action before it runs"
                aria-pressed={approvalMode === 'ask'}
                className={`flex items-center gap-1.5 px-3 h-7 rounded-full text-xs font-semibold transition-all duration-200 ${
                  approvalMode === 'ask'
                    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 shadow-sm border border-amber-500/30'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <ShieldQuestion className="w-3.5 h-3.5" />
                <span>Ask Edits</span>
              </button>
              <button
                type="button"
                onClick={() => setApprovalMode('accept-edits')}
                title="Accept Edits mode — auto-approve file changes for this session"
                aria-pressed={approvalMode === 'accept-edits'}
                className={`flex items-center gap-1.5 px-3 h-7 rounded-full text-xs font-semibold transition-all duration-200 ${
                  approvalMode === 'accept-edits'
                    ? 'bg-green-500/15 text-green-600 dark:text-green-400 shadow-sm border border-green-500/30'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Accept Edits</span>
              </button>
            </div>

            {isStreaming && (
              <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-semibold animate-pulse">
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
              <div className="flex flex-col items-center justify-center min-h-0 my-auto py-8 animate-in fade-in zoom-in-95 duration-500 max-w-full">
                <div className="mb-4 w-14 h-14 p-2.5 rounded-2xl bg-card border border-border shadow-sm flex items-center justify-center transform hover:scale-105 transition-transform duration-300">
                  <img src={logoLight} alt="Weave" className="w-full h-full object-contain dark:hidden" />
                  <img src={logoDark} alt="Weave" className="w-full h-full object-contain hidden dark:block" />
                </div>

                <h2 className="text-2xl font-extrabold mb-1 text-foreground text-center tracking-tight">
                  Weave AI Command Center
                </h2>
                <p className="text-xs text-muted-foreground text-center max-w-md mb-6 leading-relaxed">
                  Your autonomous developer intelligence. Orchestrate code edits, inspect system knowledge, execute shell workflows, and design architectures.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 w-full max-w-3xl">
                  {SUGGESTED_PROMPTS.map((p, i) => (
                    <button
                      key={i}
                      type="button"
                      className="group relative flex flex-col justify-between p-3.5 rounded-xl border border-border/80 bg-card/60 hover:bg-card text-left transition-all duration-300 shadow-sm hover:shadow-md hover:border-primary/50 hover:-translate-y-0.5 overflow-hidden"
                      onClick={() => useChatStore.getState().sendMessage(p.text)}
                    >
                      <div className="flex items-center justify-between gap-1.5 mb-2">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <div className="p-1.5 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors shrink-0">
                            <p.icon className="w-4 h-4 stroke-[2]" />
                          </div>
                          <span className="text-xs font-bold text-foreground group-hover:text-primary transition-colors truncate">
                            {p.text}
                          </span>
                        </div>
                      </div>
                      <p className="text-[11px] text-muted-foreground pl-8 line-clamp-1 leading-relaxed">
                        {p.desc}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="py-2 space-y-4">
                {messages
                  .filter((m) => !m.metadata?.isHidden)
                  .map((msg, index, arr) => {
                    let isConsecutive = false;
                    if (index > 0) {
                      const prevMsg = arr[index - 1];
                      const prevIsFakeTool =
                        prevMsg.role === 'user' &&
                        prevMsg.content.startsWith('Tool ') &&
                        prevMsg.content.includes(' returned:');
                      const currentIsFakeTool =
                        msg.role === 'user' &&
                        msg.content.startsWith('Tool ') &&
                        msg.content.includes(' returned:');

                      const prevEffectiveRole = prevIsFakeTool ? 'assistant' : prevMsg.role;
                      const currentEffectiveRole = currentIsFakeTool ? 'assistant' : msg.role;

                      if (prevEffectiveRole === currentEffectiveRole) {
                        isConsecutive = true;
                      }
                    }

                    return (
                      <ChatMessage
                        key={msg.id}
                        message={msg}
                        isLast={index === arr.length - 1}
                        isConsecutive={isConsecutive}
                      />
                    );
                  })}
                {isStreaming &&
                  messages[messages.length - 1]?.role === 'assistant' &&
                  messages[messages.length - 1]?.content === '' && (
                    <div className="flex items-start gap-4 px-5 py-3">
                      <div className="w-8 h-8 rounded-md border bg-muted flex items-center justify-center flex-shrink-0">
                        <Bot className="w-4 h-4" />
                      </div>
                      <div className="flex gap-1 mt-2">
                        <span className="typing-dot" />
                        <span className="typing-dot" />
                        <span className="typing-dot" />
                      </div>
                    </div>
                  )}
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
              aria-label="Scroll to latest message"
              title="Scroll to latest"
              className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center justify-center w-8 h-8 rounded-full bg-card border border-border shadow-lg text-foreground hover:bg-muted transition-colors"
            >
              <ArrowDown className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Approval Banner */}
        {(() => {
          const pendingApprovals = messages.flatMap((m) =>
            (m.metadata?.plugin_calls || [])
              .filter((c) => c.status === 'pending_approval')
              .map((c) => ({ messageId: m.id, call: c }))
          );
          if (pendingApprovals.length === 0) return null;

          const handleAcceptAll = () => {
            pendingApprovals.forEach(({ messageId, call }) => {
              useChatStore.getState().executeToolCall(messageId, call.capability, true);
            });
          };

          const handleAcceptAllForSession = () => {
            useApprovalModeStore.getState().setMode('accept-edits');
            handleAcceptAll();
          };

          const handleRejectAll = () => {
            pendingApprovals.forEach(({ messageId, call }) => {
              useChatStore.getState().executeToolCall(messageId, call.capability, false);
            });
          };

          return (
            <div className="mx-6 mb-3 p-3.5 bg-card border border-border rounded-xl shadow-xl flex items-center justify-between animate-in slide-in-from-bottom-2 fade-in duration-200">
              <div className="flex items-center gap-2.5 text-sm text-foreground min-w-0">
                <PlayCircle className="w-4 h-4 text-orange-500 animate-pulse flex-shrink-0" />
                <span className="font-bold">
                  AI wants to run {pendingApprovals.length} tool
                  {pendingApprovals.length > 1 ? 's' : ''}.
                </span>
                <span className="text-muted-foreground text-xs ml-1 hidden sm:inline font-mono">
                  (Files / workspace state will be modified)
                </span>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <Button
                  size="sm"
                  variant="default"
                  className="h-8 bg-green-600 hover:bg-green-700 text-white shadow-sm gap-1.5 rounded-lg"
                  onClick={handleAcceptAll}
                >
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 border-green-300 text-green-700 hover:bg-green-50 hover:text-green-800 dark:border-green-500/40 dark:text-green-400 dark:hover:bg-green-500/10 rounded-lg"
                  onClick={handleAcceptAllForSession}
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Accept All Edits</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-red-500 border-red-200 hover:bg-red-50 hover:text-red-600 rounded-lg"
                  onClick={handleRejectAll}
                >
                  Reject
                </Button>
              </div>
            </div>
          );
        })()}

        {/* Input Box */}
        <div className="flex-shrink-0 bg-transparent rounded-b-2xl">
          <ChatInput />
        </div>
      </div>

      {/* ── Column 3: Active Tools & Memory Panel ── */}
      <div className="w-[280px] flex-shrink-0 flex flex-col h-full border-l border-border/80 bg-card/40 backdrop-blur-md">
        <div className="h-14 px-4 flex items-center justify-between border-b border-border/60 flex-shrink-0 bg-muted/20">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-primary" />
            <h3 className="text-xs font-bold tracking-wide uppercase text-foreground">Active Tools & Memory</h3>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="w-7 h-7 text-muted-foreground hover:text-foreground hover:bg-muted"
            onClick={fetchIndexStatus}
            title="Refresh Memory State"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>

        <ScrollArea className="flex-1 p-4 space-y-6">
          <div className="space-y-6">
            {/* Tool Capabilities Card */}
            <div className="border border-border/60 rounded-xl p-3.5 bg-background/80 space-y-3 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-green-500" /> Active Capabilities
                </span>
                <span className="text-[10px] font-mono bg-green-500/10 text-green-500 px-2 py-0.5 rounded-full">
                  5 Builtin
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Weave is equipped with autonomous agentic capabilities to interact with your OS.
              </p>
              <div className="grid grid-cols-2 gap-1.5 pt-1">
                <div className="p-1.5 bg-muted/40 rounded border border-border/40 text-[10px] font-mono text-foreground flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span> shell.exec
                </div>
                <div className="p-1.5 bg-muted/40 rounded border border-border/40 text-[10px] font-mono text-foreground flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span> file.io
                </div>
                <div className="p-1.5 bg-muted/40 rounded border border-border/40 text-[10px] font-mono text-foreground flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span> note.create
                </div>
                <div className="p-1.5 bg-muted/40 rounded border border-border/40 text-[10px] font-mono text-foreground flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span> workflow.chain
                </div>
              </div>
            </div>

            {/* RAG & Vector Memory Card */}
            <div className="border border-border/60 rounded-xl p-3.5 bg-background/80 space-y-3 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-primary" /> Memory & RAG Index
                </span>
                {indexStatus && indexStatus.built_at > 0 ? (
                  <span className="text-[10px] font-mono bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                    {indexStatus.file_count} files
                  </span>
                ) : (
                  <span className="text-[10px] font-mono bg-amber-500/10 text-amber-500 px-2 py-0.5 rounded-full">
                    No index
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {indexStatus && indexStatus.built_at > 0
                  ? `Knowledge base indexed on ${new Date(indexStatus.built_at).toLocaleTimeString()}. Vector embeddings ready for context injection.`
                  : 'Vector index is empty. Upload files in Knowledge Base to form permanent memory.'}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="w-full h-7 text-xs gap-1.5 rounded-lg"
                onClick={handleReindex}
                disabled={reindexing}
              >
                {reindexing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-primary" />}
                <span>{reindexing ? 'Updating Index...' : 'Re-Index Memory'}</span>
              </Button>
            </div>

            {/* System Context State */}
            <div className="border border-border/60 rounded-xl p-3.5 bg-background/80 space-y-2.5 shadow-sm font-mono">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-foreground flex items-center gap-1.5 font-sans">
                  <Terminal className="w-3.5 h-3.5 text-purple-500" /> System State
                </span>
                <span className="text-[10px] bg-purple-500/10 text-purple-500 px-2 py-0.5 rounded-full">
                  Online
                </span>
              </div>
              <div className="text-[10px] text-muted-foreground space-y-1 bg-muted/40 p-2 rounded border border-border/30">
                <p className="truncate" title={cwd}>CWD: {cwd}</p>
                <p>Engine: Tauri v2 / Rust IPC</p>
                <p>Stream: Real-time SSE / Event</p>
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>

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
