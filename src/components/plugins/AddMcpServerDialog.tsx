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
import { Plug, Loader2 } from 'lucide-react';

/**
 * "Add MCP Server" entry point — reuses the Plugin Marketplace surface
 * (docs/phase8-mcp-spec.md Part 1 Q5 / Part 2 §6) instead of a new nav item
 * or view, the same gesture as the existing "GitHub"/"Install .wpk" buttons
 * in PluginMarket.tsx.
 */
export function AddMcpServerDialog() {
  const addMcpServer = usePluginStore((s) => s.addMcpServer);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!url.trim()) return;
    setSubmitting(true);
    const ok = await addMcpServer(url.trim(), name.trim());
    setSubmitting(false);
    if (ok) {
      setOpen(false);
      setUrl('');
      setName('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
          <DialogTitle>Add MCP Server</DialogTitle>
          <DialogDescription>
            Connects to an MCP (2026-07-28) server and registers its tools as capabilities.
            Every tool from a new server requires your approval the first time it's called,
            until you explicitly allowlist it.
          </DialogDescription>
        </DialogHeader>
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
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={submitting || !url.trim()}>
            {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
            Add Server
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
