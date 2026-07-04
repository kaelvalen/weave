import { Sparkles, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface TeachBarProps {
  input: string;
  onInputChange: (val: string) => void;
  onSubmit: () => Promise<void>;
  isSubmitting: boolean;
}

export function TeachBar({
  input,
  onInputChange,
  onSubmit,
  isSubmitting,
}: TeachBarProps) {
  return (
    <div className="my-6">
      <div className="bg-gradient-to-r from-primary/15 via-purple-500/10 to-transparent p-[1px] rounded-2xl border border-primary/20 shadow-sm">
        <div className="bg-card/90 backdrop-blur-md rounded-[15px] p-3 flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex items-center gap-2.5 shrink-0 pl-1">
            <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center shadow-sm">
              <Sparkles className="w-4 h-4 animate-pulse" />
            </div>
            <span className="font-mono text-xs font-bold text-foreground">
              Teach Weave...
            </span>
          </div>

          <div className="flex-1 flex items-center gap-2">
            <Input
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !isSubmitting && onSubmit()}
              placeholder="Type any rule in natural language... (e.g. 'Prefers concise code explanations', 'Always use pnpm')"
              className="border-0 bg-transparent shadow-none focus-visible:ring-0 text-xs md:text-sm h-8 px-1 font-mono placeholder:text-muted-foreground/60 font-medium w-full"
              disabled={isSubmitting}
            />
          </div>

          <div className="flex items-center justify-end gap-2 shrink-0">
            <Button
              size="sm"
              onClick={onSubmit}
              disabled={!input.trim() || isSubmitting}
              className="rounded-xl h-8 px-4 font-mono font-bold text-xs bg-primary hover:bg-primary/90 text-primary-foreground transition-all shadow-sm flex items-center gap-1.5"
            >
              <span>{isSubmitting ? 'Learning...' : 'Remember Signal'}</span>
              {isSubmitting ? (
                <span className="w-3 h-3 rounded-full border-2 border-primary-foreground border-t-transparent animate-spin" />
              ) : (
                <ArrowRight className="w-3.5 h-3.5" />
              )}
            </Button>
          </div>
        </div>
      </div>
      <div className="px-3 pt-1.5 flex items-center justify-between text-[11px] font-mono text-muted-foreground/70">
        <span>Event Source: <code className="bg-muted/40 px-1 py-0.5 rounded text-foreground/80">manual input</code> (Confidence: 95%)</span>
        <span>Signals stream directly into active working memory</span>
      </div>
    </div>
  );
}
