import { useState } from 'react';
import { usePluginStore } from '@/stores/usePluginStore';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plug, Loader2, KeyRound } from 'lucide-react';
import { extractError } from '@/lib/errors';

/**
 * "Add MCP Server" entry point — reuses the Plugin Marketplace surface
 * (docs/phase8-mcp-spec.md Part 1 Q5 / Part 2 §6) instead of a new nav item
 * or view, the same gesture as the existing "GitHub"/"Install .wpk" buttons
 * in PluginMarket.tsx.
 *
 * When the server challenges 401 (OAuth 2.1/CIMD required — Part 2 §4–§5),
 * the dialog stays open with an "Authorize" step: the backend binds a
 * loopback listener, opens the authorization page in the system browser,
 * captures the redirect, and exchanges the code for tokens; this promise
 * resolves only once the round trip completes.
 */
export function AddMcpServerDialog() {
  const addMcpServer = usePluginStore((s) => s.addMcpServer);
  const oauthAuthorize = usePluginStore((s) => s.oauthAuthorize);
  const mcpServers = usePluginStore((s) => s.mcpServers);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [authorizing, setAuthorizing] = useState(false);
  const [pendingAuthId, setPendingAuthId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!url.trim()) return;
    setSubmitting(true);
    setError(null);
    const ok = await addMcpServer(url.trim(), name.trim());
    setSubmitting(false);
    if (!ok) return;
    const added = mcpServers.find((s) => s.url === url.trim());
    if (added?.auth_required && !added.has_token) {
      setPendingAuthId(added.id);
      return;
    }
    setOpen(false);
    setUrl('');
    setName('');
  };

  const handleAuthorize = async () => {
    if (!pendingAuthId) return;
    setAuthorizing(true);
    setError(null);
    try {
      await oauthAuthorize(pendingAuthId);
      setOpen(false);
      setPendingAuthId(null);
      setUrl('');
      setName('');
    } catch (err) {
      setError(extractError(err));
    } finally {
      setAuthorizing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => {
      setOpen(next);
      if (!next) {
        setPendingAuthId(null);
        setError(null);
      }
    }}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 h-8 text-xs border-border/40 bg-surface-2"
        >
          <Plug className="w-3.5 h-3.5" />
          Add MCP Server
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {pendingAuthId ? 'Authorize MCP Server' : 'Add MCP Server'}
          </DialogTitle>
          <DialogDescription>
            {pendingAuthId ? (
              <>
                This server requires OAuth authorization. Your browser will
                open; after you approve, Weave captures the redirect and stores
                the tokens — you can close the browser tab.
              </>
            ) : (
              <>
                Connects to an MCP (2026-07-28) server and registers its tools
                as capabilities. Every tool from a new server requires your
                approval the first time it's called, until you explicitly
                allowlist it.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        {pendingAuthId ? (
          <div className="space-y-4 py-2">
            {error ? (
              <p className="text-xs text-destructive">{error}</p>
            ) : null}
            <div className="flex items-center gap-2 rounded-md border border-border/40 bg-surface-2 px-3 py-2 text-xs text-muted-foreground">
              <KeyRound className="w-3.5 h-3.5" />
              OAuth 2.1 · CIMD client identity · PKCE
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="mcp-server-url">Server URL</Label>
              <Input
                id="mcp-server-url"
                placeholder="https://example.com/mcp"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mcp-server-name">Name (optional)</Label>
              <Input
                id="mcp-server-name"
                placeholder="Weather server"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={submitting || authorizing}>
            Cancel
          </Button>
          {pendingAuthId ? (
            <Button size="sm" onClick={handleAuthorize} disabled={authorizing}>
              {authorizing ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
              {authorizing ? 'Waiting for browser…' : 'Authorize'}
            </Button>
          ) : (
            <Button size="sm" onClick={handleSubmit} disabled={submitting || !url.trim()}>
              {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
              Add Server
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
