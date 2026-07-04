import { useState, useCallback } from 'react';
import {
  Search,
  FileText,
  FileCode,
  Loader2,
  ArrowRight,
  X,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ipc } from '@/lib/ipc';

interface SearchMatch {
  name: string;
  path: string;
  type: string;
  size?: number;
}

interface SearchResult {
  matches: SearchMatch[];
  count: number;
  success: boolean;
}

export interface WorkspaceSearchProps {
  currentRoot: string;
  onSelectFile: (path: string, name: string) => void;
}

export function WorkspaceSearch({ currentRoot, onSelectFile }: WorkspaceSearchProps) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchMatch[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = useCallback(async () => {
    if (!query.trim() || !currentRoot) return;
    setLoading(true);
    setHasSearched(true);
    try {
      const res = (await ipc.pluginExecute('com.weave.builtin.file', 'file.search', {
        directory: currentRoot,
        pattern: query.trim(),
      })) as SearchResult;
      if (res && res.matches) {
        setResults(res.matches.filter((m) => m.type !== 'directory'));
      } else {
        setResults([]);
      }
    } catch (err) {
      console.error('Search error:', err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query, currentRoot]);

  const handleClear = () => {
    setQuery('');
    setResults([]);
    setHasSearched(false);
  };

  return (
    <div className="flex flex-col h-full bg-card/60 select-none">
      {/* Search Header & Input */}
      <div className="p-3 border-b border-border/60 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-foreground flex items-center gap-2">
            <Search className="w-4 h-4 text-primary" />
            <span>Workspace Search</span>
          </span>
          {query && (
            <Button
              variant="ghost"
              size="icon"
              className="w-6 h-6 text-muted-foreground hover:text-foreground"
              onClick={handleClear}
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
        <div className="flex gap-1.5">
          <Input
            placeholder="Search filenames or patterns..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="text-xs h-8 bg-background border-border/80 flex-1"
          />
          <Button
            size="sm"
            onClick={handleSearch}
            disabled={loading || !query.trim()}
            className="h-8 px-2.5 text-xs bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg shrink-0"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          </Button>
        </div>
        {hasSearched && !loading && (
          <div className="text-[11px] text-muted-foreground px-0.5 font-mono">
            Found {results.length} {results.length === 1 ? 'file' : 'files'}
          </div>
        )}
      </div>

      {/* Search Results */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1">
          {loading && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground space-y-2">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <span className="text-xs">Searching workspace...</span>
            </div>
          )}

          {!loading && hasSearched && results.length === 0 && (
            <div className="py-12 text-center text-muted-foreground space-y-1">
              <Search className="w-8 h-8 mx-auto opacity-30 mb-2" />
              <p className="text-xs font-semibold text-foreground">No matches found</p>
              <p className="text-[11px]">Try a shorter or different keyword</p>
            </div>
          )}

          {!loading && !hasSearched && (
            <div className="py-12 text-center text-muted-foreground space-y-1 px-4">
              <FileCode className="w-8 h-8 mx-auto opacity-30 mb-2 text-primary" />
              <p className="text-xs font-semibold text-foreground">Quick File Finder</p>
              <p className="text-[11px] leading-relaxed">
                Enter a file name or pattern to recursively search your active project root.
              </p>
            </div>
          )}

          {!loading &&
            results.map((match, idx) => {
              // Calculate relative path from currentRoot
              const relPath = match.path.startsWith(currentRoot)
                ? match.path.slice(currentRoot.length).replace(/^\//, '')
                : match.path;

              return (
                <div
                  key={idx}
                  onClick={() => onSelectFile(match.path, match.name)}
                  className="flex items-center justify-between p-2 rounded-lg bg-background/60 hover:bg-muted/80 border border-border/40 text-xs transition-all cursor-pointer group"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <FileText className="w-3.5 h-3.5 text-primary shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-mono font-semibold text-foreground truncate">{match.name}</p>
                      <p className="font-mono text-[10px] text-muted-foreground truncate" title={match.path}>
                        {relPath}
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity ml-1 shrink-0" />
                </div>
              );
            })}
        </div>
      </ScrollArea>
    </div>
  );
}
