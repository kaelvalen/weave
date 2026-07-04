import { useState } from 'react';
import {
  Brain,
  Search,
  Check,
  Edit3,
  Trash2,
  Clock,
  Tag,
  Activity,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { MemoryEvent } from '@/hooks/profile/useMemories';

interface MemoryTimelineProps {
  groupedMemories: {
    today: MemoryEvent[];
    yesterday: MemoryEvent[];
    earlier: MemoryEvent[];
  };
  totalCount: number;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onDelete: (key: string) => Promise<void>;
  onUpdate: (event: MemoryEvent) => Promise<void>;
  isLoading: boolean;
}

export function MemoryTimeline({
  groupedMemories,
  totalCount,
  searchQuery,
  onSearchChange,
  onDelete,
  onUpdate,
  isLoading,
}: MemoryTimelineProps) {
  const { today, yesterday, earlier } = groupedMemories;
  const hasAny = today.length > 0 || yesterday.length > 0 || earlier.length > 0;

  return (
    <div className="my-6 space-y-6">
      {/* Timeline Filter Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/30 pb-4">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-bold font-mono uppercase tracking-wider text-foreground">
            AI Memory Timeline
          </h2>
          <Badge variant="outline" className="font-mono text-xs py-0.5 px-2 bg-card/40 border-border/40">
            {totalCount} events
          </Badge>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search signals, tags, keys..."
            className="pl-8 h-8 text-xs font-mono bg-card/40 border-border/40 rounded-xl"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground font-mono text-xs animate-pulse">
          Loading memory event stream...
        </div>
      ) : !hasAny ? (
        <div className="text-center py-16 bg-card/20 border border-dashed border-border/30 rounded-2xl p-6 text-muted-foreground font-mono">
          <Brain className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-xs font-bold text-foreground">
            {searchQuery ? 'No matching signals found' : 'No memory events recorded yet'}
          </p>
          <p className="text-[11px] mt-1 max-w-sm mx-auto text-muted-foreground/80 leading-relaxed">
            Use the Teach bar above or interact with Weave AI to begin populating your personal context stream.
          </p>
        </div>
      ) : (
        <div className="space-y-8 relative before:absolute before:left-3 md:before:left-4 before:top-3 before:bottom-3 before:w-px before:bg-border/30">
          {today.length > 0 && (
            <TimelineGroup
              label="Today"
              items={today}
              onDelete={onDelete}
              onUpdate={onUpdate}
            />
          )}

          {yesterday.length > 0 && (
            <TimelineGroup
              label="Yesterday"
              items={yesterday}
              onDelete={onDelete}
              onUpdate={onUpdate}
            />
          )}

          {earlier.length > 0 && (
            <TimelineGroup
              label="Earlier Signals"
              items={earlier}
              onDelete={onDelete}
              onUpdate={onUpdate}
            />
          )}
        </div>
      )}
    </div>
  );
}

/* ── Timeline Group Section ── */
function TimelineGroup({
  label,
  items,
  onDelete,
  onUpdate,
}: {
  label: string;
  items: MemoryEvent[];
  onDelete: (key: string) => Promise<void>;
  onUpdate: (event: MemoryEvent) => Promise<void>;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 pl-1.5 md:pl-2">
        <div className="w-3 h-3 rounded-full bg-primary ring-4 ring-background z-10 shrink-0" />
        <span className="text-xs font-mono font-bold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span className="text-[10px] font-mono text-muted-foreground/60">({items.length})</span>
      </div>

      <div className="pl-7 md:pl-8 space-y-2.5">
        {items.map((event) => (
          <MemoryEventCard
            key={event.id || event.key}
            event={event}
            onDelete={onDelete}
            onUpdate={onUpdate}
          />
        ))}
      </div>
    </div>
  );
}

/* ── Individual Memory Event Card ── */
function MemoryEventCard({
  event,
  onDelete,
  onUpdate,
}: {
  event: MemoryEvent;
  onDelete: (key: string) => Promise<void>;
  onUpdate: (event: MemoryEvent) => Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [content, setContent] = useState(event.content);
  const [confidence, setConfidence] = useState(event.confidence);

  const handleSave = async () => {
    setIsEditing(false);
    await onUpdate({ ...event, content, confidence });
  };

  // Format time (e.g. 14:22)
  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch {
      return '';
    }
  };

  const confPercent = Math.round(event.confidence * 100);
  const isHighConf = event.confidence >= 0.85;

  return (
    <div className="bg-card/40 border border-border/30 rounded-xl p-4 backdrop-blur-sm hover:border-border/60 hover:bg-card/60 transition-all flex flex-col justify-between gap-3 group">
      <div className="space-y-2">
        {/* Header meta */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={`py-0 px-1.5 text-[10px] font-mono border ${
                event.source === 'manual input'
                  ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                  : 'bg-primary/10 text-primary border-primary/20'
              }`}
            >
              Source: {event.source}
            </Badge>

            <Badge
              variant="outline"
              className={`py-0 px-1.5 text-[10px] font-mono border ${
                isHighConf
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
              }`}
            >
              Confidence: {confPercent}% ({isHighConf ? 'High' : 'Medium'})
            </Badge>
          </div>

          <div className="flex items-center gap-1.5 text-muted-foreground/70">
            <Clock className="w-3 h-3" />
            <span>{formatTime(event.timestamp)}</span>
            <span className="opacity-40">|</span>
            <span className="text-[10px] text-muted-foreground font-mono">id:{event.id}</span>
          </div>
        </div>

        {/* Content / Editor */}
        {isEditing ? (
          <div className="space-y-2 pt-1">
            <Input
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="h-8 text-xs font-mono bg-background border-border/50"
              autoFocus
            />
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-muted-foreground">Confidence:</span>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={confidence}
                onChange={(e) => setConfidence(parseFloat(e.target.value))}
                className="w-24 accent-primary h-1 bg-muted rounded-lg"
              />
              <span className="text-[10px] font-mono font-bold text-primary">{Math.round(confidence * 100)}%</span>
            </div>
          </div>
        ) : (
          <p className="text-xs font-mono text-foreground/90 leading-relaxed font-medium pl-2 border-l-2 border-primary/30 py-0.5">
            Learned: <span className="text-foreground font-bold">{event.content}</span>
          </p>
        )}
      </div>

      {/* Footer tags & action controls */}
      <div className="flex items-center justify-between gap-4 pt-2 border-t border-border/15">
        <div className="flex flex-wrap items-center gap-1">
          <Tag className="w-3 h-3 text-muted-foreground/60 mr-0.5" />
          {event.tags.map((t) => (
            <span
              key={t}
              className="text-[10px] font-mono bg-muted/40 text-muted-foreground px-1.5 py-0.5 rounded border border-border/20"
            >
              #{t}
            </span>
          ))}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {isEditing ? (
            <>
              <Button size="sm" onClick={handleSave} className="h-6 text-[11px] font-mono px-2 bg-primary text-primary-foreground">
                <Check className="w-3 h-3 mr-1" /> Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)} className="h-6 text-[11px] font-mono px-2">
                Cancel
              </Button>
            </>
          ) : (
            <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsEditing(true)}
                className="h-6 w-6 text-muted-foreground hover:text-foreground rounded-md"
                title="Edit Signal"
              >
                <Edit3 className="w-3 h-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onDelete(event.key)}
                className="h-6 w-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md"
                title="Forget Signal"
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
