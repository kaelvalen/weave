import { Button } from '@/components/ui/button';
import { Check, PlayCircle } from 'lucide-react';
import { useChatStore } from '@/stores/useChatStore';

/**
 * Approval banner for tool calls awaiting user approval. Rendered in both
 * the chat view (ChatCommandCenter) and the Files view (ChatPanel) — the
 * backend agent loop halts its turn until every pending call here is
 * resolved, so every surface that can trigger a tool call must expose it.
 */
export function ApprovalBanner() {
  const messages = useChatStore((s) => s.messages);

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

  const handleRejectAll = () => {
    pendingApprovals.forEach(({ messageId, call }) => {
      useChatStore.getState().executeToolCall(messageId, call.capability, false);
    });
  };

  return (
    <div className="mx-4 mb-2 p-3 bg-card border border-border rounded-xl shadow-lg flex items-center justify-between animate-in slide-in-from-bottom-2 fade-in duration-200">
      <div className="flex items-center gap-2 text-sm text-foreground min-w-0">
        <PlayCircle className="w-4 h-4 text-orange-500 animate-pulse flex-shrink-0" />
        <span className="font-medium">
          AI wants to run {pendingApprovals.length} tool
          {pendingApprovals.length > 1 ? 's' : ''}.
        </span>
        <span className="text-muted-foreground text-xs ml-1 hidden sm:inline">
          (File, network, or system changes)
        </span>
      </div>
      <div className="flex gap-2 flex-shrink-0">
        <Button
          size="sm"
          variant="default"
          className="h-8 bg-green-600 hover:bg-green-700 text-white shadow-sm gap-1.5"
          onClick={handleAcceptAll}
          title="Approve this batch only"
        >
          Accept
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-2 border-primary/20 hover:bg-primary/5"
          onClick={handleAcceptAll}
        >
          <Check className="w-3.5 h-3.5 text-primary" /> Accept Selection
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-red-500 border-red-200 hover:bg-red-50 hover:text-red-600"
          onClick={handleRejectAll}
        >
          Reject
        </Button>
      </div>
    </div>
  );
}
