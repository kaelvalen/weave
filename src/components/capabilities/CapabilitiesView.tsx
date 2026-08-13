import { useMemo, useState } from 'react';
import { usePluginStore } from '@/stores/usePluginStore';
import { useRuntimeStore } from '@/stores/useRuntimeStore';
import type { Plugin } from '@/types/plugin';
import type { ToolMetrics } from '@/types/runtime';
import { requiresApproval } from '@/lib/capabilities';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ViewHeader } from '@/components/ui/ViewHeader';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Boxes, Search, ShieldAlert, X } from 'lucide-react';

interface CapabilityRow {
  name: string;
  description: string;
  schema: unknown;
  plugin: Plugin;
}

function ReliabilityLine({ metrics }: { metrics: ToolMetrics | undefined }) {
  if (!metrics || metrics.call_count === 0) {
    return <span className="text-muted-foreground/70">never called</span>;
  }
  const avg = Math.round(metrics.total_duration_ms / metrics.call_count);
  return (
    <span>
      {metrics.call_count} calls · {metrics.failure_count} failures · avg {avg}ms · min{' '}
      {metrics.min_duration_ms}ms · max {metrics.max_duration_ms}ms
    </span>
  );
}

function SchemaBlock({ label, schema }: { label: string; schema: unknown }) {
  const pretty = useMemo(() => {
    if (schema === undefined || schema === null) return null;
    return JSON.stringify(schema, null, 2);
  }, [schema]);

  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
        {label}
      </span>
      <pre className="p-2 rounded border border-border bg-background font-mono text-[11px] text-muted-foreground overflow-x-auto whitespace-pre max-h-64 overflow-y-auto">
        {pretty ?? '{}'}
      </pre>
    </div>
  );
}

export function CapabilitiesView() {
  const plugins = usePluginStore((s) => s.plugins);
  const loadedPlugins = usePluginStore((s) => s.loadedPlugins);
  const observability = useRuntimeStore((s) => s.observability);

  const [query, setQuery] = useState('');
  const [pluginFilter, setPluginFilter] = useState<string>('all');
  const [approvalOnly, setApprovalOnly] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const rows = useMemo<CapabilityRow[]>(() => {
    return plugins.flatMap((plugin) =>
      (plugin.capabilities?.provide ?? []).map((name) => ({
        name,
        description: plugin.capabilities.descriptions?.[name] ?? '',
        schema: plugin.capabilities.schemas?.[name],
        plugin,
      }))
    );
  }, [plugins]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (pluginFilter !== 'all' && row.plugin.id !== pluginFilter) return false;
      if (approvalOnly && !requiresApproval(row.name)) return false;
      if (!q) return true;
      return (
        row.name.toLowerCase().includes(q) ||
        row.description.toLowerCase().includes(q) ||
        row.plugin.id.toLowerCase().includes(q)
      );
    });
  }, [rows, query, pluginFilter, approvalOnly]);

  const grouped = useMemo(() => {
    const map = new Map<string, CapabilityRow[]>();
    for (const row of filtered) {
      const type = row.name.split('.')[0] || row.plugin.id;
      const list = map.get(type);
      if (list) {
        list.push(row);
      } else {
        map.set(type, [row]);
      }
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const selectedRow = useMemo(
    () => rows.find((r) => r.name === selected) ?? null,
    [rows, selected]
  );

  const selectedMetrics = selectedRow ? observability?.tool_metrics[selectedRow.name] : undefined;

  return (
    <div className="flex flex-col h-full w-full bg-background overflow-hidden">
      <ViewHeader
        title="Capabilities"
        count={`${filtered.length} / ${rows.length}`}
        actions={
          <>
            <div className="relative w-56">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search capabilities..."
                className="pl-8 h-8 text-xs font-mono bg-surface-2 border-border/40 focus-visible:ring-1 focus-visible:ring-brand"
              />
            </div>
            <Select value={pluginFilter} onValueChange={setPluginFilter}>
              <SelectTrigger className="w-40 h-8 text-xs font-mono bg-surface-2 border-border/40">
                <SelectValue placeholder="All plugins" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs font-mono">
                  All plugins
                </SelectItem>
                {plugins.map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-xs font-mono">
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              type="button"
              onClick={() => setApprovalOnly((v) => !v)}
              className={`flex items-center gap-1.5 px-2.5 h-8 rounded border font-mono text-[11px] transition-colors ${
                approvalOnly
                  ? 'border-destructive/50 text-destructive bg-destructive/10'
                  : 'border-border/40 text-muted-foreground hover:text-foreground bg-surface-2'
              }`}
              title="Show only capabilities that require approval"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              Requires approval
            </button>
          </>
        }
      />

      {/* ── Capability list and detail split ── */}
      <div className="flex flex-1 min-h-0 w-full overflow-hidden">
        <div className="flex-1 flex flex-col min-w-0 h-full border-r border-border/40">

        <ScrollArea className="flex-1">
          {grouped.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 select-none">
              <Boxes className="w-6 h-6 text-muted-foreground/50" />
              <p className="font-mono text-xs text-muted-foreground">
                {rows.length === 0
                  ? 'No capabilities discovered — check the Plugins view.'
                  : 'No capabilities match the current filters.'}
              </p>
            </div>
          ) : (
            <div className="p-2 flex flex-col gap-3">
              {grouped.map(([type, caps]) => {
                return (
                  <div key={type} className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2 px-2 py-1 font-mono">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                        {type}
                      </span>
                    </div>
                    {caps.map((row) => (
                      <button
                        key={row.name}
                        type="button"
                        onClick={() => setSelected(row.name)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded font-mono text-xs text-left transition-colors ${
                          selected === row.name ? 'bg-accent' : 'hover:bg-muted/50'
                        }`}
                      >
                        <span className="text-foreground font-semibold truncate">{row.name}</span>
                        {requiresApproval(row.name) && (
                          <ShieldAlert className="w-3 h-3 text-destructive flex-shrink-0" />
                        )}
                        <span className="text-muted-foreground truncate text-[11px]">
                          {row.description}
                        </span>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* ── Detail column ── */}
      {selectedRow && (
        <aside className="w-96 flex-shrink-0 flex flex-col h-full border-l border-border bg-card">
          <div className="h-10 px-3 flex items-center justify-between border-b border-border flex-shrink-0 font-mono text-xs">
            <span className="font-semibold text-foreground truncate">{selectedRow.name}</span>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              title="Close detail"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-3 flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={`px-1.5 py-0.5 rounded border font-mono text-[10px] ${
                    loadedPlugins.includes(selectedRow.plugin.id)
                      ? 'border-emerald-500/30 text-emerald-500'
                      : 'border-border text-muted-foreground'
                  }`}
                >
                  {selectedRow.plugin.state}
                </span>
                <span className="px-1.5 py-0.5 rounded border border-border font-mono text-[10px] text-muted-foreground">
                  {selectedRow.plugin.category}
                </span>
                {selectedRow.plugin.is_builtin && (
                  <span className="px-1.5 py-0.5 rounded border border-border font-mono text-[10px] text-muted-foreground">
                    builtin
                  </span>
                )}
                {requiresApproval(selectedRow.name) && (
                  <span className="px-1.5 py-0.5 rounded border border-destructive/50 font-mono text-[10px] text-destructive flex items-center gap-1">
                    <ShieldAlert className="w-3 h-3" />
                    requires approval
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-0.5">
                <span className="font-mono text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  Description
                </span>
                <p className="font-mono text-xs text-foreground leading-relaxed">
                  {selectedRow.description || '—'}
                </p>
              </div>

              <div className="flex flex-col gap-0.5">
                <span className="font-mono text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  Provider plugin
                </span>
                <span className="font-mono text-xs text-foreground break-all">
                  {selectedRow.plugin.name}{' '}
                  <span className="text-muted-foreground">({selectedRow.plugin.id})</span>
                </span>
              </div>

              <div className="flex flex-col gap-0.5">
                <span className="font-mono text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  Reliability
                </span>
                <span className="font-mono text-[11px] text-foreground">
                  <ReliabilityLine metrics={selectedMetrics} />
                </span>
              </div>

              {(selectedRow.plugin.capabilities.read.length > 0 ||
                selectedRow.plugin.capabilities.write.length > 0) && (
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                    Permissions
                  </span>
                  <div className="font-mono text-[11px] text-muted-foreground flex flex-col gap-0.5">
                    {selectedRow.plugin.capabilities.read.map((p) => (
                      <span key={`r-${p}`}>read: {p}</span>
                    ))}
                    {selectedRow.plugin.capabilities.write.map((p) => (
                      <span key={`w-${p}`}>write: {p}</span>
                    ))}
                  </div>
                </div>
              )}

              <SchemaBlock label="Input schema" schema={selectedRow.schema} />
            </div>
          </ScrollArea>
        </aside>
      )}
      </div>
    </div>
  );
}
